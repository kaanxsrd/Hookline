#!/usr/bin/env bash
# scripts/release/notes.sh <version> — prints the section of CHANGELOG.md for
# <version> (with or without a leading "v"), which becomes the release notes.
# Fails when CHANGELOG.md has no such section, so a release never goes out
# without notes.
set -euo pipefail

version="${1:?usage: notes.sh <version>}"
version="${version#v}"
changelog="$(dirname "$0")/../../CHANGELOG.md"

notes="$(awk -v v="$version" '
  index($0, "## [" v "]") == 1 { on = 1; next }
  /^## \[/ || /^\[[^]]+\]: / { on = 0 }
  on
' "$changelog")"

if [ -z "${notes//[[:space:]]/}" ]; then
  echo "CHANGELOG.md has no section for $version" >&2
  exit 1
fi
printf '%s\n' "$notes"
