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
    [busy.sessionName]: [{ state: 'working', at: NOW - 7 * H }, { state: 'idle', at: NOW - 5 * 60 * 1000 }],   // worked ~6h since
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
  const worked = [{ state: 'working', at: NOW - 9 * H }];
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
  const hist = { [a.sessionName]: [{ state: 'working', at: NOW - 30 * H }] };
  assert.equal(run([a], { [a.sessionName]: folder }, hist, { prompted }).sent.length, 1);
  // A newer summary, itself stale a day later: told again.
  folderWith('sumagain', 0, '2026-10-15-12.md');
  const later = NOW + 6 * H;
  assert.equal(run([a], { [a.sessionName]: folder }, hist, { prompted, now: later }).sent.length, 1, 'a new stale summary was not told');
  // An open menu on its screen: nothing typed.
  const [b] = cardsFor([['sumscreen', 'idle']]);
  const r = run([b], { [b.sessionName]: folderWith('sumscreen', 6 * H) }, { [b.sessionName]: [{ state: 'working', at: NOW - 8 * H }] }, { screen: () => 'a menu is open on its screen' });
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
