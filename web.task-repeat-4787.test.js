'use strict';
/* kosmos#4787: the Tasks row's repeat line, from the page's real functions (tskRepeatSentence, tskRow).
   The rule's words and the next run come from the board; the page only says them. */
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const page = require('./test-support/page');

const SCRIPT = page.scriptOf(fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8'));
const { tskRepeatSentence, tskRepeatMissed } = new Function('tskAgentName',
  page.liftAll(SCRIPT, ['agoWords', 'tskRepeatMissed', 'tskRepeatSentence']) + '\nreturn { tskRepeatSentence, tskRepeatMissed };')((s) => (s === 'ada' ? 'Ada' : s));
const at = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi, 0, 0).getTime();
const NOW = at(2026, 10, 6, 8, 0);   // a Tuesday, 8am local

test('#4787: the sentence says the rule, the last run (who, when, its note) and the next run; with no run it says so', () => {
  const t = { repeat: { every: 'day', at: '09:00' }, repeatWords: 'every day at 9am', repeatNextAt: at(2026, 10, 6, 9, 0), repeatNextWords: 'today at 9am',
    lastRunAt: new Date(NOW - 2 * 3600000).toISOString(), lastRunBy: 'ada', lastRunNote: 'found 3 new listings' };
  assert.equal(tskRepeatSentence(t, NOW), 'Repeats every day at 9am. Last run 2 hours ago by Ada: found 3 new listings. Next today at 9am.');
  assert.equal(tskRepeatSentence({ ...t, lastRunAt: undefined, lastRunBy: undefined, lastRunNote: undefined }, NOW),
    'Repeats every day at 9am. No run reported yet. Next today at 9am.');
  assert.equal(tskRepeatSentence({ ...t, lastRunBy: undefined, lastRunByPerson: true, lastRunNote: undefined }, NOW), 'Repeats every day at 9am. Last run 2 hours ago by you. Next today at 9am.');
  assert.equal(tskRepeatSentence({ ...t, lastRunBy: 'operator', lastRunNote: undefined }, NOW), 'Repeats every day at 9am. Last run 2 hours ago by operator. Next today at 9am.',
    'review 5: an agent named operator is not the person');
});

test('#4787: a repeating task\'s row carries the line; a one-off and a closed one do not (controls)', () => {
  const row = (t) => new Function('TSK', 'LAST', 'esc', 'agoWords', 'tskKey', 'claimNotReported', 'tskAgentName', 'tskRepeatSentence', 'tskRepeatMissed', 'TSK_GROUPS',
    page.liftAll(SCRIPT, ['tskRow']) + '\nreturn tskRow;')({ sel: new Set(), by: 'status', fold: new Set() }, [], (s) => String(s), () => 'just now',
    (x) => x.projectId + '#' + x.number, () => '', (s) => s, tskRepeatSentence, tskRepeatMissed, [])(t, { depth: 0, crumb: false, kids: 0 });
  const base = { number: 4, sentence: 'Hourly monitor', projectId: 'p1', projectName: 'Watch', createdAt: new Date(NOW).toISOString(), state: 'assigned', who: 'ada' };
  const rep = { ...base, repeat: { every: 'hour' }, repeatWords: 'every hour', repeatNextAt: at(2026, 10, 6, 9, 0), repeatNextWords: 'today at 9am' };
  assert.match(row(rep), /<div class="why tsk-repeat">Repeats every hour\. No run reported yet\. Next today at 9am\.<\/div>/);
  assert.doesNotMatch(row(base), /tsk-repeat/);
  assert.doesNotMatch(row({ ...rep, state: 'closed' }), /tsk-repeat/);
});

test('#4787 slice 1b: the task page reads a stored rule back into its controls (Sunday is 0; an hourly rule at any minute reads as Every hour)', () => {
  const SRC = page.scriptOf(fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8'));
  const days = /const TK_REPEAT_DAYS = (\[[^\]]+\]);/.exec(SRC);
  assert.ok(days, 'the page names its days');
  const stored = new Function('TK_REPEAT_DAYS', page.liftAll(SRC, ['tkRepeatStoredChoice']) + '\nreturn tkRepeatStoredChoice;')(eval(days[1]));
  assert.deepEqual(stored({ repeat: { every: 'week', day: 0, at: '09:30' } }), { every: 'week', on: 'sun', at: '09:30' });
  assert.deepEqual(stored({ repeat: { every: 'week', day: 2, at: '10:30' } }), { every: 'week', on: 'tue', at: '10:30' });
  assert.deepEqual(stored({ repeat: { every: 'day', at: '08:15' } }), { every: 'day', at: '08:15' });
  assert.deepEqual(stored({ repeat: { every: 'hour', minute: 30 } }), { every: 'hour' });
  assert.deepEqual(stored({}), { clear: true }, 'CONTROL: no rule reads as Never');
  // The page's day names are the ones the server reads (fromWords takes the first three letters).
  const { DAY_NAMES } = require('./engine/taskrepeat');
  assert.deepEqual(eval(days[1]), DAY_NAMES.map((n) => n.slice(0, 3).toLowerCase()));
});

test('#4787 slice 2: a missed run leads the sentence; more than one is counted; a late run says late (controls: none missed, on time)', () => {
  const t = { repeat: { every: 'day', at: '09:00' }, repeatWords: 'every day at 9am', repeatNextWords: 'tomorrow at 9am',
    lastRunAt: new Date(NOW - 26 * 3600000).toISOString(), lastRunBy: 'ada' };
  assert.match(tskRepeatSentence({ ...t, repeatMissed: 1, repeatMissedMore: false, repeatMissedWords: 'today at 9am' }, NOW),
    /^Missed the run due today at 9am\. Repeats every day at 9am\. Last run .+ by Ada\. Next tomorrow at 9am\.$/);
  assert.match(tskRepeatSentence({ ...t, repeatMissed: 3, repeatMissedMore: false, repeatMissedWords: 'today at 9am' }, NOW),
    /^Missed 3 runs, the latest due today at 9am\. Repeats every day at 9am\./);
  assert.match(tskRepeatSentence({ ...t, repeatMissed: 99, repeatMissedMore: true, repeatMissedWords: 'today at 9am' }, NOW),
    /^Missed more than 99 runs, the latest due today at 9am\./);
  assert.match(tskRepeatSentence(t, NOW), /^Repeats every day at 9am\./, 'CONTROL: nothing missed, nothing said about it');
  assert.match(tskRepeatSentence({ ...t, lastRunLate: true, lastRunNote: 'done' }, NOW), / by Ada, late: done\./);
  assert.doesNotMatch(tskRepeatSentence({ ...t, lastRunNote: 'done' }, NOW), /late/, 'CONTROL: an on-time run never says late');
  // #5444: a miss with no run ever reported says the miss once, not "No run reported yet" after it.
  const never = { ...t, lastRunAt: undefined, lastRunBy: undefined };
  assert.equal(tskRepeatSentence({ ...never, repeatMissed: 3, repeatMissedMore: false, repeatMissedWords: 'today at 9am' }, NOW),
    'Missed 3 runs, the latest due today at 9am. Repeats every day at 9am. Next tomorrow at 9am.');
  assert.equal(tskRepeatSentence(never, NOW), 'Repeats every day at 9am. No run reported yet. Next tomorrow at 9am.',
    'CONTROL: with nothing missed, a task never run still says so');
});

test('#4787 slice 2: the row\'s repeat line is red (class missed) only while a run is missed', () => {
  const row = (t) => new Function('TSK', 'LAST', 'esc', 'agoWords', 'tskKey', 'claimNotReported', 'tskAgentName', 'tskRepeatSentence', 'tskRepeatMissed', 'TSK_GROUPS',
    page.liftAll(SCRIPT, ['tskRow']) + '\nreturn tskRow;')({ sel: new Set(), by: 'status', fold: new Set() }, [], (s) => String(s), () => 'just now',
    (x) => x.projectId + '#' + x.number, () => '', (s) => s, tskRepeatSentence, tskRepeatMissed, [])(t, { depth: 0, crumb: false, kids: 0 });
  const rep = { number: 4, sentence: 'Daily report', projectId: 'p1', projectName: 'Watch', createdAt: new Date(NOW).toISOString(), state: 'assigned', who: 'ada',
    repeat: { every: 'day', at: '09:00' }, repeatWords: 'every day at 9am', repeatNextWords: 'today at 9am' };
  assert.match(row({ ...rep, repeatMissed: 1, repeatMissedWords: 'yesterday at 9am' }), /<div class="why tsk-repeat missed">Missed the run due yesterday at 9am\./);
  assert.match(row(rep), /<div class="why tsk-repeat">Repeats/, 'CONTROL: not missed, not red');
  // The page's rule is wired to a colour (the class alone would do nothing).
  assert.match(fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8'), /\.tsk-row \.why\.tsk-repeat\.missed, #tk-repeat-line\.missed \{ color: var\(--danger\); \}/);
});

test('#4787 slice 2 review 5: an open Tasks view reads again once a shown slot passes its miss grace, and every 5 minutes while a row is red', () => {
  const stale = new Function(page.liftAll(SCRIPT, ['tskRepeatStale']) + '\nreturn tskRepeatStale;')();
  const read = at(2026, 10, 6, 8, 0);
  const row = { repeat: { every: 'day', at: '09:00' }, state: 'assigned', repeatMissAfter: at(2026, 10, 6, 9, 15) };
  assert.equal(stale([row], read, at(2026, 10, 6, 9, 14)), false, 'before the slot is missed: no read');
  assert.equal(stale([row], read, at(2026, 10, 6, 9, 15)), true, 'once it is: read');
  assert.equal(stale([{ ...row, state: 'closed' }], read, at(2026, 10, 6, 9, 15)), false, 'CONTROL: a closed row never asks');
  assert.equal(stale([{ sentence: 'one-off', state: 'assigned' }], read, at(2026, 10, 6, 9, 15)), false, 'CONTROL: a one-off never asks');
  const red = { ...row, repeatMissAfter: at(2026, 10, 7, 9, 15), repeatMissed: 1 };
  assert.equal(stale([red], read, read + 4 * 60000), false, 'red: not within 5 minutes of the last read');
  assert.equal(stale([red], read, read + 5 * 60000), true, 'red: read again after 5 minutes, so a reported run clears it');
  assert.equal(stale([row], at(2026, 10, 6, 9, 15), at(2026, 10, 6, 9, 15) + 10000), false, 'at most one read per 30 seconds');
  // Wired: the board poll's tskRosterChanged asks it, with the time of the last good read.
  assert.match(page.liftAll(SCRIPT, ['tskRosterChanged']), /tskRepeatStale\(TSK\.data, TSK\.readAt, Date\.now\(\)\)\) \{ tskLoad\(\); return; \}/);
  const load = page.liftAll(SCRIPT, ['tskLoad']);
  const stamp = load.indexOf('TSK.readAt = Date.now();');
  assert.ok(stamp > 0 && stamp < load.indexOf('await fetch('), 'review 6: a read stamps readAt when it STARTS, before it fetches');
  assert.equal(load.split('TSK.readAt =').length, 2, 'and only there');
});

test('#4787 slice 3: the task page\'s reviewer choice: Nobody, Me and the project\'s agents, showing what is stored; hidden for a one-off', () => {
  const el = (id) => ({ id, hidden: true, textContent: '', value: '', dataset: {}, children: [], disabled: false,
    appendChild(o) { this.children.push(o); }, set textContent(v) { this._t = v; if (v === '') this.children = []; }, get textContent() { return this._t || ''; } });
  const els = { 'tk-review-row': el('tk-review-row'), 'tk-review-who': el('tk-review-who'), 'tk-review-msg': el('tk-review-msg') };
  const doc = { activeElement: null, getElementById: (id) => els[id] || null, createElement: () => ({ value: '', textContent: '' }) };
  const paint = new Function('document', 'TK_ACT', 'tskAgentName', page.liftAll(SCRIPT, ['tkReviewerOf', 'tkPaintReviewer']) + '\nreturn tkPaintReviewer;')(doc, 'close', (s) => ({ ada: 'Ada', rex: 'Rex' }[s] || s));
  const p = { id: 'p1', agents: ['ada', 'rex'] };
  paint(p, { number: 4 });
  assert.equal(els['tk-review-row'].hidden, true, 'a one-off task has no reviewer choice');
  const t = { number: 4, repeat: { every: 'day', at: '09:00' }, repeatReviewer: 'rex' };
  paint(p, t);
  const sel = els['tk-review-who'];
  assert.equal(els['tk-review-row'].hidden, false);
  assert.deepEqual(sel.children.map((o) => o.value + '=' + o.textContent), ['none=Nobody', 'me=Me', 'ada=Ada', 'rex=Rex']);
  assert.equal(sel.value, 'rex');
  paint(p, { ...t, repeatReviewer: undefined, repeatReviewerPerson: true });
  assert.equal(sel.value, 'me');
  // A stored reviewer who left the project stays listed, so the select never shows a choice that is not stored.
  paint({ id: 'p1', agents: ['ada'] }, t);
  assert.equal(sel.value, 'rex');
  assert.ok(sel.children.some((o) => o.value === 'rex' && o.textContent === 'Rex (left the project)'), 'review 12: it says so');
  assert.ok(!sel.children.some((o) => o.value === 'ada' && /left/.test(o.textContent)), 'CONTROL: a member is not marked');
  // Under the person's own focus it is not repainted; forced (its own answer) it is.
  doc.activeElement = sel; sel.value = 'ada';
  paint(p, { ...t, repeatReviewer: 'rex' });
  assert.equal(sel.value, 'ada', 'not repainted under focus');
  delete sel.dataset.sig;
  paint(p, { ...t, repeatReviewer: 'rex' }, true);
  assert.equal(sel.value, 'rex', 'forced: back to what is stored (a refusal puts it back)');
});

test('#4787 slice 3 review 5: the task history says the reviewer and a missed run in words, never the raw kind', () => {
  const phrase = new Function('tkMemberName', page.liftAll(SCRIPT, ['tkActPhrase']) + '\nreturn tkActPhrase;')((p, sn) => ({ ada: 'Ada' }[sn] || sn));
  const p = { id: 'p1' };
  assert.equal(phrase({ kind: 'reviewer-set', who: 'ada' }, p), 'Ada will be told if a run is missed');
  assert.equal(phrase({ kind: 'reviewer-set', person: true }, p), 'You will be told if a run is missed');
  assert.equal(phrase({ kind: 'reviewer-cleared' }, p), 'Nobody is told now if a run is missed');
  assert.equal(phrase({ kind: 'missed', count: 1, told: 'ada', reached: true }, p), 'A run was missed; Ada was told');
  assert.equal(phrase({ kind: 'missed', count: 3, told: 'ada', reached: false }, p), '3 runs missed; Kosmos could not reach Ada');
  assert.equal(phrase({ kind: 'missed', count: 1, person: true }, p), 'A run was missed; you review it');
});

test('#4787 slice 3 review 6: a capped miss reads "More than 99"; a finished task hides the reviewer row', () => {
  const phrase = new Function('tkMemberName', page.liftAll(SCRIPT, ['tkActPhrase']) + '\nreturn tkActPhrase;')((p, sn) => sn);
  assert.equal(phrase({ kind: 'missed', count: 99, more: true, person: true }, { id: 'p1' }), 'More than 99 runs missed; you review it');
  const el = (id) => ({ id, hidden: false, textContent: '', value: '', dataset: {}, children: [], appendChild(o) { this.children.push(o); } });
  const els = { 'tk-review-row': el('tk-review-row'), 'tk-review-who': el('tk-review-who'), 'tk-review-msg': el('tk-review-msg') };
  const doc = { activeElement: null, getElementById: (id) => els[id] || null, createElement: () => ({ value: '', textContent: '' }) };
  const paint = new Function('document', 'TK_ACT', 'tskAgentName', page.liftAll(SCRIPT, ['tkReviewerOf', 'tkPaintReviewer']) + '\nreturn tkPaintReviewer;')(doc, 'reopen', (s) => s);
  paint({ id: 'p1', agents: ['ada'] }, { number: 4, repeat: { every: 'day', at: '09:00' }, repeatReviewer: 'ada' });
  assert.equal(els['tk-review-row'].hidden, true, 'a finished task (TK_ACT reopen) shows no reviewer row');
  // And tkPaintRepeat's early return for a finished task still reaches it.
  const src = page.liftAll(SCRIPT, ['tkPaintRepeat']);
  assert.match(src, /if \(done\) \{[^\n]*tkPaintReviewer\(p, t\); return; \}/);
});

test('#5752 round 1: the Mac and Windows CLI help say the several-times form the same way', () => {
  const line = '--at <HH:MM>  (several a day: --at 09:00,21:00; hourly: --at :MM)';
  assert.ok(fs.readFileSync(path.join(__dirname, 'install', 'kosmos'), 'utf8').includes(line), 'install/kosmos');
  assert.ok(fs.readFileSync(path.join(__dirname, 'tools', 'windows', 'kosmos-cli.js'), 'utf8').includes(line), 'tools/windows/kosmos-cli.js');
});

test('#5752: a twice-daily rule round-trips through the task page\'s Repeats control; the time box moves the first time and keeps the others', () => {
  const SRC = page.scriptOf(fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8'));
  const days = /const TK_REPEAT_DAYS = (\[[^\]]+\]);/.exec(SRC);
  const els = { 'tk-repeat-every': { value: '', dataset: {} }, 'tk-repeat-at': { value: '', dataset: {} }, 'tk-repeat-day': { value: 'mon', dataset: {} } };
  const document = { getElementById: (id) => els[id] };
  const f = new Function('TK_REPEAT_DAYS', 'document', page.liftAll(SRC, ['tkRepeatStoredChoice', 'tkRepeatChoice', 'tkRepeatFillAt', 'tkRepeatKeepOthers'])
    + '\nreturn { tkRepeatStoredChoice, tkRepeatChoice, tkRepeatFillAt };')(eval(days[1]), document);
  const t = { repeat: { every: 'day', at: ['09:00', '21:00'] } };
  const stored = f.tkRepeatStoredChoice(t);
  assert.deepEqual(stored, { every: 'day', at: '09:00,21:00' }, 'the comma list the route reads');
  // Painted as the page paints it: Every day, the box shows the first time.
  els['tk-repeat-every'].value = 'day';
  f.tkRepeatFillAt(stored.at);
  assert.equal(els['tk-repeat-at'].value, '09:00');
  assert.deepEqual(f.tkRepeatChoice(), stored, 'untouched, the choice IS the stored list (Save stays off; nothing is dropped)');
  els['tk-repeat-at'].value = '08:00';
  assert.deepEqual(f.tkRepeatChoice(), { every: 'day', at: '08:00,21:00' }, 'round 1: moving the first time keeps the other');
  els['tk-repeat-at'].value = '22:00';
  assert.deepEqual(f.tkRepeatChoice(), { every: 'day', at: '21:00,22:00' }, 'sorted, whichever way it moves');
  els['tk-repeat-at'].value = '21:00';
  assert.deepEqual(f.tkRepeatChoice(), { every: 'day', at: '21:00' }, 'moved onto the other: one time, said once');
  els['tk-repeat-every'].value = 'week';
  els['tk-repeat-at'].value = '09:00';
  assert.deepEqual(f.tkRepeatChoice(), { every: 'week', on: 'mon', at: '09:00' }, 'another frequency takes the box\'s one time');
  // CONTROL: a one-time rule forgets the list, so its own 09:00 is just 09:00.
  f.tkRepeatFillAt('09:00');
  els['tk-repeat-every'].value = 'day';
  assert.equal(els['tk-repeat-at'].dataset.others, undefined);
  assert.deepEqual(f.tkRepeatChoice(), { every: 'day', at: '09:00' });
});

test('#5752 round 2: after a Save the remembered list is the saved one, so the next edit never brings back a removed time', () => {
  const SRC = page.scriptOf(fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8'));
  const days = /const TK_REPEAT_DAYS = (\[[^\]]+\]);/.exec(SRC);
  const els = { 'tk-repeat-every': { value: 'day', dataset: {} }, 'tk-repeat-at': { value: '', dataset: {} }, 'tk-repeat-day': { value: 'mon', dataset: {} } };
  const document = { getElementById: (id) => els[id] };
  const f = new Function('TK_REPEAT_DAYS', 'document', page.liftAll(SRC, ['tkRepeatStoredChoice', 'tkRepeatChoice', 'tkRepeatFillAt', 'tkRepeatKeepOthers', 'tkRepeatSaved', 'tkRepeatShowChoice', 'tkRepeatFollowUnderEdit'])
    + '\nreturn { tkRepeatStoredChoice, tkRepeatChoice, tkRepeatFillAt, tkRepeatSaved, tkRepeatFollowUnderEdit };')(eval(days[1]), document);
  const box = els['tk-repeat-at'];
  // 1: 9am and 9pm, the person moves the morning run onto 9pm (one time), saves, then picks 10am: 10am alone.
  f.tkRepeatFillAt('09:00,21:00');
  box.value = '21:00';
  f.tkRepeatSaved(f.tkRepeatChoice(), els['tk-repeat-at'].value);
  assert.equal(els['tk-repeat-every'].dataset.stored, JSON.stringify({ every: 'day', at: '21:00' }));
  box.value = '10:00';
  assert.deepEqual(f.tkRepeatChoice(), { every: 'day', at: '10:00' });
  // 2: three times, the first moved onto the second and saved: the next edit moves the first of the TWO left.
  f.tkRepeatFillAt('09:00,13:00,21:00');
  box.value = '13:00';
  f.tkRepeatSaved(f.tkRepeatChoice(), els['tk-repeat-at'].value);
  box.value = '14:00';
  assert.deepEqual(f.tkRepeatChoice(), { every: 'day', at: '14:00,21:00' });
  // 3: saved as weekly: no list is remembered for when it goes back to daily.
  f.tkRepeatFillAt('09:00,21:00');
  els['tk-repeat-every'].value = 'week';
  f.tkRepeatSaved(f.tkRepeatChoice(), els['tk-repeat-at'].value);
  els['tk-repeat-every'].value = 'day';
  assert.deepEqual(f.tkRepeatChoice(), { every: 'day', at: '09:00' });
  // The Save handler is what calls it (a page reader, so a rename that leaves the handler on the old line is seen).
  assert.match(SRC, /if \(still\(\)\) tkRepeatSaved\(sent, boxAtSend\);/);
  // Round 3: the box's time moved PAST another one and saved: Save is off afterwards (the choice is what is stored),
  // and a second click could not drop a time.
  els['tk-repeat-every'].value = 'day';
  f.tkRepeatFillAt('09:00,21:00');
  box.value = '22:00';
  const sent = f.tkRepeatChoice();
  assert.deepEqual(sent, { every: 'day', at: '21:00,22:00' });
  f.tkRepeatSaved(sent, box.value);
  assert.deepEqual(f.tkRepeatChoice(), f.tkRepeatStoredChoice({ repeat: { every: 'day', at: ['21:00', '22:00'] } }), 'unchanged after the save');
  box.value = '23:00';
  assert.deepEqual(f.tkRepeatChoice(), { every: 'day', at: '21:00,23:00' }, 'the next edit moves the box\'s own time, not 21:00');
});

test('#5752 round 3: a rule an agent changes under the person\'s unsaved edit: the edit stands and the others follow the new rule', () => {
  const SRC = page.scriptOf(fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8'));
  const days = /const TK_REPEAT_DAYS = (\[[^\]]+\]);/.exec(SRC);
  const els = { 'tk-repeat-every': { value: 'day', dataset: {} }, 'tk-repeat-at': { value: '', dataset: {} }, 'tk-repeat-day': { value: 'mon', dataset: {} } };
  const document = { getElementById: (id) => els[id] };
  const f = new Function('TK_REPEAT_DAYS', 'document', page.liftAll(SRC, ['tkRepeatStoredChoice', 'tkRepeatChoice', 'tkRepeatFillAt', 'tkRepeatKeepOthers', 'tkRepeatFollowUnderEdit'])
    + '\nreturn { tkRepeatChoice, tkRepeatFillAt, tkRepeatFollowUnderEdit };')(eval(days[1]), document);
  const box = els['tk-repeat-at'];
  f.tkRepeatFillAt('09:00,21:00');
  box.value = '10:00';   // unsaved
  assert.deepEqual(f.tkRepeatChoice(), { every: 'day', at: '10:00,21:00' }, 'precondition: the edit keeps 9pm');
  f.tkRepeatFollowUnderEdit({ repeat: { every: 'day', at: '09:00' } });
  assert.deepEqual(f.tkRepeatChoice(), { every: 'day', at: '10:00' }, 'the agent dropped 9pm: Save would not bring it back');
  f.tkRepeatFollowUnderEdit({ repeat: { every: 'day', at: ['08:00', '20:00'] } });
  assert.deepEqual(f.tkRepeatChoice(), { every: 'day', at: '10:00,20:00' }, 'the box stands for the new first time, the rest kept');
  f.tkRepeatFollowUnderEdit({ repeat: { every: 'week', day: 1, at: '09:00' } });
  assert.deepEqual(f.tkRepeatChoice(), { every: 'day', at: '10:00' }, 'a weekly rule has no other daily times');
  // tkPaintRepeat calls it when the stored rule moved and the person's edit was kept.
  assert.match(SRC, /\} else if \(every\.dataset\.stored !== stored\) tkRepeatFollowUnderEdit\(t\);/);
});

test('#5752 round 3: through the page\'s own paint loop: Save goes dark after a save, and a later agent change is followed', () => {
  const SRC = page.scriptOf(fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8'));
  const days = /const TK_REPEAT_DAYS = (\[[^\]]+\]);/.exec(SRC);
  const el = () => ({ value: '', dataset: {}, hidden: false, disabled: false, textContent: '', classList: { toggle() {} } });
  const els = {};
  for (const id of ['tk-repeat-row', 'tk-repeat-when', 'tk-repeat-line', 'tk-repeat-msg', 'tk-repeat-every', 'tk-repeat-at', 'tk-repeat-day', 'tk-repeat-save']) els[id] = el();
  const document = { getElementById: (id) => els[id], querySelector: () => el() };
  const f = new Function('TK_REPEAT_DAYS', 'document', 'TK_ACT', 'tkPaintReviewer', 'tskRepeatSentence', 'tskRepeatMissed',
    page.liftAll(SRC, ['tkRepeatStoredChoice', 'tkRepeatChoice', 'tkRepeatFillAt', 'tkRepeatKeepOthers', 'tkRepeatSaved', 'tkRepeatShowChoice', 'tkRepeatFollowUnderEdit',
      'tkRepeatShowWhen', 'tkRepeatDirty', 'tkPaintRepeat'])
    + '\nreturn { tkRepeatChoice, tkRepeatSaved, tkPaintRepeat };')(eval(days[1]), document, '', () => {}, () => '', () => false);
  const p = { id: 'p1' };
  const task = (at) => ({ number: 3, repeat: { every: 'day', at } });
  const save = els['tk-repeat-save'];
  f.tkPaintRepeat(p, task(['09:00', '21:00']));
  assert.equal(els['tk-repeat-at'].value, '09:00');
  assert.equal(save.disabled, true, 'nothing changed: Save is off');
  els['tk-repeat-at'].value = '22:00';
  f.tkPaintRepeat(p, task(['09:00', '21:00']));   // the poll during the edit
  assert.equal(els['tk-repeat-at'].value, '22:00', 'the poll keeps the edit');
  assert.equal(save.disabled, false);
  f.tkRepeatSaved(f.tkRepeatChoice(), els['tk-repeat-at'].value);
  f.tkPaintRepeat(p, task(['21:00', '22:00']));   // the repaint after pjReload
  assert.equal(save.disabled, true, 'after the save, Save is off (round 3: it stayed lit and a second click dropped 9pm)');
  f.tkPaintRepeat(p, task(['07:00']));   // an agent changes it
  assert.equal(els['tk-repeat-at'].value, '07:00', 'and a later agent change is followed (round 3: the control froze)');
  assert.equal(save.disabled, true);
  // Mid-edit agent change: the edit stands, Save sends only what is on screen.
  els['tk-repeat-at'].value = '10:00';
  f.tkPaintRepeat(p, task(['07:00']));
  f.tkPaintRepeat(p, task(['06:00', '18:00']));
  assert.equal(els['tk-repeat-at'].value, '10:00');
  assert.deepEqual(f.tkRepeatChoice(), { every: 'day', at: '10:00,18:00' });
});

test('#5752 round 4: the box changed between pressing Save and the answer: the controls show what was saved, and Save goes dark', () => {
  const SRC = page.scriptOf(fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8'));
  const days = /const TK_REPEAT_DAYS = (\[[^\]]+\]);/.exec(SRC);
  const el = () => ({ value: '', dataset: {}, hidden: false, disabled: false, textContent: '', classList: { toggle() {} } });
  const els = {};
  for (const id of ['tk-repeat-row', 'tk-repeat-when', 'tk-repeat-line', 'tk-repeat-msg', 'tk-repeat-every', 'tk-repeat-at', 'tk-repeat-day', 'tk-repeat-save']) els[id] = el();
  const document = { getElementById: (id) => els[id], querySelector: () => el() };
  const f = new Function('TK_REPEAT_DAYS', 'document', 'TK_ACT', 'tkPaintReviewer', 'tskRepeatSentence', 'tskRepeatMissed',
    page.liftAll(SRC, ['tkRepeatStoredChoice', 'tkRepeatChoice', 'tkRepeatFillAt', 'tkRepeatKeepOthers', 'tkRepeatSaved', 'tkRepeatShowChoice',
      'tkRepeatFollowUnderEdit', 'tkRepeatShowWhen', 'tkRepeatDirty', 'tkPaintRepeat'])
    + '\nreturn { tkRepeatChoice, tkRepeatSaved, tkPaintRepeat };')(eval(days[1]), document, '', () => {}, () => '', () => false);
  const p = { id: 'p1' };
  const task = (number, at) => ({ number, repeat: { every: 'day', at } });
  const box = els['tk-repeat-at'];
  const save = els['tk-repeat-save'];
  // 1: away and back while the save is in flight: repainted from the OLD rule (box 09:00).
  f.tkPaintRepeat(p, task(3, ['09:00', '21:00']));
  box.value = '10:00';
  const sent = f.tkRepeatChoice();
  const boxAtSend = box.value;
  f.tkPaintRepeat(p, task(4, '12:00'));
  f.tkPaintRepeat(p, task(3, ['09:00', '21:00']));
  assert.equal(box.value, '09:00', 'precondition: the controls were repainted from the old rule');
  f.tkRepeatSaved(sent, boxAtSend);
  f.tkPaintRepeat(p, task(3, ['10:00', '21:00']));   // after pjReload
  assert.equal(box.value, '10:00', 'the controls show what was saved');
  assert.deepEqual(f.tkRepeatChoice(), { every: 'day', at: '10:00,21:00' }, 'never a third time (round 4: 09:00,10:00,21:00)');
  assert.equal(save.disabled, true);
  // 2: typed during the save: replaced by what was saved, visibly, and Save is dark.
  box.value = '11:00';
  const sent2 = f.tkRepeatChoice();
  const at2 = box.value;
  box.value = '11:30';
  f.tkRepeatSaved(sent2, at2);
  f.tkPaintRepeat(p, task(3, ['11:00', '21:00']));
  assert.equal(box.value, '11:00');
  assert.equal(save.disabled, true);
  // 3 (round 5): away and back with only the FREQUENCY repainted: twice daily changed to weekly; the box still 09:00.
  f.tkPaintRepeat(p, task(5, ['09:00', '21:00']));
  els['tk-repeat-every'].value = 'week';
  const sent4 = f.tkRepeatChoice();
  const at4 = box.value;
  assert.deepEqual(sent4, { every: 'week', on: 'mon', at: '09:00' });
  f.tkPaintRepeat(p, task(4, '12:00'));
  f.tkPaintRepeat(p, task(5, ['09:00', '21:00']));
  assert.equal(els['tk-repeat-every'].value, 'day', 'precondition: repainted as daily');
  assert.equal(box.value, at4, 'precondition: the box did not change');
  f.tkRepeatSaved(sent4, at4);
  f.tkPaintRepeat(p, { number: 5, repeat: { every: 'week', day: 1, at: '09:00' } });
  assert.equal(els['tk-repeat-every'].value, 'week', 'the controls show the weekly rule that was saved');
  assert.deepEqual(f.tkRepeatChoice(), sent4, 'never daily 09:00 alone (round 5: 21:00 lost)');
  assert.equal(save.disabled, true);
  // 4 (round 5): only the DAY repainted: weekly Monday changed to Wednesday.
  f.tkPaintRepeat(p, { number: 6, repeat: { every: 'week', day: 1, at: '09:00' } });
  els['tk-repeat-day'].value = 'wed';
  const sent5 = f.tkRepeatChoice();
  f.tkPaintRepeat(p, task(4, '12:00'));
  f.tkPaintRepeat(p, { number: 6, repeat: { every: 'week', day: 1, at: '09:00' } });
  f.tkRepeatSaved(sent5, box.value);
  f.tkPaintRepeat(p, { number: 6, repeat: { every: 'week', day: 3, at: '09:00' } });
  assert.equal(els['tk-repeat-day'].value, 'wed');
  assert.equal(save.disabled, true);
  f.tkPaintRepeat(p, task(3, ['11:00', '21:00']));   // back on task 3 as the earlier arms left it
  // CONTROL: nothing moved during the save: the box is left as the person put it.
  box.value = '22:00';
  const sent3 = f.tkRepeatChoice();
  f.tkRepeatSaved(sent3, box.value);
  f.tkPaintRepeat(p, task(3, ['21:00', '22:00']));
  assert.equal(box.value, '22:00');
  assert.equal(save.disabled, true);
});
