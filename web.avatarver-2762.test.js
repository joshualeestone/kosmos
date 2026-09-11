/**
 * #2762: the renderers that must version their avatar URL do, and a NEW avatar URL
 * cannot appear without somebody deciding about staleness.
 *
 * 🔑 THE DEFECT. A renderer painted through an identical-HTML repaint skip
 * (`setLive`: `if (el.__lastLive === html) return`) never recreates its <img>, so a
 * BARE `/api/agent/<name>/avatar` keeps the OLD picture after a profile-image update.
 * The route is `no-store`, so the fix is only to make the markup differ: `?v=` the
 * avatar version. #2698 fixed the org chart; #2762 was the same bug on three project
 * surfaces, found separately months later; `pjRoomRow` is the same bug again and is
 * carded (#2770).
 *
 * 🛑 THIS FILE REPLACES A CROSS-RENDERER "SWEEP" THAT WAS WRONG FIVE TIMES, AND THE
 * REASON IT IS SMALL IS THAT HISTORY. Four blind reviewers each broke the sweep:
 *   v1 a regex that could not match concatenated URLs, with a control written against
 *      a URL shape no renderer on this page uses, so the control certified the gap;
 *   v2 a hardcoded name list claiming in its header to catch "renderers nobody has
 *      written yet";
 *   v3 a per-line `<img` filter plus nearest-`function` attribution, escaped four ways
 *      (SVG `<image>`, an arrow renderer inheriting a neighbour's carve-out, the URL
 *      moved into a helper, a concatenation wider than the lookback);
 *   v4 `busted` implemented as "not followed by a quote", i.e. a NEGATIVE test that
 *      FAILED OPEN, plus carve-outs with no guards and line numbers computed on the
 *      comment-stripped copy so every location it reported pointed at unrelated code;
 *   v5 the fix for those numbers introduced a line-identity filter that made every code
 *      line carrying an inline `/* … *​/` invisible. Measured on this page: 91 lines.
 *      In the same version, the four "this escape is CAUGHT" controls ran a classifier
 *      the production path did not use, so they were more sensitive than the thing they
 *      certified. That is v1's lesson, recurring structurally.
 *
 * ⭐ EACH FIX OPENED A NEW SURFACE. That is the signature of a check whose complexity
 * exceeds what its subject can support, not of one two rounds from correct. It also
 * failed CLOSED on correct code: a correctly versioned URL wrapped across two lines was
 * rejected, with a message telling the author to add the `?v=` they had already added,
 * whose easiest remedy was to carve themselves out of the check. A guard that trains
 * people to carve themselves out of it is worse than no guard.
 *
 * So this file asserts two small things instead:
 *   1. each renderer that must version DOES, and does it from `avatarVer` rather than
 *      from something that can silently interpolate to "undefined";
 *   2. the number of avatar URLs on the page is PINNED, so adding one is a question
 *      somebody has to answer rather than a thing that happens quietly.
 * The COUNT depends on nothing but the text, so it cannot be escaped by a comment, a
 * line break, a helper, a template tag or an SVG element, and it cannot reject correct
 * code.
 *
 * ⚠️ THE PER-RENDERER ARMS ARE NOT IMMUNE, AND AN EARLIER VERSION OF THIS PARAGRAPH
 * CLAIMED THEY WERE. Each reads the named function's source, so a refactor that moves
 * the URL into a helper reds that arm even though the code is correct and fully
 * versioned. That is not hypothetical: `youPicUrl()` on this page is exactly that shape.
 * Measured, a correct helper refactor of `pjMember` reds its arm with
 *     PRE-CONTROL: pjMember emits no avatar URL, so this arm is vacuous
 * ⇒ THE MESSAGE IS THE POINT, and it is why this is acceptable where the sweep it
 * replaced was not. It says the arm stopped measuring, not that your code is wrong, and
 * the remedy is to repoint MUST_VERSION at whatever emits the URL now. There is no
 * carve-out list to escape into, which is what made the old check train people to
 * exempt themselves.
 *
 * ⚠️ WHAT THIS DOES NOT DO, said plainly: it does not prove a version is CORRECT at
 * runtime, and it does not stop somebody adding a bare URL and updating the count
 * without thinking. It makes that a deliberate act with a question attached.
 * `tkFace` additionally has behavioural arms (web.task-card-761.test.js drives the real
 * function and compares two renders; docs/browser-checks/render-alltasks.js asserts the
 * rendered src in a real browser). 🛑 `pjMember`, `projectCard` and `addAgentsHtml` have
 * NO behavioural arm anywhere in the repo, so for those three THIS FILE IS THE ONLY
 * GUARD. That is why it pins `avatarVer` by name and not merely `?v=`.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { codeOnly } = require('./test-support/code-only');

const PAGE = path.join(__dirname, 'web', 'index.html');
/* Comments stripped (#1080's shared helper) so a renderer's prose can neither satisfy
   nor break an assertion about its code. */
const CODE = codeOnly(fs.readFileSync(PAGE, 'utf8'));

/** One named function's source, brace-matched. Whole function, so a multi-line
    concatenation is read as the one expression it is. */
function fnSource(name) {
  const start = CODE.indexOf('function ' + name + '(');
  assert.notEqual(start, -1, 'renderer `' + name + '` no longer exists, so this assertion stopped measuring it');
  let depth = 0; let open = false;
  for (let i = start; i < CODE.length; i += 1) {
    if (CODE[i] === '{') { depth += 1; open = true; }
    else if (CODE[i] === '}') {
      depth -= 1;
      if (open && depth === 0) {
        const src = CODE.slice(start, i + 1);
        /* 🛑 OVER-CAPTURE MUST FAIL LOUDLY. This counts braces without understanding
           strings, so a `{` inside a string literal would unbalance it and swallow the
           functions that follow -- and then an assertion about THIS renderer would pass
           on a NEIGHBOUR's versioned URL, which is the wrong-reason pass this whole file
           exists to avoid. Sound on today's page (verified: no extraction contains
           another top-level declaration); guarded so it stays that way. */
        const swallowed = src.match(/\nfunction [A-Za-z0-9_$]+\(/g);
        assert.equal(swallowed, null,
          'extracting `' + name + '` swallowed ' + (swallowed || []).length + ' later function(s): '
          + JSON.stringify(swallowed) + '. A brace inside a string literal has unbalanced the '
          + 'match, so assertions about this renderer may be reading a neighbour code.');
        return src;
      }
    }
  }
  throw new Error('could not find the end of ' + name);
}

/** The one place the version-source matcher is built, so the arms and their control
    cannot drift apart. Word-bounded because `a.avatarVersion` CONTAINS `a.avatarVer`,
    and a plain substring test passes on exactly the typo this is meant to catch. */
function boundedMatcher(token) {
  return new RegExp('\\b' + token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b');
}

/* Renderers painted through an identical-HTML skip, so a bare URL goes stale.
   `from` is the expression the version must come from: asserting only `?v=` would
   accept `?v=' + a.avatarVersion` (a typo'd property) which interpolates to the literal
   "undefined" and is byte-identical on every render, i.e. #2762 with a query string. */
const MUST_VERSION = [
  ['tkFace', 'm.avatarVer', 'project task list, painted via the TK_LIST_HTML guard'],
  ['pjMember', 'm.avatarVer', 'project member rows, painted via setIfChanged -> setLive'],
  ['projectCard', 'a.avatarVer', 'project tree cards, painted via setIfChanged(list, pjTreeRows(active))'],
  ['addAgentsHtml', 'a.avatarVer', 'the add-agents picker, painted via setLive(box, addAgentsHtml())'],
];

for (const [name, from, why] of MUST_VERSION) {
  test('#2762: ' + name + ' versions its avatar URL from avatarVer (' + why + ')', () => {
    const src = fnSource(name);
    assert.ok(src.includes('/avatar'), 'PRE-CONTROL: ' + name + ' emits no avatar URL, so this arm is vacuous');
    assert.ok(src.includes('/avatar?v='),
      name + ' emits an avatar URL with no version. It is painted through an identical-HTML '
      + 'repaint skip (' + why + '), so the <img> is never recreated and the face keeps the OLD '
      + 'picture after a profile-image update (#2698, #2762).');
    /* 🛑 WORD-BOUNDED, NOT `includes`. `a.avatarVersion` CONTAINS `a.avatarVer`, so a
       plain substring test passes on the exact typo this assertion exists to catch.
       Measured: that mutant survived 7/7 before this was bounded. It is the same
       substring trap that bit the carve-out count and the paint guard in the version
       of this file that this one replaces, for the third time in one card. */
    const bounded = boundedMatcher(from);
    assert.match(src, bounded,
      name + " versions its URL but not from `" + from + "`. A version that is not the avatar "
      + 'version interpolates to a constant (a typo\'d property gives the literal "undefined"), '
      + 'which is byte-identical on every render and stale exactly as before.');
  });
}

test('#2762: the operator own picture is versioned too, and it is rendered behind the same skip', () => {
  /* youPicUrl() is rendered inside pjRoomRow (web/index.html), which is painted through
     paintThreadInto -> setLive. De-versioning it is #2762 on the operator's own face. */
  assert.match(CODE, /function youPicUrl\(\)\s*\{[^}]*\/api\/you\/avatar\?v=/,
    'youPicUrl no longer versions the operator picture, and it is rendered inside pjRoomRow, '
    + 'which is painted through paintThreadInto -> setLive.');
});

test('#2762: the number of avatar URLs on the page is PINNED', () => {
  /* 🔑 THE CLASS GUARD, and it is one line on purpose. The thing worth catching is
     "somebody added an avatar URL and did not think about staleness". A count cannot be
     escaped by a comment, a line break, a helper, a template tag or an SVG element,
     because it does not look at the shape of anything. Every previous version of this
     file was escaped through exactly those.

     Its failure message is a QUESTION, not an instruction: a check that tells people
     what to do teaches them to satisfy it, and the previous version's easiest remedy
     was to add yourself to a carve-out list. */
  const count = CODE.split('/avatar').length - 1;
  assert.equal(count, 18,
    'the page now has ' + count + ' avatar URLs, not 18. NOTE: this counts every occurrence, '
    + 'including 6 fetch() calls and 4 /api/you/avatar lines, so an unrelated fetch moves it too; '
    + 'that is deliberate fail-closed noise rather than a hole. If you ADDED a RENDER: is it painted through '
    + 'setLive / setIfChanged / paintThreadInto? Then it needs `?v=` the avatar version, or it will '
    + 'keep showing the old picture after a profile-image update (#2698, #2762, #2770). If it is '
    + 'assigned straight to innerHTML every poll, a bare URL is fine. Either way, decide, then '
    + 'update this number.');
});

test('#2762 CONTROL: each assertion above can actually fail', () => {
  /* Without this the arms are shape-checks nobody has shown can return the dangerous
     answer, which is the defect that ran through five versions of this file. Each mutant
     is applied to a COPY of the source the assertions read, so this control exercises the
     same helper the real arms do rather than a parallel one. Every previous control in
     this file tested a classifier the shipped path did not use. */
  const real = fnSource('tkFace');
  assert.ok(real.includes('/avatar?v='), 'PRE-CONTROL: tkFace is not versioned, so the mutants below prove nothing');

  const deVersioned = real.split('/avatar?v=').join('/avatar');
  assert.ok(!deVersioned.includes('/avatar?v='), 'the de-version mutant did not change anything');

  /* The typo direction, which a plain `includes` silently passes: `m.avatarVersion`
     CONTAINS `m.avatarVer`. Assert the BOUNDED matcher rejects it, which is the whole
     reason the assertion above is a regex and not a substring test. */
  const wrongSource = real.split('m.avatarVer ').join('m.avatarVersion ');
  /* Built the way the ARM builds it, not re-derived: a control that constructs its own
     matcher is testing a parallel implementation, which is how four "escape is CAUGHT"
     controls in the file this replaced ended up certifying a path that did not ship. */
  const boundedVer = boundedMatcher('m.avatarVer');
  assert.ok(boundedVer.test(real), 'PRE-CONTROL: the bounded matcher does not match the real source');
  assert.ok(!boundedVer.test(wrongSource),
    'the bounded matcher still accepts `m.avatarVersion`, so a typo would ship as ?v=undefined');
  assert.ok(wrongSource.includes('m.avatarVer'),
    'PRE-CONTROL: the typo mutant no longer contains the substring, so it would not test the boundary');

  const fewer = CODE.replace('/avatar', 'XavatarX');
  assert.notEqual(fewer.split('/avatar').length - 1, 18, 'the count is insensitive to an avatar URL being removed');
});
