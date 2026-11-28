'use strict';
/**
 * kosmos#8378 MEASUREMENT ONLY (branch wincand-8378-never-merge, no PR, never merged): run the candidate test files listed in
 * tools/wincand-8378-list.txt on a Windows runner, one at a time, the way tools/windows-tests.js runs a file (its
 * childEnv, per-test timeout and failure reader), and print one WINCAND line per file. Shard with SHARD=k and
 * SHARDS=n (file i goes to shard i % n). Never fails the job: the lines are the result.
 */
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const wt = require('./windows-tests.js');

const root = path.join(__dirname, '..');
const all = fs.readFileSync(path.join(__dirname, 'wincand-8378-list.txt'), 'utf8').split('\n').map((s) => s.trim()).filter(Boolean);
const shards = Number(process.env.SHARDS || 1);
const shard = Number(process.env.SHARD || 0);
const mine = all.filter((_, i) => i % shards === shard);
const env = wt.childEnv(process.env);
const PER_FILE_MS = 240000;
console.log(`WINCAND-START shard ${shard} of ${shards}: ${mine.length} files`);
for (const file of mine) {
  const t0 = Date.now();
  const run = cp.spawnSync(process.execPath, ['--test', '--test-timeout=60000', file], {
    cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], timeout: PER_FILE_MS, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  const out = `${run.stdout || ''}\n${run.stderr || ''}`;
  const num = (k) => { const m = out.match(new RegExp(`^ℹ ${k} (\\d+)`, 'm')); return m ? Number(m[1]) : -1; };
  const failing = wt.failingTests(out, file);
  const killed = run.status === null;
  const detail = failing.length ? [].concat(wt.failureDetail(out, [])).join(' ').replace(/\s+/g, ' ').slice(0, 300) : '';
  console.log(`WINCAND ${file} exit=${killed ? 'KILLED' : run.status} pass=${num('pass')} fail=${num('fail')} skip=${num('skipped')} secs=${Math.round((Date.now() - t0) / 1000)}`
    + (failing.length ? ` failing=${JSON.stringify(failing.slice(0, 5))} first=${JSON.stringify(detail)}` : ''));
}
console.log(`WINCAND-END shard ${shard}`);
