#!/usr/bin/env bash
# Packages the double-click openers: dist/James-JMD-macos.zip and dist/James-JMD-windows.zip.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT"
rm -rf dist && mkdir -p dist/mac dist/windows
node tools/build.mjs >/dev/null
tools/macos-app.sh dist/mac >/dev/null
(cd dist/mac && ditto -c -k --keepParent "James JMD.app" "../James-JMD-macos.zip")
cp build/james-jmd.html tools/windows/jmd-open.ps1 tools/windows/install.cmd tools/windows/uninstall.cmd dist/windows/
(cd dist/windows && zip -q -r ../James-JMD-windows.zip .)
rm -rf dist/mac dist/windows
ls -la dist/
