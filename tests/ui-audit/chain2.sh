#!/bin/bash
# Final refresh of the "after" audit for the Super User (resumable: skips pages already in data/super-after).
cd "$(dirname "$0")/../.."
node tests/ui-audit/run.mjs --tag=after
echo "CHAIN2 DONE"
