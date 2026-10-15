'use strict';
require('../test-support/tmpscope');   // first: every temp dir this file makes is swept at exit (#4273)

/**
 * #6209 part 2: an agent whose running summary is overdue while it has been working is told once per stale summary,
 * typed into its session. Real board cards (test-support/fleet); the folder, history, screen, pause and delivery are
 * injected.
 *   node --test engine/summarydue-nudge-6209.test.js
 */

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-summarydue-6209-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');

const test = require('node:test');
const assert = require('node:assert/strict');
const fleet = require('../test-support/fleet');
const nudge = require('./summarydue-nudge');

test.after(() => { fleet.restore(); fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const H = 3600 * 1000;
const NOW = Date.parse('2026-10-15T12:00:00Z');
const DELIVERY = { PLACED: 'placed', UNCONFIRMED: 'unconfirmed', COULD_NOT: 'could_not' };

function cardsFor(specs) {
  const board = fleet.install(specs.map(([name]) => fleet.agent(name, { state: 'idle' })));
  try {
    return specs.map(([name, state]) => {
      const c = board.agents.find((x) => x.name === name || (x.sessionName || '').startsWith(name));
      assert.ok(c, 'CONTROL: no card for ' + name);
      return { ...c, state, runner: c.runner || 'claude' };
    });
  } finally { board.restore(); }
}

/* An agent folder with one summary written `agoMs` before NOW. */
function folderWith(name, agoMs, file = '2026-10-15-06.md') {
  const dir = path.join(SANDBOX, 'folders', name, 'summaries');
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, file);
  fs.writeFileSync(f, 'what moved\n');
  const t = (NOW - agoMs) / 1000;
  fs.utimesSync(f, t, t);
  return path.join(SANDBOX, 'folders', name);
}

function memPrompted() { const m = new Map(); return { get: (k) => (m.has(k) ? m.get(k) : null), set: (k, v) => { m.set(k, v); return true; }, m }; }

function run(cards, folders, histories, opts = {}) {
  const sent = [];
  const out = nudge.sweepOnce({
    roster: cards,
    book: opts.book || new Map(),
    prompted: opts.prompted || memPrompted(),
    screen: opts.screen || (() => null),
    now: opts.now || NOW,
    folder: (s) => folders[s] || null,
    history: (s) => histories[s] || [],
    paused: () => ({ paused: false }),
    deliver: (s, text) => { sent.push({ s, text }); return { state: DELIVERY.PLACED }; },
    DELIVERY,
  });
  return { out, sent };
}

test('#6209 part 2: an idle agent whose summary is 6 hours old and that worked since is told once; one that was idle is not', () => {
  const [busy, rested] = cardsFor([['sumbusy', 'idle'], ['sumrest', 'idle']]);
  const folders = { [busy.sessionName]: folderWith('sumbusy', 6 * H), [rested.sessionName]: folderWith('sumrest', 6 * H) };
  const histories = {
    [busy.sessionName]: [{ state: 'working', at: NOW - 7 * H }, { state: 'working', at: NOW - 3 * H }, { state: 'idle', at: NOW - 5 * 60 * 1000 }],   // worked ~6h since
    [rested.sessionName]: [{ state: 'idle', at: NOW - 7 * H }],   // idle the whole time
  };
  const prompted = memPrompted();
  const { sent } = run([busy, rested], folders, histories, { prompted });
  assert.deepEqual(sent.map((x) => x.s), [busy.sessionName], 'not exactly the agent that worked was told');
  assert.match(sent[0].text, /your running summary is overdue/);
  assert.match(sent[0].text, /summaries\/2026-10-15-06\.md/);
  assert.match(sent[0].text, /6 hours ago/);
  // Once per stale summary: a second sweep tells nobody.
  const again = run([busy, rested], folders, histories, { prompted });
  assert.equal(again.sent.length, 0, 'the same stale summary was told twice');
});

test('#6209 part 2: a current summary, no summary at all, a working agent and a non-Claude agent are not told', () => {
  const [fresh, none, working, codex] = cardsFor([['sumfresh', 'idle'], ['sumnone', 'idle'], ['sumwork', 'working'], ['sumcodex', 'idle']]);
  const worked = [{ state: 'working', at: NOW - 9 * H }, { state: 'working', at: NOW - H }];
  const folders = {
    [fresh.sessionName]: folderWith('sumfresh', 2 * H),
    [none.sessionName]: path.join(SANDBOX, 'folders', 'sumnone-empty'),
    [working.sessionName]: folderWith('sumwork', 6 * H),
    [codex.sessionName]: folderWith('sumcodex', 6 * H),
  };
  fs.mkdirSync(folders[none.sessionName], { recursive: true });
  const histories = { [fresh.sessionName]: worked, [none.sessionName]: worked, [working.sessionName]: worked, [codex.sessionName]: worked };
  const { sent } = run([fresh, none, working, { ...codex, runner: 'codex' }], folders, histories);
  assert.deepEqual(sent, [], 'one of them was told: ' + JSON.stringify(sent.map((x) => x.s)));
});

test('#6209 part 2: a new summary that goes stale later is a new stretch and is told again; an open screen types nothing', () => {
  const [a] = cardsFor([['sumagain', 'idle']]);
  const prompted = memPrompted();
  const folder = folderWith('sumagain', 6 * H);
  const hist = { [a.sessionName]: [{ state: 'working', at: NOW - 30 * H }, { state: 'working', at: NOW - H }, { state: 'working', at: NOW + H }] };
  assert.equal(run([a], { [a.sessionName]: folder }, hist, { prompted }).sent.length, 1);
  // A newer summary, itself stale a day later: told again.
  folderWith('sumagain', 0, '2026-10-15-12.md');
  const later = NOW + 6 * H;
  assert.equal(run([a], { [a.sessionName]: folder }, hist, { prompted, now: later }).sent.length, 1, 'a new stale summary was not told');
  // An open menu on its screen: nothing typed.
  const [b] = cardsFor([['sumscreen', 'idle']]);
  const r = run([b], { [b.sessionName]: folderWith('sumscreen', 6 * H) }, { [b.sessionName]: [{ state: 'working', at: NOW - 8 * H }, { state: 'working', at: NOW - H }] }, { screen: () => 'a menu is open on its screen' });
  assert.equal(r.sent.length, 0);
  assert.equal(r.out.results[0].act, 'screen');
});

test('#6209 part 2: the tick is inert unless live execution is allowed, and off with the operator brake', () => {
  assert.equal(nudge.nudgeEnabled(false, {}), false);
  assert.equal(nudge.nudgeEnabled(true, { AGENT_WORKFORCE_SUMMARYDUE_NUDGE_OFF: '1' }), false);
  assert.equal(nudge.nudgeEnabled(true, {}), true);
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(src, /require\('\.\/engine\/summarydue-nudge'\)\.makeTick\(\{\s*allowed: \(\) => liveExecution\.liveExecutionAllowed\(\)/, 'the board does not wire the sweep behind the live-execution gate');
});

test('#6209 review 1: no history, an empty one, or a state carried across a crash is not work: nobody is told', () => {
  const W0 = NOW - 6 * 24 * H;
  const summary = { state: 'stale', file: 'summaries/x.md', at: new Date(W0).toISOString() };
  assert.equal(nudge.workedSinceMs(null, W0, NOW), null);
  assert.equal(nudge.plan({}, summary, nudge.workedSinceMs(null, W0, NOW), null, NOW, null).act, 'none', 'no history read as work');
  assert.equal(nudge.plan({}, summary, nudge.workedSinceMs([], W0, NOW), null, NOW, null).act, 'none', 'an empty history read as work');
  const crash = [{ state: 'working', at: W0 - H }, { state: 'started', at: W0 + 5 * 24 * H }, { state: 'idle', at: W0 + 5 * 24 * H + 60000 }];
  assert.equal(nudge.plan({}, summary, nudge.workedSinceMs(crash, W0, NOW), null, NOW, null).act, 'none', 'a state carried across a crash read as days of work');
  // CONTROL: real reported work after the summary is told.
  const worked = [{ state: 'idle', at: W0 - H }, { state: 'working', at: W0 + H }, { state: 'idle', at: W0 + 7 * H }];
  const p = nudge.plan({}, summary, nudge.workedSinceMs(worked, W0, NOW), null, NOW, null);
  assert.equal(p.act, 'nudge');
  assert.match(nudge.nudgeText(summary, NOW, p.workedMs), /reported about 6 hours of work since/);
});

test('#6209 review 1: the on-disk record stops a repeat after a restart; failed deliveries retry and then give up; paused and channel cards are skipped', () => {
  const [a] = cardsFor([['sumdisk', 'idle']]);
  const folders = { [a.sessionName]: folderWith('sumdisk', 6 * H) };
  const hist = { [a.sessionName]: [{ state: 'working', at: NOW - 8 * H }, { state: 'working', at: NOW - H }] };
  const base = { roster: [a], folder: (s) => folders[s], history: (s) => hist[s], screen: () => null, paused: () => ({ paused: false }), now: NOW, DELIVERY };
  const sent = [];
  nudge.sweepOnce({ ...base, book: new Map(), deliver: (s) => { sent.push(s); return { state: DELIVERY.PLACED }; } });
  assert.equal(sent.length, 1);
  assert.ok(fs.existsSync(nudge.promptedFile()), 'the record was not written');
  // A fresh book (a board restart) with the real on-disk record: not told again.
  nudge.sweepOnce({ ...base, book: new Map(), deliver: (s) => { sent.push(s); return { state: DELIVERY.PLACED }; } });
  assert.equal(sent.length, 1, 'a restart told it again');
  // Deliveries that reach nothing: retried, then left alone after MAX_TRIES.
  const [b] = cardsFor([['sumretry', 'idle']]);
  const fb = { [b.sessionName]: folderWith('sumretry', 6 * H) };
  const hb = { [b.sessionName]: [{ state: 'working', at: NOW - 8 * H }, { state: 'working', at: NOW - H }] };
  const book = new Map(); let tries = 0;
  for (let k = 0; k < nudge.MAX_TRIES + 2; k += 1) {
    nudge.sweepOnce({ ...base, roster: [b], folder: (s) => fb[s], history: (s) => hb[s], prompted: memPrompted(), book, deliver: () => { tries += 1; return { state: DELIVERY.COULD_NOT }; } });
  }
  assert.equal(tries, nudge.MAX_TRIES, 'not exactly MAX_TRIES deliveries before giving up');
  // Paused, or reached through a channel: nothing typed.
  const [c, d] = cardsFor([['sumpause', 'idle'], ['sumchan', 'idle']]);
  const fc = { [c.sessionName]: folderWith('sumpause', 6 * H), [d.sessionName]: folderWith('sumchan', 6 * H) };
  const hc = { [c.sessionName]: hb[b.sessionName], [d.sessionName]: hb[b.sessionName] };
  const out = [];
  nudge.sweepOnce({ ...base, roster: [c, { ...d, reachedByChannel: true }], folder: (s) => fc[s], history: (s) => hc[s], prompted: memPrompted(), book: new Map(),
    paused: (s) => ({ paused: s === c.sessionName }), deliver: (s) => { out.push(s); return { state: DELIVERY.PLACED }; } });
  assert.deepEqual(out, [], 'a paused or channel-reached agent was typed to');
});
