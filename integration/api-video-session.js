/**
 * API route: video session token endpoint
 *
 * Copy this file to apps/api/src/api-video-session.js and register it in
 * apps/api/src/index.js:
 *
 *   import videoSessionRouter from './api-video-session.js';
 *   app.use('/api/v1/appointments', videoSessionRouter);
 *
 * Also register the portal variant:
 *   app.use('/api/v1/portal/appointments', portalVideoSessionRouter);
 *
 * Required env vars (add to .env):
 *   JITSI_DOMAIN       — e.g. meet.faithcounseling.app
 *   JITSI_APP_ID       — e.g. faithcounseling
 *   JITSI_APP_SECRET   — long random secret matching Prosody config
 *   JITSI_TOKEN_TTL    — seconds until token expires (default 7200)
 */

import { Router } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';

const router = Router();

const {
    JITSI_DOMAIN,
    JITSI_APP_ID,
    JITSI_APP_SECRET,
    JITSI_TOKEN_TTL = '7200',
} = process.env;

/**
 * Generate a stable, URL-safe room name from an appointment ID.
 * The room name is deterministic so that both counselor and client receive
 * the same name from separate API calls, but is not guessable from the
 * appointment ID alone.
 */
function deriveRoomName(appointmentId, secret) {
    const hash = createHash('sha256')
        .update(`faith-room-${appointmentId}-${secret}`)
        .digest('hex')
        .slice(0, 24);
    return `faith-${hash}`;
}

/**
 * Build a Jitsi JWT.
 *
 * @param {object} opts
 * @param {string}  opts.roomName
 * @param {string}  opts.userId      — stable user identifier (counselorId / clientId)
 * @param {string}  opts.displayName
 * @param {string}  [opts.email]
 * @param {boolean} opts.isModerator — true for counselors
 */
function buildJwt({ roomName, userId, displayName, email, isModerator }) {
    const now = Math.floor(Date.now() / 1000);
    const ttl = parseInt(JITSI_TOKEN_TTL, 10);

    const payload = {
        iss: JITSI_APP_ID,
        sub: JITSI_DOMAIN,
        aud: JITSI_APP_ID,
        iat: now,
        exp: now + ttl,
        room: roomName,
        context: {
            user: {
                id: String(userId),
                name: displayName,
                ...(email ? { email } : {}),
                moderator: isModerator,
            },
            features: {
                livestreaming: false,
                recording: false,
                'screen-sharing': true,
                transcription: false,
            },
        },
    };

    return jwt.sign(payload, JITSI_APP_SECRET, { algorithm: 'HS256' });
}

/**
 * Fetch an appointment row from the DB.
 * Replace the db.query call with however the rest of the codebase accesses MySQL
 * (e.g. the `db` helper already used in apps/api/src/index.js).
 */
async function getAppointment(db, appointmentId) {
    const [rows] = await db.query(
        'SELECT * FROM appointments WHERE id = ? LIMIT 1',
        [appointmentId],
    );
    return rows[0] ?? null;
}

/**
 * Persist the room name so subsequent calls return the same room.
 */
async function persistRoomName(db, appointmentId, roomName) {
    await db.query(
        'UPDATE appointments SET video_room_id = ? WHERE id = ? AND video_room_id IS NULL',
        [roomName, appointmentId],
    );
}

// ── Counselor / admin endpoint ────────────────────────────────────────────────

/**
 * POST /api/v1/appointments/:id/video-session
 *
 * The caller must be authenticated (session cookie / JWT) as a counselor or admin.
 * Returns { roomName, token, meetUrl }.
 */
router.post('/:id/video-session', async (req, res) => {
    const { id } = req.params;

    // req.user is populated by your existing auth middleware
    const user = req.user;
    if (!user) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const db = req.app.locals.db;
        const appt = await getAppointment(db, id);

        if (!appt) {
            return res.status(404).json({ error: 'Appointment not found' });
        }

        // Only the assigned counselor, their admin, or an org admin may start a session
        const isAssignedCounselor = String(appt.counselor_id) === String(user.id);
        const isAdmin = user.role === 'admin' || user.role === 'org_admin';
        if (!isAssignedCounselor && !isAdmin) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        // Use persisted room name or derive a new one
        const roomName = appt.video_room_id ?? deriveRoomName(id, JITSI_APP_SECRET);

        if (!appt.video_room_id) {
            await persistRoomName(db, id, roomName);
        }

        const token = buildJwt({
            roomName,
            userId: user.id,
            displayName: user.displayName ?? user.name ?? 'Counselor',
            email: user.email,
            isModerator: true,
        });

        console.info(`[video-session] counselor=${user.id} appt=${id} room=${roomName}`);

        return res.json({
            roomName,
            token,
            meetUrl: `https://${JITSI_DOMAIN}/${roomName}`,
        });
    } catch (err) {
        console.error('[video-session] error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;

// ── Client portal variant ─────────────────────────────────────────────────────

export const portalVideoSessionRouter = Router();

/**
 * POST /api/v1/portal/appointments/:id/video-session
 *
 * Called by the client-authenticated portal.  Issues a non-moderator token.
 */
portalVideoSessionRouter.post('/:id/video-session', async (req, res) => {
    const { id } = req.params;

    // req.portalClient is populated by the portal auth middleware
    const client = req.portalClient;
    if (!client) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const db = req.app.locals.db;
        const appt = await getAppointment(db, id);

        if (!appt) {
            return res.status(404).json({ error: 'Appointment not found' });
        }

        // Clients may only join their own appointments
        if (String(appt.client_id) !== String(client.id)) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        // Room must have been created by the counselor first
        const roomName = appt.video_room_id;
        if (!roomName) {
            return res.status(409).json({
                error: 'Session not yet started by counselor',
            });
        }

        const token = buildJwt({
            roomName,
            userId: client.id,
            displayName: client.displayName ?? client.name ?? 'Client',
            email: client.email,
            isModerator: false,
        });

        console.info(`[video-session] client=${client.id} appt=${id} room=${roomName}`);

        return res.json({
            roomName,
            token,
            meetUrl: `https://${JITSI_DOMAIN}/${roomName}`,
        });
    } catch (err) {
        console.error('[portal-video-session] error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});
