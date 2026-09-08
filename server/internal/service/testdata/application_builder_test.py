"""Source recovery and packaging boundaries for the shipped application helpers."""
import base64
import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest

SCRIPTS = Path(__file__).resolve().parents[1] / "builtin_skills/enact-application-building/scripts"
sys.path.insert(0, str(SCRIPTS))
import build
import restore


class ApplicationSourceTests(unittest.TestCase):
    def test_snapshot_excludes_credentials_and_generated_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "package.json").write_text("{}")
            (root / ".npmrc").write_text("private registry credentials")
            (root / ".env.production").write_text("private runtime credentials")
            (root / "dist").mkdir()
            (root / "dist/index.html").write_text("generated")
            self.assertEqual(build.snapshot(root), {"package.json": b"{}"})

    def test_restore_checks_digest_and_never_overwrites_work(self):
        files = {"package.json": b"{}", "src/application.ts": b"export const name = 'quality'"}
        artifact = {"source_files": {name: base64.b64encode(data).decode() for name, data in files.items()}, "source_revision": build.source_digest(files)}
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "source"
            self.assertEqual(restore.restore(artifact, target), 2)
            self.assertEqual((target / "src/application.ts").read_bytes(), files["src/application.ts"])
            with self.assertRaisesRegex(ValueError, "empty destination"):
                restore.restore(artifact, target)
            artifact["source_revision"] = "tampered"
            with self.assertRaisesRegex(ValueError, "does not match"):
                restore.restore(artifact, Path(directory) / "new")

    def test_restore_rejects_path_traversal(self):
        artifact = {"source_files": {"../outside": base64.b64encode(b"unsafe").decode()}}
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError, "Unsafe"):
                restore.restore(artifact, Path(directory))

    def test_asset_packaging_requires_entry(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError, "index.html"):
                build.package_assets(Path(directory))


if __name__ == "__main__":
    unittest.main()
