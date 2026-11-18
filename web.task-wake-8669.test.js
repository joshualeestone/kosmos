'use strict';
/* kosmos#8669: the Tasks row and the task page say what a task waits for (kosmos task wake), or what it woke on and
   whether its holder was told, in the board's own words (taskwake.fieldsOf). From the page's real tskRow and
   tskWakeSentence, lifted together (as web.task-landed-7508.test.js lifts tskRow). */
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const page = require('./test-support/page');
const taskwake = require('./engine/taskwake');

const HTML = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = page.scriptOf(HTML);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const sentence = new Function(page.liftAll(SCRIPT, ['asSentence', 'tskWakeSentence']) + '\nreturn tskWakeSentence;')();
const rowWith = (withSentence) => (t) => new Function('TSK', 'LAST', 'esc', 'agoWords', 'tskKey', 'claimNotReported', 'tskAgentName', 'tskRepeatSentence', 'tskRepeatMissed', 'TSK_GROUPS',
  page.liftAll(SCRIPT, ['pjChainText', 'pjChainSpoken', 'tskChainOf', 'tskRow', ...(withSentence ? ['asSentence', 'tskWakeSentence'] : [])]) + '\nreturn tskRow;')({ sel: new Set(), by: 'status', fold: new Set() }, [],
  esc, () => 'just now', (x) => x.projectId + '#' + x.number, () => '', (s) => s, () => '', () => false, [])(t, { depth: 0, crumb: false, kids: 0 });
const row = rowWith(true);
const base = { number: 7, sentence: 'Re-check after the refresh', projectId: 'p1', projectName: 'Alpha', createdAt: new Date().toISOString(), state: 'assigned', who: 'ada' };
/* The fields as the board sends them, from the engine's own derivation, so the page is tested on real words. */
const fields = (t) => taskwake.fieldsOf(t);
const prWake = { kind: 'pr', repo: 'octo/hello', number: 12, setAt: '2026-11-17T10:00:00.000Z', setBy: 'ada' };

test('#8669: an open row says what it waits for, in the board\'s words', () => {
  const t = { ...base, ...fields({ ...base, wake: prWake }) };
  assert.match(row(t), /<div class="why tsk-wake">Waits for PR #12 in octo\/hello to merge or close\.<\/div>/);
  const problem = { ...base, ...taskwake.fieldsOf({ ...base, wake: prWake }, Date.now(), 'GitHub could not be reached just now') };
  assert.match(row(problem), /Waits for PR #12 in octo\/hello to merge or close\. Not checked just now: GitHub could not be reached just now\.<\/div>/);
});

test('#8669: a row that woke says on what, and whether its holder was told', () => {
  const met = { ...base, wake: prWake, wakeMet: { at: new Date().toISOString(), words: 'it was merged' } };
  assert.match(row({ ...base, ...fields(met) }), /Woke: PR #12 in octo\/hello: it was merged\. Its holder is still to be told\./);
  assert.match(row({ ...base, ...fields({ ...met, wakeToldAt: new Date().toISOString(), wakeTold: { who: 'ada', reached: true } }) }), /Woke: PR #12 in octo\/hello: it was merged\. Its holder was told\./);
  assert.match(row({ ...base, ...fields({ ...met, wakeToldAt: new Date().toISOString(), wakeTold: { who: 'ada', reached: false } }) }), /Its holder could not be reached\./);
});

test('#8669: a file wake names the file, escaped; a closed row and a row with none draw no line (controls)', () => {
  const t = { ...base, ...fields({ ...base, wake: { kind: 'file', name: '<b>plan</b>.md', from: 'stat:1:2', setAt: 'x' } }) };
  assert.match(row(t), /Waits for &lt;b&gt;plan&lt;\/b&gt;\.md to change\./);
  assert.doesNotMatch(row(t), /<b>plan/, 'a file name was drawn as markup');
  assert.doesNotMatch(row(base), /tsk-wake/);
  assert.doesNotMatch(row({ ...base, state: 'closed', wakeWords: 'waits for PR #12 in octo/hello to merge or close' }), /tsk-wake/);
  // CONTROL: without the sentence lifted (the old tests' shape), the row still draws, with no wake line.
  assert.doesNotMatch(rowWith(false)({ ...base, wakeWords: 'waits for PR #12 in octo/hello to merge or close' }), /tsk-wake/);
});

test('#8669: the task page has a place for the line, painted from the same sentence', () => {
  assert.match(HTML, /<p class="dhint" id="tk-wake-line"[^>]*hidden><\/p>/);
  assert.match(SCRIPT, /getElementById\('tk-wake-line'\)[^\n]*tskWakeSentence\(t\)/);
  assert.equal(sentence({ wakeWords: 'waits until today at 3pm' }), 'Waits until today at 3pm.');
  assert.equal(sentence({}), '');
  assert.equal(sentence({ wakeWords: 'waits until today at 3pm', wakeNobody: true }), 'Waits until today at 3pm. Nobody holds this task, so nobody will be told until someone does.');
  assert.equal(sentence({ wakeMetWords: 'the wake time came', wakeNobody: true }), 'Woke: the wake time came. Nobody holds this task, so nobody has been told.');
});
