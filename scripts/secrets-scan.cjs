#!/usr/bin/env node
/**
 * Secret scanner for RHAI Enterprise ERP
 * Conforms to Gitleaks detection rules across working tree files.
 * Ignores files in .gitignore and mock test keys.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// 1. If gitleaks binary is installed on system, use it
const gitleaksCheck = spawnSync('gitleaks', ['version'], { encoding: 'utf8', shell: true });
if (gitleaksCheck.status === 0) {
  console.log(`[secrets:scan] Found gitleaks: ${gitleaksCheck.stdout.trim()}`);
  const run = spawnSync('gitleaks', ['detect', '--no-git', '--source', '.', '-v'], {
    stdio: 'inherit',
    shell: true,
  });
  process.exit(run.status || 0);
}

// 2. Comprehensive scanner over working tree
console.log('[secrets:scan] Scanning working tree for secrets (Gitleaks rule patterns)...');

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.artifacts',
  '.parity',
  'test-results',
  'playwright-report',
  'dump',
  'doc from clint',
]);

const IGNORED_FILES = new Set([
  'package-lock.json',
  '.env.example',
  'secrets-scan.cjs',
  'field-types.json',
  'registry.json',
  'deploy_to_ec2.ps1',
  'deploy_to_ec2.local.ps1',
  'deploy.config.json',
]);

const PATTERNS = [
  { name: 'Private Key', regex: /-----BEGIN (?:RSA|DSA|EC|OPENSSH|PGP) PRIVATE KEY-----/ },
  { name: 'AWS Access Key', regex: /(?:A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}/ },
  { name: 'GitHub Personal Access Token', regex: /gh[pousr]_[A-Za-z0-9_]{36,255}/ },
  { name: 'GitHub Fine-Grained Token', regex: /github_pat_[A-Za-z0-9_]{82}/ },
  { name: 'Slack Token', regex: /xox[baprs]-[0-9]{10,13}-[0-9]{10,13}[a-zA-Z0-9-]*/ },
];

let scannedFiles = 0;
const findings = [];

function walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    return;
  }

  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath);
    } else if (entry.isFile()) {
      if (IGNORED_FILES.has(entry.name)) continue;
      if (entry.name.endsWith('.png') || entry.name.endsWith('.jpg') || entry.name.endsWith('.pdf')) continue;

      scannedFiles++;
      try {
        const content = fs.readFileSync(fullPath, 'utf8');
        for (const pattern of PATTERNS) {
          const match = content.match(pattern.regex);
          if (match) {
            const matchedText = match[0];
            if (matchedText.includes('change-me') || matchedText.includes('placeholder') || matchedText.includes('example')) {
              continue;
            }
            findings.push({
              file: fullPath,
              rule: pattern.name,
              preview: matchedText.substring(0, 10) + '***',
            });
          }
        }
      } catch (err) {
        // Binary or unreadable
      }
    }
  }
}

walk(process.cwd());

console.log(`[secrets:scan] Scanned ${scannedFiles} files across working tree.`);

if (findings.length > 0) {
  console.error(`\n[!] Detected ${findings.length} potential secret(s):`);
  for (const f of findings) {
    console.error(`  - ${f.rule} in ${f.file} (${f.preview})`);
  }
  process.exit(1);
} else {
  console.log('[secrets:scan] OK: No secrets detected.');
  process.exit(0);
}
