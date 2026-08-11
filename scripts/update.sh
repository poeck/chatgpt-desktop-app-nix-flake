#!/usr/bin/env bash
set -euo pipefail

base_url="https://persistent.oaistatic.com/codex-app-prod/linux/deb/latest"
sources_file="pkgs/chatgpt-desktop-app/sources.nix"

if [[ ! -f "$sources_file" ]]; then
  echo "Run this script from the repository root." >&2
  exit 1
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

url_for() {
  printf '%s/chatgpt_%s.deb\n' "$base_url" "$1"
}

remote_etag() {
  local arch="$1"
  local etag
  etag="$({ curl -fsSIL --retry 3 "$(url_for "$arch")" || true; } | awk '
    tolower($1) == "etag:" {
      value = $2
      gsub("\\r", "", value)
      sub(/^W\//, "", value)
      sub(/^"/, "", value)
      sub(/"$/, "", value)
    }
    END { print value }
  ')"

  if [[ -z "$etag" ]]; then
    echo "Could not read the upstream ETag for $arch" >&2
    exit 1
  fi
  printf '%s\n' "$etag"
}

current_etag() {
  local arch="$1"
  awk -v arch="$arch" '
    $0 ~ ("debArch = \"" arch "\"") { found = 1; next }
    found && /etag = "/ {
      value = $0
      sub(/.*etag = "/, "", value)
      sub(/";.*/, "", value)
      print value
      exit
    }
  ' "$sources_file"
}

control_field() {
  local deb="$1"
  local field="$2"
  local member
  member="$(ar t "$deb" | awk '/^control\.tar\./ { print; exit }')"

  case "$member" in
    control.tar.xz)
      ar p "$deb" "$member" | tar -xJOf - ./control
      ;;
    control.tar.gz)
      ar p "$deb" "$member" | tar -xzOf - ./control
      ;;
    control.tar.zst)
      ar p "$deb" "$member" | tar --zstd -xOf - ./control
      ;;
    *)
      echo "Unsupported Debian control archive: $member" >&2
      exit 1
      ;;
  esac | sed -n "s/^$field: //p" | head -n1
}

etag_amd64="$(remote_etag amd64)"
etag_arm64="$(remote_etag arm64)"

if [[ "$etag_amd64" == "$(current_etag amd64)" && "$etag_arm64" == "$(current_etag arm64)" ]]; then
  echo "ChatGPT Desktop App is already up to date."
  exit 0
fi

for arch in amd64 arm64; do
  curl -fL --retry 3 -o "$tmp/chatgpt_$arch.deb" "$(url_for "$arch")"

  package="$(control_field "$tmp/chatgpt_$arch.deb" Package)"
  package_arch="$(control_field "$tmp/chatgpt_$arch.deb" Architecture)"
  if [[ "$package" != "chatgpt" || "$package_arch" != "$arch" ]]; then
    echo "Unexpected package metadata for $arch: package=$package architecture=$package_arch" >&2
    exit 1
  fi
done

version_amd64="$(control_field "$tmp/chatgpt_amd64.deb" Version)"
version_arm64="$(control_field "$tmp/chatgpt_arm64.deb" Version)"

if [[ -z "$version_amd64" || "$version_amd64" != "$version_arm64" ]]; then
  echo "Version mismatch: amd64=$version_amd64 arm64=$version_arm64" >&2
  exit 1
fi

hash_amd64="$(nix hash file --sri "$tmp/chatgpt_amd64.deb")"
hash_arm64="$(nix hash file --sri "$tmp/chatgpt_arm64.deb")"

VERSION="$version_amd64" \
ETAG_AMD64="$etag_amd64" \
ETAG_ARM64="$etag_arm64" \
HASH_AMD64="$hash_amd64" \
HASH_ARM64="$hash_arm64" \
perl -0pi -e '
  s{version = "[^"]+";}{version = "$ENV{VERSION}";};
  s{debArch = "amd64";\n      etag = "[^"]+";\n      hash = "[^"]+";}{debArch = "amd64";\n      etag = "$ENV{ETAG_AMD64}";\n      hash = "$ENV{HASH_AMD64}";};
  s{debArch = "arm64";\n      etag = "[^"]+";\n      hash = "[^"]+";}{debArch = "arm64";\n      etag = "$ENV{ETAG_ARM64}";\n      hash = "$ENV{HASH_ARM64}";};
' "$sources_file"

echo "Updated ChatGPT Desktop App to $version_amd64"
