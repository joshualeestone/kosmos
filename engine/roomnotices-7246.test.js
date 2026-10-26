'use strict';
/**
 * #7246 slice 2: a project's own setting for room posts that do not name a member (roomNotices), carried by
 * projects.edit and reported by describe beside the mode it gives now, and the page's select that sets it.
 *
 *   node --test engine/roomnotices-7246.test.js
 */
require('../test-support/tmpscope');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-roomnotices-7246-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_SYSTEMD_DIR = path.join(process.env.AGENT_WORKFORCE_LAUNCH, 'systemd', 'user');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'kosmos-projects');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const projects = require('./projects');
const roomhold = require('./roomhold');
const page = require('../test-support/page');

const WORK = path.join(SANDBOX, 'work');
fs.mkdirSync(WORK, { recursive: true });
const folder = (name) => { const d = path.join(WORK, name); fs.mkdirSync(d, { recursive: true }); return d; };
const raw = (id) => projects.readAll().find((p) => p.id === id);

test('#7246 s2: edit carries roomNotices; auto clears it; anything else is refused and nothing is written', () => {
  const members = Array.from({ length: 10 }, (_, i) => 'm' + i);
  const p = projects.create({ name: 'Busy', folder: folder('busy'), agents: members });
  assert.equal(projects.get(p.id, []).roomNotices, 'auto', 'a new project is not auto');
  assert.equal(projects.get(p.id, []).roomNoticesNow, 'digest', 'auto on 10 members is not the hourly digest');
  projects.edit(p.id, { roomNotices: 'each' });
  assert.equal(raw(p.id).roomNotices, 'each');
  assert.equal(roomhold.noticeMode(raw(p.id)), 'each', 'the stored setting did not win');
  assert.equal(projects.get(p.id, []).roomNoticesNow, 'each');
  assert.throws(() => projects.edit(p.id, { roomNotices: 'loud' }), /roomNotices must be auto, each, digest or named/);
  assert.equal(raw(p.id).roomNotices, 'each', 'a refused value was written');
  projects.edit(p.id, { roomNotices: 'auto' });
  assert.equal('roomNotices' in raw(p.id), false, 'auto left a stored value');
  assert.equal(projects.get(p.id, []).roomNoticesNow, 'digest');
  // CONTROL: a save naming only roomNotices is a real save, not "nothing here we can change".
  assert.doesNotThrow(() => projects.edit(p.id, { roomNotices: 'named' }));
  assert.equal(projects.get(p.id, []).roomNotices, 'named');
});

test('#7246 s2: the page paints the setting and says what Automatic gives this project now', () => {
  const SCRIPT = page.scriptOf(fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8'));
  const paint = new Function('document', page.lift(SCRIPT, 'pjPaintNoticesHint') + '\n' + page.lift(SCRIPT, 'pjPaintNoticesSelect') + '\nreturn pjPaintNoticesSelect;');
  const els = { 'pjs-notices': { value: '', dataset: {} }, 'pjs-notices-hint': { textContent: '' } };
  const fn = paint({ getElementById: (id) => els[id] || null });
  fn({ roomNotices: 'auto', roomNoticesNow: 'digest' });
  assert.equal(els['pjs-notices'].value, 'auto');
  assert.equal(els['pjs-notices'].dataset.painted, 'auto', 'the painted value was not kept for the save to compare with');
  assert.match(els['pjs-notices-hint'].textContent, /For this project now: one summary an hour\./);
  fn({ roomNotices: 'named', roomNoticesNow: 'named' });
  assert.equal(els['pjs-notices'].value, 'named');
  assert.doesNotMatch(els['pjs-notices-hint'].textContent, /For this project now/, 'a chosen mode still explained Automatic');
  fn({ roomNotices: 'weird' });
  assert.equal(els['pjs-notices'].value, 'auto', 'an unknown value was shown as chosen');
});

test('#7246 s2 review 1: the hint follows the member count by poll, without touching a choice in progress', () => {
  const SCRIPT = page.scriptOf(fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8'));
  const hintFn = new Function('document', page.lift(SCRIPT, 'pjPaintNoticesHint') + '\nreturn pjPaintNoticesHint;');
  const els = { 'pjs-notices': { value: 'auto', dataset: { painted: 'auto' } }, 'pjs-notices-hint': { textContent: '' } };
  const hint = hintFn({ getElementById: (id) => els[id] || null });
  hint({ roomNotices: 'auto', roomNoticesNow: 'each' });
  assert.match(els['pjs-notices-hint'].textContent, /each agent is told at the end of its next turn/);
  hint({ roomNotices: 'auto', roomNoticesNow: 'digest' });   // a member joined: the project crossed 8
  assert.match(els['pjs-notices-hint'].textContent, /For this project now: one summary an hour/);
  els['pjs-notices'].value = 'named';   // the person is choosing
  hint({ roomNotices: 'auto', roomNoticesNow: 'digest' });
  assert.equal(els['pjs-notices'].value, 'named', 'a poll repaint reset a choice in progress');
  // Review 2: another tab stored 'each' while this select still reads Automatic: no "for this project now" claim.
  els['pjs-notices'].value = 'auto';
  hint({ roomNotices: 'each', roomNoticesNow: 'each' });
  assert.doesNotMatch(els['pjs-notices-hint'].textContent, /For this project now/, 'the hint described a stored mode the select does not show');
  assert.match(els['pjs-notices-hint'].textContent, /^Automatic means one summary an hour/);
  // The poll calls it, so the hint follows: pinned on the source, as paintSettingsFacts needs the whole page to run.
  const facts = page.lift(SCRIPT, 'paintSettingsFacts');
  assert.match(facts, /pjPaintNoticesHint\(p\)/, 'the poll repaint does not repaint the hint');
  assert.doesNotMatch(facts, /pjPaintNoticesSelect\(/, 'the poll repaint resets the select');
  // Review 3: and it follows the person's own choice at once (a change listener on the select).
  assert.match(SCRIPT, /getElementById\('pjs-notices'\)\.addEventListener\('change', \(\) => \{[^}]*pjPaintNoticesHint\(p\)/, 'the hint waits for the poll while the person chooses');
});

test('#7246 s2 review 1: the save sends roomNotices only when THIS page changed it, never another tab\'s value back', () => {
  const SCRIPT = page.scriptOf(fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8'));
  // The save compares with what the select was painted with (pinned on the source; the save needs the live page).
  assert.match(SCRIPT, /if \(noticesSel && noticesVal !== \(noticesSel\.dataset\.painted \|\| 'auto'\)\) body\.roomNotices = noticesVal;/,
    'the save compares with the poll\'s value, so a stale tab sends its old choice back');
});

test('#7246 the busy hour, modelled on the real roomhold code: one wake per post becomes one wake an hour', async () => {
  // An idle member of a busy room: a colleague's unaddressed post every minute for an hour. A line typed to the
  // member wakes it; its turn ends a minute later in an idle report, which runs flushOnIdle (the report route), and
  // the minute sweep runs flushDigests. This counts the wakes under each mode. A MODEL of the chain the card measured
  // (one agent over 1,000 turns a day), not a measurement on a live board; slice 3 measures that.
  const MIN = 60 * 1000;
  const T = Date.parse('2026-10-27T15:00:00Z');
  const fleet = require('../test-support/fleet');
  async function hour(mode, who) {
    let wakes = 0;
    let busyUntil = -1;   // the minute its current turn ends
    const deliver = async () => { wakes += 1; return { state: 'placed' }; };
    const board = fleet.install([fleet.agent(who, { state: 'idle' })]);
    try {
      for (let m = 0; m < 60; m += 1) {
        const now = T + m * MIN;
        roomhold.hold(who, 'busy', 'm' + m);
        if (m === busyUntil) {   // the turn the last wake started ends now: the report route's flush
          const before = wakes;
          await roomhold.flushOnIdle(who, { deliver, roster: [], shownOf: () => 'Busy', DELIVERY: { COULD_NOT: 'could_not' }, modeOf: () => mode, now });
          if (wakes > before) busyUntil = m + 1;
        }
        if (m !== busyUntil) {   // the minute sweep, for a member not mid-turn
          const before = wakes;
          await roomhold.flushDigests(board.agents, { readReport: () => ({ found: true, state: 'idle', by: 'auto', at: new Date(now).toISOString() }),
            now, decayMs: 15 * MIN, deliver, DELIVERY: { COULD_NOT: 'could_not' }, shownOf: () => 'Busy', modeOf: () => mode, addressable: () => ({ ok: true }) });
          if (wakes > before) busyUntil = m + 1;
        }
        if (mode === 'each' && m === 0) { wakes += 1; busyUntil = 1; }   // 'each': the first post's line starts the chain
      }
    } finally { board.restore(); }
    return wakes;
  }
  const each = await hour('each', 'modeleach');
  const digest = await hour('digest', 'modeldigest');
  assert.ok(each >= 25, 'CONTROL: the each-mode chain did not keep the member awake (' + each + ' wakes in the hour)');
  assert.ok(digest <= 2, 'the digest still woke the member ' + digest + ' times in the hour');
  console.log('busy-hour model: each=' + each + ' wakes, digest=' + digest);
});
