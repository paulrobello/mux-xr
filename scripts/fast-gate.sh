#!/bin/bash
# Pre-commit entry for the fast project gate. Documentation-only commits skip
# the gate: nothing in .md/.txt/docs/ can affect build, lint, or tests.
non_docs=$(git diff --cached --name-only --diff-filter=ACMR | grep -Ev '\.(md|txt)$|^docs/' || true)
if [ -z "$non_docs" ]; then
  exit 0
fi
exec make checkall
