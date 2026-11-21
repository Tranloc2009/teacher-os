-- =============================================================================
-- TeacherOS 5.0 — Phase 4A Hardening & Durable Server Controls
-- Migration 003:
--   1. Explicit service_role grants on public & exam_private schemas
--   2. Immutable column protection on public.exam_attempts
--   3. Defense-in-depth check preventing answer keys inside public.exam_versions
--   4. Durable DB-backed Idempotency table (exam_private.api_idempotency_keys)
--      + service_role-only RPCs (exam_private remains UNEXPOSED to PostgREST)
--   5. Durable DB-backed Global Rate Limit table (exam_private.api_rate_limits)
--      + service_role-only RPC for multi-instance Worker enforcement
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Explicit service_role Grants (Required because Migration 002 revoked PUBLIC)
--    anon & authenticated remain strictly blocked from exam_private.
-- -----------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;

GRANT USAGE ON SCHEMA exam_private TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA exam_private TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA exam_private
  REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA exam_private
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO service_role;

REVOKE ALL ON FUNCTION public.handle_new_auth_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. Defense-in-Depth: Block Top-Level Answer Keys in public.exam_versions
-- -----------------------------------------------------------------------------
ALTER TABLE public.exam_versions
  DROP CONSTRAINT IF EXISTS chk_exam_versions_no_answer_key_payload;

ALTER TABLE public.exam_versions
  ADD CONSTRAINT chk_exam_versions_no_answer_key_payload
  CHECK (
    NOT (student_payload_json ? 'official_answer_key')
    AND NOT (student_payload_json ? 'answer_key')
    AND NOT (student_payload_json ? 'answerKey')
    AND NOT (student_payload_json ? 'answerKeys')
  );

-- -----------------------------------------------------------------------------
-- 3. Immutable Field Protection on public.exam_attempts
--    Prevents authenticated students from tampering with started_at, version_id,
--    assignment_id, attempt_number, or student_id on existing attempts.
-- -----------------------------------------------------------------------------
REVOKE UPDATE ON public.exam_attempts FROM authenticated;
GRANT UPDATE (status, submitted_at, idempotency_key) ON public.exam_attempts TO authenticated;

CREATE OR REPLACE FUNCTION public.protect_exam_attempt_immutable_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.assignment_id IS DISTINCT FROM OLD.assignment_id
     OR NEW.version_id IS DISTINCT FROM OLD.version_id
     OR NEW.student_id IS DISTINCT FROM OLD.student_id
     OR NEW.attempt_number IS DISTINCT FROM OLD.attempt_number
     OR NEW.started_at IS DISTINCT FROM OLD.started_at THEN
    RAISE EXCEPTION 'Cannot modify immutable exam_attempts fields (assignment_id, version_id, student_id, attempt_number, started_at)';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.protect_exam_attempt_immutable_fields() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_exam_attempts_immutable ON public.exam_attempts;
CREATE TRIGGER trg_exam_attempts_immutable
  BEFORE UPDATE ON public.exam_attempts
  FOR EACH ROW EXECUTE FUNCTION public.protect_exam_attempt_immutable_fields();

-- -----------------------------------------------------------------------------
-- 4. Durable Cross-Instance Idempotency Store (exam_private.api_idempotency_keys)
--    Enforces atomic uniqueness in PostgreSQL across all Cloudflare Worker isolates.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS exam_private.api_idempotency_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  method text NOT NULL CHECK (method IN ('POST', 'PUT', 'PATCH', 'DELETE')),
  route_path text NOT NULL CHECK (char_length(trim(route_path)) BETWEEN 1 AND 200),
  idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9._:-]{8,128}$'),
  request_hash text NOT NULL CHECK (char_length(request_hash) = 64),
  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed')),
  response_status integer,
  response_body jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  CONSTRAINT uq_api_idempotency_actor_method_route_key
    UNIQUE (actor_id, method, route_path, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_api_idempotency_expires_at
  ON exam_private.api_idempotency_keys (expires_at);

ALTER TABLE exam_private.api_idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_private.api_idempotency_keys FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE exam_private.api_idempotency_keys FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE exam_private.api_idempotency_keys TO service_role;

-- 4.1 Atomically claim an Idempotency-Key (service_role ONLY)
CREATE OR REPLACE FUNCTION public.server_claim_idempotency_key(
  p_actor_id uuid,
  p_method text,
  p_route_path text,
  p_idempotency_key text,
  p_request_hash text,
  p_ttl_seconds integer DEFAULT 86400
)
RETURNS TABLE (
  outcome text,
  response_status integer,
  response_body jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = exam_private, public, pg_temp
AS $$
DECLARE
  v_existing exam_private.api_idempotency_keys%ROWTYPE;
  v_inserted_id uuid;
  v_ttl interval := make_interval(secs => GREATEST(60, LEAST(COALESCE(p_ttl_seconds, 86400), 604800)));
BEGIN
  -- Remove expired record for the same composite key if present
  DELETE FROM exam_private.api_idempotency_keys
  WHERE actor_id = p_actor_id
    AND method = upper(p_method)
    AND route_path = p_route_path
    AND idempotency_key = p_idempotency_key
    AND expires_at <= now();

  INSERT INTO exam_private.api_idempotency_keys (
    actor_id,
    method,
    route_path,
    idempotency_key,
    request_hash,
    status,
    expires_at
  )
  VALUES (
    p_actor_id,
    upper(p_method),
    p_route_path,
    p_idempotency_key,
    p_request_hash,
    'in_progress',
    now() + v_ttl
  )
  ON CONFLICT (actor_id, method, route_path, idempotency_key) DO NOTHING
  RETURNING id INTO v_inserted_id;

  IF v_inserted_id IS NOT NULL THEN
    RETURN QUERY SELECT 'claimed'::text, NULL::integer, NULL::jsonb;
    RETURN;
  END IF;

  SELECT *
  INTO v_existing
  FROM exam_private.api_idempotency_keys
  WHERE actor_id = p_actor_id
    AND method = upper(p_method)
    AND route_path = p_route_path
    AND idempotency_key = p_idempotency_key;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'in_progress'::text, NULL::integer, NULL::jsonb;
    RETURN;
  END IF;

  IF v_existing.request_hash <> p_request_hash THEN
    RETURN QUERY SELECT 'conflict_payload'::text, NULL::integer, NULL::jsonb;
    RETURN;
  END IF;

  IF v_existing.status = 'completed' THEN
    RETURN QUERY SELECT 'replay'::text, v_existing.response_status, v_existing.response_body;
    RETURN;
  END IF;

  RETURN QUERY SELECT 'in_progress'::text, NULL::integer, NULL::jsonb;
END;
$$;

-- 4.2 Persist final completed response for an Idempotency-Key (service_role ONLY)
CREATE OR REPLACE FUNCTION public.server_complete_idempotency_key(
  p_actor_id uuid,
  p_method text,
  p_route_path text,
  p_idempotency_key text,
  p_response_status integer,
  p_response_body jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = exam_private, public, pg_temp
AS $$
BEGIN
  UPDATE exam_private.api_idempotency_keys
  SET status = 'completed',
      response_status = p_response_status,
      response_body = p_response_body
  WHERE actor_id = p_actor_id
    AND method = upper(p_method)
    AND route_path = p_route_path
    AND idempotency_key = p_idempotency_key;
END;
$$;

-- 4.3 Release in-progress claim on transient 5xx failure (service_role ONLY)
CREATE OR REPLACE FUNCTION public.server_release_idempotency_key(
  p_actor_id uuid,
  p_method text,
  p_route_path text,
  p_idempotency_key text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = exam_private, public, pg_temp
AS $$
BEGIN
  DELETE FROM exam_private.api_idempotency_keys
  WHERE actor_id = p_actor_id
    AND method = upper(p_method)
    AND route_path = p_route_path
    AND idempotency_key = p_idempotency_key
    AND status = 'in_progress';
END;
$$;

REVOKE ALL ON FUNCTION public.server_claim_idempotency_key(uuid, text, text, text, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.server_complete_idempotency_key(uuid, text, text, text, integer, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.server_release_idempotency_key(uuid, text, text, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.server_claim_idempotency_key(uuid, text, text, text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.server_complete_idempotency_key(uuid, text, text, text, integer, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.server_release_idempotency_key(uuid, text, text, text) TO service_role;

-- -----------------------------------------------------------------------------
-- 5. Durable Global Multi-Instance Rate Limit Store (exam_private.api_rate_limits)
--    Used by Cloudflare Worker for authenticated sensitive/mutating routes so
--    limits hold globally across multiple Worker isolates.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS exam_private.api_rate_limits (
  bucket_key text NOT NULL,
  window_start timestamptz NOT NULL,
  request_count integer NOT NULL DEFAULT 1 CHECK (request_count >= 1),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bucket_key, window_start)
);

CREATE INDEX IF NOT EXISTS idx_api_rate_limits_window_start
  ON exam_private.api_rate_limits (window_start);

ALTER TABLE exam_private.api_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_private.api_rate_limits FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE exam_private.api_rate_limits FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE exam_private.api_rate_limits TO service_role;

CREATE OR REPLACE FUNCTION public.server_check_rate_limit(
  p_bucket_key text,
  p_limit integer,
  p_window_seconds integer
)
RETURNS TABLE (
  allowed boolean,
  current_count integer,
  remaining integer,
  retry_after_seconds integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = exam_private, public, pg_temp
AS $$
DECLARE
  v_window_sec integer := GREATEST(10, LEAST(COALESCE(p_window_seconds, 60), 3600));
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 30), 10000));
  v_epoch bigint := floor(extract(epoch FROM now()));
  v_window_start_epoch bigint := (v_epoch / v_window_sec) * v_window_sec;
  v_window_start timestamptz := to_timestamp(v_window_start_epoch);
  v_count integer;
  v_retry integer;
BEGIN
  -- Opportunistic cleanup of stale windows (> 2 windows old) for this bucket
  DELETE FROM exam_private.api_rate_limits
  WHERE bucket_key = p_bucket_key
    AND window_start < (v_window_start - make_interval(secs => v_window_sec * 2));

  INSERT INTO exam_private.api_rate_limits (bucket_key, window_start, request_count, updated_at)
  VALUES (p_bucket_key, v_window_start, 1, now())
  ON CONFLICT (bucket_key, window_start)
  DO UPDATE SET
    request_count = exam_private.api_rate_limits.request_count + 1,
    updated_at = now()
  RETURNING exam_private.api_rate_limits.request_count INTO v_count;

  v_retry := GREATEST(1, (v_window_start_epoch + v_window_sec - v_epoch)::integer);

  IF v_count > v_limit THEN
    RETURN QUERY SELECT false, v_count, 0, v_retry;
  ELSE
    RETURN QUERY SELECT true, v_count, GREATEST(0, v_limit - v_count), 0;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.server_check_rate_limit(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.server_check_rate_limit(text, integer, integer) TO service_role;
