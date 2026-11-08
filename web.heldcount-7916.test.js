'use strict';

/**
 * kosmos#7916 (follow-up to #7915): a question an agent holds until the person is back (`kosmos report needs_you --held`)
 * reads as held on the project card (pjPillOf, from the engine's summary.needsYouHeld) and on the Tasks page's Needs your
 * decision row (tskAskRow, from askingWithoutTask's `held`), as it already does on the agent card. Both are extracted
 * from the page and CALLED, each with an unheld control.
 *
 *   node --test web.heldcount-7916.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');

function slice(start) {
  const at = PAGE.indexOf(start);
  assert.notEqual(at, -1, `${start} is not in the page at all`);
  let depth = 0;
  let i = PAGE.indexOf('{', at);
  for (; i < PAGE.length; i++) {
    if (PAGE[i] === '{') depth++;
    else if (PAGE[i] === '}') { depth--; if (depth === 0) break; }
  }
  return PAGE.slice(at, i + 1) + (start.startsWith('const ') ? ';' : '');
}
const lineOf = (start) => { const at = PAGE.indexOf(start); assert.notEqual(at, -1, `${start} is not in the page`); return PAGE.slice(at, PAGE.indexOf('\n', at)); };
const GLYPHS = lineOf('const kGlyph = ') + '\n' + slice('const GLYPH = ');
// eslint-disable-next-line no-new-func
const pjPillOf = new Function(GLYPHS + '\n' + slice('function pjPillOf(') + '\nreturn pjPillOf;')();
const proj = (summary) => ({ id: 'p1', name: 'Launch', summary });

test('#7916: a project whose every waiting question is held says Question held, calm', () => {
  const pill = pjPillOf(proj({ needsYou: 2, needsYouQuestions: 2, needsYouHeld: 2 }), false);
  assert.equal(pill.label, 'Question held');
  assert.equal(pill.cls, 'question', 'calm, like Question');
  // CONTROLS: one held beside one asked is a Question; a held question beside another reason keeps Issue.
  assert.equal(pjPillOf(proj({ needsYou: 2, needsYouQuestions: 2, needsYouHeld: 1 }), false).label, 'Question');
  assert.equal(pjPillOf(proj({ needsYou: 2, needsYouQuestions: 1, needsYouHeld: 1 }), false).label, 'Issue');
  // An older board with no needsYouHeld keeps Question.
  assert.equal(pjPillOf(proj({ needsYou: 1, needsYouQuestions: 1 }), false).label, 'Question');
  // A roster the page cannot read claims neither: no label at all (the #4730 rule), the same answer as with no hold.
  assert.equal(pjPillOf(proj({ needsYou: 1, needsYouQuestions: 1, needsYouHeld: 1 }), true).label,
    pjPillOf(proj({ needsYou: 1, needsYouQuestions: 1 }), true).label);
  assert.notEqual(pjPillOf(proj({ needsYou: 1, needsYouQuestions: 1, needsYouHeld: 1 }), true).label, 'Question held');
  // A task held for the person's decision (#7797) keeps the plain Question over held questions.
  assert.equal(pjPillOf(proj({ needsYou: 1, needsYouQuestions: 1, needsYouHeld: 1, heldForYou: 1 }), false).label, 'Question');
});

// tskAskRow, with the page's own helpers it calls stubbed to plain text (they are tested where they live).
// eslint-disable-next-line no-new-func
const tskAskRow = new Function(
  'const esc = (s) => String(s); const pjChainText = (c) => c; const tskChainOf = (a) => a.projectName;'
  + ' const tskAgentName = (w) => w; const agoWords = (ms) => Math.round(ms / 3600e3) + ' + "' hours ago'" + ';\n'
  + slice('const PJ_NEEDS_WHY = ') + '\n' + slice('function tskAskRow(') + '\nreturn tskAskRow;')();

test('#7916: a held question on Tasks says it is held, with no age pressing it', () => {
  const now = Date.parse('2026-11-04T12:00:00Z');
  const since = '2026-11-01T12:00:00.000Z';
  const held = tskAskRow({ who: 'cleo', projectId: 'p1', projectName: 'Launch', waitingSince: since, held: true }, now);
  assert.match(held, /Held until you are back\./);
  assert.doesNotMatch(held, /Waiting for your answer/);
  const asked = tskAskRow({ who: 'cleo', projectId: 'p1', projectName: 'Launch', waitingSince: since }, now);
  assert.match(asked, /Waiting for your answer for 72 hours\./, 'CONTROL: an asked question keeps its age');
});

// eslint-disable-next-line no-new-func
const pjNeedsNotice = new Function(slice('function esc(') + '\n' + slice('const PJ_NEEDS_WHY = ') + '\n'
  + slice('function pjAlsoWhy(') + '\n' + slice('function pjSaidWords(') + '\n' + slice('function pjNeedsNotice(') + '\nreturn pjNeedsNotice;')();

test('#7916: the project page\'s needs list words a held member as held, an asked one as waiting', () => {
  const m = (sessionName, name, stateHeld) => ({ sessionName, name, needsYouHere: 'question', present: true, stateHeld });
  const held = pjNeedsNotice([m('cleo', 'Cleo', true)]);
  assert.match(held, /Held until you are back\./);
  assert.doesNotMatch(held, /Waiting for your answer/);
  const asked = pjNeedsNotice([m('cleo', 'Cleo', false)]);
  assert.match(asked, /Waiting for your answer\./, 'CONTROL');
});

test('#7916: a held question about another project is said as held in the project page\'s "also" rows', () => {
  // eslint-disable-next-line no-new-func
  const pjAlsoWhy = new Function(slice('const PJ_NEEDS_WHY = ') + '\n' + slice('function pjAlsoWhy(') + '\nreturn pjAlsoWhy;')();
  assert.deepEqual(pjAlsoWhy({ state: 'needs_you', stateProject: 'other', stateHeld: true }), ['Held until you are back, about another project.', 'Answer']);
  assert.deepEqual(pjAlsoWhy({ state: 'needs_you', stateProject: 'other' }), ['Waiting for your answer about another project.', 'Answer'], 'CONTROL');
});
