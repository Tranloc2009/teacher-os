-- =============================================================================
-- TeacherOS 5.0 — Phase 4A: Row Level Security (RLS) & Least-Privilege Grants
-- Migration 002: Strict Grants, Helper Functions & Complete RLS Policies
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Lock Down Private Schema & Revoke Default Broad Privileges
-- -----------------------------------------------------------------------------
REVOKE ALL ON SCHEMA exam_private FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA exam_private FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA exam_private FROM PUBLIC, anon, authenticated;

REVOKE ALL ON TABLE
  public.profiles, public.user_roles, public.classrooms, public.class_members,
  public.exam_publications, public.exam_versions, public.exam_assignments,
  public.exam_attempts, public.attempt_answers, public.grading_results, public.audit_events
FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. Trusted SECURITY DEFINER Authorization Helpers (Locked search_path)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.has_role(p_user_id uuid, p_role text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = p_user_id
      AND ur.role = p_role
  );
$$;

CREATE OR REPLACE FUNCTION public.current_user_has_role(p_role text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT auth.uid() IS NOT NULL
    AND public.has_role(auth.uid(), p_role);
$$;

CREATE OR REPLACE FUNCTION public.is_classroom_teacher(p_classroom_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.classrooms c
    WHERE c.id = p_classroom_id
      AND c.teacher_id = p_user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.is_enrolled_student(p_classroom_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.class_members cm
    WHERE cm.classroom_id = p_classroom_id
      AND cm.student_id = p_user_id
      AND cm.status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_assignment_accessible_to_student(p_assignment_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.exam_assignments ea
    JOIN public.class_members cm
      ON cm.classroom_id = ea.classroom_id
     AND cm.student_id = p_user_id
     AND cm.status = 'active'
    WHERE ea.id = p_assignment_id
      AND ea.status IN ('open', 'closed')
  );
$$;

CREATE OR REPLACE FUNCTION public.is_publication_accessible_to_student(p_publication_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.exam_assignments ea
    JOIN public.class_members cm
      ON cm.classroom_id = ea.classroom_id
     AND cm.student_id = p_user_id
     AND cm.status = 'active'
    JOIN public.exam_publications ep
      ON ep.id = ea.publication_id
    WHERE ea.publication_id = p_publication_id
      AND ep.status = 'published'
      AND ea.status IN ('open', 'closed')
  );
$$;

CREATE OR REPLACE FUNCTION public.is_attempt_owned_by_teacher(p_attempt_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.exam_attempts att
    JOIN public.exam_assignments ea ON ea.id = att.assignment_id
    WHERE att.id = p_attempt_id
      AND ea.teacher_id = p_user_id
  );
$$;

REVOKE ALL ON FUNCTION public.has_role(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.current_user_has_role(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_classroom_teacher(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_enrolled_student(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_assignment_accessible_to_student(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_publication_accessible_to_student(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_attempt_owned_by_teacher(uuid, uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.current_user_has_role(text) TO authenticated;

-- -----------------------------------------------------------------------------
-- 3. Minimal Explicit Table Grants for 'authenticated' (ZERO Grants for 'anon')
-- -----------------------------------------------------------------------------
GRANT SELECT, UPDATE (full_name, school_name, student_code) ON public.profiles TO authenticated;
-- user_roles: READ-ONLY for authenticated; NO INSERT/UPDATE/DELETE (prevents self-escalation)
GRANT SELECT ON public.user_roles TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.classrooms TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.class_members TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.exam_publications TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.exam_versions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.exam_assignments TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.exam_attempts TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.attempt_answers TO authenticated;
-- grading_results & audit_events: READ-ONLY for authenticated; written strictly by server
GRANT SELECT ON public.grading_results TO authenticated;
GRANT SELECT ON public.audit_events TO authenticated;

-- -----------------------------------------------------------------------------
-- 4. Enable & Force RLS on EVERY Table
-- -----------------------------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles FORCE ROW LEVEL SECURITY;

ALTER TABLE public.classrooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.classrooms FORCE ROW LEVEL SECURITY;

ALTER TABLE public.class_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.class_members FORCE ROW LEVEL SECURITY;

ALTER TABLE public.exam_publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_publications FORCE ROW LEVEL SECURITY;

ALTER TABLE public.exam_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_versions FORCE ROW LEVEL SECURITY;

ALTER TABLE public.exam_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_assignments FORCE ROW LEVEL SECURITY;

ALTER TABLE public.exam_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_attempts FORCE ROW LEVEL SECURITY;

ALTER TABLE public.attempt_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attempt_answers FORCE ROW LEVEL SECURITY;

ALTER TABLE public.grading_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grading_results FORCE ROW LEVEL SECURITY;

ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_events FORCE ROW LEVEL SECURITY;

ALTER TABLE exam_private.official_answer_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_private.official_answer_keys FORCE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- 5. Strict Row Level Security Policies
-- -----------------------------------------------------------------------------

-- 5.1 public.profiles
DROP POLICY IF EXISTS profiles_select_own ON public.profiles;
CREATE POLICY profiles_select_own
  ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid());

DROP POLICY IF EXISTS profiles_select_teacher_students ON public.profiles;
CREATE POLICY profiles_select_teacher_students
  ON public.profiles FOR SELECT TO authenticated
  USING (
    public.current_user_has_role('teacher')
    AND EXISTS (
      SELECT 1
      FROM public.class_members cm
      JOIN public.classrooms c ON c.id = cm.classroom_id
      WHERE cm.student_id = profiles.id
        AND cm.status = 'active'
        AND c.teacher_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS profiles_select_admin ON public.profiles;
CREATE POLICY profiles_select_admin
  ON public.profiles FOR SELECT TO authenticated
  USING (public.current_user_has_role('admin'));

DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
CREATE POLICY profiles_update_own
  ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- 5.2 public.user_roles (SELECT ONLY — ZERO client write policies)
DROP POLICY IF EXISTS user_roles_select_own ON public.user_roles;
CREATE POLICY user_roles_select_own
  ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS user_roles_select_admin ON public.user_roles;
CREATE POLICY user_roles_select_admin
  ON public.user_roles FOR SELECT TO authenticated
  USING (public.current_user_has_role('admin'));

-- 5.3 public.classrooms
DROP POLICY IF EXISTS classrooms_teacher_manage_own ON public.classrooms;
CREATE POLICY classrooms_teacher_manage_own
  ON public.classrooms FOR ALL TO authenticated
  USING (
    public.current_user_has_role('teacher')
    AND teacher_id = auth.uid()
  )
  WITH CHECK (
    public.current_user_has_role('teacher')
    AND teacher_id = auth.uid()
  );

DROP POLICY IF EXISTS classrooms_student_select_enrolled ON public.classrooms;
CREATE POLICY classrooms_student_select_enrolled
  ON public.classrooms FOR SELECT TO authenticated
  USING (public.is_enrolled_student(id, auth.uid()));

DROP POLICY IF EXISTS classrooms_admin_select ON public.classrooms;
CREATE POLICY classrooms_admin_select
  ON public.classrooms FOR SELECT TO authenticated
  USING (public.current_user_has_role('admin'));

-- 5.4 public.class_members
DROP POLICY IF EXISTS class_members_teacher_manage_own ON public.class_members;
CREATE POLICY class_members_teacher_manage_own
  ON public.class_members FOR ALL TO authenticated
  USING (
    public.current_user_has_role('teacher')
    AND public.is_classroom_teacher(classroom_id, auth.uid())
  )
  WITH CHECK (
    public.current_user_has_role('teacher')
    AND public.is_classroom_teacher(classroom_id, auth.uid())
  );

DROP POLICY IF EXISTS class_members_student_select_own ON public.class_members;
CREATE POLICY class_members_student_select_own
  ON public.class_members FOR SELECT TO authenticated
  USING (student_id = auth.uid());

DROP POLICY IF EXISTS class_members_admin_select ON public.class_members;
CREATE POLICY class_members_admin_select
  ON public.class_members FOR SELECT TO authenticated
  USING (public.current_user_has_role('admin'));

-- 5.5 public.exam_publications
DROP POLICY IF EXISTS exam_publications_teacher_manage_own ON public.exam_publications;
CREATE POLICY exam_publications_teacher_manage_own
  ON public.exam_publications FOR ALL TO authenticated
  USING (
    public.current_user_has_role('teacher')
    AND teacher_id = auth.uid()
  )
  WITH CHECK (
    public.current_user_has_role('teacher')
    AND teacher_id = auth.uid()
  );

DROP POLICY IF EXISTS exam_publications_student_select_assigned ON public.exam_publications;
CREATE POLICY exam_publications_student_select_assigned
  ON public.exam_publications FOR SELECT TO authenticated
  USING (public.is_publication_accessible_to_student(id, auth.uid()));

DROP POLICY IF EXISTS exam_publications_admin_select ON public.exam_publications;
CREATE POLICY exam_publications_admin_select
  ON public.exam_publications FOR SELECT TO authenticated
  USING (public.current_user_has_role('admin'));

-- 5.6 public.exam_versions (Student payload ONLY — never contains answer keys)
DROP POLICY IF EXISTS exam_versions_teacher_manage_own ON public.exam_versions;
CREATE POLICY exam_versions_teacher_manage_own
  ON public.exam_versions FOR ALL TO authenticated
  USING (
    public.current_user_has_role('teacher')
    AND EXISTS (
      SELECT 1
      FROM public.exam_publications ep
      WHERE ep.id = exam_versions.publication_id
        AND ep.teacher_id = auth.uid()
    )
  )
  WITH CHECK (
    public.current_user_has_role('teacher')
    AND EXISTS (
      SELECT 1
      FROM public.exam_publications ep
      WHERE ep.id = exam_versions.publication_id
        AND ep.teacher_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS exam_versions_student_select_assigned ON public.exam_versions;
CREATE POLICY exam_versions_student_select_assigned
  ON public.exam_versions FOR SELECT TO authenticated
  USING (public.is_publication_accessible_to_student(publication_id, auth.uid()));

DROP POLICY IF EXISTS exam_versions_admin_select ON public.exam_versions;
CREATE POLICY exam_versions_admin_select
  ON public.exam_versions FOR SELECT TO authenticated
  USING (public.current_user_has_role('admin'));

-- 5.7 public.exam_assignments
DROP POLICY IF EXISTS exam_assignments_teacher_manage_own ON public.exam_assignments;
CREATE POLICY exam_assignments_teacher_manage_own
  ON public.exam_assignments FOR ALL TO authenticated
  USING (
    public.current_user_has_role('teacher')
    AND teacher_id = auth.uid()
  )
  WITH CHECK (
    public.current_user_has_role('teacher')
    AND teacher_id = auth.uid()
    AND public.is_classroom_teacher(classroom_id, auth.uid())
    AND EXISTS (
      SELECT 1
      FROM public.exam_publications ep
      WHERE ep.id = exam_assignments.publication_id
        AND ep.teacher_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS exam_assignments_student_select_enrolled ON public.exam_assignments;
CREATE POLICY exam_assignments_student_select_enrolled
  ON public.exam_assignments FOR SELECT TO authenticated
  USING (
    public.is_enrolled_student(classroom_id, auth.uid())
    AND status IN ('open', 'closed')
  );

DROP POLICY IF EXISTS exam_assignments_admin_select ON public.exam_assignments;
CREATE POLICY exam_assignments_admin_select
  ON public.exam_assignments FOR SELECT TO authenticated
  USING (public.current_user_has_role('admin'));

-- 5.8 public.exam_attempts
DROP POLICY IF EXISTS exam_attempts_student_select_own ON public.exam_attempts;
CREATE POLICY exam_attempts_student_select_own
  ON public.exam_attempts FOR SELECT TO authenticated
  USING (student_id = auth.uid());

DROP POLICY IF EXISTS exam_attempts_student_insert_own ON public.exam_attempts;
CREATE POLICY exam_attempts_student_insert_own
  ON public.exam_attempts FOR INSERT TO authenticated
  WITH CHECK (
    student_id = auth.uid()
    AND status = 'in_progress'
    AND public.is_assignment_accessible_to_student(assignment_id, auth.uid())
  );

DROP POLICY IF EXISTS exam_attempts_student_update_own ON public.exam_attempts;
CREATE POLICY exam_attempts_student_update_own
  ON public.exam_attempts FOR UPDATE TO authenticated
  USING (
    student_id = auth.uid()
    AND status = 'in_progress'
  )
  WITH CHECK (
    student_id = auth.uid()
    AND status IN ('in_progress', 'submitted')
  );

DROP POLICY IF EXISTS exam_attempts_teacher_select_own ON public.exam_attempts;
CREATE POLICY exam_attempts_teacher_select_own
  ON public.exam_attempts FOR SELECT TO authenticated
  USING (
    public.current_user_has_role('teacher')
    AND public.is_attempt_owned_by_teacher(id, auth.uid())
  );

DROP POLICY IF EXISTS exam_attempts_admin_select ON public.exam_attempts;
CREATE POLICY exam_attempts_admin_select
  ON public.exam_attempts FOR SELECT TO authenticated
  USING (public.current_user_has_role('admin'));

-- 5.9 public.attempt_answers
DROP POLICY IF EXISTS attempt_answers_student_manage_own ON public.attempt_answers;
CREATE POLICY attempt_answers_student_manage_own
  ON public.attempt_answers FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.exam_attempts att
      WHERE att.id = attempt_answers.attempt_id
        AND att.student_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.exam_attempts att
      WHERE att.id = attempt_answers.attempt_id
        AND att.student_id = auth.uid()
        AND att.status = 'in_progress'
    )
  );

DROP POLICY IF EXISTS attempt_answers_teacher_select_own ON public.attempt_answers;
CREATE POLICY attempt_answers_teacher_select_own
  ON public.attempt_answers FOR SELECT TO authenticated
  USING (
    public.current_user_has_role('teacher')
    AND public.is_attempt_owned_by_teacher(attempt_id, auth.uid())
  );

DROP POLICY IF EXISTS attempt_answers_admin_select ON public.attempt_answers;
CREATE POLICY attempt_answers_admin_select
  ON public.attempt_answers FOR SELECT TO authenticated
  USING (public.current_user_has_role('admin'));

-- 5.10 public.grading_results (Server-written ONLY; strict read isolation)
DROP POLICY IF EXISTS grading_results_student_select_own ON public.grading_results;
CREATE POLICY grading_results_student_select_own
  ON public.grading_results FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.exam_attempts att
      WHERE att.id = grading_results.attempt_id
        AND att.student_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS grading_results_teacher_select_own ON public.grading_results;
CREATE POLICY grading_results_teacher_select_own
  ON public.grading_results FOR SELECT TO authenticated
  USING (
    public.current_user_has_role('teacher')
    AND public.is_attempt_owned_by_teacher(attempt_id, auth.uid())
  );

DROP POLICY IF EXISTS grading_results_admin_select ON public.grading_results;
CREATE POLICY grading_results_admin_select
  ON public.grading_results FOR SELECT TO authenticated
  USING (public.current_user_has_role('admin'));

-- 5.11 public.audit_events (Server-written ONLY)
DROP POLICY IF EXISTS audit_events_select_admin ON public.audit_events;
CREATE POLICY audit_events_select_admin
  ON public.audit_events FOR SELECT TO authenticated
  USING (public.current_user_has_role('admin'));

DROP POLICY IF EXISTS audit_events_select_teacher_own ON public.audit_events;
CREATE POLICY audit_events_select_teacher_own
  ON public.audit_events FOR SELECT TO authenticated
  USING (
    public.current_user_has_role('teacher')
    AND actor_id = auth.uid()
  );

-- 5.12 exam_private.official_answer_keys
-- INTENTIONALLY ZERO POLICIES for anon/authenticated.
-- Only service_role (inside trusted Cloudflare Worker) can access official answer keys.
