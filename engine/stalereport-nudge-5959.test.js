'use strict';

/**
 * #5959 slice 3: an agent whose own waiting report has stood on its card over a day is told once, typed into its
 * session, in the words `kosmos report show` uses. Real board cards (test-support/fleet); the report reader, the pause
 * read and the delivery are injected.
 *   node --test engine/stalereport-nudge-5959.test.js
 */

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

// Sandbox first, before any require: status and the stores resolve their roots at require time.
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-stalenudge-5959-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');

const test = require('node:test');
const assert = require('node:assert/strict');
const fleet = require('../test-support/fleet');
const selfreport = require('./selfreport');
const nudge = require('./stalereport-nudge');

test.after(() => { fleet.restore(); fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const DAY = selfreport.STALE_WAIT_MS;
const NOW = Date.parse('2026-10-12T18:00:00Z');
const iso = (ms) => new Date(ms).toISOString();
const DELIVERY = { PLACED: 'placed', UNCONFIRMED: 'unconfirmed', COULD_NOT: 'could_not' };

/* A real board card for one agent, its state set to what the test needs (the fleet's screens give needs_you). */
function cardsFor(specs) {
  const board = fleet.install(specs.map(([name]) => fleet.agent(name, { state: 'needs_you' })));
  try {
    return specs.map(([name, state]) => {
      const c = board.agents.find((x) => x.name === name || (x.sessionName || '').startsWith(name));
      assert.ok(c, 'CONTROL: no card for ' + name);
      return { ...c, state };
    });
  } finally { board.restore(); }
}

function run(cards, reports, opts = {}) {
  const sent = [];
  const out = nudge.sweepOnce({
    roster: cards,
    book: opts.book || new Map(),
    now: opts.now || NOW,
    report: (s) => reports[s] || { found: false },
    paused: () => ({ paused: opts.paused === true }),
    deliver: (s, text) => { sent.push({ s, text }); return opts.deliver ? opts.deliver(s, text) : { state: DELIVERY.PLACED }; },
    DELIVERY,
  });
  return { sent, out };
}

test('#5959 slice 3: a waiting report over a day old on its card is told once, in report show\'s words', () => {
  const [casey, kim, leo, mara] = cardsFor([['casey', 'blocked'], ['kim', 'needs_you'], ['leo', 'blocked'], ['mara', 'needs_you']]);
  const reports = {
    [casey.sessionName]: { found: true, state: 'blocked', at: iso(NOW - 3 * DAY), by: 'agent' },
    [kim.sessionName]: { found: true, state: 'needs_you', at: iso(NOW - DAY - 60e3), by: 'auto' },
    // CONTROLS: under a day; and a report the card does not show (reconcile set it aside).
    [leo.sessionName]: { found: true, state: 'blocked', at: iso(NOW - DAY + 10 * 60e3), by: 'agent' },
    [mara.sessionName]: { found: true, state: 'blocked', at: iso(NOW - 3 * DAY), by: 'agent' },
  };
  const book = new Map();
  const { sent } = run([casey, kim, leo, mara], reports, { book });
  assert.deepEqual(sent.map((x) => x.s), [casey.sessionName, kim.sessionName], 'the wrong agents were told');
  assert.equal(sent[0].text, 'Kosmos here, a one-time reminder: Your own `blocked` report has been standing on your card for 3 days. '
    + 'If it is no longer in your way, clear it with: kosmos report clear. If it still holds, leave it. '
    + 'To see your card as the person sees it, run: kosmos report show');
  assert.match(sent[1].text, /A `needs_you` report Kosmos wrote for you has been standing on your card for over a day\. If what it was about has passed, clear it with: kosmos report clear\./);
  // Once: the next sweep tells nobody.
  const again = run([casey, kim, leo, mara], reports, { book, now: NOW + 60e3 }).sent.map((x) => x.s);
  assert.deepEqual(again, [], 'told twice about one report: ' + JSON.stringify([...book.entries()]));
  // A new report of the same state is a new report: told again only once it, too, is a day old.
  reports[casey.sessionName] = { found: true, state: 'blocked', at: iso(NOW), by: 'agent' };
  assert.equal(run([casey], reports, { book, now: NOW + 60e3 }).sent.length, 0, 'a fresh report was told about');
  assert.equal(run([casey], reports, { book, now: NOW + DAY + 60e3 }).sent.length, 1, 'a fresh report a day later was not');
});

test('#5959 slice 3: no report, a working card, a paused swarm, a stranger: nobody is told', () => {
  const [a, b, c] = cardsFor([['ann', 'blocked'], ['bea', 'working'], ['cal', 'blocked']]);
  const old = (s) => ({ found: true, state: 'blocked', at: iso(NOW - 2 * DAY), by: 'agent', s });
  assert.equal(run([a], {}).sent.length, 0, 'told with no report');
  assert.equal(run([b], { [b.sessionName]: old() }).sent.length, 0, 'told on a working card');
  assert.equal(run([c], { [c.sessionName]: old() }, { paused: true }).sent.length, 0, 'told while its swarm is switched off');
  assert.equal(run([{ ...c, isNamedOurs: false }], { [c.sessionName]: old() }).sent.length, 0, 'told a pane that is not ours');
  assert.equal(run([c], { [c.sessionName]: old() }).sent.length, 1, 'CONTROL: the same card, unpaused and ours, is told');
});

test('#5959 slice 3: a delivery that reached nothing is retried, up to MAX_TRIES; a held one spends no try', () => {
  const [d] = cardsFor([['dee', 'blocked']]);
  const reports = { [d.sessionName]: { found: true, state: 'blocked', at: iso(NOW - 2 * DAY), by: 'agent' } };
  const book = new Map();
  const held = run([d], reports, { book, deliver: () => ({ state: 'held', held: true }) });
  assert.equal(held.out.results[0].act, 'held');
  assert.equal(book.has(d.sessionName), false, 'a held delivery spent a try');
  for (let i = 0; i < nudge.MAX_TRIES; i += 1) {
    assert.equal(run([d], reports, { book, deliver: () => ({ state: DELIVERY.COULD_NOT }) }).sent.length, 1, 'try ' + (i + 1));
  }
  assert.equal(run([d], reports, { book }).sent.length, 0, 'tried again after MAX_TRIES that reached nothing');
});

test('#5959 slice 3: the sweep runs only with live execution allowed and the brake off', () => {
  assert.equal(nudge.nudgeEnabled(true, {}), true);
  assert.equal(nudge.nudgeEnabled(false, {}), false);
  assert.equal(nudge.nudgeEnabled(true, { AGENT_WORKFORCE_STALEREPORT_NUDGE_OFF: '1' }), false);
  const tick = nudge.makeTick({ allowed: () => false, roster: () => { throw new Error('read while off'); } });
  assert.equal(tick(), null);
});

test('#5959 slice 3: the server runs the sweep on its own timer, typing through deliverAutomatic', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const at = src.indexOf("require('./engine/stalereport-nudge').makeTick({");
  assert.ok(at > 0, 'the server does not make the stale-report tick');
  const block = src.slice(at, at + 900);
  assert.match(block, /allowed: \(\) => liveExecution\.liveExecutionAllowed\(\),/, 'not gated on live execution');
  assert.match(block, /deliver: \(session, text, r\) => chat\.deliverAutomatic\(/, 'not typed through deliverAutomatic');
  assert.match(block, /setInterval\(stalereportTick, /, 'no timer runs the tick');
});
