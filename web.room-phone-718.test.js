'use strict';
/* #718 mobile: the project room on a phone. The geometry and the tap behaviour are measured
   by docs/browser-checks/render-room-msgbox-2806.js (phone, touch and hover arms). This file
   pins what that check does not render: that the conversation-first order is a DOM move,
   and the touchscreen rules that keep the reaction bar reachable and closable. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
/* Every @media block, found by COUNTING BRACES. A lazy match up to the first "\n}" ran on for
   hundreds of lines past a one-line block (main's `@media (hover: none) { ... }` at the top of
   the page), so a rule moved out of its block still read as inside it. */
function mediaBlocks() {
  // Where CSS comments are, so an "@media" MENTIONED in a comment is not read as a block.
  const comments = []; for (let c = html.indexOf('/*'); c !== -1; c = html.indexOf('/*', c + 2)) { const e = html.indexOf('*/', c + 2); comments.push([c, e < 0 ? html.length : e + 2]); if (e < 0) break; c = e; }
  const inComment = (i) => comments.some(([a, b]) => i >= a && i < b);
  const out = []; const re = /@media ([^{]+) \{/g; let m;
  while ((m = re.exec(html))) {
    if (inComment(m.index)) continue;
    let j = re.lastIndex, d = 1;
    // Count braces in CSS only: skip comments and quoted strings (both hold braces on this page).
    while (d && j < html.length) {
      const c = html[j];
      if (c === '/' && html[j + 1] === '*') { const e = html.indexOf('*/', j + 2); j = e < 0 ? html.length : e + 2; continue; }
      if (c === '"' || c === "'") { j += 1; while (j < html.length && html[j] !== c) { if (html[j] === '\\') j += 1; j += 1; } j += 1; continue; }
      if (c === '{') d += 1; else if (c === '}') d -= 1;
      j += 1;
    }
    out.push({ query: m[1].trim(), start: m.index, end: j, body: html.slice(re.lastIndex, j - 1) });
    re.lastIndex = j;
  }
  return out;
}
const MEDIA = mediaBlocks();
const blocks = (q) => MEDIA.filter((b) => b.query === '(' + q + ')').map((b) => b.body).join('\n');
const outsideMedia = (q) => { let t = html; MEDIA.filter((b) => b.query === '(' + q + ')').sort((a, b) => b.start - a.start).forEach((b) => { t = t.slice(0, b.start) + t.slice(b.end); }); return t; };

test('on a phone the conversation comes first IN THE DOM, never by CSS order (#1017)', () => {
  // A visual-only reorder splits reading order from tab order; the browser check measures the
  // real DOM order at 375 and 800 (render-room-msgbox-2806, phone arm).
  const phone = blocks('max-width: 30rem');
  assert.match(phone, /#pj-room\.thread \{/, 'the phone block was found (an empty block would make the next line vacuous)');
  // No CSS order on either column, in any rule anywhere on the page.
  assert.doesNotMatch(html, /\.pj(mid|split)\b[^{}]*\{[^}]*\border\s*:/);
  // Grid placement splits reading order the same way; none on either column at phone width.
  assert.doesNotMatch(phone, /\.pj(mid|split)\b[^{}]*\{[^}]*\bgrid-(row|column|area)\s*:/);
  assert.match(html, /function pjPhoneOrder\(\) \{/);
  // The Members/Files column is what moves. The conversation column holds the composer, and
  // moving it would blur the composer (iOS does not restore the keyboard for a scripted focus).
  // Anchored to its branch: a swap of the phone and wide moves must fail here, not only in the browser.
  assert.match(html, /if \(window\.matchMedia\(PJ_PHONE_MQ\)\.matches\) \{\n    if \(mid\.nextElementSibling !== split\) mid\.after\(split\);\n  \} else if \(mid\.previousElementSibling !== split\) \{\n    grid\.insertBefore\(split, mid\);\n  \}/);
  assert.doesNotMatch(html, /grid\.insertBefore\(mid,|split\.after\(mid\)/);
  assert.match(html, /pjPhoneMq\.addEventListener\('change', pjPhoneOrder\)/);
});

test("the script's phone and touch queries are the CSS blocks' exact queries", () => {
  // Duplicated by value (CLAUDE.md #5): if the CSS moves to another width, the DOM move must too.
  const q = (name) => { const m = html.match(new RegExp('const ' + name + " = '([^']+)';")); assert.ok(m, name + ' is declared'); return m[1]; };
  const block = (query) => MEDIA.filter((b) => b.query === query).map((b) => b.body).join('\n');
  assert.match(block(q('PJ_PHONE_MQ')), /#pj-room\.thread \{ padding: 12px 6px;/, 'the room phone rules live under PJ_PHONE_MQ');
  assert.match(block(q('PJ_TOUCH_MQ')), /#pj-room \.msg\.rxn-show \.rxn-quick \{/, 'the room touch rules live under PJ_TOUCH_MQ');
});

test('the link card has no left bar and the same border as the file card beside it', () => {
  const rule = (sel) => { const m = html.match(new RegExp('\\n\\' + sel + ' \\{([^}]*)\\}')); assert.ok(m, sel + ' rule found'); return m[1]; };
  const lpv = rule('.lpv'); const att = rule('.att');
  assert.doesNotMatch(lpv, /border-left/, 'no left accent bar (Josh, 2026-09-24)');
  const border = (r) => (r.match(/border: ([^;]+);/) || [])[1];
  assert.ok(border(lpv) && border(lpv) === border(att), 'lpv ' + border(lpv) + ' vs att ' + border(att));
});

test('on a touchscreen only a tap (or focus) opens the room reaction bar, never sticky hover', () => {
  const t = blocks('hover: none');
  assert.match(t, /#pj-room \.msg\.rxn-show \.rxn-quick \{ opacity: 1; pointer-events: auto; \}/);
  assert.match(t, /#pj-room \.msg:hover:not\(\.rxn-show\) \.rxn-quick:not\(:focus-within\) \{ opacity: 0; pointer-events: none; \}/);
  assert.match(t, /#pj-room \.msg:hover:not\(\.rxn-show\) \.msg-bd,\n  #pj-room \.msg:hover:not\(\.rxn-show\) \.msg-bd::before \{ background-image: none; \}/, 'no sticky hover tint either');
  assert.match(t, /#pj-room \.rxn \{ min-height: 36px; padding: 2px 10px; \}/, 'a reaction pill is thumb-size on ANY touchscreen, landscape phones included');
  assert.match(t, /#pj-room \.rxn-quick \{ gap: 4px; top: auto; bottom: calc\(100% \+ 4px\); \}/, 'the open bar sits wholly above the message, clear of a one-line bubble');
  const lift = t.match(/#pj-room \.msg\.rxn-show \.msg-b \{ z-index: (\d+); \}/);
  const comp = html.match(/\n\.pjmid \.composer \{ position: sticky; bottom: 0; z-index: (\d+);/);
  assert.ok(lift && comp, 'the open-row lift and the sticky composer rule are both found');
  assert.ok(Number(lift[1]) >= 1 && Number(lift[1]) < Number(comp[1]), 'the open row is above its neighbours (z auto) but under the sticky composer: ' + lift[1] + ' vs ' + comp[1]);
  assert.match(t, /\.pjmid #pj-post-mirror \.pj-mirror-in \{ font-size: 16px; \}/, 'the composer\'s @mention mirror matches the composer (16px through the project page\'s one field rule)');
  assert.match(t, /#pj-room \.msg\.rxn-below \.rxn-quick \{ bottom: auto; top: calc\(100% \+ 4px\); \}/, 'and below it where the thread top would cut it');
  assert.match(html, /document\.addEventListener\('pointerdown', \(e\) => \{\n  if \(!RXN_SHOW_POST\) return;[^\n]*\n  const room = document\.getElementById\('pj-room'\);/, 'outside taps close on pointerdown (iOS sends no click to a document listener for plain content)');
  assert.match(t, /#pj-room \.msg:not\(\.you\) \.rxn-quick \{ right: auto; left: 0; \}/, 'an agent bar starts at its bubble, not past the thread edge');
});

test('the tap listener is registered before the data-open-agent one, which must stay last', () => {
  const tap = html.indexOf("if (e.target.closest('.rxn-pick, .rxn')) { pjRxnClose(); return; }");
  // The data-open-agent listener itself (its code, not the comment above it).
  const last = html.indexOf("const t = e.target && e.target.closest ? e.target.closest('[data-open-agent]') : null;");
  assert.ok(tap > 0 && last > 0 && tap < last, 'tap listener at ' + tap + ', last listener at ' + last);
});

test("your own bubble's room cap repeats the base bubble cap (78ch), pinned", () => {
  const base = html.match(/\n\.msg-bd \{ [^}]*max-width: ([\d.]+ch);/);
  const room = html.match(/#pj-room \.msg\.you \.msg-bd \{ max-width: min\(([\d.]+ch), 100%\); \}/);
  assert.ok(base && room, 'both rules found');
  assert.equal(room[1], base[1]);
});

test('the projects row fits an iPhone SE: Add Project at its narrowest, the sort and toggle may wrap', () => {
  // The harness (overflow) and the 2806 phone arm (no overlap, whole sort label) are the behaviour
  // checks; this pins the rules so they cannot quietly go.
  const phone = blocks('max-width: 30rem');
  assert.match(phone, /#pj-list-view \.statsrow \{ grid-template-columns: min-content minmax\(0, 1fr\); \}/);
  assert.match(phone, /#pj-list-view \.statsrow > \.viewctl \{ min-width: 0; width: 100%; justify-content: flex-end; flex-wrap: wrap; gap: 8px; \}/);
  assert.match(phone, /#pj-list-view \.sortctl \{ flex: 0 0 auto; \}/, 'the sort never shrinks below its label');
  assert.match(phone, /#pj-list-view \.viewctl > \.viewtoggle \{ flex: 0 0 auto; \}/, 'nor the toggle below its buttons');
  const mq = html.match(/const PJ_PHONE_MQ = '\(max-width: ([\d.]+rem)\)';/)[1];
  const rowBlock = html.match(/@media \(max-width: ([\d.]+rem)\) \{\n  #pj-list-view \.statsrow/);
  assert.ok(rowBlock, 'the projects-row block moved; re-anchor');
  assert.equal(rowBlock[1], mq);
});

test('the first-visit project tip anchors at the conversation first on a phone (page order)', () => {
  assert.match(html, /at: '\.pj3 > \.pjmid \.pjmidhead, #pj-add-member',/);
});

test('the pinned bar keeps the same gap from its edge as the CSS bar does from its message', () => {
  const js = html.match(/const RXN_BAR_GAP_PX = (\d+);/);
  const css = blocks('hover: none').match(/#pj-room \.rxn-quick \{ gap: 4px; top: auto; bottom: calc\(100% \+ (\d+)px\); \}/);
  assert.ok(js && css, 'both found');
  assert.equal(js[1], css[1]);
});

test('every field on the project page and its Tasks and members dialogs is 16px on a touchscreen only', () => {
  // The behaviour is swept in the browser (render-room-msgbox-2806, phone arm); this pins that
  // the rule stays inside the touch query, so a mouse layout is unchanged.
  const t = blocks('hover: none');
  const rule = /:is\(#pj-list-view, #pj-one-view, #pj-task-view, #pj-docs-view, #pj-settings-view, #pj-add-view\) :is\(input, select, textarea\),\n  #nt-modal :is\(input, select, textarea\), #am-modal :is\(input, select, textarea\) \{ font-size: 16px; \}/;
  assert.match(t, rule, 'the project page\'s own views (not all of #panel-projects: the one-screen layout puts Settings and Tasks inside it)');
  assert.doesNotMatch(outsideMedia('hover: none'), /#pj-add-view\) :is\(input, select, textarea\)/, 'never outside the touch query');
  // One rule, scoped: no unscoped class that reaches other screens (Settings uses .tk-inp).
  assert.doesNotMatch(t, /(^|[\s,])\.tk-inp\s*[,{]/m, '.tk-inp is not raised app-wide');
});

test('the media-block reader is sound: real blocks only, none overlapping, each closed inside its own <style>', () => {
  const junk = MEDIA.filter((b) => /\n|\*\//.test(b.query)).map((b) => b.query.slice(0, 60));
  assert.deepEqual(junk, [], 'a "query" spanning lines or a comment end is prose, not a block');
  for (let i = 1; i < MEDIA.length; i += 1) assert.ok(MEDIA[i].start >= MEDIA[i - 1].end, 'blocks overlap at ' + MEDIA[i].start);
  // Every block closes, and closes inside its own <style> element (a reader that ran past the
  // block's end would cross the </style>). Nested @media (dark mode inside a block) is valid CSS.
  const bad = MEDIA.filter((b) => { const close = html.indexOf('</style>', b.start); return close < 0 || b.end > close; }).map((b) => b.query);
  assert.deepEqual(bad, [], 'a block ran past its own </style>');
  assert.ok(MEDIA.some((b) => b.query === '(hover: none)' && !b.body.includes('\n')), 'the one-line touch block (the case that fooled the old reader) is read as its own block');
});
