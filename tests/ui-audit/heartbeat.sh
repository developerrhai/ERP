#!/bin/bash
# Every 10 minutes: append a status line to docs/ui-audit/PHASE-36-CHECKPOINT.md and restart the audit chain
# if it died (the chain is resumable, so it continues where it stopped). Stops when "CHAIN2 DONE" is in the log.
cd "$(dirname "$0")/../.."
LOG="/c/Users/admin/AppData/Local/Temp/audit-chain2.log"
CK="docs/ui-audit/PHASE-36-CHECKPOINT.md"
while true; do
  sleep 600
  n_after=$(wc -l < docs/ui-audit/data/super-after/pages.jsonl 2>/dev/null || echo 0)
  roles=""
  for r in admin; do
    c=$(wc -l < docs/ui-audit/data/$r/pages.jsonl 2>/dev/null || echo 0)
    roles="$roles $r=$c"
  done
  free=$(powershell -c "'{0:N2}' -f ((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory/1MB)" 2>/dev/null | tr -d '\r')
  state="running"
  if grep -q "CHAIN2 DONE" "$LOG" 2>/dev/null; then
    state="CHAIN2 DONE"
  elif ! powershell -c "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | ? { \$_.CommandLine -like '*ui-audit*run.mjs*' } | measure | % Count" 2>/dev/null | grep -q "[1-9]"; then
    state="chain was dead - restarted"
    powershell -c "Get-Process chrome-headless-shell -ErrorAction SilentlyContinue | Stop-Process -Force" >/dev/null 2>&1
    (bash tests/ui-audit/chain2.sh >> "$LOG" 2>&1 &)
  fi
  echo "- $(date '+%Y-%m-%d %H:%M') heartbeat: super-after=$n_after/327;$roles (of 327 each); free RAM ${free} GB; chain $state" >> "$CK"
  [ "$state" = "CHAIN2 DONE" ] && break
done
