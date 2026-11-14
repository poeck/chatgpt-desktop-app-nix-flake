# ChatGPT Desktop App Nix Flake (Official Linux Build)

[![Update ChatGPT Desktop App](https://github.com/poeck/chatgpt-desktop-app-nix-flake/actions/workflows/update.yml/badge.svg)](https://github.com/poeck/chatgpt-desktop-app-nix-flake/actions/workflows/update.yml)

Nix flake for OpenAI's **official ChatGPT Desktop App for Linux**.

This packages the real, native Linux build published by OpenAI. It does not wrap `chatgpt.com`, convert the macOS app, unpack the Windows app, or depend on an unofficial Linux port.

> [!IMPORTANT]
> This repository is an independent Nix package and is not affiliated with or endorsed by OpenAI. The application binary it installs is the official Linux release hosted by OpenAI.

## Why This Flake

- **Official upstream Linux binary**: downloads OpenAI's own `chatgpt` Debian packages from `persistent.oaistatic.com`.
- **No unofficial repack**: the application payload is not rebuilt or patched with third-party features.
- **NixOS-ready**: provides a NixOS module, overlay, package, and runnable app output.
- **Native desktop integration**: preserves OpenAI's launcher, desktop entry, icon, URL handler, and MIME associations.
- **Nix runtime adaptation only**: adapts ELF interpreters, library paths, and writable plugin-cache copies for the Nix store.
- **Automatic updates**: GitHub Actions checks OpenAI's APT indexes hourly and commits verified versions and SHA-256 hashes.
- **Multi-architecture**: supports both `x86_64-linux` and `aarch64-linux` from OpenAI's official `amd64` and `arm64` packages.
- **Reproducible inputs**: pins each upstream `.deb` by versioned URL and content hash, and locks `nixpkgs` through `flake.lock`.

## Usage

Run directly:

```sh
nix run github:poeck/chatgpt-desktop-app-nix-flake
```

Install into a Nix profile:

```sh
nix profile install github:poeck/chatgpt-desktop-app-nix-flake
```

Use the NixOS module:

```nix
{
  inputs.chatgpt-desktop-app.url = "github:poeck/chatgpt-desktop-app-nix-flake";

  outputs = { nixpkgs, chatgpt-desktop-app, ... }: {
    nixosConfigurations.my-host = nixpkgs.lib.nixosSystem {
      system = "x86_64-linux";
      modules = [
        chatgpt-desktop-app.nixosModules.default
        {
          nixpkgs.config.allowUnfree = true;
          programs.chatgpt-desktop-app.enable = true;
        }
      ];
    };
  };
}
```

Use the overlay:

```nix
{
  nixpkgs.config.allowUnfree = true;
  nixpkgs.overlays = [ inputs.chatgpt-desktop-app.overlays.default ];
  environment.systemPackages = [ pkgs.chatgpt-desktop-app ];
}
```

The installed command is `chatgpt`.

## Official Upstream Packages

The flake consumes OpenAI's official Debian packages directly:

| Nix system | OpenAI architecture | Official APT index |
| --- | --- | --- |
| `x86_64-linux` | `amd64` | [Packages](https://persistent.oaistatic.com/codex-app-prod/linux/deb/dists/stable/main/binary-amd64/Packages) |
| `aarch64-linux` | `arm64` | [Packages](https://persistent.oaistatic.com/codex-app-prod/linux/deb/dists/stable/main/binary-arm64/Packages) |

Each package is fetched from
`https://persistent.oaistatic.com/codex-app-prod/linux/deb/pool/main/c/chatgpt/chatgpt_${version}_${arch}.deb`.
The `/latest/` URLs are overwritten on new releases and are deliberately avoided:
otherwise a fresh download can fail its pinned hash while a cached build succeeds.

OpenAI also publishes official RPM packages, but this flake uses the equivalent `.deb` payloads as its canonical source.

## Official vs. Unofficial Linux Ports

Projects created before OpenAI shipped Linux support commonly wrapped the website or converted the macOS/Windows application. Those projects helped fill a real gap, but this flake has a deliberately narrower purpose: package the **official Linux release as-is for Nix and NixOS**.

The derivation only performs changes required by the Nix store layout:

1. Extract OpenAI's `.deb`.
2. Patch native ELF interpreter and dependency paths.
3. Add the required runtime libraries and desktop utilities.
4. Adapt libc detection and ensure copied plugin caches are owner-writable.
5. Install the upstream desktop entry, icon, and `chatgpt` launcher.

These compatibility patches preserve the upstream application's behavior on NixOS.

Bundled plugins are copied out of the read-only Nix store before the app customizes
their manifests and skills. The Linux copy helper makes those destination files
and directories owner-writable, preserving executable bits and skipping symlinks.
Without this adaptation, a manifest write can fail with `EACCES`, aborting the
marketplace update and leaving an older Browser plugin paired with a newer runtime.
The store originals and symlink targets remain unchanged.

Every package build tests the patched copy helper against read-only fixtures,
including manifest edits, directory removal, repeated updates, and source and
symlink-target preservation. The build fails if the upstream copy helper changes
so that the patch needs review.

## Updating

The scheduled workflow reads the version, filename, size, and SHA-256 from both
official APT indexes every hour. It requires matching versions and refuses
automatic downgrades. Before replacing `sources.nix`, it fetches both versioned
packages through Nix with the expected hashes, checks their sizes, and validates
their Debian package names, versions, and architectures. A failed download or
partial release leaves both previous pins intact. ETags are no longer used.
The workflow then builds the x86_64 package, evaluates every flake output, and
commits the update.

Run the same updater locally from the repository root (requires Python 3, curl, and Nix;
the updater uses the locked nixpkgs input to provide `dpkg-deb`):

```sh
./scripts/update.sh
python3 scripts/test-update.py
nix build .#chatgpt-desktop-app
nix flake check --all-systems --no-build
```

## License and Trademark Notice

The Nix expressions and automation in this repository are MIT licensed. ChatGPT Desktop App is proprietary software distributed by OpenAI and is marked `unfree` in Nix.

ChatGPT and OpenAI are trademarks of OpenAI. This project is not affiliated with, sponsored by, or endorsed by OpenAI.

## Upstream

- [OpenAI Codex page and official Linux download](https://openai.com/codex/)
- [ChatGPT Desktop App documentation](https://developers.openai.com/codex/app)
