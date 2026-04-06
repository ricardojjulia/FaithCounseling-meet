/**
 * VideoSessionModal — Mantine modal that launches a Jitsi video session
 *
 * Copy to apps/web/src/components/VideoSessionModal.jsx
 *
 * Props:
 *  opened        {boolean}  — controls modal visibility
 *  appointmentId {string}   — ID of the appointment row
 *  isPortal      {boolean}  — true when rendered inside the client portal
 *  onClose       {function} — called when user closes or session ends
 *
 * Usage in SchedulingPage.jsx or CounselorHomePage.jsx:
 *
 *   const [videoApptId, setVideoApptId] = useState(null);
 *
 *   <VideoSessionModal
 *     opened={videoApptId !== null}
 *     appointmentId={videoApptId}
 *     onClose={() => setVideoApptId(null)}
 *   />
 */

import { useRef, useState, useEffect, useCallback } from 'react';
import {
    Alert,
    Button,
    Group,
    Loader,
    Modal,
    Stack,
    Text,
} from '@mantine/core';
import { IconVideo, IconVideoOff } from '@tabler/icons-react';
import { useJitsiApi } from '../lib/useJitsiApi.js';
import { useI18n } from '../lib/i18nContext.jsx';

const JITSI_DOMAIN = import.meta.env.VITE_JITSI_DOMAIN ?? 'meet.jit.si';

/**
 * Fetch a short-lived JWT + room name from the FaithCounseling API.
 *
 * @param {string}  appointmentId
 * @param {boolean} isPortal
 * @returns {Promise<{roomName: string, token: string, meetUrl: string}>}
 */
async function fetchVideoSession(appointmentId, isPortal) {
    const base = isPortal
        ? `/api/v1/portal/appointments/${encodeURIComponent(appointmentId)}/video-session`
        : `/api/v1/appointments/${encodeURIComponent(appointmentId)}/video-session`;

    const res = await fetch(base, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
    });

    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? res.statusText);
    }
    return res.json();
}

export default function VideoSessionModal({ opened, appointmentId, isPortal = false, onClose }) {
    const { t } = useI18n();
    const containerRef = useRef(null);

    const [session, setSession] = useState(null);  // { roomName, token }
    const [loading, setLoading] = useState(false);
    const [fetchError, setFetchError] = useState(null);
    const [sessionEnded, setSessionEnded] = useState(false);

    // Load session credentials when the modal opens
    useEffect(() => {
        if (!opened || !appointmentId) return;

        setSession(null);
        setFetchError(null);
        setSessionEnded(false);
        setLoading(true);

        fetchVideoSession(appointmentId, isPortal)
            .then(setSession)
            .catch((err) => setFetchError(err.message))
            .finally(() => setLoading(false));
    }, [opened, appointmentId, isPortal]);

    const handleLeft = useCallback(() => {
        setSessionEnded(true);
    }, []);

    const handleReadyToClose = useCallback(() => {
        onClose();
    }, [onClose]);

    const { api, ready, error: apiError } = useJitsiApi({
        domain: JITSI_DOMAIN,
        roomName: session?.roomName ?? null,
        jwt: session?.token ?? null,
        containerRef,
        onLeft: handleLeft,
        onReadyToClose: handleReadyToClose,
    });

    // Hang up and close
    const handleClose = useCallback(() => {
        api?.executeCommand('hangup');
        onClose();
    }, [api, onClose]);

    const displayError = fetchError ?? apiError;

    return (
        <Modal
            opened={opened}
            onClose={handleClose}
            title={
                <Group gap="xs">
                    <IconVideo size={18} />
                    <Text fw={600}>{t('scheduling.joinVideo')}</Text>
                </Group>
            }
            size="100%"
            fullScreen
            withCloseButton={!ready || sessionEnded}
            closeOnClickOutside={false}
            closeOnEscape={false}
            styles={{
                body: { padding: 0, height: 'calc(100vh - 60px)', display: 'flex', flexDirection: 'column' },
                header: { padding: '8px 16px' },
            }}
        >
            {/* ── Loading state ── */}
            {loading && (
                <Stack align="center" justify="center" style={{ flex: 1 }}>
                    <Loader size="lg" />
                    <Text c="dimmed">{t('video.loadingSession')}</Text>
                </Stack>
            )}

            {/* ── Error state ── */}
            {!loading && displayError && (
                <Stack align="center" justify="center" style={{ flex: 1 }} p="xl">
                    <IconVideoOff size={40} color="var(--mantine-color-red-6)" />
                    <Alert color="red" variant="light" w="100%" maw={480} title={t('video.sessionError')}>
                        {displayError}
                    </Alert>
                    <Button variant="light" onClick={onClose}>
                        {t('action.close')}
                    </Button>
                </Stack>
            )}

            {/* ── Session ended ── */}
            {sessionEnded && (
                <Stack align="center" justify="center" style={{ flex: 1 }}>
                    <Text size="lg" fw={500}>{t('video.sessionEnded')}</Text>
                    <Button onClick={onClose}>{t('action.close')}</Button>
                </Stack>
            )}

            {/* ── Jitsi iframe container ── */}
            {!loading && !displayError && !sessionEnded && (
                <div
                    ref={containerRef}
                    style={{ flex: 1, width: '100%', position: 'relative' }}
                >
                    {/* The External API renders an <iframe> inside this div */}
                    {!ready && (
                        <Stack
                            align="center"
                            justify="center"
                            style={{ position: 'absolute', inset: 0 }}
                        >
                            <Loader size="md" />
                        </Stack>
                    )}
                </div>
            )}
        </Modal>
    );
}
