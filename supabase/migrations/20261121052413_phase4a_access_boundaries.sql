-- Keep RLS helpers out of the Data API. Existing policies retain their references.
ALTER FUNCTION public.has_role(uuid, text) SET SCHEMA exam_private;
ALTER FUNCTION public.current_user_has_role(text) SET SCHEMA exam_private;
ALTER FUNCTION public.is_classroom_teacher(uuid, uuid) SET SCHEMA exam_private;
ALTER FUNCTION public.is_enrolled_student(uuid, uuid) SET SCHEMA exam_private;
ALTER FUNCTION public.is_assignment_accessible_to_student(uuid, uuid) SET SCHEMA exam_private;
ALTER FUNCTION public.is_publication_accessible_to_student(uuid, uuid) SET SCHEMA exam_private;
ALTER FUNCTION public.is_attempt_owned_by_teacher(uuid, uuid) SET SCHEMA exam_private;

CREATE OR REPLACE FUNCTION exam_private.current_user_has_role(p_role text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT auth.uid() IS NOT NULL AND exam_private.has_role(auth.uid(), p_role);
$$;

REVOKE ALL ON FUNCTION exam_private.has_role(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  exam_private.current_user_has_role(text),
  exam_private.is_classroom_teacher(uuid, uuid),
  exam_private.is_enrolled_student(uuid, uuid),
  exam_private.is_assignment_accessible_to_student(uuid, uuid),
  exam_private.is_publication_accessible_to_student(uuid, uuid),
  exam_private.is_attempt_owned_by_teacher(uuid, uuid)
TO authenticated;

-- Restrict question content to active, published assignments within their window.
DROP POLICY exam_versions_student_select_assigned ON public.exam_versions;
CREATE POLICY exam_versions_student_select_assigned ON public.exam_versions
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.exam_assignments a
    JOIN public.exam_publications p ON p.id = a.publication_id
    WHERE a.publication_id = exam_versions.publication_id
      AND p.status = 'published'
      AND a.status = 'open'
      AND (a.starts_at IS NULL OR a.starts_at <= now())
      AND (a.ends_at IS NULL OR a.ends_at > now())
      AND exam_private.is_enrolled_student(a.classroom_id, auth.uid())
  )
);

-- Only the Worker finalizes an attempt. Database defaults set the start timestamp.
DROP POLICY exam_attempts_student_update_own ON public.exam_attempts;
REVOKE INSERT, UPDATE ON TABLE public.exam_attempts FROM authenticated;
REVOKE UPDATE (status, submitted_at, idempotency_key) ON public.exam_attempts FROM authenticated;
GRANT INSERT (assignment_id, version_id, student_id, attempt_number) ON public.exam_attempts TO authenticated;

DROP POLICY exam_attempts_student_insert_own ON public.exam_attempts;
CREATE POLICY exam_attempts_student_insert_own ON public.exam_attempts
FOR INSERT TO authenticated
WITH CHECK (
  student_id = auth.uid()
  AND status = 'in_progress'
  AND exam_private.current_user_has_role('student')
  AND EXISTS (
    SELECT 1 FROM public.exam_assignments a
    JOIN public.exam_versions v ON v.publication_id = a.publication_id
    JOIN public.exam_publications p ON p.id = a.publication_id
    WHERE a.id = exam_attempts.assignment_id
      AND v.id = exam_attempts.version_id
      AND p.status = 'published'
      AND a.status = 'open'
      AND (a.starts_at IS NULL OR a.starts_at <= now())
      AND (a.ends_at IS NULL OR a.ends_at > now())
      AND exam_attempts.attempt_number <= a.max_attempts
      AND exam_private.is_enrolled_student(a.classroom_id, auth.uid())
  )
);

-- Answer identity and question number stay fixed on updates. Keep read access to
-- submitted answers while requiring an active attempt for any write.
REVOKE INSERT, UPDATE ON TABLE public.attempt_answers FROM authenticated;
GRANT INSERT (attempt_id, question_index, answer_payload),
  UPDATE (answer_payload) ON public.attempt_answers TO authenticated;

DROP POLICY attempt_answers_student_manage_own ON public.attempt_answers;
CREATE POLICY attempt_answers_student_select_own ON public.attempt_answers
FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.exam_attempts a
  WHERE a.id = attempt_answers.attempt_id AND a.student_id = auth.uid()
));
CREATE POLICY attempt_answers_student_insert_own ON public.attempt_answers
FOR INSERT TO authenticated
WITH CHECK (EXISTS (
  SELECT 1 FROM public.exam_attempts a
  WHERE a.id = attempt_answers.attempt_id AND a.student_id = auth.uid()
    AND a.status = 'in_progress'
));
CREATE POLICY attempt_answers_student_update_own ON public.attempt_answers
FOR UPDATE TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.exam_attempts a
  WHERE a.id = attempt_answers.attempt_id AND a.student_id = auth.uid()
    AND a.status = 'in_progress'
));

-- Reject recognized grading fields even inside nested objects and arrays.
-- Publishing still requires constructing the student payload from an allowlist.
ALTER TABLE public.exam_versions
  DROP CONSTRAINT chk_exam_versions_no_answer_key_payload,
  ADD CONSTRAINT chk_exam_versions_no_answer_key_payload CHECK (
    jsonb_typeof(student_payload_json) = 'object'
    AND NOT jsonb_path_exists(
      student_payload_json,
      'strict $.** ? (@.type() == "object").keyvalue() ? (@.key like_regex "^(official[_ -]?)?answer[_ -]?keys?$|^correct[_ -]?(answers?|value|formatted|canonical[_ -]?key|options?([_ -]?(ids?|labels?))?)$|^is[_ -]?correct$|^solutions?([_ -]?(guide|outline|hash))?$|^explanations?([_ -]?text)?$" flag "i")'
    )
  );
