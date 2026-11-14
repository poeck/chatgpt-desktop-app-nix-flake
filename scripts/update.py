#!/usr/bin/env python3
"""Pin both architectures from OpenAI's APT indexes and verify their packages."""

import base64
import json
from pathlib import Path
import re
import subprocess
import tempfile


ROOT = Path(__file__).resolve().parents[1]
SOURCES = ROOT / "pkgs/chatgpt-desktop-app/sources.nix"
BASE_URL = "https://persistent.oaistatic.com/codex-app-prod/linux/deb/"
ARCHES = {"x86_64-linux": "amd64", "aarch64-linux": "arm64"}


def control_records(text):
    """Read Debian control paragraphs, including folded description fields."""
    record = {}
    field = None
    for line in [*text.splitlines(), ""]:
        if not line:
            if record:
                yield record
            record, field = {}, None
        elif line[0].isspace() and field:
            record[field] += "\n" + line[1:]
        else:
            field, separator, value = line.partition(":")
            if not separator or field in record:
                raise ValueError("Invalid Debian control record")
            record[field] = value.strip()


def version_key(version):
    if not re.fullmatch(r"[0-9]+(?:\.[0-9]+)+", version):
        raise ValueError(f"Unexpected ChatGPT version: {version!r}")
    return tuple(map(int, version.split(".")))


def parse_release(index, arch):
    packages = [
        record for record in control_records(index)
        if record.get("Package") == "chatgpt" and record.get("Architecture") == arch
    ]
    if not packages:
        raise ValueError(f"No chatgpt package for {arch} in the APT index")
    package = max(packages, key=lambda item: version_key(item["Version"]))
    version = package["Version"]
    filename = f"pool/main/c/chatgpt/chatgpt_{version}_{arch}.deb"
    if package["Filename"] != filename:
        raise ValueError(f"Unexpected package filename for {arch}: {package['Filename']!r}")
    if not re.fullmatch(r"[0-9a-fA-F]{64}", package["SHA256"]):
        raise ValueError(f"Invalid SHA-256 digest for {arch}")
    if int(package["Size"]) <= 0:
        raise ValueError(f"Invalid package size for {arch}")
    return {
        "version": version,
        "arch": arch,
        "url": BASE_URL + filename,
        "size": int(package["Size"]),
        "hash": "sha256-" + base64.b64encode(bytes.fromhex(package["SHA256"])).decode("ascii"),
    }


def render_sources(releases):
    versions = {release["version"] for release in releases.values()}
    if len(versions) != 1:
        raise ValueError("APT package versions differ between amd64 and arm64; retry after publication finishes")
    version = next(iter(versions))
    platforms = "\n\n".join(
        f'    {system} = {{\n'
        f'      debArch = "{release["arch"]}";\n'
        f'      hash = "{release["hash"]}";\n'
        f'    }};'
        for system, release in releases.items()
    )
    return f'{{\n  version = "{version}";\n\n  platforms = {{\n{platforms}\n  }};\n}}\n'


def verify_package(release):
    # Nix verifies the index's expected hash, also when the file is cached.
    fetched = json.loads(subprocess.check_output([
        "nix", "store", "prefetch-file", "--json",
        "--expected-hash", release["hash"], release["url"],
    ], text=True))
    path = Path(fetched["storePath"])
    if fetched["hash"] != release["hash"] or path.stat().st_size != release["size"]:
        raise ValueError(f"Package hash or size mismatch for {release['arch']}")
    # dpkg can inspect either architecture without executing its payload.
    control = subprocess.check_output([
        "nix", "shell", "--inputs-from", str(ROOT), "nixpkgs#dpkg",
        "--command", "dpkg-deb", "--field", str(path),
    ], text=True)
    package, = control_records(control)
    if (package["Package"], package["Version"], package["Architecture"]) != (
        "chatgpt", release["version"], release["arch"],
    ):
        raise ValueError(f"Unexpected Debian package metadata for {release['arch']}")


def update_sources(releases, current, sources_file=SOURCES):
    updated = render_sources(releases)
    version = next(iter(releases.values()))["version"]
    if version_key(version) < version_key(current["version"]):
        raise ValueError(f"APT indexes would downgrade {current['version']} to {version}; leaving pins unchanged")
    if sources_file.read_text() == updated:
        print(f"ChatGPT Desktop App {version} is already up to date.", flush=True)
        return
    # Verify both architectures before atomically replacing any previous pins.
    for release in releases.values():
        verify_package(release)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", dir=sources_file.parent, delete=False) as output:
            temporary = Path(output.name)
            output.write(updated)
        temporary.chmod(0o644)
        temporary.replace(sources_file)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    print(f"Updated ChatGPT Desktop App to {version}", flush=True)


def main():
    releases = {}
    for system, arch in ARCHES.items():
        url = BASE_URL + f"dists/stable/main/binary-{arch}/Packages"
        index = subprocess.check_output([
            "curl", "-fsSL", "--retry", "3", "--max-time", "60", url,
        ], text=True)
        releases[system] = parse_release(index, arch)
    current = json.loads(subprocess.check_output([
        "nix", "eval", "--json", "--file", str(SOURCES),
    ], text=True))
    update_sources(releases, current)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, subprocess.CalledProcessError) as error:
        raise SystemExit(f"Update failed; source pins were not replaced: {error}") from error
