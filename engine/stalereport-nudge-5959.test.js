'use strict';
require('../test-support/tmpscope');   // first: every temp dir this file makes is swept at exit (#4273)

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
      return { ...c, state, stateReported: true };   // the card shows the agent's report, as reconcile marks it; runner as the board says
    });
  } finally { board.restore(); }
}

/* An in-memory stand-in for the on-disk reminded record, so tests do not share it; the file itself has its own test. */
function memReminded() { const m = new Map(); return { get: (k) => (m.has(k) ? m.get(k) : null), set: (k, v) => { m.set(k, v); return true; }, m }; }

function run(cards, reports, opts = {}) {
  const sent = [];
  const out = nudge.sweepOnce({
    roster: cards,
    book: opts.book || new Map(),
    reminded: opts.reminded || memReminded(),
    screen: opts.screen || (() => null),   // a clear prompt unless a test says otherwise; the real reader has its own test
    now: opts.now || NOW,
    report: (s) => reports[s] || { found: false },
    paused: () => ({ paused: opts.paused === true }),
    deliver: (s, text) => { sent.push({ s, text }); return opts.deliver ? opts.deliver(s, text) : { state: DELIVERY.PLACED }; },
    DELIVERY,
    log: opts.log,
  });
  return { sent, out };
}

test('#5959 slice 3: an agent\'s own blocked report over a day old on its card is told once, in report show\'s words', () => {
  const [casey, leo, mara, nia] = cardsFor([['casey', 'blocked'], ['leo', 'blocked'], ['mara', 'needs_you'], ['nia', 'blocked']]);
  const reports = {
    [casey.sessionName]: { found: true, state: 'blocked', at: iso(NOW - 3 * DAY), by: 'agent' },
    // CONTROLS: under a day; a report the card does not show (another state); the way reconcile really sets a report
    // aside (the same state on the card, read from the screen: stateReported false).
    [leo.sessionName]: { found: true, state: 'blocked', at: iso(NOW - DAY + 10 * 60e3), by: 'agent' },
    [mara.sessionName]: { found: true, state: 'blocked', at: iso(NOW - 3 * DAY), by: 'agent' },
    [nia.sessionName]: { found: true, state: 'blocked', at: iso(NOW - 3 * DAY), by: 'agent' },
  };
  const niaScreen = { ...nia, stateReported: false };
  const book = new Map();
  const reminded = memReminded();
  const { sent } = run([casey, leo, mara, niaScreen], reports, { book, reminded });
  assert.deepEqual(sent.map((x) => x.s), [casey.sessionName], 'the wrong agents were told');
  assert.equal(sent[0].text, 'Kosmos here, a reminder: Your own `blocked` report has been standing for 3 days. '
    + 'If it is no longer in your way, clear it with: kosmos report clear. If it still holds, leave it. '
    + 'To see your card as the person sees it, run: kosmos report show');
  assert.equal(reminded.get(casey.sessionName), reports[casey.sessionName].at, 'the reminder was not recorded');
  // Once: the next sweep tells nobody, even with a fresh in-memory book (a board restart), from the record alone.
  assert.deepEqual(run([casey, leo, mara, niaScreen], reports, { reminded, now: NOW + 60e3 }).sent, [], 'told again after a restart');
  // A new report is a new report: told again only once it, too, is over a day old.
  reports[casey.sessionName] = { found: true, state: 'blocked', at: iso(NOW), by: 'agent' };
  assert.equal(run([casey], reports, { book, reminded, now: NOW + 60e3 }).sent.length, 0, 'a fresh report was told about');
  assert.equal(run([casey], reports, { book, reminded, now: NOW + DAY + 60e3 }).sent.length, 1, 'a fresh report a day later was not');
});

test('#5959 slice 3: never needs_you (a question waiting on the person), never a report Kosmos wrote (a provider failure)', () => {
  const [q, k] = cardsFor([['quin', 'needs_you'], ['kai', 'blocked']]);
  const { sent } = run([q, k], {
    [q.sessionName]: { found: true, state: 'needs_you', at: iso(NOW - 3 * DAY), by: 'agent' },
    // The real shape of Kosmos's automatic blocked: the StopFailure hook's provider failure.
    [k.sessionName]: { found: true, state: 'blocked', at: iso(NOW - 3 * DAY), by: 'auto', on: 'provider api (server_error)' },
  });
  assert.deepEqual(sent, [], 'typed into a question, or about a provider failure whose reminder turn would fail');
  assert.equal(run([k], { [k.sessionName]: { found: true, state: 'blocked', at: iso(NOW - 3 * DAY), by: 'agent' } }).sent.length, 1,
    'CONTROL: the same card with its own blocked is told');
});

test('#5959 slice 3: an agent mid-turn is told at a later sweep, between turns', () => {
  const [m] = cardsFor([['moe', 'blocked']]);
  const reports = { [m.sessionName]: { found: true, state: 'blocked', at: iso(NOW - 2 * DAY), by: 'agent' } };
  const book = new Map();
  const reminded = memReminded();
  assert.equal(run([{ ...m, activeWhileWaiting: true }], reports, { book, reminded }).sent.length, 0, 'typed into a turn');
  assert.equal(run([m], reports, { book, reminded }).sent.length, 1, 'CONTROL: told once the turn is over');
});

test('#5959 slice 3: Claude cards only (the menu hold that keeps a line out of an open ask is Claude-only)', () => {
  const [c] = cardsFor([['cora', 'blocked']]);
  assert.equal(c.runner, 'claude', 'CONTROL: the fleet card is a Claude card');
  const reports = { [c.sessionName]: { found: true, state: 'blocked', at: iso(NOW - 2 * DAY), by: 'agent' } };
  for (const runner of ['codex', 'gemini', 'grok', 'antigravity', 'muse']) {
    assert.equal(run([{ ...c, runner }], reports).sent.length, 0, 'typed into a ' + runner + ' agent');
  }
  assert.equal(run([c], reports).sent.length, 1, 'CONTROL: the Claude card is told');
});

test('#5959 slice 3: a report written by someone else, or with no writer, is not called the agent\'s own', () => {
  const [e, f] = cardsFor([['eve', 'blocked'], ['fay', 'blocked']]);
  const { sent } = run([e, f], {
    [e.sessionName]: { found: true, state: 'blocked', at: iso(NOW - 2 * DAY), by: 'operator' },
    [f.sessionName]: { found: true, state: 'blocked', at: iso(NOW - 2 * DAY), by: null },
  });
  assert.equal(sent.length, 2);
  for (const x of sent) assert.match(x.text, /: This `blocked` report has been standing/, x.text);
});

test('#5959 slice 3: exactly a day old is not yet stale, as for kosmos report show', () => {
  const [g] = cardsFor([['gus', 'blocked']]);
  const at = (ms) => ({ [g.sessionName]: { found: true, state: 'blocked', at: iso(NOW - ms), by: 'agent' } });
  assert.equal(run([g], at(DAY)).sent.length, 0, 'told at exactly a day');
  assert.equal(run([g], at(DAY + 1)).sent.length, 1, 'CONTROL: told a millisecond later');
});

test('#5959 slice 3: no report, a working card, a paused swarm, a stranger: nobody is told', () => {
  const [a, b, c] = cardsFor([['ann', 'blocked'], ['bea', 'working'], ['cal', 'blocked']]);
  const old = () => ({ found: true, state: 'blocked', at: iso(NOW - 2 * DAY), by: 'agent' });
  assert.equal(run([a], {}).sent.length, 0, 'told with no report');
  assert.equal(run([b], { [b.sessionName]: old() }).sent.length, 0, 'told on a working card');
  assert.equal(run([c], { [c.sessionName]: old() }, { paused: true }).sent.length, 0, 'told while its swarm is switched off');
  assert.equal(run([{ ...c, isNamedOurs: false }], { [c.sessionName]: old() }).sent.length, 0, 'told a pane that is not ours');
  assert.equal(run([{ ...c, isNamedOurs: undefined }], { [c.sessionName]: old() }).sent.length, 0, 'told a pane not known to be ours');
  assert.equal(run([c], { [c.sessionName]: old() }).sent.length, 1, 'CONTROL: the same card, unpaused and ours, is told');
});

test('#5959 slice 3: retries up to MAX_TRIES then gives up, an unconfirmed delivery counts as reached, a hold spends no try', () => {
  const [d, u] = cardsFor([['dee', 'blocked'], ['uma', 'blocked']]);
  const reports = {
    [d.sessionName]: { found: true, state: 'blocked', at: iso(NOW - 2 * DAY), by: 'agent' },
    [u.sessionName]: { found: true, state: 'blocked', at: iso(NOW - 2 * DAY), by: 'agent' },
  };
  const book = new Map();
  const reminded = memReminded();
  const logged = [];
  const held = run([d], reports, { book, reminded, deliver: () => ({ state: 'held', held: true, heldBy: 'limit' }), log: (r) => logged.push(r) });
  assert.equal(held.out.results[0].heldBy, 'limit', 'the result does not say what held it');
  assert.equal(book.get(d.sessionName).tries, undefined, 'a held delivery spent a try');
  run([d], reports, { book, reminded, deliver: () => ({ state: 'held', held: true, heldBy: 'limit' }), log: (r) => logged.push(r) });
  assert.equal(logged.length, 1, 'a hold is logged once per report');
  assert.match(logged[0].because, /; held \(limit\)$/);
  for (let i = 0; i < nudge.MAX_TRIES; i += 1) {
    assert.equal(run([d], reports, { book, reminded, deliver: () => ({ state: DELIVERY.COULD_NOT }), log: (r) => logged.push(r) }).sent.length, 1, 'try ' + (i + 1));
  }
  assert.match(logged[logged.length - 1].because, /so this report is left alone$/, 'the give-up is not said');
  assert.equal(run([d], reports, { book, reminded }).sent.length, 0, 'tried again after MAX_TRIES that reached nothing');
  assert.equal(reminded.get(d.sessionName), null, 'recorded as reminded though nothing reached it');
  // UNCONFIRMED may have reached the pane: recorded, never sent twice.
  run([u], reports, { book, reminded, deliver: () => ({ state: DELIVERY.UNCONFIRMED }) });
  assert.equal(reminded.get(u.sessionName), reports[u.sessionName].at);
  assert.equal(run([u], reports, { book, reminded }).sent.length, 0, 'an unconfirmed delivery was sent again');
});

test('#5959 slice 3: the reminded record is kept on disk under the data root and survives a new reader', () => {
  const [h] = cardsFor([['hal', 'blocked']]);
  const reports = { [h.sessionName]: { found: true, state: 'blocked', at: iso(NOW - 2 * DAY), by: 'agent' } };
  const file = nudge.remindedFile();
  assert.ok(file.startsWith(process.env.AGENT_WORKFORCE_DATA), 'CONTROL: the record is not under the sandboxed data root: ' + file);
  const sent = [];
  const sweep = () => nudge.sweepOnce({ roster: [h], book: new Map(), now: NOW, report: (s) => reports[s], paused: () => ({ paused: false }),
    screen: () => null, deliver: (s) => { sent.push(s); return { state: DELIVERY.PLACED }; }, DELIVERY });
  sweep();
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8'))[h.sessionName], reports[h.sessionName].at);
  sweep();   // a new book and a new reader, as after a restart
  assert.equal(sent.length, 1, 'reminded again after a restart');
  // An unreadable record reads as empty: a reminder becomes possible again, never refused.
  fs.writeFileSync(file, 'not json');
  sweep();
  assert.equal(sent.length, 2);
  // Dropped only when off the board AND over PRUNE_MS old: one roster read missing a card does not cost its record.
  fs.writeFileSync(file, JSON.stringify({ gone: iso(NOW - nudge.PRUNE_MS - DAY), away: iso(NOW - 2 * DAY) }));
  sweep();
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(file, 'utf8'))).sort(), ['away', h.sessionName].sort(),
    'pruned a recent record of an agent briefly off the board, or kept an old one');
});

test('#5959 slice 3: nothing is typed while a menu or prompt is open on its screen, or a channel-reached agent', () => {
  const [o] = cardsFor([['oli', 'blocked']]);
  const reports = { [o.sessionName]: { found: true, state: 'blocked', at: iso(NOW - 2 * DAY), by: 'agent' } };
  const book = new Map();
  const reminded = memReminded();
  const logged = [];
  for (let i = 0; i < 5; i += 1) {
    const r = run([o], reports, { book, reminded, screen: () => 'a menu is open on its screen', log: (x) => logged.push(x) });
    assert.equal(r.sent.length, 0, 'typed into an open menu');
  }
  assert.equal(logged.length, 1, 'an open screen is logged once per report');
  assert.equal(book.get(o.sessionName).tries, undefined, 'an open screen spent a try');
  assert.equal(run([{ ...o, reachedByChannel: true }], reports, { book, reminded }).sent.length, 0, 'typed to an agent whose screen cannot be read here');
  assert.equal(run([o], reports, { book, reminded }).sent.length, 1, 'CONTROL: told once its prompt is clear');
});

test('#5959 slice 3: the screen reader refuses a menu, a permission prompt and an unreadable screen, and passes a clear prompt', () => {
  const status = require('./status');
  const chat = require('./chat');
  const real = chat.viewport;
  const seen = [];
  try {
    chat.viewport = () => ({ text: null });
    assert.equal(nudge.screenOpen('x', []), 'its screen could not be read');
    // Whatever the readers say about a given text is what screenOpen says: driven through stubs of status's readers.
    const orig = { q: status.claudeQuestionMenuUp, s: status.claudeSafeguardsMenuUp, p: status.claudePermissionPromptKind, l: status.claudeLimitMenuUp };
    try {
      chat.viewport = () => ({ text: 'anything' });
      status.claudeSafeguardsMenuUp = () => false; status.claudeQuestionMenuUp = () => false; status.claudePermissionPromptKind = () => null;
      status.claudeLimitMenuUp = () => false;
      assert.equal(nudge.screenOpen('x', []), null, 'CONTROL: a clear prompt');
      status.claudeQuestionMenuUp = () => true; seen.push(nudge.screenOpen('x', []));
      status.claudeQuestionMenuUp = () => false; status.claudeSafeguardsMenuUp = () => true; seen.push(nudge.screenOpen('x', []));
      status.claudeSafeguardsMenuUp = () => false; status.claudeLimitMenuUp = () => true; seen.push(nudge.screenOpen('x', []));
      status.claudeLimitMenuUp = () => false; status.claudePermissionPromptKind = () => 'wording'; seen.push(nudge.screenOpen('x', []));
      status.claudePermissionPromptKind = () => 'shape'; seen.push(nudge.screenOpen('x', []));
    } finally { Object.assign(status, { claudeQuestionMenuUp: orig.q, claudeSafeguardsMenuUp: orig.s, claudePermissionPromptKind: orig.p, claudeLimitMenuUp: orig.l }); }
  } finally { chat.viewport = real; }
  assert.deepEqual(seen, ['a menu is open on its screen', 'a menu is open on its screen', 'a menu is open on its screen', 'a prompt is open on its screen', 'a prompt is open on its screen']);
});

test('#5959 slice 3: a record that could not be written is logged', () => {
  const [i] = cardsFor([['ida', 'blocked']]);
  const logged = [];
  run([i], { [i.sessionName]: { found: true, state: 'blocked', at: iso(NOW - 2 * DAY), by: 'agent' } },
    { reminded: { get: () => null, set: () => false }, log: (r) => logged.push(r) });
  assert.ok(logged.some((r) => r.act === 'record' && /could not be written/.test(r.because)), JSON.stringify(logged));
});

test('#5959 slice 3: the sweep runs only with live execution allowed and the brake off', () => {
  assert.equal(nudge.nudgeEnabled(true, {}), true);
  assert.equal(nudge.nudgeEnabled(false, {}), false);
  assert.equal(nudge.nudgeEnabled(true, { AGENT_WORKFORCE_STALEREPORT_NUDGE_OFF: '1' }), false);
  const tick = nudge.makeTick({ allowed: () => false, roster: () => { throw new Error('read while off'); } });
  assert.equal(tick(), null);
  const braked = nudge.makeTick({ allowed: () => true, env: { AGENT_WORKFORCE_STALEREPORT_NUDGE_OFF: '1' }, roster: () => { throw new Error('read while braked'); } });
  assert.equal(braked(), null);
  // CONTROL: allowed and unbraked, the tick runs and sweeps the roster it is given.
  let read = false;
  const on = nudge.makeTick({ allowed: () => true, env: {}, roster: () => { read = true; return []; } });
  assert.deepEqual(on(), { results: [] });
  assert.equal(read, true, 'the tick did not read the roster while allowed');
});

test('#5959 slice 3: the server runs the sweep on its own timer, typing through deliverAutomatic', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const at = src.indexOf("require('./engine/stalereport-nudge').makeTick({");
  assert.ok(at > 0, 'the server does not make the stale-report tick');
  const end = src.indexOf('stalereportSweep.unref();', at);
  assert.ok(end > at, 'CONTROL: the stale-report timer was not found after its tick');
  const block = src.slice(at, end);
  assert.match(block, /allowed: \(\) => liveExecution\.liveExecutionAllowed\(\),/, 'not gated on live execution');
  assert.match(block, /deliver: \(session, text, r\) => chat\.deliverAutomatic\(/, 'not typed through deliverAutomatic');
  assert.match(block, /setInterval\(stalereportTick, /, 'no timer runs the tick');
});
