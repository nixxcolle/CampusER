BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.incident_audio
  ADD COLUMN IF NOT EXISTS transcript_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS transcript_text text,
  ADD COLUMN IF NOT EXISTS transcription_claim uuid,
  ADD COLUMN IF NOT EXISTS transcription_lease_until timestamptz;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.incident_audio'::regclass AND conname = 'incident_audio_transcript_state'
  ) THEN
    ALTER TABLE public.incident_audio ADD CONSTRAINT incident_audio_transcript_state CHECK (
      transcript_status IN ('pending', 'processing', 'ready', 'failed', 'no_speech')
      AND (
        (transcript_status = 'ready' AND transcript_text IS NOT NULL AND char_length(transcript_text) BETWEEN 1 AND 4000)
        OR (transcript_status <> 'ready' AND transcript_text IS NULL)
      )
      AND (
        (transcript_status = 'processing' AND transcription_claim IS NOT NULL AND transcription_lease_until IS NOT NULL)
        OR (transcript_status <> 'processing' AND transcription_claim IS NULL AND transcription_lease_until IS NULL)
      )
    );
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'campus_er_app') THEN
    GRANT UPDATE (transcript_status, transcript_text, transcription_claim, transcription_lease_until)
      ON public.incident_audio TO campus_er_app;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS incident_audio_transcript_queue
  ON public.incident_audio (created_at DESC, event_id)
  WHERE transcript_status IN ('pending', 'processing');

COMMIT;
