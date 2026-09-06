-- One row per (skill, version). Doubles as the listing index: the version
-- history page reads by skill_id and orders by version, which this serves
-- directly. Concurrent build in its own single-statement file, per the repo
-- migration rule.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_skill_version_skill_version
    ON skill_version (skill_id, version DESC);
