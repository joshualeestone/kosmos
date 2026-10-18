'use strict';

/**
 * #6483 (noise pass on 0.7.56, for Josh's clean interface): one agent asked one question, and its project card said a
 * red "Issue" with a warning triangle and a red border, while the agent's own card said a calm "Question". And the
 * Members notice named the agent twice in a row ("Cleo needs you on this project." then "Cleo").
 *
 * pjPillOf now says "Question" (the agent card's pill: its "?" glyph, no red) when every member that needs the person
 * here is an agent's own question (the engine's summary.needsYouQuestions); anything else keeps the red Issue. The
 * notice drops the name from the one row its heading already names. Both are extracted from the page and CALLED.
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
// GLYPH's restarting entry calls kGlyph, a one-line arrow the brace slicer cannot lift, so its own line comes first.
const lineOf = (start) => { const at = PAGE.indexOf(start); assert.notEqual(at, -1, `${start} is not in the page`); return PAGE.slice(at, PAGE.indexOf('\n', at)); };
const GLYPHS = lineOf('const kGlyph = ') + '\n' + slice('const GLYPH = ');
// eslint-disable-next-line no-new-func
const pjPillOf = new Function(GLYPHS + '\n' + slice('function pjPillOf(') + '\nreturn pjPillOf;')();
// eslint-disable-next-line no-new-func
const pjNeedsNotice = new Function(slice('function esc(') + '\n' + slice('const PJ_NEEDS_WHY = ') + '\n'
  + slice('function pjAlsoWhy(') + '\n' + slice('function pjNeedsNotice(') + '\nreturn pjNeedsNotice;')();
// eslint-disable-next-line no-new-func
const GLYPH = new Function(GLYPHS + '\nreturn GLYPH;')();

const proj = (summary) => ({ id: 'p1', name: 'Launch', summary });

test('#6483: a project whose only need is an agent\'s own question says Question, calm, with the agent card\'s glyph', () => {
  const pill = pjPillOf(proj({ needsYou: 1, needsYouQuestions: 1, working: 1 }), false);
  assert.equal(pill.label, 'Question');
  assert.notEqual(pill.cls, 'attn', 'a question drew the red attention look (the card border keys on attn)');
  assert.equal(pill.glyph, GLYPH.question, 'not the "?" the agent card draws');
  assert.equal(pill.glyph.includes('haz'), false, 'the warning triangle came with it');
});

test('#6483: any other reason, alone or beside a question, keeps the red Issue', () => {
  for (const s of [{ needsYou: 2, needsYouQuestions: 1 }, { needsYou: 1, needsYouQuestions: 0 }]) {
    const pill = pjPillOf(proj(s), false);
    assert.equal(pill.label, 'Issue', JSON.stringify(s));
    assert.equal(pill.cls, 'attn', JSON.stringify(s));
  }
});

test('#6483: an older board with no needsYouQuestions keeps Issue (it cannot tell a question from a problem)', () => {
  const pill = pjPillOf(proj({ needsYou: 1 }), false);
  assert.equal(pill.label, 'Issue');
  assert.equal(pill.cls, 'attn');
});

test('#6483: a roster the page cannot read claims no Question either', () => {
  const pill = pjPillOf(proj({ needsYou: 1, needsYouQuestions: 1 }), true);
  assert.notEqual(pill.label, 'Question');
  assert.notEqual(pill.label, 'Issue');
});

const member = (sessionName, name, needsYouHere) => ({ sessionName, name, needsYouHere, present: true });

test('#6483: the notice names one agent once: in its heading, not again on its row', () => {
  const html = pjNeedsNotice([member('cleo', 'Cleo', 'question')]);
  assert.match(html, /<b>Cleo needs you on this project\.<\/b>/);
  assert.equal((html.match(/Cleo/g) || []).length - (html.match(/aria-label="[^"]*Cleo"/g) || []).length, 1,
    'the name is shown more than once outside the buttons\' labels');
  assert.equal(html.includes('class="pnwho"'), false, 'the row still carries a name line');
  assert.match(html, /aria-label="Answer Cleo">Answer<\/button>/, 'the Answer button lost the name a screen reader needs');
  assert.match(html, /Waiting for your answer\./);
});

test('#6483 CONTROL: with two agents the heading counts them, so each row keeps its name', () => {
  const html = pjNeedsNotice([member('cleo', 'Cleo', 'question'), member('dax', 'Dax', 'trust')]);
  assert.match(html, /<b>2 agents need you on this project\.<\/b>/);
  assert.equal((html.match(/class="pnwho"/g) || []).length, 2);
});

test('#6483: a named heading plus an "also" row: only the named member loses its name line', () => {
  const sam = { ...member('sam', 'Sam', null), state: 'needs_you', stateProject: 'other' };
  const html = pjNeedsNotice([member('cleo', 'Cleo', 'question'), sam], (r) => r.sessionName === 'sam');
  assert.match(html, /<b>Cleo needs you on this project\.<\/b>/);
  assert.match(html, /<span class="pnwho">Sam<\/span>/, 'the other agent must still be named');
  assert.equal(html.includes('<span class="pnwho">Cleo</span>'), false);
});
