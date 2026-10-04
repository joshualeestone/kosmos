'use strict';
/* #5153 slice 4: the undo panel's words and choices, the activity line it leaves, and the Settings switch, from the
 * real functions in web/index.html.
 *   node --test web.undo-5153.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');
const page = require('./test-support/page');

const RAW = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = page.scriptOf(RAW);
const lift = (name) => page.lift(SCRIPT, name);
// eslint-disable-next-line no-new-func
const B = new Function(page.liftConst(SCRIPT, 'TKU_WHY') + '\n' + ['esc', 'usageNum', 'tkUndoListHtml', 'tkUndoDoneLine'].map(lift).join('\n')
  + '\nreturn { tkUndoListHtml, tkUndoDoneLine };')();
const text = (html) => html.replace(/<[^>]*>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

test('each file says what undo will do, or why not; only safe ones start chosen, unsafe ones cannot be chosen', () => {
  const html = B.tkUndoListHtml({ files: [
    { path: '/w/a.md', action: 'restore', ok: true },
    { path: '/w/new <x>.md', action: 'move-aside', ok: true },
    { path: '/w/shared.md', action: 'restore', ok: false, why: 'shared' },
    { path: '/w/later.md', action: 'restore', ok: false, why: 'changed-since' },
  ] });
  const boxes = [...html.matchAll(/<input type="checkbox" data-path="([^"]*)"([^>]*)>/g)].map((m) => [m[1], /checked/.test(m[2]), /disabled/.test(m[2])]);
  assert.deepEqual(boxes, [
    ['/w/a.md', true, false],
    ['/w/new &lt;x&gt;.md', true, false],
    ['/w/shared.md', false, false],
    ['/w/later.md', false, true],
  ], 'chosen: safe ones; choosable: another agent\'s overlap; never: a file changed after the close');
  const t = text(html);
  assert.match(t, /goes back to how it was before this task/);
  assert.match(t, /moved into Kosmos’s own folder, not deleted/);
  assert.match(t, /another agent also edited it meanwhile/);
  assert.match(t, /changed after the task closed: left as it is/);
  assert.match(t, /saves each one’s current version first/);
});

test('after an undo the person is told what was done, what was not, and where the saved versions are', () => {
  assert.equal(B.tkUndoDoneLine({ done: ['/a'], skipped: [], savedIn: '/k/saved/x' }), 'Undone: 1 file. The versions from before the undo are saved in /k/saved/x.');
  assert.equal(B.tkUndoDoneLine({ done: ['/a', '/b'], skipped: [{ path: '/c', why: 'changed-since' }], savedIn: '/k/s' }),
    'Undone: 2 files. 1 file was left as it was. The versions from before the undo are saved in /k/s.');
});

test('the task\'s activity says an undo happened', () => {
  assert.match(SCRIPT, /case 'undone': return ev\.files === 1 \? 'One file’s changes undone' : 'File changes undone \('/);
});

test('the switch is in Settings > Advanced and drawn only once read (never a false Off); the panel only while on', () => {
  const adv = RAW.slice(RAW.indexOf('id="s-sec-advanced"'), RAW.indexOf('id="s-sec-advanced"') + 3000);
  assert.match(adv, /<button class="toggle" id="undo-toggle" role="switch" aria-label="Keep a copy before an agent edits a file" hidden>/);
  assert.match(SCRIPT, /const files = plan && plan\.on && Array\.isArray\(plan\.files\) \? plan\.files : \[\];/, 'the button shows only with the switch on');
});

test('files whose history is not certain can be chosen but start unchosen; unsafe ones cannot be chosen', () => {
  const html = B.tkUndoListHtml({ files: [
    { path: '/w/o.md', action: 'restore', ok: false, why: 'other-task' },
    { path: '/w/i.md', action: 'restore', ok: false, why: 'incomplete' },
    { path: '/w/l.md', action: 'restore', ok: false, why: 'not-a-file' },
    { path: '/w/m.md', action: 'restore', ok: false, why: 'moved' },
  ] });
  const boxes = [...html.matchAll(/<input type="checkbox" data-path="([^"]*)"([^>]*)>/g)].map((m) => [/checked/.test(m[2]), /disabled/.test(m[2])]);
  assert.deepEqual(boxes, [[false, false], [false, false], [false, true], [false, true]]);
  assert.match(text(html), /undo was turned on after the agent began/);
  assert.match(text(html), /no longer a plain file here: left as it is/);
});
