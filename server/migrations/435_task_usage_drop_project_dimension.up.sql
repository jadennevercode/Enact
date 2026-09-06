-- Take the project out of the hourly usage rollup.
--
-- The pipeline (migrations 101/102, cost columns in 213, xact lock in 272,
-- teardown guard in 243) aggregates usage on the key
--
--     (bucket_hour, workspace_id, runtime_id, agent_id, project_id, provider, model)
--
-- and `project_id` came from `issue.project_id` through the task's queue row.
-- With the project concept removed that column is about to disappear, so
-- every function that reads it has to stop first — this migration must land
-- before the one that drops `issue.project_id`.
--
-- Removing the dimension deletes more than it changes, because two of the
-- three invalidation triggers existed only to keep it honest:
--
--   * `trg_issue_project_dirty_hourly` re-attributed buckets when an issue
--     moved between projects. Nothing moves any more.
--   * `trg_issue_delete_dirty_hourly` captured `OLD.project_id` before the
--     issue row vanished, because by the time the queue rows cascade the
--     issue is gone. The remaining key columns all live on the queue row and
--     the agent, so `trg_atq_dirty_hourly` already covers that delete.
--
--   * `trg_atq_dirty_hourly` keeps firing, but only for `runtime_id`.
--     `issue_id` was in its column list because re-pointing a task at
--     another issue could change the project; with the project gone, which
--     issue a task belongs to no longer affects any bucket key.
--
-- The window function loses its `LEFT JOIN issue` for the same reason, and
-- with it the `IS NOT DISTINCT FROM` project matching in both the recompute
-- and the empty-bucket delete.
--
-- `task_usage_hourly.project_id` and `task_usage_hourly_dirty.project_id` are
-- deliberately LEFT IN PLACE, always NULL from here on. Dropping a column
-- that participates in `uq_task_usage_hourly_key` drops the constraint, and
-- `ON CONFLICT ON CONSTRAINT` in this function needs a real constraint, not a
-- unique index — so the column can only go with a rebuild that leaves the
-- scheduled rollup without its conflict target for the length of the rebuild.
-- The constraint is `UNIQUE NULLS NOT DISTINCT`, so once every row holds NULL
-- it already enforces exactly the new key and the columns cost nothing but a
-- NULL bitmap bit. A follow-up migration can drop them during a maintenance
-- window.
--
-- The backfill at the end is what makes that safe. Existing rows still carry
-- real project ids; new rows will carry NULL. Left alone the two would
-- coexist and a workspace total would count the same usage twice, because the
-- empty-bucket delete only ever matches the key it recomputed. Folding every
-- row onto the NULL key first removes that possibility.

-- 1. Triggers that existed only to maintain the project dimension.
DROP TRIGGER IF EXISTS trg_issue_project_dirty_hourly ON issue;
DROP FUNCTION IF EXISTS enqueue_task_usage_hourly_dirty_for_issue_project();

DROP TRIGGER IF EXISTS trg_issue_delete_dirty_hourly ON issue;
DROP FUNCTION IF EXISTS enqueue_task_usage_hourly_dirty_for_issue_delete();

-- 2. The queue-row trigger. Body is migration 102's with the issue join and
-- the project column removed; the teardown guard from 243 is preserved.
CREATE OR REPLACE FUNCTION enqueue_task_usage_hourly_dirty_for_atq()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF OLD.runtime_id IS DISTINCT FROM NEW.runtime_id THEN
            -- OLD side. NULL runtime_id rows are not aggregated (no
            -- runtime → no bucket); skip those.
            IF OLD.runtime_id IS NOT NULL THEN
                INSERT INTO task_usage_hourly_dirty (
                    bucket_hour, workspace_id, runtime_id, agent_id, provider, model
                )
                SELECT DISTINCT
                    task_usage_hour_bucket(tu.created_at),
                    a.workspace_id,
                    OLD.runtime_id,
                    OLD.agent_id,
                    tu.provider,
                    tu.model
                  FROM task_usage tu
                  JOIN agent a ON a.id = OLD.agent_id
                 WHERE tu.task_id = OLD.id
                ON CONFLICT ON CONSTRAINT uq_task_usage_hourly_dirty_key DO UPDATE
                    SET enqueued_at = GREATEST(task_usage_hourly_dirty.enqueued_at, EXCLUDED.enqueued_at);
            END IF;

            IF NEW.runtime_id IS NOT NULL THEN
                INSERT INTO task_usage_hourly_dirty (
                    bucket_hour, workspace_id, runtime_id, agent_id, provider, model
                )
                SELECT DISTINCT
                    task_usage_hour_bucket(tu.created_at),
                    a.workspace_id,
                    NEW.runtime_id,
                    NEW.agent_id,
                    tu.provider,
                    tu.model
                  FROM task_usage tu
                  JOIN agent a ON a.id = NEW.agent_id
                 WHERE tu.task_id = NEW.id
                ON CONFLICT ON CONSTRAINT uq_task_usage_hourly_dirty_key DO UPDATE
                    SET enqueued_at = GREATEST(task_usage_hourly_dirty.enqueued_at, EXCLUDED.enqueued_at);
            END IF;
        END IF;
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        IF OLD.runtime_id IS NOT NULL THEN
            INSERT INTO task_usage_hourly_dirty (
                bucket_hour, workspace_id, runtime_id, agent_id, provider, model
            )
            SELECT DISTINCT
                task_usage_hour_bucket(tu.created_at),
                a.workspace_id,
                OLD.runtime_id,
                OLD.agent_id,
                tu.provider,
                tu.model
              FROM task_usage tu
              JOIN agent a ON a.id = OLD.agent_id
             WHERE tu.task_id = OLD.id
            ON CONFLICT ON CONSTRAINT uq_task_usage_hourly_dirty_key DO UPDATE
                SET enqueued_at = GREATEST(task_usage_hourly_dirty.enqueued_at, EXCLUDED.enqueued_at);
        END IF;
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$$;

-- INVARIANT (carried over from 102): agent_task_queue.agent_id is immutable
-- once a row is inserted. If a future feature makes it mutable it MUST be
-- added to this trigger's `OF` list, or dirty buckets for the old agent_id
-- will not be enqueued and historical aggregates will silently rot.
-- `issue_id` is no longer in the list: it only mattered while the bucket key
-- carried the issue's project.
DROP TRIGGER IF EXISTS trg_atq_dirty_hourly ON agent_task_queue;
CREATE TRIGGER trg_atq_dirty_hourly
BEFORE UPDATE OF runtime_id OR DELETE ON agent_task_queue
FOR EACH ROW
WHEN (current_setting('enact.workspace_teardown', true) IS DISTINCT FROM 'on')
EXECUTE FUNCTION enqueue_task_usage_hourly_dirty_for_atq();

-- 3. The raw-usage delete trigger. Same edit: no issue join, no project.
CREATE OR REPLACE FUNCTION enqueue_task_usage_hourly_dirty_for_tu()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO task_usage_hourly_dirty (
        bucket_hour, workspace_id, runtime_id, agent_id, provider, model
    )
    SELECT
        task_usage_hour_bucket(OLD.created_at),
        a.workspace_id,
        atq.runtime_id,
        atq.agent_id,
        OLD.provider,
        OLD.model
      FROM agent_task_queue atq
      JOIN agent a ON a.id = atq.agent_id
     WHERE atq.id = OLD.task_id
       AND atq.runtime_id IS NOT NULL
    ON CONFLICT ON CONSTRAINT uq_task_usage_hourly_dirty_key DO UPDATE
        SET enqueued_at = GREATEST(task_usage_hourly_dirty.enqueued_at, EXCLUDED.enqueued_at);
    RETURN OLD;
END;
$$;

-- 4. The window function. Body is 213's with the project dimension and the
-- `LEFT JOIN issue` it was read through removed everywhere: dirty discovery,
-- the recompute grouping, the upsert column list and the empty-bucket delete.
CREATE OR REPLACE FUNCTION rollup_task_usage_hourly_window(
    p_from TIMESTAMPTZ,
    p_to   TIMESTAMPTZ
)
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
    v_rows BIGINT;
BEGIN
    IF p_from >= p_to THEN
        RETURN 0;
    END IF;

    WITH
    dirty_from_updates AS (
        SELECT DISTINCT
            task_usage_hour_bucket(tu.created_at) AS bucket_hour,
            a.workspace_id                        AS workspace_id,
            atq.runtime_id                        AS runtime_id,
            atq.agent_id                          AS agent_id,
            tu.provider                           AS provider,
            tu.model                              AS model
          FROM task_usage tu
          JOIN agent_task_queue atq ON atq.id = tu.task_id
          JOIN agent            a   ON a.id   = atq.agent_id
         WHERE atq.runtime_id IS NOT NULL
           AND (
                (tu.updated_at >= p_from AND tu.updated_at < p_to)
                -- Legacy updated_at-NULL rows; partial index from 078.
                OR (tu.updated_at IS NULL
                    AND tu.created_at >= p_from
                    AND tu.created_at <  p_to)
           )
    ),
    dirty_from_queue AS (
        SELECT bucket_hour, workspace_id, runtime_id, agent_id, provider, model
          FROM task_usage_hourly_dirty
         WHERE enqueued_at < p_to
    ),
    dirty_keys AS (
        SELECT * FROM dirty_from_updates
        UNION
        SELECT * FROM dirty_from_queue
    ),
    recomputed AS (
        SELECT
            dk.bucket_hour,
            dk.workspace_id,
            dk.runtime_id,
            dk.agent_id,
            dk.provider,
            dk.model,
            SUM(tu.input_tokens)::bigint       AS input_tokens,
            SUM(tu.output_tokens)::bigint      AS output_tokens,
            SUM(tu.cache_read_tokens)::bigint  AS cache_read_tokens,
            SUM(tu.cache_write_tokens)::bigint AS cache_write_tokens,
            -- Authoritative half: only rows the provider priced.
            COALESCE(SUM(tu.cost_usd_ticks), 0)::bigint AS cost_usd_ticks,
            -- Estimated half: tokens from rows the provider did not price.
            COALESCE(SUM(tu.input_tokens)       FILTER (WHERE tu.cost_usd_ticks IS NULL), 0)::bigint AS uncosted_input_tokens,
            COALESCE(SUM(tu.output_tokens)      FILTER (WHERE tu.cost_usd_ticks IS NULL), 0)::bigint AS uncosted_output_tokens,
            COALESCE(SUM(tu.cache_read_tokens)  FILTER (WHERE tu.cost_usd_ticks IS NULL), 0)::bigint AS uncosted_cache_read_tokens,
            COALESCE(SUM(tu.cache_write_tokens) FILTER (WHERE tu.cost_usd_ticks IS NULL), 0)::bigint AS uncosted_cache_write_tokens,
            COUNT(DISTINCT tu.task_id)::bigint AS task_count,
            COUNT(*)::bigint                   AS event_count
          FROM dirty_keys dk
          JOIN agent_task_queue atq ON atq.runtime_id  = dk.runtime_id
                                    AND atq.agent_id    = dk.agent_id
          JOIN agent            a   ON a.id            = atq.agent_id
                                    AND a.workspace_id = dk.workspace_id
          JOIN task_usage       tu  ON tu.task_id      = atq.id
                                    AND tu.provider    = dk.provider
                                    AND tu.model       = dk.model
                                    AND task_usage_hour_bucket(tu.created_at) = dk.bucket_hour
         GROUP BY 1, 2, 3, 4, 5, 6
    ),
    upserted AS (
        INSERT INTO task_usage_hourly AS d (
            bucket_hour, workspace_id, runtime_id, agent_id, provider, model,
            input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
            cost_usd_ticks,
            uncosted_input_tokens, uncosted_output_tokens,
            uncosted_cache_read_tokens, uncosted_cache_write_tokens,
            task_count, event_count
        )
        SELECT
            bucket_hour, workspace_id, runtime_id, agent_id, provider, model,
            input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
            cost_usd_ticks,
            uncosted_input_tokens, uncosted_output_tokens,
            uncosted_cache_read_tokens, uncosted_cache_write_tokens,
            task_count, event_count
          FROM recomputed
        ON CONFLICT ON CONSTRAINT uq_task_usage_hourly_key DO UPDATE
            SET input_tokens                = EXCLUDED.input_tokens,
                output_tokens               = EXCLUDED.output_tokens,
                cache_read_tokens           = EXCLUDED.cache_read_tokens,
                cache_write_tokens          = EXCLUDED.cache_write_tokens,
                cost_usd_ticks              = EXCLUDED.cost_usd_ticks,
                uncosted_input_tokens       = EXCLUDED.uncosted_input_tokens,
                uncosted_output_tokens      = EXCLUDED.uncosted_output_tokens,
                uncosted_cache_read_tokens  = EXCLUDED.uncosted_cache_read_tokens,
                uncosted_cache_write_tokens = EXCLUDED.uncosted_cache_write_tokens,
                task_count                  = EXCLUDED.task_count,
                event_count                 = EXCLUDED.event_count,
                updated_at                  = now()
        RETURNING 1
    ),
    deleted_empty AS (
        DELETE FROM task_usage_hourly d
         USING dirty_keys dk
         WHERE d.bucket_hour  = dk.bucket_hour
           AND d.workspace_id = dk.workspace_id
           AND d.runtime_id   = dk.runtime_id
           AND d.agent_id     = dk.agent_id
           AND d.provider     = dk.provider
           AND d.model        = dk.model
           AND NOT EXISTS (
               SELECT 1 FROM recomputed r
                WHERE r.bucket_hour  = dk.bucket_hour
                  AND r.workspace_id = dk.workspace_id
                  AND r.runtime_id   = dk.runtime_id
                  AND r.agent_id     = dk.agent_id
                  AND r.provider     = dk.provider
                  AND r.model        = dk.model
           )
        RETURNING 1
    )
    SELECT (SELECT COUNT(*) FROM upserted) + (SELECT COUNT(*) FROM deleted_empty)
      INTO v_rows;

    DELETE FROM task_usage_hourly_dirty WHERE enqueued_at < p_to;

    RETURN v_rows;
END;
$$;

-- 5. Fold the existing rows onto the NULL project key.
--
-- Staged through an unlogged table rather than a CTE because the delete has
-- to happen between reading the old rows and writing the merged ones, and
-- migrations run outside an explicit transaction so a TEMP table's session
-- scope is not something to rely on.
DROP TABLE IF EXISTS task_usage_hourly_merge_tmp;
CREATE UNLOGGED TABLE task_usage_hourly_merge_tmp AS
SELECT
    bucket_hour, workspace_id, runtime_id, agent_id, provider, model,
    SUM(input_tokens)::bigint       AS input_tokens,
    SUM(output_tokens)::bigint      AS output_tokens,
    SUM(cache_read_tokens)::bigint  AS cache_read_tokens,
    SUM(cache_write_tokens)::bigint AS cache_write_tokens,
    SUM(cost_usd_ticks)::bigint     AS cost_usd_ticks,
    -- The uncosted columns are NULL on buckets not recomputed since 213 added
    -- them, and readers COALESCE to the total. Summing with COALESCE would
    -- turn "not yet known" into a real zero for the whole merged bucket, so a
    -- group keeps NULL unless every row in it had a value.
    CASE WHEN bool_and(uncosted_input_tokens IS NOT NULL)
         THEN SUM(uncosted_input_tokens)::bigint END        AS uncosted_input_tokens,
    CASE WHEN bool_and(uncosted_output_tokens IS NOT NULL)
         THEN SUM(uncosted_output_tokens)::bigint END       AS uncosted_output_tokens,
    CASE WHEN bool_and(uncosted_cache_read_tokens IS NOT NULL)
         THEN SUM(uncosted_cache_read_tokens)::bigint END   AS uncosted_cache_read_tokens,
    CASE WHEN bool_and(uncosted_cache_write_tokens IS NOT NULL)
         THEN SUM(uncosted_cache_write_tokens)::bigint END  AS uncosted_cache_write_tokens,
    -- task_count counted DISTINCT task_id within one project bucket. A task
    -- belongs to exactly one issue and so to exactly one project, so no task
    -- is counted in two of the rows being merged and the sum stays exact.
    SUM(task_count)::bigint  AS task_count,
    SUM(event_count)::bigint AS event_count,
    MAX(updated_at)          AS updated_at
FROM task_usage_hourly
GROUP BY 1, 2, 3, 4, 5, 6;

DELETE FROM task_usage_hourly;

INSERT INTO task_usage_hourly (
    bucket_hour, workspace_id, runtime_id, agent_id, provider, model,
    input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
    cost_usd_ticks,
    uncosted_input_tokens, uncosted_output_tokens,
    uncosted_cache_read_tokens, uncosted_cache_write_tokens,
    task_count, event_count, updated_at
)
SELECT
    bucket_hour, workspace_id, runtime_id, agent_id, provider, model,
    input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
    cost_usd_ticks,
    uncosted_input_tokens, uncosted_output_tokens,
    uncosted_cache_read_tokens, uncosted_cache_write_tokens,
    task_count, event_count, updated_at
FROM task_usage_hourly_merge_tmp;

DROP TABLE task_usage_hourly_merge_tmp;

-- Same fold for the pending invalidations. These are work items, not
-- aggregates, so the merge keeps the latest enqueue time for the key.
DROP TABLE IF EXISTS task_usage_hourly_dirty_merge_tmp;
CREATE UNLOGGED TABLE task_usage_hourly_dirty_merge_tmp AS
SELECT
    bucket_hour, workspace_id, runtime_id, agent_id, provider, model,
    MAX(enqueued_at) AS enqueued_at
FROM task_usage_hourly_dirty
GROUP BY 1, 2, 3, 4, 5, 6;

DELETE FROM task_usage_hourly_dirty;

INSERT INTO task_usage_hourly_dirty (
    bucket_hour, workspace_id, runtime_id, agent_id, provider, model, enqueued_at
)
SELECT
    bucket_hour, workspace_id, runtime_id, agent_id, provider, model, enqueued_at
FROM task_usage_hourly_dirty_merge_tmp;

DROP TABLE task_usage_hourly_dirty_merge_tmp;

COMMENT ON COLUMN task_usage_hourly.project_id IS
    'Vestigial. Always NULL since migration 435 removed the project dimension; kept only because dropping it would drop uq_task_usage_hourly_key, which the rollup needs as an ON CONFLICT target.';
COMMENT ON COLUMN task_usage_hourly_dirty.project_id IS
    'Vestigial. Always NULL since migration 435; see task_usage_hourly.project_id.';
