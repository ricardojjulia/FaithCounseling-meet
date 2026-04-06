# FaithCounseling × FaithCounseling-meet Integration Guide

This directory contains all the code you need to wire FaithCounseling-meet into the
[FaithCounseling](https://github.com/ricardojjulia/FaithCounseling) practice management
platform. Every file here is ready to copy directly into the FaithCounseling monorepo.

---

## Directory layout

```
integration/
├── README.md                  ← this file
├── .env.example               ← environment variables (add to root .env)
├── db-migration.sql           ← add video_room_id to the appointments table
├── api-video-session.js       ← Express route: POST /api/v1/appointments/:id/video-session
├── useJitsiApi.js             ← React hook encapsulating the External API lifecycle
└── VideoSessionModal.jsx      ← Drop-in Mantine modal for launching a session
```

---

## Prerequisites

| Requirement | Notes |
|-------------|-------|
| Self-hosted Jitsi stack | Deploy with `docker-compose.yml` in the root of this repo. |
| `JITSI_APP_ID` / `JITSI_APP_SECRET` | Set in Prosody's token plugin and in your API `.env`. |
| `jsonwebtoken` npm package | Already required by many Node stacks; add with `pnpm add jsonwebtoken`. |
| HTTPS everywhere | WebRTC requires a secure context. |

For a **quick smoke-test without running your own Jitsi**, set `JITSI_DOMAIN=meet.jit.si`
and omit JWT — rooms will be public. Replace with the self-hosted domain before production.

---

## Step-by-step

### 1 — Run the database migration

```bash
mysql -u faith_app -p faith_counseling < integration/db-migration.sql
```

### 2 — Add the API route

Copy `api-video-session.js` to `apps/api/src/` and register it in `apps/api/src/index.js`:

```js
import videoSessionRouter from './api-video-session.js';
// ...inside the app setup:
app.use('/api/v1/appointments', videoSessionRouter);
```

Install the JWT library if not already present:

```bash
cd apps/api && pnpm add jsonwebtoken
```

### 3 — Add the React hook and modal

Copy `useJitsiApi.js` and `VideoSessionModal.jsx` to `apps/web/src/components/` (or
`apps/web/src/lib/` for the hook).

### 4 — Add the "Join Session" button

In `SchedulingPage.jsx`, import `VideoSessionModal` and add a state variable:

```jsx
import VideoSessionModal from './VideoSessionModal.jsx';

// inside the component:
const [videoApptId, setVideoApptId] = useState(null);

// in the appointment row actions:
<Button
  size="xs"
  variant="light"
  color="violet"
  leftSection={<IconVideo size={14} />}
  onClick={() => setVideoApptId(appt.id)}
>
  {t('scheduling.joinVideo')}
</Button>

// at the bottom of the component tree:
<VideoSessionModal
  opened={videoApptId !== null}
  appointmentId={videoApptId}
  onClose={() => setVideoApptId(null)}
/>
```

### 5 — Add i18n keys

Add the following keys to every language file in `packages/i18n/`:

```json
"scheduling.joinVideo": "Join Video Session",
"scheduling.startVideo": "Start Video Session",
"video.sessionEnded": "Session ended",
"video.loadingSession": "Connecting to session…",
"video.sessionError": "Could not start video session."
```

### 6 — Environment variables

Add to your root `.env` (see `.env.example`):

```
JITSI_DOMAIN=meet.faithcounseling.app
JITSI_APP_ID=faithcounseling
JITSI_APP_SECRET=<change-me>
VITE_JITSI_DOMAIN=meet.faithcounseling.app
```

---

## Security notes

- JWT tokens expire in **2 hours** — counselors/clients must refresh the page to get a new token after that window.
- Each appointment gets a **unique, random room name** generated on first call and persisted in `video_room_id`.
- The counselor always receives `moderator: true`; the client receives `moderator: false`.
- With a self-hosted Prosody (JWT auth enabled), no one can join without a valid token.
- Session start/end events are logged to the API console; extend to an audit table as needed (see `PLANS/FULL-SECURITY-AND-AUDITING.md`).
