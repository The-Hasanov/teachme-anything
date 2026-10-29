#!/usr/bin/env sh
# Everything to run before a release, in one go. Stops at the first failure.
#   sh scripts/check.sh          plugin, engine, pane, FSRS and the VS Code extension
#   sh scripts/check.sh --quick  plugin, engine and pane only
set -e
cd "$(dirname "$0")/.."

echo '== plugin validate'; claude plugin validate .
echo '== plugin test';     claude plugin test .
[ "$1" = "--quick" ] && { echo 'All quick checks passed.'; exit 0; }
echo '== FSRS reference';  node extension/test/fsrs-ref.cjs
echo '== extension';       (cd extension && npm install --silent && npm test)
echo 'All checks passed.'
