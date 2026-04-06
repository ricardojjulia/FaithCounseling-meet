/**
 * useJitsiApi — React hook for the Jitsi Meet External API
 *
 * Copy to apps/web/src/lib/useJitsiApi.js
 *
 * Handles:
 *  - Dynamic script loading (one load per page)
 *  - API instantiation inside a provided DOM container ref
 *  - Event forwarding through a stable callbacks object
 *  - Cleanup (api.dispose) on unmount or roomName change
 *
 * Usage:
 *
 *   const containerRef = useRef(null);
 *   const { api, ready, error } = useJitsiApi({
 *     domain: import.meta.env.VITE_JITSI_DOMAIN,
 *     roomName,
 *     jwt,
 *     containerRef,
 *     onJoined: () => console.log('joined'),
 *     onLeft:   () => console.log('left'),
 *   });
 */

import { useState, useEffect, useRef, useCallback } from 'react';

const SCRIPT_ID = 'jitsi-external-api-script';

/**
 * Dynamically load the Jitsi External API script exactly once.
 *
 * @param {string} domain
 * @returns {Promise<void>}
 */
function loadJitsiScript(domain) {
    return new Promise((resolve, reject) => {
        if (document.getElementById(SCRIPT_ID)) {
            resolve();
            return;
        }
        const script = document.createElement('script');
        script.id = SCRIPT_ID;
        script.src = `https://${domain}/external_api.js`;
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error(`Failed to load Jitsi script from ${domain}`));
        document.head.appendChild(script);
    });
}

/**
 * @typedef {object} UseJitsiApiOptions
 * @property {string}            domain       - Jitsi Meet domain (no protocol)
 * @property {string}            roomName     - Jitsi room name
 * @property {string}            [jwt]        - JWT token from the FaithCounseling API
 * @property {React.RefObject}   containerRef - ref attached to the div that holds the iframe
 * @property {string}            [displayName]
 * @property {function}          [onJoined]   - fired when the local participant joins
 * @property {function}          [onLeft]     - fired when the local participant leaves / hangup
 * @property {function}          [onParticipantJoined]
 * @property {function}          [onParticipantLeft]
 * @property {function}          [onReadyToClose]
 */

/**
 * @param {UseJitsiApiOptions} options
 */
export function useJitsiApi({
    domain,
    roomName,
    jwt,
    containerRef,
    displayName,
    onJoined,
    onLeft,
    onParticipantJoined,
    onParticipantLeft,
    onReadyToClose,
}) {
    const [api, setApi] = useState(null);
    const [ready, setReady] = useState(false);
    const [error, setError] = useState(null);

    // Keep callback references stable so callers do not need to memoize them
    const cbRef = useRef({});
    cbRef.current = { onJoined, onLeft, onParticipantJoined, onParticipantLeft, onReadyToClose };

    const initialize = useCallback(async () => {
        if (!domain || !roomName || !containerRef.current) return;

        try {
            await loadJitsiScript(domain);
        } catch (err) {
            setError(err.message);
            return;
        }

        if (typeof window.JitsiMeetExternalAPI === 'undefined') {
            setError('JitsiMeetExternalAPI not available after script load');
            return;
        }

        const options = {
            roomName,
            parentNode: containerRef.current,
            width: '100%',
            height: '100%',
            configOverwrite: {
                // welcomePage.disabled is already set server-side in config.js; repeated
                // here so the embedded iframe honours it regardless of server config drift.
                welcomePage: { disabled: true },
                disableInviteFunctions: true,
                doNotStoreRoom: true,
                // Pre-join screen is intentionally kept at its server default (enabled)
                // so counselors and clients can confirm audio/video devices before entering.
            },
            interfaceConfigOverwrite: {
                SHOW_JITSI_WATERMARK: false,
                SHOW_BRAND_WATERMARK: false,
                TOOLBAR_BUTTONS: [
                    'camera', 'chat', 'desktop', 'filmstrip', 'fullscreen',
                    'hangup', 'microphone', 'noisesuppression', 'participants-pane',
                    'raisehand', 'select-background', 'settings', 'tileview', 'videoquality',
                ],
            },
            ...(jwt ? { jwt } : {}),
            ...(displayName ? { userInfo: { displayName } } : {}),
        };

        const instance = new window.JitsiMeetExternalAPI(domain, options);

        instance.addEventListener('videoConferenceJoined', (data) => {
            setReady(true);
            cbRef.current.onJoined?.(data);
        });

        instance.addEventListener('videoConferenceLeft', (data) => {
            cbRef.current.onLeft?.(data);
        });

        instance.addEventListener('participantJoined', (data) => {
            cbRef.current.onParticipantJoined?.(data);
        });

        instance.addEventListener('participantLeft', (data) => {
            cbRef.current.onParticipantLeft?.(data);
        });

        instance.addEventListener('readyToClose', () => {
            cbRef.current.onReadyToClose?.();
        });

        setApi(instance);

        return () => {
            instance.dispose();
            setApi(null);
            setReady(false);
        };
    }, [domain, roomName, jwt, displayName, containerRef]);

    useEffect(() => {
        let cleanup;
        initialize()
            .then((fn) => { cleanup = fn; })
            .catch((err) => { console.error('[useJitsiApi] initialization failed:', err); });
        return () => { cleanup?.(); };
    }, [initialize]);

    return { api, ready, error };
}
