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
const blocks = (q) => [...html.matchAll(new RegExp('@media \\(' + q + '\\) \\{([\\s\\S]*?)\\n\\}', 'g'))].map((m) => m[1]).join('\n');

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
  const block = (query) => [...html.matchAll(/@media ([^{]+) \{([\s\S]*?)\n\}/g)].filter((m) => m[1] === query).map((m) => m[2]).join('\n');
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
  assert.match(t, /#pj-post \{ font-size: 16px; \}/, 'no iOS focus zoom on the room composer');
  assert.match(t, /\.pjmid #pj-post-mirror \.pj-mirror-in \{ font-size: 16px; \}/, 'and its @mention mirror matches it');
  assert.match(t, /#pj-room-search, #pj-thread-who, #pj-list-view \.sortctl select \{ font-size: 16px; \}/, 'and every other field on these pages (iOS zooms any field under 16px)');
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

test('the projects row fits an iPhone SE: its right cell and the sort may shrink at phone width', () => {
  // Measured by the shared harness (projects, se, Chromium: .panel 330 > 327 before). The
  // harness is the behaviour check; this pins the rules so they cannot quietly go.
  const phone = blocks('max-width: 30rem');
  assert.match(phone, /#pj-list-view \.statsrow \{ grid-template-columns: auto minmax\(0, 1fr\); \}/);
  assert.match(phone, /#pj-list-view \.sortctl select \{ min-width: 0; max-width: 100%; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; \}/, 'the select may shrink (min-width 0, max-width 100%), which is what stops the overflow in every engine; the ellipsis needs overflow hidden where the engine draws one on a select');
  // The projects-row block and the room's block are the same phone width as the script's query.
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
  assert.match(t, /#panel-projects :is\(input, select, textarea\), #nt-modal :is\(input, select, textarea\),\n  #am-modal :is\(input, select, textarea\) \{ font-size: 16px; \}/);
  assert.doesNotMatch(html.replace(/@media \(hover: none\) \{[\s\S]*?\n\}/g, ''), /#panel-projects :is\(input, select, textarea\)/, 'never outside the touch query');
});
