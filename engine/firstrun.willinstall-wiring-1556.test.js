'use strict';

/**
 * #1556: THE PRODUCER AND THE READER MUST AGREE ON THE PATH.
 *
 * 🛑 WHY THIS FILE EXISTS, AND IT IS A CORRECTION TO MY OWN SHIPPED WORK.
 * I first served `willInstall` on `/api/connect`, verified it answered correctly
 * on three separate boards, and shipped a screen that did not change by one
 * character. `frClaudeInstallNeeded()` reads `FR.connect.willInstall`, and `FR` is
 * assigned WHOLESALE from `/api/first-run` at both of its two assignment sites, so
 * it never carried the route's reply at all. Every check I ran was aimed at the
 * half that already worked.
 *
 * ⚠️ THE EXISTING GUARD COULD NOT HAVE CAUGHT IT EITHER, WHICH IS THE REAL GAP.
 * `web.connect-confirm.test.js` slices the reader's SOURCE and matches /willInstall/
 * on the text. That passes whether or not anything on earth produces the field. It
 * asserts the reader asks the question; nothing asserted the question gets answered.
 *
 * ⭐ SO THIS TEST DERIVES THE PATH FROM THE READER AND ASSERTS IT AGAINST THE
 * PRODUCER. Rename either side and it goes red, which is the property that was
 * missing. It is deliberately not a second copy of the string "connect.willInstall":
 * a constant I typed here would agree with a producer I typed there and prove
 * nothing about the page.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const { mkTemp } = require('../test-support/tmpdir.js');
const SANDBOX = mkTemp('fr-wiring-1556-');
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = nodePath.join(SANDBOX, 'claude.json');

/* 🛑 PIN THE LAUNCHER BEFORE REQUIRING, OR THIS TEST READS THE OPERATOR'S MACHINE.
   `willInstall()` gates on `fs.accessSync(claudeBinPath(), X_OK)` BEFORE it reaches
   any injected runner, and `claudeBinPath()` resolves the real `~/.local/bin/claude`.
   So on a box with no runnable launcher this file fails at the first assertion, and
   on this box it passed for a reason that has nothing to do with the code under test.

   ⚠️ THIS IS THE HAZARD I DOCUMENTED IN `firstrun.test.js` ONE FILE OVER AND THEN
   REPRODUCED HERE. Writing the warning did not make me apply it. */
const STUB_BIN = nodePath.join(SANDBOX, 'claude-stub');
fs.writeFileSync(STUB_BIN, '#!/bin/sh\nexit 0\n');
fs.chmodSync(STUB_BIN, 0o755);
process.env.AGENT_WORKFORCE_CLAUDE_BIN = STUB_BIN;

const firstrun = require('./firstrun');
const subscription = require('./subscription');
const status = require('./status');
const connect = require('./connect');

const PAGE = fs.readFileSync(nodePath.join(__dirname, '..', 'web', 'index.html'), 'utf8');

/** The reader's own source is the authority on where it looks. */
function readerPath() {
  const start = PAGE.indexOf('function frClaudeInstallNeeded()');
  assert.ok(start > 0, 'frClaudeInstallNeeded is gone; this test needs rewriting, not deleting');
  const fn = PAGE.slice(start, PAGE.indexOf('\n}', start));
  const container = fn.match(/FR\s*&&\s*FR\.([a-zA-Z_$][\w$]*)/);
  const field = fn.match(/st\.([a-zA-Z_$][\w$]*)\s*===\s*'boolean'|typeof\s+st\.([a-zA-Z_$][\w$]*)/);
  assert.ok(container, 'could not read which FR key the reader uses');
  assert.ok(field, 'could not read which field the reader tests');
  return { key: container[1], field: field[1] || field[2] };
}

test.beforeEach(() => {
  subscription.setRunner(async () => ({ stdout: JSON.stringify({ loggedIn: true }), err: null }));
  /* ⚠️ TMUX PINNED FOR THE SAME REASON AS THE LAUNCHER, one dependency over, and I
     missed it the first time. `firstrun.state()` calls `fleet()` -> `paneRoster()`
     -> `listPanes()`, so with no pane source this file SHELLS OUT TO THE REAL TMUX
     and reads the operator's live fleet. The assertions do not depend on it, because
     `fleet()` catches, so it is not flaky today. It is still the hazard `server.test.js`
     records as #332, and this file spends a paragraph on exactly this class about the
     BINARY while leaving the fleet unpinned. The sibling `firstrun.test.js` sets a
     pane source in every single test. */
  status.setPaneSource(() => '');
  connect.resetForTests();
});
test.afterEach(() => {
  subscription.setRunner(null);
  status.setPaneSource(null);
  connect.setRunner(null);
  connect.resetForTests();
});

test('#1556 the first-run payload answers on the exact path the page reads', async () => {
  const { key, field } = readerPath();
  connect.setRunner(async () => ({ ok: true, stdout: '' }));   // a launcher that runs
  const state = await firstrun.state();
  assert.ok(state[key] && typeof state[key] === 'object',
    `the page reads FR.${key}, and the payload has no such object`);
  assert.equal(typeof state[key][field], 'boolean',
    `the page tests typeof FR.${key}.${field} === 'boolean' and would fail open without it`);
});

test('#1556 the VALUE carries, both ways, not just the shape', async () => {
  const { key, field } = readerPath();

  connect.setRunner(async () => ({ ok: true, stdout: '' }));
  connect.resetForTests();
  const installed = await firstrun.state();
  assert.equal(installed[key][field], false, 'a working launcher must not ask for an install');

  /* The harmful direction. A launcher that exists but does not run: X_OK passes,
     so only the probe separates them, and a wrong answer here is the unannounced
     281MB download. */
  connect.setRunner(async () => ({ ok: false, stdout: '' }));
  connect.resetForTests();
  const broken = await firstrun.state();
  assert.equal(broken[key][field], true, 'a launcher that does not run still needs an install');
});

test('#1556 control: this test can tell a right path from a wrong one', async () => {
  const { key, field } = readerPath();
  connect.setRunner(async () => ({ ok: true, stdout: '' }));
  const state = await firstrun.state();
  /* If the assertions above passed for any object at all, they would be worthless.
     A neighbouring key that the page does NOT read must not satisfy them. */
  assert.notEqual(key, 'subscription', 'the reader key resolved to the wrong thing');
  assert.equal(typeof (state.subscription || {})[field], 'undefined',
    'the field appears on an unrelated key too, so the shape assertion proves nothing');
});

test('#1556 the two probes OVERLAP: the launcher probe starts before checkLive resolves', async () => {
  /* ⚠️ THE COMMENT IN firstrun.js CLAIMS THIS AND NOTHING PINNED IT. Moving
     `const willInstallSoon = ...` below `await subscription.checkLive()` left every
     test green, so the overlap was an assertion about the code rather than a property
     of it. That is the unchecked-claim class this branch has been correcting all
     night, and it was sitting in my own fix for the cost finding.

     Perturbation: move that line below the await and this arm goes red. */
  let checkLiveResolved = false;
  let probeStartedBeforeCheckLive = null;

  subscription.setRunner(async () => {
    await new Promise((r) => setTimeout(r, 60));
    checkLiveResolved = true;
    return { stdout: JSON.stringify({ loggedIn: true }), err: null };
  });
  connect.setRunner(async () => {
    if (probeStartedBeforeCheckLive === null) probeStartedBeforeCheckLive = !checkLiveResolved;
    return { ok: true, stdout: '' };
  });
  connect.resetForTests();

  await firstrun.state();
  assert.equal(probeStartedBeforeCheckLive, true,
    'the launcher probe waited for checkLive, so the two shell-outs are serial, not overlapped');
});
