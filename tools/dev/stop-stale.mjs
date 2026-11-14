// Lists (and with --kill stops) node processes of THIS repo that hold the dev / e2e ports.
// Never touches other programs: a listener is stopped only if its command line mentions this repo folder.
// Usage: node tools/dev/stop-stale.mjs [--kill]
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..').toLowerCase();
const PORTS = [4100, 5173, 5180];
const kill = process.argv.includes('--kill');
const ps = (cmd) => {
  try {
    return execFileSync('powershell', ['-NoProfile', '-Command', cmd], { encoding: 'utf8' }).trim();
  } catch {
    return ''; // the process or port vanished while we looked
  }
};

let found = 0;
for (const port of PORTS) {
  const pids = ps(
    `Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique`,
  )
    .split(/\s+/)
    .filter(Boolean);
  for (const pid of pids) {
    const line = ps(`(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`).toLowerCase();
    const name = ps(`(Get-Process -Id ${pid}).ProcessName`);
    const mine = name.toLowerCase().startsWith('node') && line.split('/').join(path.sep).includes(repo);
    console.log(`port ${port}  pid ${pid}  ${name}  ${mine ? 'THIS REPO' : 'not this repo (left alone)'}`);
    if (mine) {
      found += 1;
      if (kill) {
        ps(`Stop-Process -Id ${pid} -Force`);
        console.log(`  stopped ${pid}`);
      }
    }
  }
}
if (!found) console.log('No leftover node processes of this repo on ports ' + PORTS.join(', ') + '.');
else if (!kill) console.log('Run again with --kill to stop them.');
