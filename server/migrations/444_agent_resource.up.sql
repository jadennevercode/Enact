-- Per-agent resource selection.
--
-- `workspace_resource` is workspace-wide by design: every task in the
-- workspace sees every repo and directory attached to it. That is right for
-- code — an agent working an issue needs the code the issue is about — and
-- wrong for knowledge. A knowledge base is only worth its context cost to the
-- agents whose work it informs, and injecting every workspace's knowledge into
-- every run would put a domain handbook in front of an agent triaging inbox
-- mail.
--
-- So knowledge is opted into per agent, and this table is that opt-in. It is
-- deliberately not `agent_knowledge`: the row says "this agent selected this
-- resource", and a later resource type that wants the same treatment needs no
-- second join table. Today only `knowledge_repo` resources are ever bound
-- here; `github_repo` and `local_directory` stay workspace-wide.
--
-- No foreign keys, per the repo rule. Deleting a resource or an agent clears
-- its rows explicitly in application code, inside the same transaction as the
-- parent delete.
CREATE TABLE IF NOT EXISTS agent_resource (
    agent_id    UUID NOT NULL,
    resource_id UUID NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by  UUID,
    PRIMARY KEY (agent_id, resource_id)
);

COMMENT ON TABLE agent_resource IS
    'Workspace resources an individual agent has opted into. Today only knowledge_repo resources; code resources stay workspace-wide.';
