#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
course_gems="$HOME/.local/share/jekyll-gems"
export GEM_HOME="$course_gems"
export GEM_PATH="$course_gems"
export PATH="$course_gems/bin:$PATH"
exec jekyll build --destination _site "$@"
