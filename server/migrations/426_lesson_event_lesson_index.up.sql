-- One lesson's history, oldest first, as the detail page renders it.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lesson_event_lesson
    ON lesson_event (lesson_id, created_at);
