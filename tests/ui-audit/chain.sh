#!/bin/bash
# Unattended chain: full "after" audit for Super User, then 4 more roles at 1440 only. Each step resumes where it stopped.
cd "$(dirname "$0")/../.."
node tests/ui-audit/run.mjs --tag=after
for r in admin mgr-purchase emp-stores sales-talsaw; do
  node tests/ui-audit/run.mjs --role=$r --width=1440
done
echo "CHAIN DONE"
