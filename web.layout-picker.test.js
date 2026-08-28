'use strict';
/**
 * #520: the consolidated view is one option in Settings > Styles, tabs by
 * default. What this pins: the picker's two tiles with tabs checked in the
 * markup; the page writes data-layout only from what the engine answered
 * (never from a click alone); the mode exists at 960px and up, with both
 * rails auto-folding below 1280px rather than the view dropping straight
 * to tabs (2026-08-25, Josh: "thats perfect, lets try that"); and the
 * consolidated CSS never removes the board's grid or list from the page, it
 * re-lays them. The fold-first behavior itself is pinned in
 * web.consolidated-breakpoint.test.js.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = PAGE.slice(PAGE.lastIndexOf('<script>'));

/* ⚠️ THE "IS IT STYLED AWAY" GUARDS MUST READ DECLARATIONS, NOT PROSE.
   They are `doesNotMatch` on the raw block, so they fire on any occurrence of a
   slot's id -- including one inside a COMMENT. That is not hypothetical: a
   comment added beside the .apphead override, explaining that those very slots
   are what the override protects, turned both guards red while the CSS was
   correct. A guard that a correct explanation can break teaches people to stop
   explaining, which is the opposite of what it is for.
   🔑 Stripping comments is what makes the assertion mean what its message says.
   The positive control below proves the strip did not also remove the guard's
   teeth: a planted `display: none` on a real slot must still be caught. */
const stripCssComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
/* ⚠️ Declared HERE, above every use. It previously sat 61 lines below its
   first caller and worked only because node:test defers test callbacks past
   module evaluation -- a describe wrapper or an only-run would have put it in
   the temporal dead zone. */

/* The guard's regex, declared ONCE and shared by the assertion and its control,
   so the two cannot drift into testing different things -- which is exactly what
   happened when the control carried a paraphrase of it.
   ⚠️ And declared HERE for the same reason as the helper above: putting it
   beside the control left it in the temporal dead zone for the assertion that
   runs first. Same bug, one variable over, inside the fix for it. */
const GUARD = /(?:#pj-room|#pj-room-search|\.composer)(?:(?!scrollbar)[^{])*\{[^}]*display: none/;

test('the picker sits at the top of Styles with two tiles, tabs checked in the markup', () => {
  const at = PAGE.indexOf('id="s-sec-styles"');
  const theme = PAGE.indexOf('id="style-theme"', at);
  const sec = PAGE.slice(at, theme);
  assert.match(sec, /id="layout-field"/, 'the picker is not in Styles, above the theme');
  assert.match(sec, /role="radio" aria-checked="true" data-layout-pick="tabs"/);
  assert.match(sec, /role="radio" aria-checked="false" data-layout-pick="consolidated"/);
  assert.match(sec, /Needs a window at least 960 pixels wide; the side columns fold to icons as it narrows, and narrower than 960, the tabs come back\./);
  assert.equal((PAGE.match(/data-layout-pick="/g) || []).length, 2);
});

test('the root attribute is written from the engine\'s answer, and a click only asks the engine', () => {
  const fn = SCRIPT.slice(SCRIPT.indexOf('function applyLayout('), SCRIPT.indexOf('function applyStyle('));
  assert.match(fn, /document\.documentElement\.setAttribute\('data-layout', want\)/);
  assert.match(fn, /const want = layout === 'consolidated' \? 'consolidated' : 'tabs'/, 'anything but consolidated is the tabs');
  const click = fn.slice(fn.indexOf("addEventListener('click'"));
  assert.match(click, /fetch\('\/api\/style', \{ method: 'PUT'/);
  assert.match(click, /applyLayout\(r\.layout, true\)/, 'the click applies its own wish rather than the engine\'s answer');
  assert.doesNotMatch(click, /setAttribute\('data-layout'/, 'the click writes the root attribute directly');
  assert.match(SCRIPT, /applyLayout\(r\.layout, apply\);/, 'paintStyles does not carry the layout');
});

test('the mode is gated on width and on the two tabs it merges; Settings stays a whole page', () => {
  assert.match(SCRIPT, /const CONSOLIDATED_MIN_WIDTH = 960;/, 'the floor moved or lost its name');
  assert.match(SCRIPT, /const CONSOLIDATED_FOLD_WIDTH = 1280;/, 'the auto-fold width moved or lost its name');
  assert.match(SCRIPT, /window\.innerWidth >= CONSOLIDATED_MIN_WIDTH/);
  const st = SCRIPT.slice(SCRIPT.indexOf('function showTab('), SCRIPT.indexOf('function showTab(') + 4000);
  assert.match(st, /const cons = layoutConsolidated\(\) && \(tab === 'agents' \|\| tab === 'projects'\)/);
  assert.match(st, /document\.body\.classList\.toggle\('consolidated', cons\)/);
  assert.match(PAGE, /@media \(min-width: 960px\) \{\s*html\[data-layout="consolidated"\] body\.consolidated \{ display: grid/);
});

test('the consolidated CSS re-lays the board list and the projects panel; it hides nothing a person needs', () => {
  const css = PAGE.slice(PAGE.indexOf('/* ---- #520: the consolidated view'), PAGE.indexOf('.laytiles {'));
  assert.ok(css.length > 200, 'the CSS block moved; re-anchor');
  /* The whole media block, to its closing brace, so an added rule can never
     push the ones asserted on out of the window. */
  const start = PAGE.indexOf('@media (min-width: 960px) {\n  html[data-layout="consolidated"]');
  const block = PAGE.slice(start, PAGE.indexOf('\n}\n', start) + 3);
  assert.match(block, /> #alist \{ grid-column: 1/);
  assert.match(block, /> #panel-projects \{ grid-column: 2/);
  /* #980 note: the tempered selector part ((?!scrollbar)[^{])* keeps this
     guard from tripping on `::-webkit-scrollbar { display: none }` -- a
     hidden scrollbar TRACK on the composer's textarea is a #980 ask, not
     the composer being hidden. The guard still catches the real thing:
     any of these elements themselves carrying display: none. */
  assert.doesNotMatch(stripCssComments(block), GUARD, 'the room, its search or its composer is hidden in the consolidated view');
  /* ⚠️ THE CONTROL RUNS THE GUARD'S OWN REGEX, not a similar one. A first
     version asserted `/\.composer[^{]*\{[^}]*display: none/`, which never
     exercised the tempered `(?!scrollbar)` part and never touched the two id
     alternatives -- so mis-tightening the temper would blind the guard while
     this control stayed green, still reporting that it could catch a real
     display:none. A control that tests a paraphrase of the guard is not a
     control. */
  for (const planted of ['.composer { display: none; }', '#pj-room { display: none; }', '#pj-room-search { display: none; }']) {
    assert.match(stripCssComments('a{}\n  ' + planted), GUARD,
      `control: the guard no longer catches a real display:none on ${planted.split(' ')[0]}`);
  }
  assert.doesNotMatch(stripCssComments('/* .composer display: none in prose */'), GUARD,
    'control: a comment naming the composer can redden the guard again');
});

test('no em dash in what a person reads', () => {
  const at = PAGE.indexOf('id="layout-field"');
  assert.doesNotMatch(PAGE.slice(at, at + 4000), /—/);
});

test('piece two: the rail heads exist once, hidden until the mode, with a + on the board\'s own actions and a fold per rail', () => {
  assert.equal((PAGE.match(/id="rail-agents"/g) || []).length, 1);
  assert.equal((PAGE.match(/id="rail-projects"/g) || []).length, 1);
  assert.match(PAGE, /<div class="railhead" id="rail-agents" hidden>/);
  assert.match(PAGE, /<div class="railhead" id="rail-projects" hidden>/);
  assert.match(SCRIPT, /getElementById\('rail-agents'\)\.hidden = !cons/);
  assert.match(SCRIPT, /getElementById\('rail-agents-new'\)\.addEventListener\('click', \(\) => document\.getElementById\('new-agent'\)\.click\(\)\)/, 'the rail + is not the board\'s own New agent');
  assert.match(SCRIPT, /getElementById\('rail-projects-new'\)\.addEventListener\('click', \(\) => document\.getElementById\('pj-new'\)\.click\(\)\)/, 'the rail + is not the list\'s own New project');
  assert.match(SCRIPT, /sessionStorage\.getItem\('rail-fold-' \+ k\)/, 'a fold is not per session');
  assert.match(PAGE, /body\.consolidated\.fold-a \{ grid-template-columns: 48px/);
  assert.match(PAGE, /body\.consolidated\.fold-p #panel-projects \{ grid-template-columns: 48px/);
  /* The switch-specificity trap: `#pj-list.asgrid { display: flex }` carries
     one more class than a `#pj-list { display: none }` fold, so the fold must
     name `.asgrid` too or it loses regardless of order. Measured 2026-08-24. */
  assert.match(PAGE, /body\.consolidated\.fold-p #pj-list\.asgrid[^{]*\{ display: none; \}/, 'the projects fold lost to #pj-list.asgrid again');
});

test('piece three: the person\'s row exists once, hidden until the mode, opens Settings, and its pill is the header\'s own theme buttons', () => {
  assert.equal((PAGE.match(/id="rail-me"/g) || []).length, 1);
  assert.match(PAGE, /<div class="railme" id="rail-me" hidden>/);
  const row = PAGE.slice(PAGE.indexOf('id="rail-me"'), PAGE.indexOf('id="rail-me"') + 2500);
  assert.equal((row.match(/data-theme-set="(light|dark)"/g) || []).length, 2, 'the row does not carry the two theme buttons the document handler serves');
  assert.match(SCRIPT, /getElementById\('rail-me'\)\.hidden = !cons/);
  assert.match(SCRIPT, /querySelector\('\.tab\[data-tab="settings"\]'\)/, 'the row does not open Settings through the tab');
  assert.match(SCRIPT, /function paintRailMe\(\)/);
  assert.match(SCRIPT, /paintRailMe\(\);\n  if \(!face\) return;/, 'paintYou no longer paints the row');
});

test('piece four: the row draws its ring only with a known memory and its warning only on needs-you, and both are hidden outside the mode', () => {
  const fn = SCRIPT.slice(SCRIPT.indexOf('function lrowRing('), SCRIPT.indexOf('function lrow('));
  assert.match(fn, /if \(pct === null\) return '';/, 'a ring is drawn for an unknown memory');
  assert.match(fn, /class="gf \$\{band\}"/, 'the ring does not use the gauge\'s own band classes');
  assert.match(SCRIPT, /\$\{av\}\$\{lrowRing\(a\)\}\$\{m\.st === 'attn' \? LROW_WARN : ''\}/, 'the warning is not gated on the needs-you state');
  assert.match(SCRIPT, /<div class="lav">\$\{off\}<\/div>/, 'a stopped row reads a memory the route does not emit for it');
  assert.match(PAGE, /\.lav \.lring, \.lav \.lwarn \{ display: none; \}/, 'the ring or warning shows in the tabs\' list layout');
  assert.match(PAGE, /body\.consolidated \.lrow > \.lav > \.lwarn \{ display: block/);
});



test('piece five: the header folds to its notice slots, the K mark is the header\'s own image at the rail top, and the rails go flat', () => {
  const start = PAGE.indexOf('@media (min-width: 960px) {\n  html[data-layout="consolidated"]');
  const block = PAGE.slice(start, PAGE.indexOf('\n}\n', start) + 3);
  const decls = stripCssComments(block);
  assert.match(block, /> \.apphead \.klink, [^{]*> \.apphead h1,\n[^{]*> \.apphead \.tabs, [^{]*> \.apphead \.headright \{ display: none; \}/, 'the header does not fold to its slots');
  assert.doesNotMatch(decls, /> \.apphead \{[^}]*display: none/, 'the whole header is hidden, and with it the update and offline notices');
  /* ⚠️ THIS USED TO FORBID MENTIONING A SLOT AT ALL, which is a proxy for the
     real property: a slot must not be styled AWAY. kosmos#1188 moved the
     header's bottom margin onto the slots (so the gap appears only when a notice
     is actually on screen), which mentions them for a reason that is the
     opposite of hiding. Now it forbids the hiding itself. */
  for (const slot of ['#utoast-slot', '#unote-slot', '#uoffline-slot', '#unews-slot']) {
    const rules = decls.match(new RegExp('[^{}]*' + slot + '[^{}]*\\{[^}]*\\}', 'g')) || [];
    for (const r of rules) {
      assert.doesNotMatch(r, /display:\s*none|visibility:\s*hidden/, 'a notice slot is styled away: ' + r.trim());
    }
  }
  // CONTROL: the strip must not have disarmed the check.
  assert.match(stripCssComments('/* #utoast-slot is fine */\n  #utoast-slot { display: none; }'), /#utoast-slot/,
    'stripCssComments removed a real declaration, so the two guards above can no longer catch a styled-away slot');
  assert.doesNotMatch(stripCssComments('/* mentions #utoast-slot in prose only */'), /#utoast-slot/,
    'stripCssComments no longer strips comments, so a comment naming a slot will fail the guards again');
  /* 🛑 THE K MARK IS GONE (kosmos#1188). Josh, 2026-08-27: "I want to get rid of
     the K icon in the top left corner." These three lines pinned its markup, its
     painter and its click handler, and all three were correct until he asked for
     it removed. Replaced with what he asked for in its place, so the head is
     still guarded rather than merely unpinned: the + sits INSIDE .lead beside the
     name, and the fold arrow stays out in .railacts on the right. */
  assert.doesNotMatch(PAGE, /class="railk"|id="rail-k"|rail-k-img/, 'the K mark came back to the rail head');
  assert.match(PAGE, /<span class="lead"><button class="fold plus" type="button" id="rail-agents-new"[^>]*>\+<\/button><span class="railname">Agents<\/span><\/span>/,
    'the agents + is not inside .lead beside the name');
  assert.match(PAGE, /<span class="lead"><button class="fold plus" type="button" id="rail-projects-new"[^>]*>\+<\/button><span class="railname">Projects<\/span><\/span>/,
    'the projects + is not inside .lead beside the name');
  assert.match(PAGE, /id="rail-agents-fold"/, 'the agents fold arrow left .railacts');
  assert.match(block, /body\.consolidated \.lrow \{ border: 0; background: none;/);
});

test('piece six: the board notice bars do not sit over the consolidated grid', () => {
  const start = PAGE.indexOf('@media (min-width: 960px) {\n  html[data-layout="consolidated"]');
  const block = PAGE.slice(start, PAGE.indexOf('\n}\n', start) + 3);
  assert.match(block, /> #found-wrap, [^{]*> #removed-wrap, [^{]*> #restart-wrap \{ display: none; \}/, 'the found/removed/restart bars still stack over the grid');
  /* Control: the news line is NOT hidden here; it has a home in the header slot.
     Comments stripped for the same reason as piece five above -- a comment
     explaining what this protects must not be able to fail it. */
  /* ⚠️ SAME WIDENING AS PIECE FIVE: this forbade MENTIONING the news line, as a
     proxy for hiding it. kosmos#1188 gives #unews-slot a margin so the header's
     old bottom gap appears only when a notice is on screen, which mentions it in
     order to show it properly. The property is that it is not hidden. */
  const newsRules = stripCssComments(block).match(/[^{}]*(?:#unews-slot|#newsbar)[^{}]*\{[^}]*\}/g) || [];
  for (const r of newsRules) {
    assert.doesNotMatch(r, /display:\s*none|visibility:\s*hidden/, 'the news line was hidden rather than relocated: ' + r.trim());
  }
});

/**
 * ⚠️ SUPERSEDES the old "project cards go flat" half of piece six, above.
 * That assertion pinned a citation nobody had checked: the comment claimed
 * the flat, borderless treatment matched "the mock", but the real mock
 * (installkosmos.com/consolidated-mock, screenshotted and read from its
 * own source 2026-08-25) draws Tasks/Members/Files as white, bordered,
 * rounded cards on a tinted column background -- the opposite of flat.
 * See web.consolidated-match-mock.test.js for the corrected behavior and
 * the full account of the citation error.
 */

test('piece seven: the projects panel drops its box padding in the consolidated view, so the title sits flush with the rail top', () => {
  const start = PAGE.indexOf('@media (min-width: 960px) {\n  html[data-layout="consolidated"]');
  const block = PAGE.slice(start, PAGE.indexOf('\n}\n', start) + 3);
  assert.match(block, /> #panel-projects \{ padding: 0; border: 0; background: none;/, 'the projects panel keeps its box padding, which sits the title below the agents rail');
  assert.match(block, /body\.consolidated \.pjhead \{ margin-bottom: 10px; padding: 0; \}/);
});

test('piece eight: the member rows go flat in the consolidated view, not boxed', () => {
  const start = PAGE.indexOf('@media (min-width: 960px) {\n  html[data-layout="consolidated"]');
  const block = PAGE.slice(start, PAGE.indexOf('\n}\n', start) + 3);
  assert.match(block, /body\.consolidated \.pj-member \{ border: 0; padding: 6px 8px;/, 'the member rows keep their box border in the consolidated view');
  assert.match(block, /body\.consolidated \.pj-member:hover \{ background: var\(--k-surface\); \}/);
});

test('piece nine, then #761 (2026-08-25): the project head moves into the conversation header in EVERY layout now, not only consolidated', () => {
  const src = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
  // The move is a function called from the layout switch, so both boot and a click take the same path.
  assert.match(src, /document\.documentElement\.setAttribute\('data-layout', want\);\n  placeProjectHead\(\);/);
  const fn = src.match(/function placeProjectHead\(\) \{[\s\S]*?\n\}/);
  assert.ok(fn, 'placeProjectHead is defined');
  assert.match(fn[0], /mid\.insertBefore\(head, mid\.firstChild\)/, 'the head goes first in the conversation header');
  // Josh, 2026-08-25 10:12 CDT, asked for the tab view to match: there is no
  // "move it back for tabs" branch left to test for. If one reappears here
  // it is a regression of that request, not a restored feature.
  assert.doesNotMatch(fn[0], /grid\.parentElement\.insertBefore/, 'the tabs-only un-merge branch should not have returned');
  // Exercised, not just read: a bare DOM stand-in runs the merge, twice, and
  // from both starting positions (never-merged, and already-merged).
  const mk = (children = []) => { const n = { children: [...children], parentElement: null, get firstChild() { return this.children[0] || null; },
    insertBefore(node, before) { if (node.parentElement) node.parentElement.children = node.parentElement.children.filter((c) => c !== node); node.parentElement = this; const i = before ? this.children.indexOf(before) : -1; if (i < 0) this.children.push(node); else this.children.splice(i, 0, node); } }; children.forEach((c) => { c.parentElement = n; }); return n; };
  const head = mk(); const dlab = mk(); const mid = mk([dlab]); const grid = mk(); mk([head, grid]);
  const document = { querySelector: (sel) => ({ '#pj-one-view .pjhead': head, '#pj-one-view .pjmidhead': mid })[sel] };
  // eslint-disable-next-line no-new-func
  const place = new Function('document', fn[0] + '\nreturn placeProjectHead;')(document);
  place();
  assert.equal(head.parentElement, mid); assert.equal(mid.children[0], head, 'ahead of the Conversation label');
  place();
  assert.equal(mid.children.filter((c) => c === head).length, 1, 'a second apply does not duplicate it');
  place();
  assert.equal(head.parentElement, mid, 'a third apply (simulating a tab-view boot after a consolidated one) leaves it merged, never un-merges it');
  // And the CSS: the label steps aside, the header takes the rule, in
  // BOTH the consolidated-scoped block and the unscoped one that gives the
  // tab view the same shape (see the comment above the unscoped rules).
  const consolidatedBlock = src.slice(src.indexOf('html[data-layout="consolidated"]'));
  assert.match(consolidatedBlock, /body\.consolidated \.pjmidhead > \.dlab \{ display: none; \}/);
  assert.match(consolidatedBlock, /body\.consolidated \.pjmidhead \{[^}]*border-bottom: 1px solid var\(--k-rule\)/);
  assert.match(src, /\.pjmidhead:has\(\.pjhead\) > \.dlab \{ display: none; \}/, 'the tab-view (unscoped) rule hiding the label');
  assert.match(src, /\.pjmidhead:has\(\.pjhead\) \{[^}]*border-bottom: 1px solid var\(--k-rule\)/, 'the tab-view (unscoped) rule taking the header rule');
});

test('piece ten: the + sits at the card heads and the minus on the member rows, in the consolidated view only', () => {
  const src = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
  // The minus is drawn only when the project page asks for it, and carries the settings row's own data-drop.
  assert.match(src, /function pjMember\(m, suppressTold, withMinus\)/);
  assert.match(src, /withMinus\n\s+\? '<button class="pj-minus" type="button" data-drop="' \+ esc\(m\.sessionName\)/);
  assert.match(src, /roster\.map\(\(m\) => pjMember\(m, !!sharedTold, true\)\)/, 'the project page asks for it');
  // #762: Project settings asks for it too now (the same red-X treatment,
  // not a third pattern), so the count is two -- the tab/consolidated view
  // AND the settings rows -- not one.
  assert.equal((src.match(/pjMember\([^)]*, true\)/g) || []).length, 2, 'the minus is drawn somewhere other than these two call sites');
  assert.match(src, /rows\.map\(\(m\) => pjMember\(m, false, true\)\)/, 'the settings rows ask for it too (#762)');
  // One drop for both lists, both routed through the confirm modal (#762
  // moved the settings rows onto the same ask-first flow the project page
  // already had).
  assert.match(src, /async function dropMember\(btn, msg\)/);
  assert.match(src, /getElementById\('pjs-members'\)\.addEventListener\('click', \(e\) => \{\n\s+const btn = e\.target\.closest\('\.pj-minus\[data-drop\]'\);[\s\S]{0,80}openMemModal\(btn, document\.getElementById\('pjs-members-msg'\)\)/);
  // #761: the minus asks first; the dialog's Remove is what calls dropMember.
  // #762 factored the modal setup into openMemModal, shared by both
  // listeners (the settings rows above and the tab view here), so the
  // pin moved from the listener body onto the shared function.
  assert.match(src, /getElementById\('pj-one-agents'\)\.addEventListener\('click', \(e\) => \{\n\s+const btn = e\.target\.closest\('\.pj-minus\[data-drop\]'\);[\s\S]{0,80}openMemModal\(btn, document\.getElementById\('pj-one-msg'\)\)/);
  assert.match(src, /function openMemModal\(btn, msg\) \{[\s\S]{0,1200}getElementById\('mem-modal'\)\.hidden = false;/);
  assert.match(src, /getElementById\('mem-go'\)\.addEventListener\('click', \(\) => \{[\s\S]{0,300}dropMember\(p\.btn, p\.msg \|\| document\.getElementById\('pj-one-msg'\)\)/);
  // Hidden outside the mode; on hover inside it. The Remove door steps aside there.
  // #761: the minus is in both views now; the base rule draws it hidden-until-hover, and the door is gone everywhere.
  assert.match(src, /\n\.pj-minus \{ display: grid;[^}]*opacity: 0; \}\n\.pj-member:hover \.pj-minus, \.pj-minus:focus-visible \{ opacity: 1; \}/);
  assert.match(src, /\n#pj-remove-member \{ display: none; \}/);
  const block = src.slice(src.indexOf('html[data-layout="consolidated"]'));
  assert.match(block, /body\.consolidated \.pj-member:hover \.pj-minus, [^{]*\.pj-minus:focus-visible \{ opacity: 1; \}/);
  assert.match(block, /body\.consolidated #pj-remove-member \{ display: none; \}/);
  // The + is the wired button, moved to the head row and shrunk; its words stay for the accessible name (font-size: 0, not display: none).
  assert.match(block, /\.pjsplit \.pjcard-members > \.pj-addmem, [^{]*\.pj3 #pj-newtask \{ grid-column: 2; grid-row: 1; width: 22px; height: 22px;[^}]*font-size: 0;/, 'the + rule outranks the card\'s span-all rule (it lost once, and sat over the label)');
  assert.doesNotMatch(src, /id="pj-newtask" type="button" style=/, 'the inline margin moved to CSS so the mode can restyle it');
});
