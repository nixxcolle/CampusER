BEGIN;
SET LOCAL lock_timeout = '5s';
-- Stop rather than silently relying on a table with row security disabled.
DO $$ BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.emergency_reports'::regclass) THEN
    RAISE EXCEPTION 'Enable and review emergency_reports row security before applying this migration';
  END IF;
END $$;
ALTER TABLE public.emergency_reports
  ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz,
  ADD COLUMN IF NOT EXISTS acknowledged_by uuid,
  ADD COLUMN IF NOT EXISTS acknowledged_office text;

CREATE OR REPLACE FUNCTION public.campus_er_can_receive(report_type text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=auth.uid()
    AND p.office::text IN ('School Clinic','Campus Security','DRRMO','Administrator')
    AND (report_type='General Emergency' OR p.office::text='Administrator'
      OR (p.office::text='School Clinic' AND report_type='Medical Emergency')
      OR (p.office::text='Campus Security' AND report_type='Security Threat')
      OR (p.office::text='DRRMO' AND report_type='Fire/Disaster')));
$$;
REVOKE ALL ON FUNCTION public.campus_er_can_receive(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.campus_er_can_receive(text) TO authenticated;
DROP POLICY IF EXISTS campus_er_general_broadcast_read ON public.emergency_reports;
CREATE POLICY campus_er_general_broadcast_read ON public.emergency_reports FOR SELECT TO authenticated
  USING (emergency_type='General Emergency' AND (SELECT public.campus_er_can_receive('General Emergency')));

CREATE OR REPLACE FUNCTION public.campus_er_stamp_acknowledgment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor_office text;
  trusted boolean := auth.role()='service_role' OR (auth.uid() IS NULL AND session_user IN ('postgres','supabase_admin'));
BEGIN
  IF NOT COALESCE(trusted,false) THEN
    IF TG_OP='UPDATE' AND (NEW.acknowledged_at IS DISTINCT FROM OLD.acknowledged_at
      OR NEW.acknowledged_by IS DISTINCT FROM OLD.acknowledged_by
      OR NEW.acknowledged_office IS DISTINCT FROM OLD.acknowledged_office) THEN
      RAISE EXCEPTION 'Acknowledgment receipt fields are server managed' USING ERRCODE='42501';
    ELSIF TG_OP='INSERT' AND (NEW.acknowledged_at IS NOT NULL OR NEW.acknowledged_by IS NOT NULL OR NEW.acknowledged_office IS NOT NULL) THEN
      RAISE EXCEPTION 'Acknowledgment receipt fields are server managed' USING ERRCODE='42501';
    END IF;
    IF NEW.status='acknowledged' AND NEW.acknowledged_at IS NULL
      AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
      IF auth.uid() IS NULL OR NOT public.campus_er_can_receive(NEW.emergency_type) THEN
        RAISE EXCEPTION 'This office cannot acknowledge this incident' USING ERRCODE='42501';
      END IF;
      SELECT p.office::text INTO actor_office FROM public.profiles p WHERE p.id=auth.uid();
      NEW.acknowledged_at := pg_catalog.clock_timestamp();
      NEW.acknowledged_by := auth.uid();
      NEW.acknowledged_office := actor_office;
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.campus_er_stamp_acknowledgment() FROM PUBLIC;
DROP TRIGGER IF EXISTS campus_er_acknowledgment_receipt ON public.emergency_reports;
CREATE TRIGGER campus_er_acknowledgment_receipt BEFORE INSERT OR UPDATE ON public.emergency_reports
  FOR EACH ROW EXECUTE FUNCTION public.campus_er_stamp_acknowledgment();

CREATE OR REPLACE FUNCTION public.acknowledge_emergency_report(p_report_id uuid)
RETURNS SETOF public.emergency_reports LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE receipt public.emergency_reports%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Staff sign-in required' USING ERRCODE='42501'; END IF;
  UPDATE public.emergency_reports r SET status='acknowledged'
    WHERE r.id=p_report_id AND r.status IN ('active','pending')
      AND public.campus_er_can_receive(r.emergency_type)
    RETURNING r.* INTO receipt;
  IF NOT FOUND THEN
    SELECT r.* INTO receipt FROM public.emergency_reports r
      WHERE r.id=p_report_id AND public.campus_er_can_receive(r.emergency_type);
    IF NOT FOUND THEN RAISE EXCEPTION 'Incident unavailable to this office' USING ERRCODE='42501'; END IF;
  END IF;
  RETURN NEXT receipt;
END $$;
REVOKE ALL ON FUNCTION public.acknowledge_emergency_report(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.acknowledge_emergency_report(uuid) TO authenticated;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime')
    AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='emergency_reports') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.emergency_reports;
  END IF;
END $$;
NOTIFY pgrst, 'reload schema';
COMMIT;
