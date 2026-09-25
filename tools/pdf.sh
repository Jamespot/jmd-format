#!/usr/bin/env bash
# Prints a .james-jmd.html to PDF with headless Chrome — same pipeline as the reference deck (960×540 pt). The jmd CLI does the same in-process: bin/jmd.mjs pdf.
# usage: tools/pdf.sh build/slug.james-jmd.html [out.pdf]
set -euo pipefail
IN="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
OUT="${2:-${IN%.james-jmd.html}.pdf}"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
"$CHROME" --headless=new --disable-gpu --no-pdf-header-footer \
  --run-all-compositor-stages-before-draw --virtual-time-budget=4000 \
  --print-to-pdf="$OUT" "file://$IN" 2>/dev/null
echo "$OUT"
pdfinfo "$OUT" | grep -E "Pages|Page size"
