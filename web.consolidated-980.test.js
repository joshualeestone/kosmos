'use strict';

/**
 * #980 spec pins (Josh, 2026-08-26 08:31): the boxless consolidated view's
 * rulings that no other test file pins -- one pin per ruling, so none of
 * them can be reverted silently. The grid skeleton, the flat thread and the
 * Files/Members order are pinned in their pre-existing files; this file
 * carries the rest.
 *
 *   node --test web.consolidated-980.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const PAGE = fs.readFileSync('web/index.html', 'utf8');
const cons = 'html\\[data-layout="consolidated"\\] body\\.consolidated';

/* #1430: the assertions below no longer end at their rule's closing brace, so an
   appended declaration is not a red that looks like a product bug. That is how
   main went down at step 3 under #1310.

   Kept pinned here on purpose: four single complete declarations, all
   `display: none`. The absence-shaped promise is `\.cinput { ...
   scrollbar-width: none; -ms-overflow-style: none; }`: a later
   `scrollbar-width: auto` in that rule is exactly the disclosed failure.
   🛑 AND THE KEEPS CARRY THE ORIGINAL DEFECT BY CONSTRUCTION, which the block
   above did not say: a kept pin STILL GOES RED on a legitimate append. That is
   #1310 itself, retained deliberately. Measured across the keeps in this change:
   appending `margin: 0;` to a kept rule reds it.
   ⚠️ The justification is a SNAPSHOT OF TODAY'S STYLESHEET -- each kept
   selector's rules currently carry a single declaration, checked, with controls.
   It is not a property of the rule, and round 10 disproved one of these keeps by
   finding the page already extended its selector. **If a kept rule ever gains a
   declaration, loosen it rather than treating the pin as settled.**

   ⚠️ THREE THINGS IT DOES NOT COVER, and all three are real. An open tail cannot
   see a SAME-RULE OVERRIDE. It tolerates an APPEND but NOT a declaration INSERTED
   between the promised ones -- #1310 happened to append; had it grouped the
   property differently this would not have prevented it. And a SAME-SELECTOR,
   LATER-RULE override is invisible to any text pin, loosened or not: if the sheet
   declares the selector twice the later rule wins, and an assertion on the earlier
   one is GREEN when the behaviour breaks and RED on a no-op. Three instances were
   found in this tree and all three are now FIXED with cascade-resolving checks --
   two by #1476 itself, and a third here that #1476's guard could not see because
   both declarations carried the same VALUE.

   ⚠️ AND LOOSENING HAS A COST FOR THAT GUARD, DISCLOSED RATHER THAN LEFT TO BE
   FOUND: web.cascade-shadowed-pins-1476.test.js matches on a rule WITH its closing
   brace, so dropping the brace takes these files out of its reach. Measured: on
   main it sees 3 such assertions in the files this branch touches, on this branch
   it sees 0. Nothing fails today. The guard wants a brace-optional matcher, and
   that is #1469's territory rather than something to patch quietly here.

   🔑 So the four-arm proof behind this change establishes that each assertion
   tracks the rule TEXT. It does NOT establish that the rule GOVERNS.

   🛑 NOT MECHANICALLY ENFORCED (#1469). A guard was built and removed rather than
   shipped: it was blind to the very spelling that caused #1310, and a green
   nobody can trust stops the next person looking.

   Full argument, counts and the four-arm proof: .claude/plans/css-brace-anchor-1430.md */

/* 🛑 THE ONE GUARD THAT IS NOT A TEXT MATCH, and the reason it exists is a
   BLOCKER this suite passed straight through. A paragraph appended AFTER a
   comment's closing delimiter left six lines of raw prose inside a declaration
   block. CSS error recovery then discards from there to the next semicolon --
   (and note: the first draft of THIS comment closed itself early the same way,
   by quoting the delimiter literally, which is how cheap the mistake is) --
   which was the one ending `grid-template-rows` -- so the entire row template
   was DROPPED by every browser while the file still contained the text.
   ⚠️ Every other pin in this branch is `readFileSync` + regex, so not one of
   them can tell "the rule is written" from "the rule takes effect". All 11
   passed against dead CSS. This scans the stylesheet's comment structure
   instead, which is the cheapest property that actually distinguishes them. */
function strayCommentTerminators(css) {
  /* ⚠️ Quoted strings are SKIPPED. A CSS rule whose content property contains
     a comment delimiter as literal text is valid, and without this it would be
     reported as a stray terminator. No such rule exists in this file today,
     but this is the suite's one non-textual guard, and a guard that cries wolf
     is a guard people learn to ignore.
     📌 Note the shape of the bug that made this comment awkward to write: the
     first draft quoted the delimiter, which closed this comment early and
     broke the file. That is the third time today the same two characters have
     done that, which is the best argument for the scanner existing at all. */
  const out = [];
  let i = 0, inComment = false, line = 1, openedAt = 0;
  while (i < css.length) {
    if (css[i] === '\n') line += 1;
    if (!inComment && (css[i] === '"' || css[i] === "'")) {
      const q = css[i]; i += 1;
      while (i < css.length && css[i] !== q) { if (css[i] === '\\') i += 1; if (css[i] === '\n') line += 1; i += 1; }
      i += 1; continue;
    }
    if (!inComment && css.startsWith('/*', i)) { inComment = true; openedAt = line; i += 2; continue; }
    if (inComment && css.startsWith('*/', i)) { inComment = false; i += 2; continue; }
    if (!inComment && css.startsWith('*/', i)) { out.push(line); i += 2; continue; }
    i += 1;
  }
  if (inComment) out.push(-openedAt); // negative = a comment left open
  return out;
}

test('the stylesheet has no stray comment terminator: a rule discarded by the parser still reads correctly in the file', () => {
  const open = PAGE.indexOf('<style>');
  const close = PAGE.lastIndexOf('</style>');
  assert.ok(open > 0 && close > open, 'could not find the <style> block; this guard is measuring nothing');
  const css = PAGE.slice(open + 7, close);

  const stray = strayCommentTerminators(css);
  const unclosed = stray.filter((n) => n < 0).map((n) => -n);
  const closers = stray.filter((n) => n > 0);
  assert.deepEqual(unclosed, [], `a comment is left OPEN (started near stylesheet line ${unclosed[0]}), so every rule after it is swallowed`);
  assert.deepEqual(closers, [],
    `stray '*/' at stylesheet line(s) ${closers.join(', ')}: text after a comment's closer sits raw inside a declaration block, and CSS error recovery discards through the next semicolon. The rule that follows is dead in the browser while still matching every text pin in this file.`);

  // CONTROLS, both directions. Without these the scanner could be returning
  // [] because it never matches anything, which is the failure it exists to catch.
  assert.deepEqual(strayCommentTerminators('a{/* fine */ color: red; }'), [],
    'control: the scanner flags a well-formed comment, so its empty result above proves nothing');
  assert.deepEqual(strayCommentTerminators('a{/* one */\n prose */\n color: red; }'), [2],
    'control: the scanner no longer catches a planted stray terminator, so the assertion above is inert');
  assert.deepEqual(strayCommentTerminators('a{/* never closed'), [-1],
    'control: the scanner no longer catches an unclosed comment');
  assert.deepEqual(strayCommentTerminators('a{ content: "*/"; }'), [],
    'control: a delimiter inside a CSS string is reported as stray, which would make this guard cry wolf');
  // Three lines: the string on 1, an ordinary comment on 2, the stray on 3.
  assert.deepEqual(strayCommentTerminators('a{ content: "x"; }\n b{/* one */\n prose */ }'), [3],
    'control: skipping strings also swallowed a REAL stray terminator after one');
});

test('the open project stays lit: a persistent .open state, written on click and on repaint', () => {
  /* 🔑 REWRITTEN FOR kosmos#1192, PROPERTY UNCHANGED. This pinned the exact
     box-shadow, which was the MECHANISM. The property is that a selected project
     is distinguishable WITHOUT hovering, and Josh asked on 2026-08-27 for that to
     be a ground rather than a bar and a stroke: "I just want it to be a white
     area to indicate that that project is selected."
     ⚠️ AND IT MUST SURVIVE THE THEME, WHICH THE NAIVE VERSION DID NOT. Measured:
     the surface token against the column behind it is 12 units apart in light and
     SIX in dark, so `background: var(--k-surface)` alone left dark-mode users
     unable to tell which project was open. That is what this guard caught, and it
     was right to. Hence a dedicated token with an explicit value per theme. */
  const openRule = PAGE.match(new RegExp(cons + ' \\.pj-row\\.open \\{[^}]*\\}'));
  assert.ok(openRule, 'the selected-project rule is gone; hover alone cannot say which project is on screen');
  assert.match(openRule[0], /background:\s*var\(--k-sel/,
    'the selected project no longer has a ground of its own, so selection is only a hover away from invisible');
  for (const t of ['\\[data-theme="dark"\\]', '\\[data-theme="light"\\]']) {
    assert.match(PAGE, new RegExp(t + '[^{]*\\{[^}]*--k-sel:'),
      'the selection ground has no explicit value for one theme, so it falls back and can collapse onto the column');
  }
  assert.match(PAGE, /p\.id === PJ_CURRENT \? ' open' : ''/,
    'the painter no longer writes .open on repaints');
  assert.match(PAGE, /p\.id === PJ_CURRENT \? ' aria-current="true"' : ''/,
    'the painter no longer writes aria-current with the class -- the ring answers sighted users only');
  const pm = PAGE.slice(PAGE.indexOf('function pjMarkOpen(id)'), PAGE.indexOf('function pjMarkOpen(id)') + 600);
  assert.match(pm, /classList\.toggle\('open', on\)/,
    'pjMarkOpen no longer toggles the class');
  assert.match(pm, /setAttribute\('aria-current', 'true'\)/,
    'pjMarkOpen no longer toggles aria-current with the class');
  /* Comments stripped for BOTH assertions below, not just the count: a comment
     quoting either call would satisfy a raw-PAGE match. */
  const codeOnly = PAGE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert.match(codeOnly, /pjMarkOpen\(id\);/,
    'openProject no longer marks selection on the click itself (it would wait for the next repaint)');
  /* ⚠️ COUNTED IN CODE, NOT IN PROSE. The raw-text count matched anywhere in
     the file, so a comment quoting the call would have satisfied it -- the
     same hole that let an indexOf find a comment before a declaration
     elsewhere in this suite. Comments are stripped first, so the number
     means call sites. */
  /* ⚠️ THE EXACT COUNT, not a floor. `>= 4` against six real call sites meant
     two could be deleted while the pin stayed green and its message asserted
     the opposite. A floor is the right shape only when the number is allowed
     to grow freely; here every call site is a named close path, so the number
     IS the claim. Adding a legitimate one should make somebody update this
     line and say which path it is. */
  const nulls = (codeOnly.match(/pjMarkOpen\(null\)/g) || []).length;
  assert.equal(nulls, 6,
    `pjMarkOpen(null) is called from ${nulls} places, expected 6. Fewer means a close path lost it and a lit row can outlive its project; more means a new close path arrived and this pin should name it.`);
  assert.ok((('/* pjMarkOpen(null) */').replace(/\/\*[\s\S]*?\*\//g, '').match(/pjMarkOpen\(null\)/g) || []).length === 0,
    'control: the comment strip no longer removes a quoted call, so the count above can be satisfied by prose');
});

/* ⚠️ COMPUTED, NOT MATCHED. A string pin on the box-shadow proves the rule is
   still written; it cannot notice that a token edit dropped the marker back
   under the accessibility floor, which is the failure that actually happened
   here (the fill and ring were pinned all along and were 1.13:1 and 1.16:1).
   So this reads the real hex out of the real token blocks and does the real
   arithmetic. Its positive control is the OLD carrier: --k-rule on --k-side
   must still measure UNDER 3:1, which proves the formula and the extraction
   both work and that the test is not passing on a lookup that quietly failed. */
/* ⚠️ ANCHORED TO BLOCK BOUNDARIES, not to a byte count. The first version of
   this sliced a fixed 1200 characters forward from the first token, and a long
   comment sitting between --k-bg and --k-side pushed --k-side outside the
   window. The control below caught it (it reported the extraction broken
   rather than a comfortable ratio), which is the only reason this is anchored
   properly now instead of silently measuring three of the four grounds. */
const LIGHT_START = PAGE.indexOf('--k-bg: #faf9f7');
const DARK_MEDIA = PAGE.indexOf('@media (prefers-color-scheme: dark)');
const DARK_END = PAGE.indexOf('@media (prefers-contrast: more) and (prefers-color-scheme: dark)');
assert.ok(LIGHT_START > 0 && DARK_MEDIA > LIGHT_START && DARK_END > DARK_MEDIA,
  'the token-block anchors moved; every contrast reading below would be measuring the wrong block');
const TOKEN_BLOCKS = {
  light: PAGE.slice(LIGHT_START, DARK_MEDIA),
  dark: PAGE.slice(DARK_MEDIA, DARK_END),
};
function token(theme, name) {
  const m = TOKEN_BLOCKS[theme].match(new RegExp('--' + name + ':\\s*(#[0-9a-fA-F]{6})'));
  assert.ok(m, 'token --' + name + ' not found in the ' + theme + ' block -- extraction broke, so any ratio below is meaningless');
  return m[1];
}
function ratio(a, b) {
  const lum = (h) => {
    const p = [1, 3, 5].map((i) => {
      const c = parseInt(h.substr(i, 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test('the open-project marker clears 3:1 on BOTH grounds it touches, in BOTH themes (SC 1.4.11)', () => {
  for (const theme of ['light', 'dark']) {
    const bar = token(theme, 'k-ink-2');
    const rowFill = token(theme, 'k-surface');
    const railGround = token(theme, 'k-side');
    // The bar is drawn inset on the open row, so its inner ground is that
    // row's fill and its outer edge abuts the rail. BOTH are adjacent.
    for (const [what, ground] of [['the row fill it sits on', rowFill], ['the rail ground it abuts', railGround]]) {
      const r = ratio(bar, ground);
      assert.ok(r >= 3, `${theme}: the open marker ${bar} measures ${r.toFixed(2)}:1 against ${what} (${ground}), under the 3:1 this file declares (grep for THE OPTION BUTTON BOUNDARY IS A CONTRAST FLOOR) for anything identifying a control's state`);
    }
    // POSITIVE CONTROL: the carriers this fix replaced must still measure
    // under the floor. If this ever passes, the extraction or the formula is
    // broken and every assertion above is worthless.
    const oldRing = ratio(token(theme, 'k-rule'), railGround);
    assert.ok(oldRing < 3, `${theme}: control failed -- --k-rule on --k-side measured ${oldRing.toFixed(2)}:1, which should be under 3:1. The token extraction or the contrast formula is wrong, so the assertions above prove nothing.`);
  }
});

test('the consolidated .apphead override resets margin, or the update notice is clipped away', () => {
  /* 🛑 `.apphead` carries `margin: calc(-1 * --space-8)` on both sides for ONE
     reason: to cancel the body's own --space-8 padding. This view sets
     `padding: 0`, so those -24px stop cancelling and become a real offset,
     and under this view's `height: 100vh` the result was clipped rather
     than scrollable (the view was `overflow: hidden` when this was found;
     it is `overflow-y: auto` now, but the margin reset is still what keeps
     the notice in its own box rather than 24px outside it).
     Measured before the fix: .apphead and
     #newsbar rendered at left:-24, top:-24, slicing the update notice through
     the middle with its status dot off-screen.
     The surfaces this protects are named in the header-gives-way comment as the reason
     the header is allowed to give way at all. */
  const rule = PAGE.match(new RegExp(cons + ' > \\.apphead \\{[^}]*\\}'));
  assert.ok(rule, 'the consolidated .apphead override is gone');
  /* ⚠️ THE PROPERTY IS THAT MARGIN IS RESET, NOT HOW IT IS SPELLED. This pinned
     `0 0 var(--space-6)` literally, and the reason recorded above is the -24px
     mirror margins: unreset, .apphead and #newsbar rendered at left:-24, top:-24
     and sliced the update notice in half. `margin: 0` cancels those exactly as
     well as `0 0 16px` does, and kosmos#1188 needs the bottom 16px gone because
     it was painting a grey band across the top of the consolidated view.
     ⇒ Widened to either form, and NOT to /margin:/ alone: `margin-bottom: 8px`
     would pass that and leave the -24px uncancelled, which is the defect. */
  assert.match(rule[0], /margin:\s*(?:0|0 0 var\(--space-6\));/,
    'the consolidated .apphead override stopped resetting margin: .apphead\'s -24px mirror margins no longer cancel anything (this view has padding:0)');
  // The property this depends on, pinned beside it: if the body ever regains
  // padding, the reset above becomes wrong rather than merely unnecessary.
  assert.match(PAGE, new RegExp(cons + '[^{]*\\{[^}]*height: 100vh; overflow-y: auto; overflow-x: hidden; padding: 0'),
    'the consolidated body no longer sets padding:0 -- re-check the .apphead margin reset above, which exists only to compensate for it');
});

test('the search placeholder follows the EFFECTIVE view, in showTab, not the saved layout', () => {
  const st = PAGE.slice(PAGE.indexOf("document.body.classList.toggle('consolidated', cons)"), PAGE.indexOf("document.body.classList.toggle('consolidated', cons)") + 1400);
  assert.match(st, /roomSearch\.placeholder = cons \? 'Search' : roomSearch\.dataset\.longPlaceholder/,
    'the placeholder swap left showTab (or the tab-view restore stopped reading the markup-captured wording, so a markup edit could be silently reverted)');
  assert.match(st, /if \(!\('longPlaceholder' in roomSearch\.dataset\)\) roomSearch\.dataset\.longPlaceholder = roomSearch\.placeholder/,
    'the long wording is no longer captured from the markup exactly once (an in-check, so even an empty captured value never re-fires the capture)');
  const al = PAGE.slice(PAGE.indexOf('function applyLayout('), PAGE.indexOf('function applyLayout(') + 1200);
  assert.doesNotMatch(al, /placeholder =/,
    'applyLayout swaps the placeholder again -- that keys on the SAVED layout and goes stale across the 960px resize');
});

test('the state chatter is hidden from the EYE only, and a needs-you row keeps its inline Answer action', () => {
  /* 🛑 THE HIDE MUST NOT BE `display: none`, and this is the pin that says so.
     `display: none` removes the element from the ACCESSIBILITY TREE as well as
     the screen, so a rail row announced its name and role and then said
     nothing about state at all -- working, idle and Not running alike, with
     only `attn` surviving via its triangle's own aria-label.
     Josh's ask was visual ("we don't want to put a status bubble in there").
     The states he listed -- idle, working, needs you, is there a problem --
     are exactly what a screen-reader user has no glyph to fall back on for. */
  /* 🔑 REWRITTEN FOR kosmos#1191, AND THE PROPERTY IS UNCHANGED. This used to
     pin the visually-hidden CLIP, which was the MECHANISM. The property it was
     protecting is that an agent's state reaches the accessibility tree, because
     `display: none` on `.lstate` once left a rail row announcing its name and
     role and then saying nothing about state at all.
     Josh, 2026-08-27, asked for "a single text line ... to indicate what they're
     doing", so the word is now VISIBLE, which satisfies that property more
     strongly than the clip did: it reaches the eye AND the ear.
     ⚠️ HIS 2026-08-26 RULING STILL HOLDS AND IS PINNED BELOW. He rejected the
     BUBBLE ("we don't want to put a status bubble in there"), not the words, so
     the decorative glyphs stay hidden while the sentence shows. Those glyphs are
     `aria-hidden` already, so hiding them costs the ear nothing.
     ⇒ What must never happen is `.lstate` itself becoming `display: none`. */
  /* 🛑 STRIP COMMENTS FIRST. This file discusses `.lrow > .lstate` at length
     directly above the rules, so an uncommented scan matches PROSE and fails for
     a reason that has nothing to do with the CSS. My first version went red on
     origin/main by matching a comment fragment, which is a real failure for a
     spurious cause and would vanish the moment somebody reworded the note. */
  const CSS = PAGE.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const hides = CSS.match(new RegExp('[^{}]*\\.lrow > \\.lstate[^{]*\\{[^}]*\\}', 'g')) || [];
  for (const h of hides) {
    if (/\.lstate >/.test(h)) continue;          // the glyph rule, which SHOULD be display:none
    /* ⚠️ AND THE FOLDED COLUMN IS NOT THE DEFECT. `body.consolidated.fold-a`
       collapses the agents rail to 48px and shows avatars only, so hiding the
       name, title and state there is the feature. My first version of this loop
       caught that rule and called it the bug: the check's input was wider than
       the property it was written for. */
    if (/\.fold-a\b/.test(h)) continue;
    assert.doesNotMatch(h, /display:\s*none/,
      'a rule takes .lstate out of the accessibility tree as well as off the screen: ' + h.slice(0, 90));
  }
  assert.match(CSS, new RegExp(cons + ' \\.lrow > \\.lstate > \\.(?:act|haz|rest|pause|stop|qmark)'),
    'the decorative state glyphs are no longer hidden, so the status bubble Josh rejected on 2026-08-26 is back');
  assert.match(CSS, new RegExp(cons + ' \\.lrow > \\.lstate \\{[^}]*font-size: \\.625rem'),
    'the state line is no longer at the agent-title size Josh asked for');

  /* The chatter itself SHOULD be gone from both channels: it is the quoted
     last-words line Josh called nonsense, not a state.
     kosmos#986 strengthened this from a HIDE to an ABSENCE: the list row no
     longer renders `.lsaid` at all, so there is no rule to assert and nothing
     a new surface could forget to hide. Asserting the class is absent from the
     whole page is the stronger claim, and it fails if anyone reintroduces the
     render -- which the old `display: none` pin would have happily allowed. */
  assert.doesNotMatch(PAGE, /lsaid/,
    'the quoted last-words line is being rendered again somewhere -- Josh cut it under #855 (grid) and #986 (list); it should not exist in the markup at all');
  assert.match(PAGE, new RegExp(cons + ' \\.lrow:has\\(\\.lstate \\.ansgo\\) > \\.lav \\{ grid-row: 1 \\/ span 3;'),
    'the avatar no longer spans the Answer row, so the kept .lstate misaligns');
  /* Every state glyph stays aria-hidden, or the clip above starts announcing
     decorative markup alongside the word. */
  /* ⚠️ ANCHORED AT A LINE START. A plain indexOf('const GLYPH = {') found a
     COMMENT that names the declaration before finding the declaration, and the
     slice then counted zero glyphs and failed with a message about aria-hidden
     -- a true-sounding error about the wrong thing. Prose can quote any string;
     it cannot start a line at column zero inside this file's indented CSS. */
  const at = PAGE.indexOf('\nconst GLYPH = {');
  assert.ok(at > 0, 'the GLYPH declaration moved or was renamed; the count below would be measuring nothing');
  const g = PAGE.slice(at, at + 700);
  assert.equal((g.match(/aria-hidden="true"/g) || []).length, 6,
    'a GLYPH lost its aria-hidden: the visually-hidden .lstate would announce decoration with the state word');
});

test('each fold hides its OWN rail label, and only its own', () => {
  assert.match(PAGE, new RegExp(cons + '\\.fold-a #rail-agents \\.railname \\{ display: none; \\}'),
    'the fold-a railname hide lost its #rail-agents scope (unscoped, folding agents blanked the PROJECTS label)');
  assert.match(PAGE, new RegExp(cons + '\\.fold-p #rail-projects \\.railname \\{ display: none; \\}'),
    'folding projects no longer hides its own label, which overflowed the 48px strip as clipped letters');
});

test('the pre-rail grid rows are auto, never 0: the notice surfaces must be able to show', () => {
  // #askcard (a phone asking to pair), #conn (subscription unreachable) and
  // #board-msg are auto-placed body children. In a 0-height track they
  // painted under the rails' opaque grounds -- a pairing request nobody
  // can see. auto tracks collapse while hidden and give them height the
  // moment they show; this is the layout's load-bearing safety property.
  /* ⚠️ The flexing row is minmax(200px, 1fr), NOT minmax(0, 1fr). At 0 it
     could be squeezed away entirely by the auto notice tracks above it, and
     with the old `overflow: hidden` the board was then unreachable -- no page
     scroll to fall back on, because this view removed it. The floor and the
     body's `overflow-y: auto` are one fix: the row stays recognisably itself,
     and if the window is too short for that the page scrolls rather than
     clipping. A 0 floor here silently reopens that hole. */
  assert.match(PAGE, new RegExp(cons + ' \\{[^}]*grid-template-rows: repeat\\(38, auto\\) auto minmax\\(200px, 1fr\\) auto;', 's'),
    'the pre-rail rows are not auto tracks -- a visible notice surface can vanish under the rails again');
  for (const id of ['id="askcard"', 'id="conn"', 'id="board-msg"']) {
    assert.ok(PAGE.includes(id), id + ' is gone; re-derive whether the auto-rows invariant still protects the right surfaces');
  }

  // The 38-track headroom is a real number: the 39th simultaneously
  // renderable auto-placed body child would spill into an implicit row
  // below the clipped viewport -- the same invisible-surface failure the
  // auto rows exist to prevent. Count the body's direct element children
  // with a small depth tracker (comments stripped) and hold the margin.
  // Script BODIES are stripped before counting (their JS builds tag-like
  // strings that drift the depth tracker; verified: without this the depth
  // ends at +23 and only ordering luck kept the count right); the empty
  // <script></script> shells stay so the elements themselves are counted.
  const bodyHtml = PAGE.slice(PAGE.indexOf('<body'), PAGE.indexOf('</body>'))
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/(<script\b[^>]*>)[\s\S]*?(<\/script>)/g, '$1$2');
  let depth = 0, children = 0;
  const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^"'>])*)>/g;
  // True HTML void elements plus, for readability, the SVG shape names this
  // page writes self-closing (those are already handled by the trailing-/
  // check; the depth-0 tripwire below is the actual protection either way).
  const voidTags = new Set(['img', 'input', 'br', 'hr', 'meta', 'link', 'source', 'path', 'circle', 'rect', 'use', 'stop',
    'area', 'base', 'col', 'embed', 'track', 'wbr', 'param']);
  let m2;
  while ((m2 = tagRe.exec(bodyHtml)) !== null) {
    const [, close, tag, attrs] = m2;
    if (tag === 'body') continue;
    if (close) { depth--; continue; }
    if (depth === 0) children++;
    if (!voidTags.has(tag.toLowerCase()) && !/\/\s*$/.test(attrs)) depth++;
  }
  assert.ok(children <= 38, 'the body has ' + children + ' direct children; the consolidated grid reserves 38 pre-rail auto rows, and past it a visible notice can be silently clipped. Widening repeat(38, auto) is a FIVE-site renumbering: the rails\' explicit rows must move with it (#rail-agents 39, #alist 40, #rail-me 41, #panel-projects 39 / span 3), or all four land inside the widened pre-rail range');
  assert.ok(children >= 20, 'the body child counter read ' + children + ', implausibly low -- the counter itself has likely broken, re-derive before trusting the headroom claim');
  assert.equal(depth, 0, 'the child counter ended at depth ' + depth + ', not 0 -- it is mis-parsing the markup and its count cannot be trusted');
});

test('the remaining #980 rulings each keep their pin', () => {
  // One pin per ruling is this file's contract; these four had none.
  assert.match(PAGE, new RegExp(cons + '\\.fold-a #alist \\.pj-empty \\{ display: none; \\}'),
    'the folded 48px strip shows the letter-wrapped empty-state card again');
  assert.match(PAGE, new RegExp(cons + ' \\.pj-member \\.lav\\.pj-face \\{ width: 28px; height: 28px; flex: 0 0 28px; aspect-ratio: 1;'),
    'the member avatar lost its shrink-proof 1:1 pin; a long name can squish it out of round again');
  assert.match(PAGE, new RegExp(cons + ' \\.pjmidhead \\.pjhead \\.pj-desc \\{ white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0;'),
    'the header description no longer truncates to one line');
  assert.match(PAGE, /desc\.title = p\.description \|\| ''/,
    'the truncated description lost its full-text hover (the title the truncation comment promises)');
  /* kosmos#1006 moved this from the consolidated-scoped selector to the base
     `.cinput` rule, which is where the max-height that CREATES the scrollbar
     lives. Pinning the base rule is the stronger claim: the old pin passed
     happily while every composer outside the consolidated view still showed
     the track, which is the bug Josh reported three weeks later on a different
     screen. Asserting the property sits with its cause is what stops the fix
     being scoped to one layout again. */
  assert.match(PAGE, /\.cinput \{[^}]*scrollbar-width: none; -ms-overflow-style: none;/,
    'the composer scrollbar hide is no longer on the base .cinput rule, so composers outside the consolidated view show their track again');
  assert.match(PAGE, /\.cinput::-webkit-scrollbar \{ display: none; \}/,
    'the WebKit half of the composer scrollbar hide is gone -- this is the half that matters in the Mac app');
});

/* THE SCROLL PATH IS ASSERTED PER SUB-VIEW, DERIVED FROM THE PAGE, rather than
   as one literal selector list. The old pin named four ids in one exact order
   with one exact line break, so #1382 adding a legitimate fifth sub-view turned
   it red on correct code -- while the test's own name promises EVERY sub-view
   scrolls. It was pinning WHICH views exist, an incidental property, instead of
   the property it is named for.
   => Loosened on the axis nothing consumes (which ids, in what order, on which
   line), tightened on the axis the name promises (each one HAS the path). A
   sixth sub-view now passes when it was wired and fails NAMING ITSELF when it
   was not, so this guard gets stronger as the app grows instead of needing an
   edit every time.
   #pj-one-view is the SINGLE-PROJECT WRAPPER, not a sub-view. It holds the
   others and deliberately carries min-height: 0 with NO overflow, so the scroll
   belongs to the pane inside it. Excluded by name and on purpose, not by
   accident. */
const SCROLL_WRAPPER = 'pj-one-view';
const SUB_VIEW_IDS = [...new Set(
  [...PAGE.matchAll(/id="(pj-[a-z]+-view)"/g)].map(m => m[1])
)].filter(id => id !== SCROLL_WRAPPER);

/* Comments are stripped before the rule scan. A CSS comment can contain a brace
   and an id, so an unstripped scan could credit a sub-view with a scroll path it
   only has in prose -- and that error runs in the reassuring direction, hiding a
   real miss rather than inventing one. */
const SCROLL_GRANTED = new Set(
  [...PAGE.replace(/\/\*[\s\S]*?\*\//g, ' ')
      .matchAll(/([^{}]*)\{ min-height: 0; overflow-y: auto;/g)]
    .flatMap(m => [...m[1].matchAll(/#(pj-[a-z]+-view)/g)].map(x => x[1]))
);

test('every projects sub-view scrolls inside the no-page-scroll grid', () => {
  // The page used to grow and scroll; with the body's scroll now reserved for
  // the too-short-window case only (overflow-y: auto + a 200px floor), a view
  // without its own overflow is clipped with no scrollbar and no wheel
  // target -- Project settings' bottom controls unreachable.

  /* POPULATION FLOOR. If the id sweep above reads the page wrong it returns an
     empty list, every sub-view is trivially accounted for, and a missing scroll
     path passes unseen. A guard that can return zero for a page it failed to
     read is not a guard. Deliberately below today's six, so removing a view is
     not a false red, and far above the nothing a broken read returns. */
  assert.ok(SUB_VIEW_IDS.length >= 5,
    'the sub-view sweep found ' + SUB_VIEW_IDS.length + ' views, so it is not reading the page and a lost scroll path would pass unseen');

  const missing = SUB_VIEW_IDS.filter(id => !SCROLL_GRANTED.has(id));
  assert.deepEqual(missing, [],
    'these projects sub-views lost their scroll path under the viewport-height grid: ' + missing.join(', '));
  assert.match(PAGE, new RegExp(cons + ' #pj-list-view \\{ min-height: 0; overflow-y: auto;'),
    'the projects list view lost its scroll');
});

test('the projects rail header pins over its scrolling list, like the agents header', () => {
  assert.match(PAGE, new RegExp(cons + ' #rail-projects \\{ position: sticky; top: 0; z-index: 4; background: var\\(--k-side, #f3f1ec\\);'),
    'the projects header scrolls away with a long list while the agents header stays -- the two rails answer the same gesture differently');
});

test('the right-column cards stretch into their tracks, or they overlap each other on a small laptop', () => {
  /* 🛑 MEASURED, NOT REASONED. With `align-self: start` a card is sized by its
     own content under the 38vh cap, never by its track. The two `minmax(0,auto)`
     tracks have a base size of 0, so under pressure grid splits the leftover
     equally and they land below their content; the track shrinks faster than the
     cap, and past roughly 770px of viewport the cards overflow their areas. They
     are opaque and paint in DOM order, so Tasks covered the top of Files and
     Files covered the top of Members -- the sticky Files label and the
     + Add member control disappeared under an opaque card.
     ⚠️ The body's overflow-y escape hatch cannot catch this: the tracks SHRINK,
     so the grid never exceeds the viewport and no page scrollbar ever appears.
     Headless at 1280 wide, 14 rows per card: `start` overlapped by 8px at 720
     and 22px at 600; `stretch` overlapped at none of 900/720/600. */
  assert.match(PAGE, new RegExp(cons + ' \\.pj3 > \\.pjsplit > \\.pjcard, ' + cons + ' \\.pj3 > aside\\.pjcol:not\\(\\.pjsplit\\) \\{ min-height: 0; align-self: stretch;'),
    'the right-column cards no longer stretch into their tracks: below ~770px they overflow and cover each other, and the page-scroll safety valve cannot fire because the tracks shrink rather than grow');
});

test('the two auto-row cards carry viewport caps a tall list cannot game', () => {
  // Measured in review: with 30 rows in Tasks and Files, %-caps against
  // content-sized tracks let both grow ~460px and push Members off-screen.
  assert.match(PAGE, new RegExp(cons + ' \\.pj3 > aside\\.pjcol:not\\(\\.pjsplit\\), ' + cons + ' \\.pj3 > \\.pjsplit > \\.pjcard-files \\{ max-height: 38vh;'),
    'Tasks/Files lost their viewport caps; tall content can push Members off the bottom again');
  /* ⚠️ `calc(100% - 12px)`, and the 12px is the card's own bottom margin.
     `max-height` resolves against the grid AREA, so a plain 100% makes the
     margin box 12px taller than its track and a full Members list spills out
     to the body scroll -- a page scrollbar in the exact state this branch
     removes, and one that does not need a short window to appear. */
  assert.match(PAGE, new RegExp(cons + ' \\.pj3 > \\.pjsplit > \\.pjcard-members \\{ max-height: calc\\(100% - 12px\\);'),
    'Members lost its track-bounded cap');
});
