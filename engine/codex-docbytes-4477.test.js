'use strict';
/**
 * #4477: codex reads a project's AGENTS.md only up to `project_doc_max_bytes` (32 KiB by default)
 * and silently drops the rest. Kosmos appends its own working rules after the person's brief, so
 * the tail codex would drop is Kosmos's. Both codex launch sites raise the limit to twice Kosmos's
 * instruction-file cap, and these tests hold the two sites and that number together.
 *
 *   node --test engine/codex-docbytes-4477.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workerfile = require('./workerfile');
const codex = require('./win32codex');

const SUPERVISOR = path.join(__dirname, '..', 'bin', 'agent-supervisor.sh');
/* Twice the cap: codex spends one budget across every AGENTS.md from the repository root down. */
const WANT = `project_doc_max_bytes=${2 * workerfile.MAX_BYTES}`;

test('#4477: the Windows codex turn raises codex\'s AGENTS.md limit to twice Kosmos\'s instruction cap', () => {
  assert.equal(codex.DOC_BYTES_CFG, WANT);
  for (const opts of [{ message: 'fresh' }, { message: 'again', sessionId: 'thread-1', autonomy: true }]) {
    const args = codex.codexTurnArgs(opts);
    assert.deepEqual(args.slice(0, 3), ['-c', WANT, 'exec'], `the override is not a top-level -c before exec: ${JSON.stringify(args)}`);
  }
});

test('#4477: the Mac supervisor passes the same limit on every codex launch', () => {
  const src = fs.readFileSync(SUPERVISOR, 'utf8');
  const m = /^\s*DOCBYTES_CFG="([^"]*)"\s*$/m.exec(src);
  assert.ok(m, 'bin/agent-supervisor.sh no longer defines DOCBYTES_CFG');
  assert.equal(m[1], WANT, 'the Mac value and twice Kosmos\'s instruction cap disagree');
  /* Every codex launch line carries it. CONTROL: there are codex launch lines to check. */
  const launches = src.split('\n').filter((l) => /"\$CLAUDE" --dangerously-bypass-approvals-and-sandbox/.test(l));
  assert.ok(launches.length >= 2, `expected the codex launch lines (with and without a model), found ${launches.length}`);
  for (const l of launches) assert.match(l, /-c "\$DOCBYTES_CFG"/, `a codex launch does not pass the limit: ${l.trim()}`);
});

/* Arithmetic on constants only: it guards against the cap ever shrinking below codex's default. */
test('#4477: the limit is above codex\'s own default, or the override would lower it', () => {
  assert.ok(2 * workerfile.MAX_BYTES > 32 * 1024, `the limit (${2 * workerfile.MAX_BYTES}) is not above codex's 32 KiB default`);
});
