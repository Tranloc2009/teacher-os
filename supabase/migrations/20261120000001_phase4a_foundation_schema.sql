-- =============================================================================
-- TeacherOS 5.0 — Phase 4A: Supabase Foundation & Security Schema
-- Migration 001: Core Tables, Private Answer Key Schema, Indexes & Signup Trigger
-- Tier: Supabase Free (PostgreSQL + Supabase Auth) — Zero Paid Add-ons
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- 1. Private Schema for Sensitive Exam Answer Keys (NOT exposed by PostgREST)
-- -----------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS exam_private;

REVOKE ALL ON SCHEMA exam_private FROM PUBLIC;
REVOKE ALL ON SCHEMA exam_private FROM anon;
REVOKE ALL ON SCHEMA exam_private FROM authenticated;

-- -----------------------------------------------------------------------------
-- 2. Shared Timestamp Trigger Helper
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- 3. Public Foundation Tables (UUID PKs, Strict FKs, Domain Constraints)
-- -----------------------------------------------------------------------------

-- 3.1 Profiles (1-to-1 with auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  full_name text NOT NULL DEFAULT '',
  school_name text NOT NULL DEFAULT '',
  student_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles (email);
CREATE INDEX IF NOT EXISTS idx_profiles_student_code ON public.profiles (student_code) WHERE student_code IS NOT NULL;

DROP TRIGGER IF EXISTS trg_profiles_updated_at ON public.profiles;
CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3.2 Authoritative User Roles (NEVER read roles from auth.users.raw_user_meta_data)
CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('admin', 'teacher', 'student')),
  granted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_user_roles_user_role UNIQUE (user_id, role)
);

CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON public.user_roles (user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role ON public.user_roles (role);

-- 3.3 Classrooms (owned by teacher_id)
CREATE TABLE IF NOT EXISTS public.classrooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 120),
  subject text NOT NULL DEFAULT 'Toán học' CHECK (char_length(trim(subject)) BETWEEN 1 AND 80),
  grade text NOT NULL DEFAULT '12' CHECK (char_length(trim(grade)) BETWEEN 1 AND 20),
  school_year text NOT NULL DEFAULT '',
  join_code text NOT NULL UNIQUE CHECK (char_length(trim(join_code)) BETWEEN 4 AND 24),
  is_archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_classrooms_teacher_id ON public.classrooms (teacher_id);
CREATE INDEX IF NOT EXISTS idx_classrooms_join_code ON public.classrooms (join_code);

DROP TRIGGER IF EXISTS trg_classrooms_updated_at ON public.classrooms;
CREATE TRIGGER trg_classrooms_updated_at
  BEFORE UPDATE ON public.classrooms
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3.4 Class Members (student enrollment per classroom)
CREATE TABLE IF NOT EXISTS public.class_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  classroom_id uuid NOT NULL REFERENCES public.classrooms(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_class_members_classroom_student UNIQUE (classroom_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_class_members_classroom_id ON public.class_members (classroom_id);
CREATE INDEX IF NOT EXISTS idx_class_members_student_id ON public.class_members (student_id);
CREATE INDEX IF NOT EXISTS idx_class_members_active_lookup ON public.class_members (classroom_id, student_id) WHERE status = 'active';

-- 3.5 Exam Publications (teacher-authored published exam metadata)
CREATE TABLE IF NOT EXISTS public.exam_publications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(trim(title)) BETWEEN 1 AND 200),
  subject text NOT NULL DEFAULT 'Toán học' CHECK (char_length(trim(subject)) BETWEEN 1 AND 80),
  grade text NOT NULL DEFAULT '12' CHECK (char_length(trim(grade)) BETWEEN 1 AND 20),
  duration_minutes integer NOT NULL DEFAULT 45 CHECK (duration_minutes >= 1 AND duration_minutes <= 360),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'closed', 'archived')),
  source_exam_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_exam_publications_teacher_id ON public.exam_publications (teacher_id);
CREATE INDEX IF NOT EXISTS idx_exam_publications_status ON public.exam_publications (status);

DROP TRIGGER IF EXISTS trg_exam_publications_updated_at ON public.exam_publications;
CREATE TRIGGER trg_exam_publications_updated_at
  BEFORE UPDATE ON public.exam_publications
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3.6 Exam Versions (student-safe version payload ONLY — NO official answer keys!)
CREATE TABLE IF NOT EXISTS public.exam_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  publication_id uuid NOT NULL REFERENCES public.exam_publications(id) ON DELETE CASCADE,
  version_code text NOT NULL CHECK (char_length(trim(version_code)) BETWEEN 1 AND 24),
  student_payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  question_count integer NOT NULL DEFAULT 0 CHECK (question_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_exam_versions_pub_code UNIQUE (publication_id, version_code)
);

CREATE INDEX IF NOT EXISTS idx_exam_versions_publication_id ON public.exam_versions (publication_id);

-- 3.7 Exam Assignments (connects an exam publication to a classroom)
CREATE TABLE IF NOT EXISTS public.exam_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  publication_id uuid NOT NULL REFERENCES public.exam_publications(id) ON DELETE CASCADE,
  classroom_id uuid NOT NULL REFERENCES public.classrooms(id) ON DELETE CASCADE,
  teacher_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  starts_at timestamptz,
  ends_at timestamptz,
  max_attempts integer NOT NULL DEFAULT 1 CHECK (max_attempts >= 1 AND max_attempts <= 10),
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'open', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_exam_assignments_window CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS idx_exam_assignments_classroom_id ON public.exam_assignments (classroom_id);
CREATE INDEX IF NOT EXISTS idx_exam_assignments_teacher_id ON public.exam_assignments (teacher_id);
CREATE INDEX IF NOT EXISTS idx_exam_assignments_publication_id ON public.exam_assignments (publication_id);

DROP TRIGGER IF EXISTS trg_exam_assignments_updated_at ON public.exam_assignments;
CREATE TRIGGER trg_exam_assignments_updated_at
  BEFORE UPDATE ON public.exam_assignments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3.8 Exam Attempts (student attempts for an assignment)
CREATE TABLE IF NOT EXISTS public.exam_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES public.exam_assignments(id) ON DELETE CASCADE,
  version_id uuid NOT NULL REFERENCES public.exam_versions(id) ON DELETE RESTRICT,
  student_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  attempt_number integer NOT NULL DEFAULT 1 CHECK (attempt_number >= 1),
  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'submitted', 'graded', 'expired')),
  started_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_exam_attempts_assignment_student_num UNIQUE (assignment_id, student_id, attempt_number)
);

CREATE INDEX IF NOT EXISTS idx_exam_attempts_assignment_id ON public.exam_attempts (assignment_id);
CREATE INDEX IF NOT EXISTS idx_exam_attempts_student_id ON public.exam_attempts (student_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_exam_attempts_idempotency
  ON public.exam_attempts (student_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

DROP TRIGGER IF EXISTS trg_exam_attempts_updated_at ON public.exam_attempts;
CREATE TRIGGER trg_exam_attempts_updated_at
  BEFORE UPDATE ON public.exam_attempts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3.9 Attempt Answers (student selected/typed answers per question)
CREATE TABLE IF NOT EXISTS public.attempt_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id uuid NOT NULL REFERENCES public.exam_attempts(id) ON DELETE CASCADE,
  question_index integer NOT NULL CHECK (question_index >= 1),
  answer_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_attempt_answers_attempt_question UNIQUE (attempt_id, question_index)
);

CREATE INDEX IF NOT EXISTS idx_attempt_answers_attempt_id ON public.attempt_answers (attempt_id);

DROP TRIGGER IF EXISTS trg_attempt_answers_updated_at ON public.attempt_answers;
CREATE TRIGGER trg_attempt_answers_updated_at
  BEFORE UPDATE ON public.attempt_answers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3.10 Grading Results (server-computed scores ONLY)
CREATE TABLE IF NOT EXISTS public.grading_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id uuid NOT NULL UNIQUE REFERENCES public.exam_attempts(id) ON DELETE CASCADE,
  score numeric(6, 2) NOT NULL CHECK (score >= 0),
  max_score numeric(6, 2) NOT NULL CHECK (max_score > 0),
  correct_count integer NOT NULL DEFAULT 0 CHECK (correct_count >= 0),
  total_questions integer NOT NULL DEFAULT 0 CHECK (total_questions >= 0),
  breakdown_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  graded_by text NOT NULL DEFAULT 'server',
  graded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_grading_results_attempt_id ON public.grading_results (attempt_id);

-- 3.11 Audit Events (immutable server-side security & workflow audit log)
CREATE TABLE IF NOT EXISTS public.audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_role text NOT NULL DEFAULT 'system',
  event_type text NOT NULL CHECK (char_length(trim(event_type)) BETWEEN 1 AND 100),
  resource_type text NOT NULL CHECK (char_length(trim(resource_type)) BETWEEN 1 AND 80),
  resource_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_events_actor_id ON public.audit_events (actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_event_type ON public.audit_events (event_type);
CREATE INDEX IF NOT EXISTS idx_audit_events_created_at ON public.audit_events (created_at DESC);

-- -----------------------------------------------------------------------------
-- 4. Private Official Answer Keys Table (Strictly Server-Only via exam_private)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS exam_private.official_answer_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_version_id uuid NOT NULL UNIQUE REFERENCES public.exam_versions(id) ON DELETE CASCADE,
  publication_id uuid NOT NULL REFERENCES public.exam_publications(id) ON DELETE CASCADE,
  teacher_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  answer_key_json jsonb NOT NULL,
  checksum_sha256 text NOT NULL CHECK (char_length(checksum_sha256) = 64),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_official_answer_keys_publication_id
  ON exam_private.official_answer_keys (publication_id);
CREATE INDEX IF NOT EXISTS idx_official_answer_keys_teacher_id
  ON exam_private.official_answer_keys (teacher_id);

DROP TRIGGER IF EXISTS trg_official_answer_keys_updated_at ON exam_private.official_answer_keys;
CREATE TRIGGER trg_official_answer_keys_updated_at
  BEFORE UPDATE ON exam_private.official_answer_keys
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 5. Trusted Auth Signup Trigger
--    Creates profile and assigns ONLY 'student' role by default.
--    NEVER trusts raw_user_meta_data->>'role' for privilege assignment.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_full_name text;
BEGIN
  v_full_name := COALESCE(NULLIF(trim(NEW.raw_user_meta_data ->> 'full_name'), ''), '');

  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, COALESCE(NEW.email, ''), v_full_name)
  ON CONFLICT (id) DO NOTHING;

  -- Self-signup ALWAYS receives ONLY the least-privileged 'student' role.
  -- Teacher and Admin roles MUST be granted via trusted server/admin workflow.
  INSERT INTO public.user_roles (user_id, role, granted_by)
  VALUES (NEW.id, 'student', NULL)
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS teacheros_on_auth_user_created ON auth.users;
CREATE TRIGGER teacheros_on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();
