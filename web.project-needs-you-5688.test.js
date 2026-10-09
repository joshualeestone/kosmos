'use strict';

/**
 * #5688 (Josh, 2026-10-09 08:45): a project showed a red Issue, and its page never said what the issue was or how to
 * clear it. pjNeedsNotice names each member the pill counts (the engine's needsYouHere), says why, and offers Open.
 * Extracted from the page and CALLED, with the real esc().
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
// eslint-disable-next-line no-new-func
const pjNeedsNotice = new Function(slice('function esc(') + '\n' + slice('const PJ_NEEDS_WHY = ') + '\n'
  + slice('function pjNeedsNotice(') + '\nreturn pjNeedsNotice;')();

const m = (name, needsYouHere) => ({ sessionName: name.toLowerCase(), name, present: true, needsYouHere });

test('#5688: nothing counted, nothing said', () => {
  assert.equal(pjNeedsNotice([m('Dario', null), m('Demis', null)]), '');
  assert.equal(pjNeedsNotice([]), '');
});

test('#5688: one member: named in the heading, the reason, and one Open that names the agent', () => {
  const html = pjNeedsNotice([m('Dario', null), m('Elon', 'stuck_auth')]);
  assert.match(html, /<b>Elon needs you on this project\.<\/b>/);
  assert.match(html, /Cannot sign in, so it cannot work until its account is reconnected\./);
  assert.match(html, /data-pn-open="elon"/);
  assert.match(html, /aria-label="Open Elon">Open<\/button>/);
  assert.equal((html.match(/data-pn-open=/g) || []).length, 1, 'only the counted member gets a row');
  assert.equal(html.includes('—'), false, 'an em dash reached the person');
});

test('#5688: several members: counted in the heading, each with its own reason; a question says Answer', () => {
  const html = pjNeedsNotice([m('Elon', 'question'), m('Sam', 'crash_loop'), m('Mark', 'gave_up'), m('Demis', 'stuck_rate'), m('Dario', 'trust')]);
  assert.match(html, /<b>5 agents need you on this project\.<\/b>/);
  assert.match(html, /aria-label="Answer Elon">Answer<\/button>/);
  for (const w of ['Waiting for your answer about this project.', 'keeps restarting it', 'stopped trying to reconnect it',
    'Paused by a rate limit', 'Waiting on a trust prompt']) assert.ok(html.includes(w), w);
});

test('#5688: a reason the page does not know yet still gets a row, worded generally', () => {
  const html = pjNeedsNotice([m('Elon', 'something_new')]);
  assert.match(html, /Needs you\./);
  assert.match(html, /data-pn-open="elon"/);
});

test('#5688: names are escaped', () => {
  const html = pjNeedsNotice([m('<b>x</b>', 'trust')]);
  assert.equal(html.includes('<b>x</b>'), false);
});

test('#5688 wiring: both notice boxes paint it first, and its Open opens the agent with the project to return to', () => {
  assert.match(PAGE, /const notice = pjNeedsNotice\(roster\) \+ pjCoordNotice\(p\) \+ pjNotice\(roster, p\.id\);/);
  assert.match(PAGE, /setIfChanged\(rn, op \? pjNeedsNotice\(op\.agents \|\| \[\]\) \+ pjCoordNotice\(op\)/);
  assert.match(slice('function pjNeedsOpenClick('), /openDetail\(b\.dataset\.pnOpen, undefined, PJ_CURRENT\)/);
  assert.match(PAGE, /getElementById\('pj-one-notice'\)\.addEventListener\('click', pjNeedsOpenClick\)/);
  assert.match(PAGE, /rn\.addEventListener\('click', pjNeedsOpenClick\)/);
});

test('#5688 (Josh 08:50/08:51): "Done not set" is gone from the projects list and Roadmap, markup and styles', () => {
  // A deletion with no guard gets undone: the tag's class and words must not come back into the page's markup or CSS.
  // Comments may still NAME it (history); a quoted string or a CSS selector may not.
  assert.equal(/['"][^'"\n]*Done not set[^'"\n]*['"]/.test(PAGE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '')), false, 'the words are back in a string');
  assert.equal(/\.pj-doneunset\b|class="pj-doneunset"/.test(PAGE.replace(/\/\*[\s\S]*?\*\//g, '')), false, 'the tag class is back');
  assert.ok(PAGE.includes('doneSet') || PAGE.includes('What does done look like?'), 'CONTROL: the done field itself is still on the page');
});
