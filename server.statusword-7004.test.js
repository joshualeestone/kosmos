'use strict';
require('./test-support/tmpscope');
/**
 * #7004 (the iPhone plan's slice 2, #6838): /api/status gives each card its word (cardWord, engine/cardlabel labelOf,
 * the computer's own words) and its tone in the phone's list (cardTone, cardlabel toneOf), so the phone shows the
 * computer's words instead of keeping its own copy. Three parts:
 *   1. toneOf on cards built by hand, each tone and the cases that are easy to get wrong;
 *   2. the route, on a fake fleet classified by the real engine: every row carries the two fields, equal to labelOf and
 *      toneOf over that same row;
 *   3. the phone's fallback (ios/Kosmos/BoardLogic.swift, used only with a Mac older than this) has the engine's words
 *      and needs-you set (the table only: the words statusWord writes directly, and a restart's cause, which an older
 *      Mac's phone reads as "Restarting agent", are not compared).
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-statusword-7004-')));
const mk = (n) => { const d = path.join(SANDBOX, n); fs.mkdirSync(d, { recursive: true }); return d; };
process.env.AGENT_WORKFORCE_HOME = mk('home');
process.env.AGENT_WORKFORCE_DATA = mk('data');
process.env.AGENT_WORKFORCE_WORKERS = mk('workers');
process.env.AGENT_WORKFORCE_PROJECTS = mk('projects');
process.env.AGENT_WORKFORCE_LAUNCH = mk('launch');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server } = require('./server');
const fleet = require('./test-support/fleet');
const cardlabel = require('./engine/cardlabel');
const { needsPerson } = require('./engine/status');

let base;
test.before(async () => { await start(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => { try { server.close(); } catch { /* best effort */ } fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const tone = (card) => cardlabel.toneOf(card, needsPerson(card));

test('#7004 toneOf: a question is asked, Working is working, the needs-you words are needs_you, the rest quiet', () => {
  assert.equal(tone({ state: 'needs_you', stateReportedBy: 'agent' }), 'asked');
  assert.equal(tone({ state: 'working' }), 'working');
  assert.equal(tone({ state: 'idle' }), 'quiet');
  assert.equal(tone({ state: 'restarting' }), 'quiet');
  for (const state of ['needs_you', 'rate_limited', 'auth_failed', 'connection_lost', 'blocked', 'unknown']) {
    assert.equal(tone({ state }), 'needs_you', state);
  }
  assert.equal(tone({ state: 'needs_you', awaitingApproval: true }), 'needs_you', 'a permission prompt');
  assert.equal(tone({ state: 'idle', running: false }), 'needs_you', 'not running');
  assert.equal(tone({ state: 'connection_lost', reconnect: { phase: 'waiting' } }), 'quiet', 'Reconnecting... is not red');
});

test('#7004 toneOf: the board\'s own needs-the-person wins over the word; a state with no word is quiet unless it needs the person', () => {
  // A crash loop reads "Keeps stopping", a word the needs-you set does not list, but the board counts it.
  const looping = { state: 'idle', crashLoop: { looping: true } };
  assert.equal(cardlabel.labelOf(looping), 'Keeps stopping');
  assert.equal(tone(looping), 'needs_you');
  // A stuck error and a helper that gave up need the person on an idle-looking card.
  assert.equal(tone({ state: 'idle', stuckError: { stuck: true } }), 'needs_you');
  assert.equal(tone({ state: 'idle', ownBound: { raised: true } }), 'needs_you');
  // A state added later, with no word here: quiet, never red at the top (labelOf alone would say "Can't tell").
  assert.equal(cardlabel.labelOf({ state: 'brand_new_state' }), "Can't tell", 'CONTROL: the word alone would be red');
  assert.equal(tone({ state: 'brand_new_state' }), 'quiet');
  assert.equal(cardlabel.toneOf({ state: 'brand_new_state' }, true), 'needs_you', 'unless the board counts it as needing the person');
});

test('#7004 /api/status: every row carries cardWord and cardTone, equal to labelOf and toneOf over that row', async () => {
  const board = fleet.install([
    fleet.agent('wanda', { state: 'working' }),
    fleet.agent('ivo', { state: 'idle' }),
    fleet.agent('sol', { state: 'auth_failed' }),
    fleet.agent('rae', { state: 'rate_limited' }),
  ]);
  try {
    const s = await (await fetch(base + '/api/status')).json();
    const rows = s.agents.filter((a) => ['wanda', 'ivo', 'sol', 'rae'].includes(a.sessionName));
    assert.equal(rows.length, 4, 'CONTROL: the four agents are on the board');
    for (const r of rows) {
      assert.equal(typeof r.cardWord, 'string', r.sessionName + ' has no cardWord');
      const { cardWord, cardTone, ...card } = r;
      assert.equal(cardWord, cardlabel.labelOf(card), r.sessionName);
      assert.equal(cardTone, tone(card), r.sessionName);
    }
    const by = (n) => rows.find((a) => a.sessionName === n);
    assert.deepEqual([by('wanda').cardWord, by('wanda').cardTone], ['Working', 'working']);
    assert.deepEqual([by('ivo').cardWord, by('ivo').cardTone], ['Idle', 'quiet']);
    assert.deepEqual([by('sol').cardWord, by('sol').cardTone], ['Sign-in Issue', 'needs_you'], 'the word the phone used to get wrong');
    assert.deepEqual([by('rae').cardWord, by('rae').cardTone], ['Rate Limit', 'needs_you']);
    // server.test.js's "no field the board sends is unknown to the page" sees these only when its board has a row,
    // which it may not; so here, where rows exist: the page does not read them, and that list names them.
    const page = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
    const guard = fs.readFileSync(path.join(__dirname, 'server.test.js'), 'utf8');
    const list = guard.slice(guard.indexOf('const UNREAD_ON_PURPOSE = {'), guard.indexOf('\n};', guard.indexOf('const UNREAD_ON_PURPOSE = {')));
    assert.ok(list.length > 100, 'UNREAD_ON_PURPOSE moved; re-anchor this test');
    for (const k of ['cardWord', 'cardTone']) {
      assert.ok(k in rows[0], 'CONTROL: the row carries ' + k);
      if (!page.includes(k)) assert.match(list, new RegExp('^  ' + k + ':', 'm'), k + ' is sent, unread by the page and not in UNREAD_ON_PURPOSE');
    }
  } finally { board.restore(); }
});

test('#7004 withCardWords passes the board\'s own needs-the-person into the tone, on rows whose word alone would be quiet', () => {
  const { withCardWords } = require('./server');
  // Each of these needs the person while its word is not a needs-you word, so a route that passed false for the second
  // argument would show them quiet; the four fleet agents above cannot tell the two apart.
  const rows = withCardWords([
    { sessionName: 'loop', state: 'idle', crashLoop: { looping: true } },
    { sessionName: 'gave', state: 'idle', ownBound: { raised: true } },
    { sessionName: 'gone', state: 'connection_lost', reconnect: { phase: 'gave_up' } },
    { sessionName: 'calm', state: 'idle' },
  ]);
  const by = (n) => rows.find((r) => r.sessionName === n);
  assert.deepEqual([by('loop').cardWord, by('loop').cardTone], ['Keeps stopping', 'needs_you']);
  assert.deepEqual([by('gave').cardWord, by('gave').cardTone], ['Idle', 'needs_you']);
  assert.equal(by('gone').cardTone, 'needs_you');
  assert.deepEqual([by('calm').cardWord, by('calm').cardTone], ['Idle', 'quiet'], 'CONTROL: the same word without the flag is quiet');
  // A row whose word cannot be worked out (here a field that throws when read) is passed on without the two, and the
  // rows after it still get theirs: one bad row never fails the whole read.
  const bad = { sessionName: 'bad', get state() { throw new Error('unreadable'); } };
  const odd = withCardWords([null, bad, { sessionName: 'ok', state: 'working' }]);
  assert.equal(odd[0], null);
  assert.equal(odd[1], bad);
  assert.equal(odd[2].cardTone, 'working');
});

test('#7004 the status route runs withCardWords last, over rows that already carry the late fields', () => {
  // The fake fleet cannot make a row with a restart cause or a crash loop, so the order is pinned in the source: the
  // word reads reconnect, crashLoop and disruption, which the other wrappers and the route attach before this line.
  const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  const lines = src.split('\n').filter((l) => /^\s*const rows = .*agents\.concat\(offline\)/.test(l));
  assert.equal(lines.length, 1, 'the status route\'s rows line moved; re-anchor this test');
  assert.match(lines[0], /^\s*const rows = withCardWords\(withReplyChannel\(withTokenGuard\(withAgentSortFields\(agents\.concat\(offline\)\)\)\)\);$/,
    'withCardWords is not the outermost wrapper of the finished rows');
});

// ---- 3. the phone's fallback is the engine's words ----
const SWIFT = fs.readFileSync(path.join(__dirname, 'ios', 'Kosmos', 'BoardLogic.swift'), 'utf8');
const between = (open, close) => {
  const at = SWIFT.indexOf(open);
  assert.notEqual(at, -1, open + ' moved in BoardLogic.swift; re-anchor this test');
  return SWIFT.slice(at + open.length, SWIFT.indexOf(close, at + open.length));
};

test('#7004 the phone\'s fallback words are engine/cardlabel STATE_COPY, and its needs-you words are NEEDS_YOU_WORDS', () => {
  const pairs = [...between('static let stateCopy: [String: String] = [', ']').matchAll(/"([a-z_]+)":\s*"([^"]+)"/g)];
  assert.ok(pairs.length >= 10, 'the phone table was not read');
  assert.deepEqual(Object.fromEntries(pairs.map((m) => [m[1], m[2]])), { ...cardlabel.STATE_COPY },
    'a word changed on one side only: the phone would say one thing and the computer another on an older Mac');
  const words = [...between('static let needsYouWords: Set<String> = [', ']').matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(new Set(words), cardlabel.NEEDS_YOU_WORDS);
  // And the four tone names the Mac sends are the four the phone reads.
  const named = [...between('static func tone(named name: String?) -> Tone? {', 'default:').matchAll(/case "([a-z_]+)"/g)].map((m) => m[1]);
  assert.deepEqual(new Set(named), new Set(['needs_you', 'asked', 'working', 'quiet']));
});
