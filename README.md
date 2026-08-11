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
- **Nix runtime adaptation only**: patches ELF interpreters and library paths so the official binaries can run in the Nix store.
- **Automatic updates**: GitHub Actions checks OpenAI's release artifacts hourly and commits verified version, ETag, and SHA-256 changes.
- **Multi-architecture**: supports both `x86_64-linux` and `aarch64-linux` from OpenAI's official `amd64` and `arm64` packages.
- **Reproducible inputs**: pins each upstream `.deb` by content hash and locks `nixpkgs` through `flake.lock`.

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

| Nix system | OpenAI architecture | Official package |
| --- | --- | --- |
| `x86_64-linux` | `amd64` | [`chatgpt_amd64.deb`](https://persistent.oaistatic.com/codex-app-prod/linux/deb/latest/chatgpt_amd64.deb) |
| `aarch64-linux` | `arm64` | [`chatgpt_arm64.deb`](https://persistent.oaistatic.com/codex-app-prod/linux/deb/latest/chatgpt_arm64.deb) |

OpenAI also publishes official RPM packages, but this flake uses the equivalent `.deb` payloads as its canonical source.

## Official vs. Unofficial Linux Ports

Projects created before OpenAI shipped Linux support commonly wrapped the website or converted the macOS/Windows application. Those projects helped fill a real gap, but this flake has a deliberately narrower purpose: package the **official Linux release as-is for Nix and NixOS**.

The derivation only performs changes required by the Nix store layout:

1. Extract OpenAI's `.deb`.
2. Patch native ELF interpreter and dependency paths.
3. Add the required runtime libraries and desktop utilities.
4. Install the upstream desktop entry, icon, and `chatgpt` launcher.

It does not modify ChatGPT's application code.

## Updating

The scheduled workflow checks the ETags of both official packages every hour. When OpenAI publishes new artifacts, it downloads both architectures, validates their Debian metadata, requires matching versions, computes Nix SHA-256 hashes, builds the x86_64 package, evaluates every flake output, and commits the update.

Run the same updater locally:

```sh
./scripts/update.sh
nix build .#chatgpt-desktop-app
nix flake check --all-systems --no-build
```

## License and Trademark Notice

The Nix expressions and automation in this repository are MIT licensed. ChatGPT Desktop App is proprietary software distributed by OpenAI and is marked `unfree` in Nix.

ChatGPT and OpenAI are trademarks of OpenAI. This project is not affiliated with, sponsored by, or endorsed by OpenAI.

## Upstream

- [OpenAI Codex page and official Linux download](https://openai.com/codex/)
- [ChatGPT Desktop App documentation](https://developers.openai.com/codex/app)
