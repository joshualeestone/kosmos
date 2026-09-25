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
  assert.match(t, /#pj-room \.msg:not\(\.you\) \.rxn-quick \{ right: auto; left: 0; \}/, 'an agent bar starts at its bubble, not past the thread edge');
});

test('the tap listener is registered before the data-open-agent one, which must stay last', () => {
  const tap = html.indexOf("if (e.target.closest('.rxn-pick')) { pjRxnClose(); return; }");
  const last = html.indexOf('Keep this one last among the room\'s click listeners');
  assert.ok(tap > 0 && last > 0 && tap < last, 'tap listener at ' + tap + ', last listener at ' + last);
});
