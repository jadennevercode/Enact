-- "Which lessons changed this skill" — read by the skill detail page next to
-- the version history, and by the proposal endpoint to refuse a second open
-- proposal against a skill that already has one.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lesson_target_skill
    ON lesson (target_skill_id, created_at DESC)
    WHERE target_skill_id IS NOT NULL;
