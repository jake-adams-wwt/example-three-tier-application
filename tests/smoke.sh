#!/usr/bin/env bash
# T64 CI fixture: fails if README.md is missing or contains the marker BREAK_CI.
set -e
test -f README.md
if grep -q "BREAK_CI" README.md; then echo "smoke: README contains BREAK_CI"; exit 1; fi
echo "smoke: ok"
