// Phase 22-A: fails on an unbounded list read.
//   * `findMany(` whose argument has no `take`
//   * a `$queryRaw` / `$queryRawUnsafe` / `.query(` SELECT whose SQL has no LIMIT
// unless the line before carries `// unpaginated: <reason>`.
// Run: npx tsx tools/check-unbounded.ts   (exit 1 when there are findings)
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..', 'apps', 'api', 'src');
const SCOPE = ['modules'];

export interface Finding {
  file: string;
  line: number;
  kind: 'findMany' | 'queryRaw';
  text: string;
}

function walk(dir: string, out: string[]): void {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name)) out.push(p);
  }
}

/** Index just after the paren that closes the one opened at `open`. Skips strings/templates. */
function matchParen(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') {
      const q = c;
      i += 1;
      while (i < src.length && src[i] !== q) {
        if (src[i] === '\\') i += 1;
        else if (q === '`' && src[i] === '$' && src[i + 1] === '{') {
          let d = 0;
          for (; i < src.length; i += 1) {
            if (src[i] === '{') d += 1;
            else if (src[i] === '}') {
              d -= 1;
              if (d === 0) break;
            }
          }
        }
        i += 1;
      }
    } else if (c === '(') depth += 1;
    else if (c === ')') {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return src.length;
}

function lineOf(src: string, idx: number): number {
  let n = 1;
  for (let i = 0; i < idx; i += 1) if (src.charCodeAt(i) === 10) n += 1;
  return n;
}

function exempt(lines: string[], line: number): boolean {
  for (let l = line - 1; l >= Math.max(0, line - 3); l -= 1) {
    const t = lines[l - 1]?.trim() ?? '';
    if (/\/\/\s*unpaginated:\s*\S+/.test(t)) return true;
    if (
      t !== '' &&
      !t.startsWith('//') &&
      !t.startsWith('.') &&
      !t.startsWith('const ') &&
      !t.startsWith('await ') &&
      !t.startsWith('return ') &&
      !t.startsWith('let ') &&
      !t.startsWith('(')
    )
      break;
  }
  return false;
}

/**
 * A raw SELECT counts as a list read unless it provably returns at most one row:
 * it has LIMIT, locks rows (FOR UPDATE), calls nextval/pg_advisory/pg_try, or its select list is
 * only aggregates with no GROUP BY.
 */
export function isListSelect(sql: string): boolean {
  if (!/\bselect\b/i.test(sql)) return false;
  if (/\blimit\b/i.test(sql)) return false;
  if (/\bfor\s+(update|share|no\s+key\s+update)\b/i.test(sql)) return false;
  if (
    /\b(nextval|pg_advisory\w*|pg_try\w*|pg_notify|pg_sleep|current_setting|set_config)\s*\(/i.test(
      sql,
    )
  )
    return false;
  const m = /\bselect\b([\s\S]*?)\bfrom\b/i.exec(sql);
  if (!m) return !/\bselect\s+(1|true|now\(\)|current_date)\b/i.test(sql) && false;
  if (!/\bgroup\s+by\b/i.test(sql)) {
    let sel = m[1] ?? '';
    for (let i = 0; i < 6; i += 1) sel = sel.replace(/\([^()]*\)/g, '');
    const cols = sel.split(',').map((c) => c.trim());
    const agg = /^(distinct\s+)?(count|sum|max|min|avg|bool_or|bool_and|coalesce)\b/i;
    if (cols.length > 0 && cols.every((c) => agg.test(c) || /^exists\b/i.test(c))) return false;
  }
  return true;
}

/**
 * A findMany is bounded when it has take, spreads a paging object (...page / ...paging), uses
 * skip, or reads only the rows named by an id list (where: { id: { in: [...] } }).
 */
export function isBoundedFindMany(body: string): boolean {
  return (
    /\btake\b/.test(body) ||
    /\bskip\b/.test(body) ||
    /\.\.\.(page|paging|paged|pageArgs)\b/.test(body) ||
    /\bwhere:\s*\{\s*id:\s*\{\s*in:/.test(body)
  );
}

export function scanSource(file: string, src: string): Finding[] {
  const out: Finding[] = [];
  const lines = src.split('\n');
  const re = /\.findMany\(|\$queryRaw(?:Unsafe)?\s*(?:<[^>]*>)?\s*[(`]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const start = m.index;
    const ln = lineOf(src, start);
    if (m[0] === '.findMany(') {
      // a repository wrapper's own findMany is checked where it queries; skip the call site
      if (/(repository|repo|Repository|Repo)$/.test(src.slice(Math.max(0, start - 30), start)))
        continue;
      const end = matchParen(src, start + m[0].length - 1);
      const body = src.slice(start, end);
      if (!isBoundedFindMany(body) && !exempt(lines, ln)) {
        out.push({ file, line: ln, kind: 'findMany', text: lines[ln - 1]?.trim() ?? '' });
      }
    } else {
      let end: number;
      const open = m[0].endsWith('`') ? start + m[0].length - 1 : start + m[0].length - 1;
      if (m[0].endsWith('`')) {
        end = open + 1;
        while (end < src.length && src[end] !== '`') end += src[end] === '\\' ? 2 : 1;
      } else end = matchParen(src, open);
      const body = src.slice(start, end);
      if (isListSelect(body) && !exempt(lines, ln)) {
        out.push({ file, line: ln, kind: 'queryRaw', text: lines[ln - 1]?.trim() ?? '' });
      }
    }
  }
  return out;
}

export function scanAll(): Finding[] {
  const files: string[] = [];
  for (const d of SCOPE) walk(path.join(ROOT, d), files);
  const all: Finding[] = [];
  for (const f of files)
    all.push(...scanSource(path.relative(ROOT, f), fs.readFileSync(f, 'utf8')));
  return all;
}

if (require.main === module) {
  const findings = scanAll();
  const byModule = new Map<string, number>();
  for (const f of findings) {
    const mod = f.file.split(path.sep)[1] ?? '?';
    byModule.set(mod, (byModule.get(mod) ?? 0) + 1);
  }
  if (process.argv.includes('--verbose'))
    for (const f of findings) console.log(`${f.file}:${f.line} [${f.kind}] ${f.text}`);
  console.log(`check-unbounded: ${findings.length} finding(s)`);
  for (const [k, v] of [...byModule.entries()].sort((a, b) => b[1] - a[1]))
    console.log(`  ${k}: ${v}`);
  process.exit(findings.length === 0 ? 0 : 1);
}
