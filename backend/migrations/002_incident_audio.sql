BEGIN;

CREATE TABLE IF NOT EXISTS incident_audio (
    event_id text PRIMARY KEY REFERENCES incidents (event_id),
    sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    byte_length integer NOT NULL CHECK (byte_length BETWEEN 44 AND 1048576),
    duration_ms integer NOT NULL CHECK (duration_ms BETWEEN 1 AND 10000),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMIT;
