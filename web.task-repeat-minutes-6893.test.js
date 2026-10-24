'use strict';
/* kosmos#6893: the task page's Repeats control offers "Every so many minutes" with a number box. From the page's real
   functions: the choice sends { every: 'minutes', at: '<n>' } (the form the route reads), a stored minutes rule fills the
   box and leaves the time box alone, and only the minutes box shows for it. */
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const page = require('./test-support/page');
const taskrepeat = require('./engine/taskrepeat');

const HTML = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
const SRC = page.scriptOf(HTML);

function lifted() {
  const days = /const TK_REPEAT_DAYS = (\[[^\]]+\]);/.exec(SRC);
  const el = () => ({ value: '', dataset: {}, hidden: false, disabled: false, textContent: '', classList: { toggle() {} } });
  const els = {};
  for (const id of ['tk-repeat-row', 'tk-repeat-when', 'tk-repeat-line', 'tk-repeat-msg', 'tk-repeat-every', 'tk-repeat-at', 'tk-repeat-day',
    'tk-repeat-save', 'tk-repeat-mins', 'tk-repeat-mins-wrap']) els[id] = el();
  const document = { getElementById: (id) => els[id], querySelector: () => el() };
  const f = new Function('TK_REPEAT_DAYS', 'document', 'TK_ACT', 'tkPaintReviewer', 'tskRepeatSentence', 'tskRepeatMissed',
    page.liftAll(SRC, ['tkRepeatStoredChoice', 'tkRepeatChoice', 'tkRepeatFillAt', 'tkRepeatKeepOthers', 'tkRepeatSaved', 'tkRepeatShowChoice',
      'tkRepeatFollowUnderEdit', 'tkRepeatShowWhen', 'tkRepeatDirty', 'tkPaintRepeat'])
    + '\nreturn { tkRepeatChoice, tkRepeatStoredChoice, tkRepeatShowWhen, tkPaintRepeat, tkRepeatDirty };')(eval(days[1]), document, '', () => {}, () => '', () => false);
  return { f, els };
}

test('#6893: the select offers it and the number box is in the When row, sized and labelled', () => {
  assert.match(HTML, /<option value="minutes">Every so many minutes<\/option>/);
  assert.match(HTML, /<input type="number" id="tk-repeat-mins"[^>]*min="15" max="720"[^>]*aria-label="When: every how many minutes"/);
  assert.match(HTML, /<span id="tk-repeat-mins-wrap" hidden>/);
});

test('#6893: choosing it sends the number in the form the board reads, and the board makes the same rule', () => {
  const { f, els } = lifted();
  els['tk-repeat-every'].value = 'minutes';
  els['tk-repeat-mins'].value = '30';
  const sent = f.tkRepeatChoice();
  assert.deepEqual(sent, { every: 'minutes', at: '30' });
  // The route builds the rule with fromWords(body.every, { at: body.at }): the same rule the CLI's 30m makes.
  assert.deepEqual(taskrepeat.fromWords(sent.every, { at: sent.at }), taskrepeat.fromWords('30m'));
  // Review 2: as the board will store it: a leading zero is the same number, and 60 is the hourly rule.
  els['tk-repeat-mins'].value = '030';
  assert.deepEqual(f.tkRepeatChoice(), { every: 'minutes', at: '30' });
  els['tk-repeat-mins'].value = '60';
  assert.deepEqual(f.tkRepeatChoice(), { every: 'hour' });
  f.tkRepeatDirty({ repeat: { every: 'hour', minute: 0 } });
  assert.equal(els['tk-repeat-save'].disabled, true, '60 on an hourly task is no change: Save stays off');
  els['tk-repeat-mins'].value = '  ';
  assert.deepEqual(f.tkRepeatChoice(), { needsTime: true }, 'an empty box is no choice yet');
  f.tkRepeatDirty({ repeat: null });
  assert.equal(els['tk-repeat-msg'].textContent, 'Say how many minutes');
  assert.equal(els['tk-repeat-save'].disabled, true);
  // CONTROL: a daily choice with no time still says the time sentence.
  els['tk-repeat-every'].value = 'day';
  els['tk-repeat-at'].value = '';
  f.tkRepeatDirty({ repeat: null });
  assert.equal(els['tk-repeat-msg'].textContent, 'Choose a time');
});

test('#6893: a stored minutes rule fills the minutes box, shows only it, and reads as unchanged', () => {
  const { f, els } = lifted();
  const t = { number: 4, repeat: { every: 'minutes', n: 45 } };
  assert.deepEqual(f.tkRepeatStoredChoice(t), { every: 'minutes', at: '45' });
  f.tkPaintRepeat({ id: 'p1' }, t);
  assert.equal(els['tk-repeat-every'].value, 'minutes');
  assert.equal(els['tk-repeat-mins'].value, '45');
  assert.equal(els['tk-repeat-at'].value, '09:00', 'the time box keeps its own default, not the number');
  assert.equal(els['tk-repeat-when'].hidden, false);
  assert.equal(els['tk-repeat-mins-wrap'].hidden, false);
  assert.equal(els['tk-repeat-at'].hidden, true);
  assert.equal(els['tk-repeat-day'].hidden, true);
  assert.equal(els['tk-repeat-save'].disabled, true, 'nothing changed: Save is off');
  els['tk-repeat-mins'].value = '30';
  f.tkRepeatDirty(t);
  assert.equal(els['tk-repeat-save'].disabled, false, 'a new number lights Save');
  // CONTROL: a weekly rule hides the minutes box and shows the day and time.
  f.tkPaintRepeat({ id: 'p1' }, { number: 5, repeat: { every: 'week', day: 1, at: '09:30' } });
  assert.equal(els['tk-repeat-mins-wrap'].hidden, true);
  assert.equal(els['tk-repeat-at'].hidden, false);
  assert.equal(els['tk-repeat-day'].hidden, false);
});
