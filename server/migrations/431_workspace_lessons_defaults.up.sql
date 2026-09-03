-- Provisioning marker for the Lesson Learner bundle (lessons, phase 2).
--
-- Parallel to `sdlc_defaults_version` and deliberately not folded into it. The
-- two bundles ship on their own schedules and a workspace can legitimately be
-- current on one and behind on the other; sharing a counter would mean every
-- change to either re-provisions both, and a failure in one would hold back the
-- other.
--
-- Same reconciliation shape: bump the constant in Go, redeploy, and every
-- workspace below it is repaired at boot.

ALTER TABLE workspace
    ADD COLUMN IF NOT EXISTS lessons_defaults_version INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN workspace.lessons_defaults_version IS
    'Version of the product-owned Lesson Learner bundle this workspace has been provisioned with. Behind the Go constant means it is re-applied at boot.';
