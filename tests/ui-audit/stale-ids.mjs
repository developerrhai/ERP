// Prints (comma separated) the ids in data/super-after/pages.jsonl audited before the given UTC time (argv[2]),
// for: node tests/ui-audit/run.mjs --tag=after --force --page=$(node tests/ui-audit/stale-ids.mjs 2026-11-14T00:00:00Z)
import { readFileSync } from 'node:fs';
const cut = Date.parse(process.argv[2] ?? '');
const rows = readFileSync(new URL('../../docs/ui-audit/data/super-after/pages.jsonl', import.meta.url), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
process.stdout.write(rows.filter((r) => Date.parse(r.at) < cut).map((r) => r.id).join(','));
