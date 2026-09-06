-- The primary key already covers "which resources has this agent selected".
-- This index answers the other direction, "which agents selected this
-- resource", which the delete path needs to clear bindings when a resource is
-- removed, and which the settings UI needs to warn that a knowledge base is
-- still in use.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_agent_resource_resource
    ON agent_resource (resource_id);
