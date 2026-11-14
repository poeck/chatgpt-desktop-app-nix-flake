import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import update


def package(arch="amd64", version="26.1111.21308"):
    return (
        f"Package: chatgpt\nVersion: {version}\nArchitecture: {arch}\n"
        f"Filename: pool/main/c/chatgpt/chatgpt_{version}_{arch}.deb\n"
        f"Size: 42\nSHA256: {'00' * 32}\nDescription: ChatGPT\n continued description\n\n"
    )


def releases():
    return {
        system: update.parse_release(package(arch), arch)
        for system, arch in update.ARCHES.items()
    }


class UpdateTests(unittest.TestCase):
    def test_selects_latest_numeric_version_and_correct_architecture(self):
        index = package(version="26.999.1") + package() + package("arm64", "26.9999.1")
        release = update.parse_release(index, "amd64")
        self.assertEqual(release["version"], "26.1111.21308")
        self.assertEqual(release["hash"], "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=")
        self.assertTrue(release["url"].endswith("/chatgpt_26.1111.21308_amd64.deb"))

    def test_rejects_invalid_index_metadata(self):
        for old, new in [
            ("pool/main/c/chatgpt/", "https://example.org/"),
            ("SHA256: " + "00" * 32, "SHA256: invalid"),
            ("Size: 42", "Size: -1"),
            ("Version: 26.1111.21308", 'Version: 26.1111.${bad}'),
            ("Architecture: amd64", "Architecture: arm64"),
        ]:
            with self.subTest(new=new), self.assertRaises(ValueError):
                update.parse_release(package().replace(old, new), "amd64")

    def test_partial_release_and_downgrade_leave_pins_unchanged(self):
        with tempfile.TemporaryDirectory() as directory:
            sources = Path(directory) / "sources.nix"
            sources.write_text("previous pins")
            partial = releases()
            partial["aarch64-linux"] = update.parse_release(package("arm64", "26.1110.1"), "arm64")
            with patch.object(update, "verify_package") as verify:
                with self.assertRaisesRegex(ValueError, "versions differ"):
                    update.update_sources(partial, {"version": "26.1023.51421"}, sources)
                with self.assertRaisesRegex(ValueError, "downgrade"):
                    update.update_sources(releases(), {"version": "26.1112.1"}, sources)
                verify.assert_not_called()
            self.assertEqual(sources.read_text(), "previous pins")

    def test_failed_second_download_preserves_both_previous_pins(self):
        with tempfile.TemporaryDirectory() as directory:
            sources = Path(directory) / "sources.nix"
            sources.write_text("previous pins")
            with patch.object(update, "verify_package", side_effect=[None, subprocess.CalledProcessError(1, "nix")]):
                with self.assertRaises(subprocess.CalledProcessError):
                    update.update_sources(releases(), {"version": "26.1023.51421"}, sources)
            self.assertEqual(sources.read_text(), "previous pins")
            self.assertEqual(list(Path(directory).iterdir()), [sources])

    def test_successful_update_and_unchanged_release(self):
        with tempfile.TemporaryDirectory() as directory:
            sources = Path(directory) / "sources.nix"
            sources.write_text("previous pins")
            selected = releases()
            with patch.object(update, "verify_package") as verify:
                update.update_sources(selected, {"version": "26.1023.51421"}, sources)
                self.assertEqual(verify.call_count, 2)
                self.assertEqual(sources.read_text(), update.render_sources(selected))
                self.assertEqual(sources.stat().st_mode & 0o777, 0o644)
                verify.reset_mock()
                update.update_sources(selected, {"version": "26.1111.21308"}, sources)
                verify.assert_not_called()

    def test_rejects_package_that_does_not_match_index(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "package.deb"
            path.write_bytes(b"x" * 42)
            release = update.parse_release(package(), "amd64")
            fetched = json.dumps({"hash": release["hash"], "storePath": str(path)})
            for control in [package("arm64"), package(version="26.1110.1")]:
                with patch.object(subprocess, "check_output", side_effect=[fetched, control]):
                    with self.assertRaisesRegex(ValueError, "Debian package metadata"):
                        update.verify_package(release)


if __name__ == "__main__":
    unittest.main()
