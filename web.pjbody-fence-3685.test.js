'use strict';
/**
 * #3685: the room's code-block split (pjBody) reads a fence the way the store and pjRich do
 * (#3679): leading spaces allowed, three or more backticks, no backtick after them, closed only
 * by a bare run at least as long. Lifts the REAL pjBody from web/index.html.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const page = require('./test-support/page');

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = page.scriptOf(PAGE);
const body = new Function('PJ_DOC_NAMES', ['esc', 'pjInline', 'pjLinkPaths', 'pjRichSpans', 'pjListDepth', 'pjTableCells',
  'pjTableAligns', 'pjTableHtml', 'pjProse', 'pjBody'].map((n) => page.lift(SCRIPT, n)).join('\n') + '\nreturn pjBody;')(new Set());
const draw = (t) => body(t, new Set(), []);

test('#3685: a column-0 three-backtick fence renders as it always did', () => {
  // The exact markup main's split produced for this input (measured, not composed).
  assert.equal(draw('before\n```\ncode\nline\n```\nafter'), 'before<figure class="codeb"><pre>code\nline</pre></figure>after');
});

test('#3685: a fence indented under a list item is code, and loses the opener\'s indent', () => {
  const html = draw('- step\n  ```\n  # not a heading\n    x   y\n  ```\n- next');
  assert.match(html, /<figure class="codeb"><pre># not a heading\n  x   y<\/pre><\/figure>/, html);
  assert.doesNotMatch(html, /mdh/, 'a line inside the fence was drawn as a heading');
  assert.match(html, /<span class="mdli">next<\/span>/);
});

test('#3685: a list stays open across a fence nested in one of its items', () => {
  const html = draw('- a\n  - b\n    ```\n    x\n    ```\n  - c\n- d');
  assert.match(html, /<span class="mdli mdli-d1">b<\/span>/, html);
  assert.match(html, /<span class="mdli mdli-d1">c<\/span>/, 'the item after the fence lost its depth: ' + html);
  assert.match(html, /<span class="mdli">d<\/span>/);
  // A column-0 fence ends the list, so an indented item after it starts a new one.
  assert.match(draw('- a\n```\nx\n```\n  - c'), /<span class="mdli">c<\/span>/);
});

test('#3685: a four-backtick fence holds a three-backtick example', () => {
  assert.match(draw('````md\n```js\nx\n```\n````'), /<figure class="codeb"><pre>```js\nx\n```<\/pre><\/figure>/);
});

test('#3685: a fence line with an info string does not close a fence', () => {
  assert.match(draw('```\na\n```js\nb\n```'), /<figure class="codeb"><pre>a\n```js\nb<\/pre><\/figure>/);
});

test('#3685: an inline ```span``` line opens nothing, and an unclosed fence stays prose', () => {
  assert.doesNotMatch(draw('```x``` then\nmore\n```\ncode'), /codeb/, 'an unclosed reading drew a code block');
  assert.doesNotMatch(draw('```\nnever closed'), /codeb/);
});

test('#3685: a CRLF fence closes, and a path-shaped infostring is still labelled', () => {
  const html = draw('```notes.md\r\nx\r\n```\r\nafter');
  assert.match(html, /class="codesrc"/, 'the path label was lost');
  assert.match(html, /<figure class="codeb"><pre>/);
  assert.match(html, /<\/figure>after$/, 'the text after the fence was not drawn after it');
});

test('#3685: the opener\'s indent is cut in columns, a tab counting as 4', () => {
  // A tab-indented opener cuts four spaces from the code, as a four-space opener does.
  assert.match(draw('\t```\n    code\n\t```'), /<pre>code<\/pre>/);
  assert.match(draw('    ```\n\tcode\n    ```'), /<pre>code<\/pre>/);
  // A tab wider than what is left of the cut keeps its remainder as spaces.
  assert.match(draw('  ```\n\tcode\n  ```'), /<pre>  code<\/pre>/);
  // Deeper code keeps what is past the cut.
  assert.match(draw('\t```\n\t\tcode\n\t```'), /<pre>\tcode<\/pre>/);
});
