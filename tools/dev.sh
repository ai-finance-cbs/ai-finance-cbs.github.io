#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
./tools/build.sh
printf '%s\n' 'Local preview: http://127.0.0.1:4173/?fakeauth=student'
exec python3 -m http.server 4173 --bind 127.0.0.1 --directory _site
