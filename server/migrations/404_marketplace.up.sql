-- The Marketplace: a directory of publishable capability assets — skills,
-- agent templates and MCP server entries — that any workspace in this
-- deployment can browse and install into its own library.
--
-- Ontologies are deliberately absent. They are not stored here: they are
-- federated from Capability Hub and materialized as an ordinary workspace
-- skill on attach (see handler/ontology.go). The Marketplace UI lists them as
-- a fourth kind by reading that catalog, not this table.
--
-- The shape follows plugin_package / plugin_package_version / _file, which
-- solved the same problem one release earlier: an identity row, immutable
-- published versions, and the bytes a version ships. What is new here is the
-- part migration 392 named as a separate decision and deferred — a directory
-- readable outside the publishing workspace, and therefore a status column
-- with a takedown state.
--
-- No foreign keys (repo rule): the application resolves every relationship and
-- sweeps versions/files/installs explicitly.

-- One publishable identity. `slug` is a stable human handle scoped to the
-- publisher, not a global name: a deployment-wide unique slug would make
-- publishing a land grab between tenants, so listings are addressed by id and
-- two workspaces may each publish their own "code-review".
CREATE TABLE marketplace_listing (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind TEXT NOT NULL CHECK (kind IN ('skill', 'agent', 'mcp')),
    slug TEXT NOT NULL CHECK (char_length(slug) BETWEEN 2 AND 128),
    name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 160),
    description TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT '',
    tags TEXT[] NOT NULL DEFAULT '{}',
    -- Publisher. Kept even for a public listing: a reader has to be able to
    -- see who is accountable for what they are about to install.
    workspace_id UUID NOT NULL,
    published_by UUID,
    -- 'public' reaches every workspace in this deployment; 'workspace' is an
    -- internal team library and never leaves the publishing workspace. Both
    -- run through the same install path, so a team can rehearse a listing
    -- before making it public.
    visibility TEXT NOT NULL DEFAULT 'workspace' CHECK (visibility IN ('public', 'workspace')),
    -- draft: never published, publisher-only. published: installable.
    -- deprecated: still installable for anyone who already depends on it, but
    -- hidden from browse. removed: taken down; nothing may install it. A
    -- takedown never deletes the row, so an install record keeps naming
    -- something that exists.
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'deprecated', 'removed')),
    featured BOOLEAN NOT NULL DEFAULT FALSE,
    install_count BIGINT NOT NULL DEFAULT 0 CHECK (install_count >= 0),
    -- The version a plain install resolves to. Denormalized so browsing does
    -- not join the version table per row.
    latest_version_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One published version. Immutable by construction, exactly as
-- plugin_package_version is: nothing in the application updates this row, and
-- republishing an existing version string is a conflict rather than an
-- overwrite. An installed workspace can therefore always be told which bytes
-- it took.
--
-- `manifest` is the kind-specific descriptor the installer reads: skill
-- frontmatter for a skill, the portable agent fields for an agent template,
-- the redacted server entry plus its required secret names for an MCP entry.
-- It never carries credential values — the publish path strips them and
-- marketplace_sanitize.go owns that rule.
CREATE TABLE marketplace_listing_version (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_id UUID NOT NULL,
    version TEXT NOT NULL CHECK (char_length(version) BETWEEN 1 AND 64),
    manifest JSONB NOT NULL CHECK (jsonb_typeof(manifest) = 'object'),
    changelog TEXT NOT NULL DEFAULT '',
    -- sha256 over the canonical manifest + file set, hex. Two people can
    -- confirm they are looking at the same version.
    digest TEXT NOT NULL CHECK (char_length(digest) = 64),
    size_bytes BIGINT NOT NULL CHECK (size_bytes >= 0),
    published_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The files a version ships: SKILL.md and its references for a skill listing,
-- and the same for every skill an agent template embeds.
--
-- TEXT rather than BYTEA, matching skill_file.content: the import pipeline
-- already drops binary files because they cannot survive a PG TEXT column, so
-- storing bytes here would create a class of listing that can be published and
-- never installed.
CREATE TABLE marketplace_listing_file (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    version_id UUID NOT NULL,
    path TEXT NOT NULL CHECK (char_length(path) BETWEEN 1 AND 1024),
    content TEXT NOT NULL,
    size_bytes BIGINT NOT NULL CHECK (size_bytes >= 0),
    sha256 TEXT NOT NULL CHECK (char_length(sha256) = 64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- What a workspace took, and which version it took. Drives the install
-- counter and the "a newer version is available" prompt on the installed
-- entity. The installed entity is an ordinary workspace row from that moment
-- on: this table records provenance, it does not own the copy, and deleting
-- the skill or agent leaves the record to be swept by the application.
CREATE TABLE marketplace_install (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_id UUID NOT NULL,
    version_id UUID NOT NULL,
    workspace_id UUID NOT NULL,
    entity_kind TEXT NOT NULL CHECK (entity_kind IN ('skill', 'agent', 'mcp')),
    entity_id UUID NOT NULL,
    installed_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
