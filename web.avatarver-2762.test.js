/**
 * #2762: every member-face renderer that sits behind an identical-HTML repaint
 * skip must version its avatar URL.
 *
 * 🔑 WHY THIS IS AN INVARIANT AND NOT FOUR SEPARATE ARMS. The defect is not "one
 * function forgot a query string". It is that a page with FOUR renderers of the
 * same face, all behind a skip that compares HTML to the last HTML written,
 * needs every one of them to change when the picture changes. #2698 fixed the
 * org chart. #2762 was the same bug on the task list, found separately, months
 * later. The next one is found the same way unless something asks the question
 * of ALL of them at once, which is what this file does.
 *
 * THE RULE, stated so a future reader can decide where a NEW renderer belongs:
 *   painted through setLive / setIfChanged / a keyed thread repaint  -> MUST version
 *   assigned straight to innerHTML every poll                        -> bare is fine
 * because a direct assignment recreates the <img> and refetches (the route is
 * `no-store`), while a skip means the <img> is never recreated at all.
 *
 * ⚠️ THIS IS A SOURCE-SHAPE ASSERTION, and it is weaker than the behavioural arms
 * in web.task-card-761.test.js (which run the real tkFace and compare two renders)
 * and the real-browser assertion in docs/browser-checks/render-alltasks.js. It
 * cannot tell you the version is CORRECT, only that a bare URL was not emitted.
 * It is here for the property those cannot express: coverage of every renderer,
 * including ones nobody has written yet.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { codeOnly } = require('./test-support/code-only');

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');

/* Comments are stripped BOTH directions (#1080's shared helper): this file's own
   explanatory comments mention avatar URLs, and a renderer's comment must never
   be able to satisfy or break an assertion about its code. */
const CODE = codeOnly(PAGE);

/** The source of one top-level function, by name, out of the stripped page. */
function fnSource(name) {
  const start = CODE.indexOf('function ' + name + '(');
  assert.notEqual(start, -1,
    'the renderer `' + name + '` no longer exists, so this invariant stopped measuring it');
  let depth = 0; let seen = false;
  for (let i = start; i < CODE.length; i += 1) {
    if (CODE[i] === '{') { depth += 1; seen = true; }
    else if (CODE[i] === '}') { depth -= 1; if (seen && depth === 0) return CODE.slice(start, i + 1); }
  }
  throw new Error('could not find the end of ' + name);
}

// Renderers whose output is painted through a skip. Adding a renderer here is a
// claim you can check: find its paint call and confirm it is setLive /
// setIfChanged / paintThreadInto rather than a direct innerHTML assignment.
const MUST_VERSION = [
  ['tkFace', 'project task list, painted via the TK_LIST_HTML guard'],
  ['pjMember', 'project member rows, painted via setIfChanged -> setLive'],
  ['projectCard', 'project tree cards, painted via setIfChanged(list, pjTreeRows(active))'],
  ['addAgentsHtml', 'the add-agents picker, painted via setLive(box, addAgentsHtml())'],
];

/* A BARE avatar emission: `/avatar` closing its string literal, rather than
   continuing into `?v=`.

   🛑 THE FIRST VERSION OF THIS PATTERN WAS VACUOUS AND ITS CONTROL HID IT. It
   required `/api/agent/` and `/avatar` to be CONTIGUOUS:
       /\/api\/agent\/[^'"`]*?\/avatar(["'`])/
   Three of the four renderers below build that URL by CONCATENATION:
       '...<img src="/api/agent/' + encodeURIComponent(name) + '/avatar" alt="">'
   so there are quote characters between the two halves and the pattern could
   never match them. Measured: reverting tkFace AND pjMember to bare URLs both
   left this file 6/6 GREEN.

   ⚠️ The control passed anyway, because I wrote it against a single-literal URL
   (`<img src="/api/agent/april/avatar">`) that NO renderer on this page uses. A
   control has to resemble the subject; one that does not just certifies the
   blind spot. The controls below now use the real concatenated shape. */
const BARE = /\/avatar(["'`])/;

for (const [name, why] of MUST_VERSION) {
  test('#2762: ' + name + ' versions its avatar URL (' + why + ')', () => {
    const src = fnSource(name);
    assert.ok(/\/avatar/.test(src),
      'PRE-CONTROL: ' + name + ' emits no avatar URL at all, so this arm is vacuous');
    assert.doesNotMatch(src, BARE,
      name + ' emits a BARE avatar URL. Its output is painted through an identical-HTML skip ('
      + why + '), so the <img> is never recreated and the face keeps the OLD picture after a '
      + 'profile-image update. Append `?v=` the avatar version, as #2698 and #2762 did.');
  });
}

test('#2762 CONTROL: the bare-URL pattern fails on the REAL emission shapes, both of them', () => {
  /* Both shapes the page actually uses, because the first version of this control
     used a shape it does not and certified a pattern that matched nothing. */
  const concatBare = `'<img src="/api/agent/' + encodeURIComponent(n) + '/avatar" alt="">'`;
  const concatOk = `'<img src="/api/agent/' + encodeURIComponent(n) + '/avatar?v=' + (m.avatarVer || 0) + '" alt="">'`;
  const tplBare = '`<img src="/api/agent/${encodeURIComponent(n)}/avatar" alt="">`';
  const tplOk = '`<img src="/api/agent/${encodeURIComponent(n)}/avatar?v=${v}" alt="">`';

  assert.match(concatBare, BARE, 'the pattern misses a bare CONCATENATED url, which is what three of the four renderers emit');
  assert.match(tplBare, BARE, 'the pattern misses a bare TEMPLATE-LITERAL url');
  assert.doesNotMatch(concatOk, BARE, 'the pattern flags a correctly versioned concatenated url');
  assert.doesNotMatch(tplOk, BARE, 'the pattern flags a correctly versioned template-literal url');
});

test('#2762: renderers that rebuild every poll are deliberately NOT required to version', () => {
  /* The other half of the rule, asserted so nobody "fixes" these and so the list
     above is understood as a judgement rather than an oversight. `lrow` is
     assigned with `document.getElementById('alist').innerHTML = ...` and busyRow
     with `el.innerHTML = busyRow(...)`: a direct assignment recreates the <img>
     every poll, and the avatar route is no-store, so the picture refreshes with
     no version needed. */
  for (const name of ['lrow', 'busyRow']) {
    const src = fnSource(name);
    assert.ok(/\/avatar/.test(src), 'PRE-CONTROL: ' + name + ' no longer draws a face');
  }
  assert.match(CODE, /getElementById\('alist'\)\.innerHTML\s*=/,
    'the agents list stopped being a direct innerHTML assignment; if it is now behind a skip, lrow must version its URL and move to MUST_VERSION');
});
