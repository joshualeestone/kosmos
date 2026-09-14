'use strict';
/**
 * #2868 (Josh): a file dropped ON the composer input area -- the text field AND
 * the + -- attaches, instead of the browser pasting the file's path.
 *
 * Josh: "if i drag an image and drop to send it that the input area for the text
 * and the +, like the whole thing is active to drop it in.. i tried to drop it in
 * the input area and it just pasted a file path".
 *
 * The attach mechanism (attachUploadAll) and the thread/room drop target already
 * existed; the composer input area was NOT a drop target, so a drop there hit the
 * text input's native behaviour and pasted the path. The fix wires the input's own
 * `.composerbox` as a drop target (covering both composers -- project post and
 * agent dialogue -- with no new markup id) through the shared wireDropTarget
 * helper, and preventDefault on dragover/drop is what stops the path paste.
 *
 * These are source-string guards (this bot cannot render index.html); they pin the
 * wiring by name so a regression fails in `yarn test` rather than only in Josh's
 * live review.
 *
 *   node --test web.composer-drop-2868.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const page = require('./test-support/page');
const SCRIPT = page.scriptOf(PAGE);

const rule = (needle) => {
  const n = PAGE.split(needle).length - 1;
  assert.equal(n, 1, `the anchor ${needle} matches ${n} places`);
  return PAGE.slice(PAGE.indexOf(needle), PAGE.indexOf('}', PAGE.indexOf(needle)) + 1);
};

test('the composer input area is wired as a file drop target', () => {
  /* Resolved from the text input's own .composerbox, so BOTH composers (project
     post + agent dialogue) are covered without adding a dedicated markup id. */
  assert.match(SCRIPT, /textEl\s*&&\s*textEl\.closest\('\.composerbox'\)/,
    'the composer input area is not resolved from the text input as a drop target');
  assert.match(SCRIPT, /wireDropTarget\(\s*textEl\s*&&\s*textEl\.closest\('\.composerbox'\)\s*,\s*where\s*\)/,
    'the resolved .composerbox is not handed to wireDropTarget for this `where`');
  /* Still inside the loop over both attach contexts (unchanged), so the wiring
     runs for the room composer and the agent-dialogue composer alike. */
  assert.match(SCRIPT, /for \(const where of \[ATTACH_ROOM, ATTACH_AGENT\]\)/,
    'the drop wiring no longer iterates both composer contexts');
});

test('a drop on the composer prevents the browser default (the path-paste bug) and routes to attachUploadAll', () => {
  const start = SCRIPT.indexOf('function wireDropTarget(');
  assert.ok(start !== -1, 'wireDropTarget helper is gone');
  /* Bound the slice to the helper body: from its declaration to the loop that
     calls it, so the assertions below read this function and not the whole file. */
  const end = SCRIPT.indexOf('for (const where of [ATTACH_ROOM, ATTACH_AGENT])', start);
  assert.ok(end > start, 'could not bound the wireDropTarget body');
  const fn = SCRIPT.slice(start, end);
  /* preventDefault on dragover is precisely what stops the text input pasting the
     dropped file's path. */
  assert.match(fn, /addEventListener\('dragover'[\s\S]*?preventDefault\(\)/,
    'dragover does not preventDefault, so a drop on the input would still paste the path');
  /* The drop preventDefaults too and routes the file(s) to the existing attach path. */
  assert.match(fn, /addEventListener\('drop'[\s\S]*?e\.preventDefault\(\)[\s\S]*?attachUploadAll\(files, where\)/,
    'the drop does not preventDefault and route files to attachUploadAll');
});

test('the composer shows a drop-active state without changing its resting box', () => {
  const r = rule('.composerbox.dragging');
  assert.match(r, /outline:\s*2px dashed/,
    'no drop-active outline on the composer when a file is dragged over it');
  /* The base .composerbox rule (border/flex, guarded by web.focus-ring-1303d)
     must be a SEPARATE rule -- the drag state adds, it does not restyle the box. */
  assert.doesNotMatch(rule('.composerbox.dragging'), /display:\s*flex/,
    'the drag rule bled into the base composerbox layout');
});
