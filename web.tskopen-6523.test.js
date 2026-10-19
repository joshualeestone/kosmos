'use strict';
/* #6523 (noise read; Mona Lisa agreed): on a project's Tasks view the crumb no longer carries a second "Open project";
   the title's chevron (#4586) is the way back, and it says where it goes in its accessible name and its tooltip.
   Read from the page source; render-subback-4586.js measures the painted chevron (name, 44px on touch). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');

function paintSlice() {
  const at = PAGE.indexOf("document.getElementById('tsk-crumb').innerHTML = picked");
  assert.notEqual(at, -1, 'the Tasks crumb paint is not where this check expects it');
  const end = PAGE.indexOf('const scoped = tskScoped(', at);
  assert.ok(end > at, 'the chevron block after the crumb was not found');
  return PAGE.slice(at, end);
}

test('#6523: the Tasks crumb carries no Open project link', () => {
  // The statement alone (it ends at its `: '';`), not the comment after it, which names [data-open-project].
  const slice = paintSlice();
  const crumb = slice.slice(0, slice.indexOf(": '';") + 5);
  assert.ok(crumb.length > 20, 'the crumb statement was not found');
  assert.match(crumb, /All tasks<\/button> › ' \+ esc\(pjChainText\(picked\.chain\)\)/, 'the crumb lost All tasks or the path');
  assert.doesNotMatch(crumb, /data-open-project/, 'the crumb still has a second way back to the project');
  assert.doesNotMatch(crumb, /Open project/, 'the crumb still says Open project');
});

test('#6523: the chevron names the project in its accessible name and its tooltip, and clears the tooltip with no project', () => {
  const back = paintSlice().split("const back = document.getElementById('tsk-back');")[1];
  assert.ok(back, 'the chevron block is missing');
  assert.match(back, /back\.setAttribute\('aria-label', 'Back to ' \+ pjChainSpoken\(picked\.chain\)\)/);
  assert.match(back, /back\.title = 'Back to ' \+ pjChainText\(picked\.chain\)/, 'the chevron has no tooltip naming the project');
  assert.match(back, /back\.removeAttribute\('title'\)/, 'a tooltip naming a project would outlive the scope');
});

test('#6523: the #5072 crumb-layout rules are gone with the link', () => {
  assert.doesNotMatch(PAGE, /\.tsk-crumb-open|\.tsk-crumb-sep/, 'a rule for the retired Open project is left behind');
});
