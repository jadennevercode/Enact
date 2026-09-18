"""Tests for the role resolution the gates depend on.

Run with: go test ./internal/service/ -run TestSDLCRoleScripts, or directly with
    python3 -m unittest discover -s internal/service/testdata/sdlc

Who holds a role now comes from the workspace, through the enact CLI, so these
tests stand a fake `enact` on PATH and check the three answers a gate actually
asks for: who holds this role, does this role exist, and is anything unstaffed.
"""

import json
import os
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

# The scripts live in the embedded skill bundle; this test lives outside it so
# it is not shipped to every agent workspace along with the suite.
SCRIPTS = (
    Path(__file__).resolve().parents[2]
    / "builtin_sdlc"
    / "skills"
    / "sdlc-core"
    / "scripts"
)
sys.path.insert(0, str(SCRIPTS))

import _common  # noqa: E402

CATALOG = [
    {
        "key": "qa",
        "name": "QA",
        "archived": False,
        "holders": [{"user_id": "u-1", "name": "Ada", "email": "ada@example.com"}],
    },
    {
        "key": "architect",
        "name": "架构",
        "archived": False,
        "holders": [],
    },
    {
        "key": "ops",
        "name": "运维",
        "archived": True,
        "holders": [{"user_id": "u-2", "name": "Bo", "email": "bo@example.com"}],
    },
    {
        "key": "security_review",
        "name": "安全评审",
        "archived": False,
        "holders": [{"user_id": "u-3", "name": "Cy", "email": "cy@example.com"}],
    },
]


class RoleHolderTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.install_fake_enact(json.dumps(CATALOG, ensure_ascii=False))

    def install_fake_enact(self, stdout, exit_code=0):
        """A fake CLI on PATH. Never the real one: these tests must not reach an
        account, and the point is the parsing, not the transport."""
        path = Path(self.tmp.name) / "enact"
        path.write_text(f"#!/bin/sh\ncat <<'JSON'\n{stdout}\nJSON\nexit {exit_code}\n")
        path.chmod(path.stat().st_mode | stat.S_IEXEC)
        os.environ["PATH"] = f"{self.tmp.name}{os.pathsep}{os.environ['PATH']}"
        _common._TEAM_ROLE_CACHE = False

    def test_holders_are_reachable_by_key_and_by_both_names(self):
        holders = _common.role_holders()
        # A project may name the role by its workspace key, by the workspace's
        # own display name, or by the name this suite ships with.
        self.assertEqual(holders["qa"], ["Ada"])
        self.assertEqual(holders["QA"], ["Ada"])
        self.assertEqual(holders["security_review"], ["Cy"])
        self.assertEqual(holders["安全评审"], ["Cy"])

    def test_archived_role_holds_nobody(self):
        # The assignment survives archiving so it can be restored, but a retired
        # role must not satisfy a gate — that would be a signature from a role
        # the workspace has decided no longer applies.
        holders = _common.role_holders()
        self.assertNotIn("ops", holders)
        self.assertNotIn("运维", holders)

    def test_role_with_no_holders_is_reported_missing(self):
        missing = _common.missing_approver_roles({})
        self.assertIn("架构", missing)   # defined, nobody holds it
        self.assertIn("运维", missing)   # archived, so unstaffed
        self.assertNotIn("QA", missing)  # Ada holds it

    def test_a_workspace_defined_role_is_a_known_role(self):
        known = _common.known_role_names()
        self.assertIn("安全评审", known)
        self.assertIn("security_review", known)
        self.assertIn("业务负责人", known)  # suite vocabulary, always known

    def test_config_naming_a_role_nothing_defines_is_reported(self):
        cfg = {"phase_review": {"qa": ["法务"]}}
        self.assertIn("法务", _common.unknown_roles(cfg))

    def test_unreachable_cli_means_nobody_is_confirmed(self):
        # No enact CLI, no workspace, no network. Reporting "nobody holds this"
        # is the honest answer; pretending the roles are staffed would let a
        # gate through on an assumption this script cannot check.
        path = Path(self.tmp.name) / "enact"
        path.write_text("#!/bin/sh\nexit 1\n")
        path.chmod(path.stat().st_mode | stat.S_IEXEC)
        _common._TEAM_ROLE_CACHE = False
        self.assertEqual(_common.role_holders(), {})
        self.assertIn("QA", _common.missing_approver_roles({}))


if __name__ == "__main__":
    unittest.main()
