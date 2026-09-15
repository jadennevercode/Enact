DROP TABLE IF EXISTS semantic_human_decision;
DROP TABLE IF EXISTS semantic_review_packet;
ALTER TABLE semantic_construction
    DROP COLUMN IF EXISTS candidate_cards,
    DROP COLUMN IF EXISTS interview_state,
    DROP COLUMN IF EXISTS authoring_revision;
