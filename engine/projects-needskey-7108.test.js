'use strict';

/**
 * #7108: a question's dismiss key (needsYouKey) is cut on a code-point boundary. A cut through an emoji left half a
 * surrogate pair, which JSON.stringify writes as a lone "\ud83d", and the iPhone's JSON reader refuses the whole
 * projects answer.
 *
 *   node --test engine/projects-needskey-7108.test.js
 *
 * Sandbox first, before any require (see engine/projects.test.js): every root the code writes to.
 */
require('../test-support/tmpscope');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-needskey-7108-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_SYSTEMD_DIR = path.join(process.env.AGENT_WORKFORCE_LAUNCH, 'systemd', 'user');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'kosmos-projects');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const projects = require('./projects');
const selfreport = require('./selfreport');
const fleet = require('../test-support/fleet');
const { cutUnits } = require('./textcut');

const WORK = path.join(SANDBOX, 'work');
fs.mkdirSync(WORK, { recursive: true });
const folder = (name) => { const d = path.join(WORK, name); fs.mkdirSync(d, { recursive: true }); return d; };
function cards(specs) {
  const board = fleet.install(specs);
  try { return board.agents; } finally { board.restore(); }
}
// A lone half of a surrogate pair: a lead not followed by a trail, or a trail not after a lead.
const LONE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
// 299 units, then an emoji (two units) across the 300th.
const SPLIT = 'a'.repeat(299) + '\u{1F600} and more';
const LONE_ESCAPE = /\\ud[89a-f][0-9a-f]{2}/i;

test('#7108: a question cut through an emoji keeps no half of it, and the answer stays strict JSON', () => {
  assert.ok(LONE.test('question:' + SPLIT.slice(0, 300)), 'CONTROL: the old cut did not leave half an emoji');
  const p = projects.create({ name: 'Emoji', folder: folder('emoji'), agents: ['em08'] });
  assert.equal(selfreport.record('em08', { state: 'needs_you', because: SPLIT, project: p.id }).recorded, true, 'fixture: the report was refused');
  const r = projects.list(cards([fleet.agent('em08', { state: 'needs_you' })])).find((x) => x.id === p.id);
  const m = r.agents.find((a) => a.sessionName === 'em08');
  assert.equal(m.needsYouHere, 'question');
  assert.equal(m.needsYouKey, 'question:' + 'a'.repeat(299), 'the key ends before the emoji');
  assert.ok(!LONE.test(m.needsYouKey), 'the key holds half an emoji');
  // What the phone receives: JSON.stringify escapes only a LONE half (a valid pair is written as itself), so any
  // \ud800-\udfff escape in the whole project's answer is one the phone refuses.
  assert.ok(!LONE_ESCAPE.test(JSON.stringify(r)), 'the projects answer carries a lone surrogate escape');
});

test('#7108: the shortened key still dismisses, and a whole emoji under the cut is kept', () => {
  const p = projects.create({ name: 'Emoji two', folder: folder('emoji2'), agents: ['em09'] });
  selfreport.record('em09', { state: 'needs_you', because: SPLIT, project: p.id });
  const roster = cards([fleet.agent('em09', { state: 'needs_you' })]);
  const key = projects.list(roster).find((x) => x.id === p.id).agents.find((a) => a.sessionName === 'em09').needsYouKey;
  projects.dismissNeeds(p.id, 'em09', key);
  const after = projects.list(roster).find((x) => x.id === p.id).agents.find((a) => a.sessionName === 'em09');
  assert.equal(after.needsYouHere, null, 'the dismissal under the new key did not hide the row');
  // CONTROL: an emoji wholly inside the first 300 units is kept whole.
  const whole = 'a'.repeat(298) + '\u{1F600}rest';
  const q = projects.create({ name: 'Emoji three', folder: folder('emoji3'), agents: ['em10'] });
  selfreport.record('em10', { state: 'needs_you', because: whole, project: q.id });
  const k = projects.list(cards([fleet.agent('em10', { state: 'needs_you' })])).find((x) => x.id === q.id).agents[0].needsYouKey;
  assert.equal(k, 'question:' + 'a'.repeat(298) + '\u{1F600}', 'a whole emoji under the cut was dropped');
});

test('#7108: the board builds its fallback key the same way (pjNeedsNotice keyOf)', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');
  assert.ok(page.includes("const keyWords = (t) => { const w = String(t || '').slice(0, 300); const c = w.charCodeAt(w.length - 1); return c >= 0xD800 && c <= 0xDBFF ? w.slice(0, -1) : w; };"),
    'the board fallback no longer drops a trailing half of an emoji');
  assert.ok(page.includes("'question:' + keyWords(m.because)"), 'the board fallback does not use keyWords');
});

test('#7108 review 1: a question cut at 1000 units by the self-report keeps no half emoji either', () => {
  const long = 'b'.repeat(999) + '\u{1F600} tail';
  const p = projects.create({ name: 'Long', folder: folder('long'), agents: ['em11'] });
  assert.equal(selfreport.record('em11', { state: 'needs_you', because: long, project: p.id }).recorded, true);
  const r = projects.list(cards([fleet.agent('em11', { state: 'needs_you' })])).find((x) => x.id === p.id);
  const m = r.agents.find((a) => a.sessionName === 'em11');
  assert.ok(LONE.test(long.slice(0, 1000)), 'CONTROL: the old 1000-unit cut did not leave half an emoji');
  assert.equal(m.because, 'b'.repeat(999), 'the question was not cut before the emoji');
  assert.ok(!LONE_ESCAPE.test(JSON.stringify(r)), 'the projects answer carries a lone surrogate escape');
});

test('#7108 review 1: a broken key is refused, and a stored one never reaches the answer', () => {
  const p = projects.create({ name: 'Legacy', folder: folder('legacy'), agents: ['em12'] });
  assert.throws(() => projects.dismissNeeds(p.id, 'em12', 'question:' + SPLIT.slice(0, 300)), /not a reason a project shows/,
    'a key ending in half an emoji was accepted');
  // A dismissal saved before the fix, under a broken key, still in the store.
  const all = projects.readAll();
  const at = all.findIndex((x) => x.id === p.id);
  all[at] = { ...all[at], needsDismissed: { em12: 'question:' + SPLIT.slice(0, 300) } };
  projects.writeAll(all);
  const r = projects.list(cards([])).find((x) => x.id === p.id);
  assert.equal(r.needsDismissed, undefined, 'the dismissal store went out in the answer');
  assert.ok(!LONE_ESCAPE.test(JSON.stringify(r)), 'a stored broken key reached the answer');
  assert.ok(projects.readAll().find((x) => x.id === p.id).needsDismissed, 'CONTROL: the stored dismissal is still kept');
});

test('#7108: cutUnits keeps whole pairs and never ends on a lead half', () => {
  assert.equal(cutUnits('ab\u{1F600}', 3), 'ab');
  assert.equal(cutUnits('ab\u{1F600}', 4), 'ab\u{1F600}');
  assert.equal(cutUnits('abc', 10), 'abc');
});

test('#7108 review 2: a commitment cut at 300 keeps no half emoji (it goes out in /api/status)', () => {
  const commitments = require('./commitments');
  const what = 'c'.repeat(299) + '\u{1F600} more';
  assert.ok(LONE.test(what.slice(0, 300)), 'CONTROL: the old cut did not leave half an emoji');
  commitments.report('cm08', [{ what }]);
  const got = commitments.read('cm08');
  const items = Array.isArray(got) ? got : (got && (got.commitments || got.items)) || [];
  assert.ok(items.length >= 1, 'fixture: the commitment was not recorded: ' + JSON.stringify(got).slice(0, 200));
  assert.equal(items[0].what, 'c'.repeat(299), 'the commitment was not cut before the emoji');
  assert.ok(!LONE_ESCAPE.test(JSON.stringify(got)), 'the commitment carries a lone surrogate escape');
});

test('#7108 review 2: a report stored before the fix, ending in half an emoji, is read back well-formed', () => {
  assert.equal(selfreport.record('em13', { state: 'needs_you', because: 'ok', project: 'x' }).recorded, true, 'fixture: the report was refused');
  // Rewrite the stored line as an older build wrote it: cut through an emoji.
  const file = selfreport.fileFor('em13');
  assert.ok(fs.readFileSync(file, 'utf8').includes('"because":"ok"'), 'fixture: the stored report was not where fileFor says');
  const broken = 'b'.repeat(999) + '\uD83D';
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('"because":"ok"', '"because":' + JSON.stringify(broken)));
  const r = selfreport.read('em13');
  assert.ok(LONE.test(broken), 'CONTROL: the stored text is broken');
  assert.ok(!LONE.test(r.because), 'a stored half emoji was read back as is');
  assert.ok(!LONE_ESCAPE.test(JSON.stringify(r)), 'the read report carries a lone surrogate escape');
});
