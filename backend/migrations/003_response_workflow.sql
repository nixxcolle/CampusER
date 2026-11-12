BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE incidents
  ADD COLUMN IF NOT EXISTS response_status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz,
  ADD COLUMN IF NOT EXISTS acknowledged_by uuid,
  ADD COLUMN IF NOT EXISTS acknowledged_office text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='incidents'::regclass AND conname='incidents_response_status_values') THEN
    ALTER TABLE incidents ADD CONSTRAINT incidents_response_status_values
      CHECK (response_status IN ('active','pending','acknowledged','resolved'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='incidents'::regclass AND conname='incidents_acknowledgment_complete') THEN
    ALTER TABLE incidents ADD CONSTRAINT incidents_acknowledgment_complete CHECK (
      (acknowledged_at IS NULL AND acknowledged_by IS NULL AND acknowledged_office IS NULL) OR
      (acknowledged_at IS NOT NULL AND acknowledged_by IS NOT NULL AND acknowledged_office IS NOT NULL AND acknowledged_office IN ('School Clinic','Campus Security','DRRMO','Administrator'))
    );
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='campus_er_app') THEN
    GRANT UPDATE (response_status, acknowledged_at, acknowledged_by, acknowledged_office) ON incidents TO campus_er_app;
  END IF;
END $$;
COMMIT;
