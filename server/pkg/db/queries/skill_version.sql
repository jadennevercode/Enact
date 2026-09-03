-- Skill version history.
--
-- Every write to a skill's content appends a row here, whatever produced it.
-- The list variant omits `content` and `files` for the same reason
-- ListSkillSummariesByWorkspace omits content: SKILL.md bodies run 50-200KB and
-- a version list is a list of headings, not of documents.

-- name: NextSkillVersionNumber :one
SELECT COALESCE(MAX(version), 0) + 1 FROM skill_version WHERE skill_id = $1;

-- name: CreateSkillVersion :one
INSERT INTO skill_version (
    skill_id, workspace_id, version, name, description, content, config, files,
    content_hash, source, lesson_id, created_by, summary
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
RETURNING *;

-- name: GetSkillVersion :one
SELECT * FROM skill_version WHERE id = $1;

-- name: GetSkillVersionInWorkspace :one
SELECT * FROM skill_version WHERE id = $1 AND workspace_id = $2;

-- name: GetSkillVersionByNumber :one
SELECT * FROM skill_version WHERE skill_id = $1 AND version = $2;

-- name: ListSkillVersionSummaries :many
SELECT id, skill_id, workspace_id, version, name, description, config,
       content_hash, source, lesson_id, created_by, summary, created_at
FROM skill_version
WHERE skill_id = $1
ORDER BY version DESC;

-- name: SetSkillCurrentVersion :exec
UPDATE skill SET current_version_id = $2, updated_at = now() WHERE id = $1;

-- name: DeleteSkillVersionsBySkill :exec
-- Called from the skill delete transaction. No foreign key does this for us,
-- per the repo rule.
DELETE FROM skill_version WHERE skill_id = $1;

-- name: SetSkillVersionLesson :exec
-- Attributes a version to the lesson that produced it. Needed only on the
-- new-skill publication path, where the version is written by the shared skill
-- creation helper before the lesson row can name it.
UPDATE skill_version SET lesson_id = $2 WHERE id = $1;
