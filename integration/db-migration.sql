-- Migration: add video_room_id to appointments
-- Run once against the faith_counseling database.
--
-- This column stores the deterministic Jitsi room name for each telehealth
-- appointment.  It is NULL for in-person or phone appointments and is populated
-- on the first call to POST /api/v1/appointments/:id/video-session.

ALTER TABLE appointments
    ADD COLUMN video_room_id VARCHAR(128) NULL DEFAULT NULL
        COMMENT 'Jitsi room name for telehealth appointments; NULL = not a video session';
