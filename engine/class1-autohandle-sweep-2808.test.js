'use strict';

/*
 * #2808 class-1 (c) ARMED sweep, against REAL reconciled cards.
 *
 * sweepOnce consumes board cards (safeRoster()), so it must be tested against cards the
 * real snapshot() pipeline produces - not hand-built literals (fixture-discipline forbids a
 * hand-built card key, because a hand-built card is free to carry fields the producer
 * never emits). test-support/fleet installs real panes + self-reports; status.snapshot()
 * reconciles them into the cards the board shows, and those drive the sweep here. The
 * executor is still injected (a fake recording its calls), so NO real restart happens.
 *
 *   node --test class1-autohandle-sweep-2808.test.js
 */

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

// Sandbox EVERY root the pipeline touches BEFORE requiring status/fleet/selfreport (they
// resolve their roots at require time). selfreport writes under DATA; createAgent answers
// the trust question into CLAUDE_CONFIG - both must be the sandbox, never the operator's.
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'c1-sweep-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');

const test = require('node:test');
const assert = require('node:assert/strict');

const fleet = require('../test-support/fleet');
const status = require('./status');
const selfreport = require('./selfreport');
const class1 = require('./class1-autohandle');

test.after(() => { try { fleet.restore(); } catch { /* best effort */ } fs.rmSync(SANDBOX, { recursive: true, force: true }); });

/* Claude Code's trust dialog, the same capture the engine tests pin (2.1.258+). A pane
   showing this scrapes to needs_you WITH the trust row as stateEvidence and, because
   reconcileReport leads with the live dialog, stateReportedBy null - the exact shape the
   by:'auto'-only trigger would miss and the scrape trigger must catch. */
const TRUST_DIALOG_SCREEN = [
  'Worked for 2m',
  ' Accessing workspace:',
  ' /Users/somebody/work/workers/zeta',
  ' Quick safety check: Is this a project you created or one you trust? (Like your own code, a well-known open source',
  ' project, or work from your team). If not, take a moment to review what\'s in this folder first.',
  ' Claude Code\'ll be able to read, edit, and execute files here.',
  ' ❯ No, exit',
  '   Yes, I trust this folder',
  '',
].join('\n');

// A fake executor that records every call, so a test asserts WHICH sessions were acted on
// and that the key passed is the SESSION name (not the display name).
function fakeDeps() {
  const calls = [];
  return {
    calls,
    trustAgentFolder: (n) => { calls.push(['trust', n]); return { wrote: true }; },
    restart: (n, cause) => { calls.push(['restart', n, cause]); return { outcome: 'restarted' }; },
    RESTARTED: 'restarted',
    isTrustDialogEvidence: status.isTrustDialogEvidence,
  };
}

// Install a set of agents, write their self-reports, return the reconciled cards + a
// session-name lookup by the fleet name. Caller restores.
function installBoard(specs) {
  const board = fleet.install(specs.map((s) => fleet.agent(s.name, { state: s.paneState || 'idle', screen: s.screen, displayName: s.displayName })));
  // Map fleet name -> the sessionName the reconciled card actually carries (the selfreport key).
  const keyOf = {};
  for (const s of specs) {
    const card = board.agents.find((c) => c.name === s.name || c.sessionName === s.name || (c.sessionName || '').startsWith(s.name));
    keyOf[s.name] = card ? card.sessionName : s.name;
    if (s.report) selfreport.record(keyOf[s.name], s.report);
  }
  // Re-snapshot so the self-reports are reconciled into the cards.
  const agents = status.snapshot().agents;
  return { agents, keyOf, restore: board.restore };
}

test('sweepOnce acts on by:auto AND a trust-dialog scrape; never on by:agent / non-trust scrape / working', () => {
  const b = installBoard([
    { name: 'autoperm', report: { state: 'needs_you', because: 'asking permission to use Bash', auto: true } }, // by:auto -> handle
    { name: 'trustdlg', paneState: 'needs_you', screen: TRUST_DIALOG_SCREEN },                                   // trust scrape -> handle
    { name: 'question', report: { state: 'needs_you', because: 'Which venue?' } },                               // by:agent -> none
    { name: 'scrapeq', paneState: 'needs_you' },                                                                 // scraped non-trust needs_you -> none
    { name: 'busy', paneState: 'working', report: { state: 'working', because: 'building', auto: true } },        // working -> none
  ]);
  try {
    const d = fakeDeps();
    const { results } = class1.sweepOnce({ roster: b.agents, attempts: new Map(), now: 1e6, ...d });
    const act = {};
    for (const r of results) act[r.session] = r.act;
    assert.equal(act[b.keyOf.autoperm], 'trust-and-restart', 'a by:auto needs_you is handled');
    assert.equal(act[b.keyOf.trustdlg], 'trust-and-restart', 'a live trust-dialog scrape is handled (no by:auto self-report exists for it)');
    assert.equal(act[b.keyOf.question], 'none', 'a by:agent question is NEVER auto-handled');
    assert.equal(act[b.keyOf.scrapeq], 'none', 'a scraped non-trust needs_you stays red');
    assert.equal(act[b.keyOf.busy], 'none', 'a working agent is not touched');
    // The executor was called ONLY for the two class-1 agents, keyed on their sessionName.
    const restarted = d.calls.filter((c) => c[0] === 'restart').map((c) => c[1]).sort();
    assert.deepEqual(restarted, [b.keyOf.autoperm, b.keyOf.trustdlg].sort());
  } finally { b.restore(); }
});

test('BLOCKER regression: the executor is keyed on the card sessionName, not the display name', () => {
  const b = installBoard([
    // A NAMED agent: display name 'Splinterish' differs from the session key 'blkperm',
    // exactly like the real fleet (session claudebot -> display Splinter).
    { name: 'blkperm', displayName: 'Splinterish', report: { state: 'needs_you', because: 'asking permission', auto: true } },
  ]);
  try {
    const card = b.agents.find((c) => c.sessionName === b.keyOf.blkperm);
    assert.ok(card, 'the agent is on the board');
    // The card's display name and its session key are not the same string; the executor must
    // use the session key (what create.trustAgentFolder / remove.restart resolve by).
    assert.notEqual(card.name, card.sessionName, 'fixture: display name differs from session key');
    const d = fakeDeps();
    class1.sweepOnce({ roster: b.agents, attempts: new Map(), now: 1e6, ...d });
    assert.deepEqual(d.calls, [['trust', card.sessionName], ['restart', card.sessionName, 'restart']],
      'the executor must be called with the SESSION key, not the display name');
  } finally { b.restore(); }
});

test('the loop-guard escalates across ticks (real card, carried attempts Map)', () => {
  const b = installBoard([
    { name: 'stuck', paneState: 'needs_you', screen: TRUST_DIALOG_SCREEN }, // stays a live trust dialog every tick
  ]);
  try {
    const key = b.keyOf.stuck;
    const d = fakeDeps();
    const book = new Map();
    const r1 = class1.sweepOnce({ roster: b.agents, attempts: book, now: 1_000, ...d });
    const r2 = class1.sweepOnce({ roster: b.agents, attempts: book, now: 2_000, ...d });
    const r3 = class1.sweepOnce({ roster: b.agents, attempts: book, now: 3_000, ...d });
    const actOf = (r) => r.results.find((x) => x.session === key).act;
    assert.equal(actOf(r1), 'trust-and-restart');
    assert.equal(actOf(r2), 'trust-and-restart');
    assert.equal(actOf(r3), 'escalate', 'a still-standing dialog escalates after maxAttempts, it does not restart forever');
    assert.equal(d.calls.filter((c) => c[0] === 'restart').length, 2, 'exactly two restarts, then escalate');
  } finally { b.restore(); }
});

test('best-effort: a throwing restart still records the attempt and does not abort the sweep', () => {
  const b = installBoard([
    { name: 'boom', paneState: 'needs_you', screen: TRUST_DIALOG_SCREEN },
    { name: 'beok', report: { state: 'needs_you', because: 'asking permission', auto: true } },
  ]);
  try {
    const boomKey = b.keyOf.boom;
    const okKey = b.keyOf.beok;
    const book = new Map();
    const { results } = class1.sweepOnce({
      roster: b.agents, attempts: book, now: 1e6,
      trustAgentFolder: () => ({ wrote: true }),
      restart: (n) => { if (n === boomKey) throw new Error('kaboom'); return { outcome: 'restarted' }; },
      RESTARTED: 'restarted',
      isTrustDialogEvidence: status.isTrustDialogEvidence,
    });
    const boom = results.find((r) => r.session === boomKey);
    const ok = results.find((r) => r.session === okKey);
    assert.equal(boom.handled, false, 'the throwing restart is caught, not handled');
    assert.equal(ok.handled, true, 'the sweep continued to the next agent');
    assert.equal((book.get(boomKey) || []).length, 1, 'the attempt was recorded despite the throw');
  } finally { b.restore(); }
});
