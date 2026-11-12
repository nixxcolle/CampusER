BEGIN;

CREATE TABLE stations (
    station_id text PRIMARY KEY CHECK (btrim(station_id) <> ''),
    location text NOT NULL CHECK (btrim(location) <> ''),
    device_token_sha256 text NOT NULL UNIQUE
        CHECK (device_token_sha256 ~ '^[0-9a-f]{64}$')
);

CREATE TABLE incidents (
    event_id text PRIMARY KEY CHECK (btrim(event_id) <> ''),
    station_id text NOT NULL REFERENCES stations (station_id),
    -- Keep the location and office resolved at the time the report was saved.
    location text NOT NULL CHECK (btrim(location) <> ''),
    receiving_office text NOT NULL CHECK (btrim(receiving_office) <> ''),
    category text NOT NULL
        CHECK (category IN ('MEDICAL', 'SECURITY', 'FIRE_DISASTER', 'GENERAL')),
    -- The API maps the firmware's JSON trigger field to this column.
    trigger_source text NOT NULL CHECK (trigger_source = 'physical_button'),
    uptime_ms bigint NOT NULL CHECK (uptime_ms BETWEEN 0 AND 4294967295),
    -- The firmware sends null when the station clock was unsynchronized.
    occurred_at_unix bigint CHECK (occurred_at_unix >= 0),
    received_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMIT;
