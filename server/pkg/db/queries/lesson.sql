-- Lessons: proposals to change a skill, and their decision history.

-- name: NextLessonNumber :one
SELECT COALESCE(MAX(number), 0) + 1 FROM lesson WHERE workspace_id = $1;

-- name: CreateLesson :one
INSERT INTO lesson (
    workspace_id, number, title, status,
    target_kind, target_skill_id, base_version_id, new_asset, proposed_skill_name,
    observation, evidence, applies_when, counterexample,
    proposed_name, proposed_description, proposed_content, proposed_files, change_summary,
    retrospective_id, source_task_id, source_issue_id, proposed_by_type, proposed_by_id,
    parent_lesson_id
)
VALUES (
    $1, $2, $3, $4,
    $5, $6, $7, $8, $9,
    $10, $11, $12, $13,
    $14, $15, $16, $17, $18,
    $19, $20, $21, $22, $23,
    $24
)
RETURNING *;

-- name: GetLesson :one
SELECT * FROM lesson WHERE id = $1;

-- name: GetLessonInWorkspace :one
SELECT * FROM lesson WHERE id = $1 AND workspace_id = $2;

-- name: GetLessonByNumber :one
SELECT * FROM lesson WHERE workspace_id = $1 AND number = $2;

-- name: ListLessonsByWorkspace :many
-- A NULL status means "everything except deprecated", which is what the default
-- list view shows: withdrawn rules are kept for the record, not for the feed.
SELECT * FROM lesson
WHERE workspace_id = $1
  AND (
    (sqlc.narg('status')::text IS NULL AND status <> 'deprecated')
    OR status = sqlc.narg('status')
  )
  AND (sqlc.narg('target_skill_id')::uuid IS NULL OR target_skill_id = sqlc.narg('target_skill_id'))
  AND (sqlc.narg('retrospective_id')::uuid IS NULL OR retrospective_id = sqlc.narg('retrospective_id'))
ORDER BY created_at DESC
LIMIT $2 OFFSET $3;

-- name: ListLessonsByTargetSkill :many
SELECT * FROM lesson
WHERE target_skill_id = $1
ORDER BY created_at DESC;

-- name: ListLessonsByRetrospective :many
SELECT * FROM lesson
WHERE retrospective_id = $1
ORDER BY number ASC;

-- name: CountOpenLessonsForSkill :one
-- Guards against a second proposal piling onto a skill that already has one
-- waiting. Two open proposals against the same file cannot both be approved
-- against the same base version, so the second one is dead on arrival — better
-- to say so at proposal time than at approval time.
SELECT count(*) FROM lesson
WHERE target_skill_id = $1 AND status IN ('proposed', 'in_review');

-- name: CountLessonsByStatus :many
SELECT status, count(*) AS count FROM lesson
WHERE workspace_id = $1
GROUP BY status;

-- name: UpdateLessonProposal :one
-- Editing the proposal itself, allowed only while it is still proposed or in
-- review. The decision and publication columns are not reachable from here.
UPDATE lesson SET
    title = COALESCE(sqlc.narg('title'), title),
    observation = COALESCE(sqlc.narg('observation'), observation),
    evidence = COALESCE(sqlc.narg('evidence'), evidence),
    applies_when = COALESCE(sqlc.narg('applies_when'), applies_when),
    counterexample = COALESCE(sqlc.narg('counterexample'), counterexample),
    proposed_name = COALESCE(sqlc.narg('proposed_name'), proposed_name),
    proposed_description = COALESCE(sqlc.narg('proposed_description'), proposed_description),
    proposed_content = COALESCE(sqlc.narg('proposed_content'), proposed_content),
    proposed_files = COALESCE(sqlc.narg('proposed_files'), proposed_files),
    change_summary = COALESCE(sqlc.narg('change_summary'), change_summary),
    updated_at = now()
WHERE id = $1 AND status IN ('proposed', 'in_review')
RETURNING *;

-- name: SetLessonStatus :one
UPDATE lesson SET status = $2, updated_at = now()
WHERE id = $1
RETURNING *;

-- name: RejectLesson :one
-- decided_by is a user id and the handler refuses agent credentials before
-- reaching this query. A rejected lesson keeps its row: the next person to have
-- the same idea needs to be able to find out it was already considered.
UPDATE lesson SET
    status = 'rejected',
    decided_by = $2,
    decided_at = now(),
    decision_reason = $3,
    updated_at = now()
WHERE id = $1 AND status IN ('proposed', 'in_review')
RETURNING *;

-- name: PublishLesson :one
-- Runs inside the publication transaction, after the new skill_version exists.
-- The status flip and the version pointer are written together so an
-- approved-but-unapplied lesson is not a reachable state.
UPDATE lesson SET
    status = 'published',
    target_skill_id = COALESCE(sqlc.narg('target_skill_id'), target_skill_id),
    decided_by = $2,
    decided_at = now(),
    decision_reason = $3,
    published_version_id = $4,
    published_at = now(),
    updated_at = now()
WHERE id = $1 AND status IN ('proposed', 'in_review')
RETURNING *;

-- name: DeprecateLesson :one
UPDATE lesson SET
    status = 'deprecated',
    deprecated_by = $2,
    deprecated_at = now(),
    deprecation_reason = $3,
    reverted_version_id = sqlc.narg('reverted_version_id'),
    updated_at = now()
WHERE id = $1 AND status = 'published'
RETURNING *;

-- name: SetLessonRetrospective :exec
UPDATE lesson SET retrospective_id = $2, updated_at = now() WHERE id = $1;

-- Lesson events

-- name: CreateLessonEvent :one
INSERT INTO lesson_event (lesson_id, workspace_id, kind, actor_type, actor_id, note, details)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING *;

-- name: ListLessonEvents :many
SELECT * FROM lesson_event
WHERE lesson_id = $1
ORDER BY created_at ASC;

-- name: DeleteLessonEventsByLesson :exec
DELETE FROM lesson_event WHERE lesson_id = $1;
