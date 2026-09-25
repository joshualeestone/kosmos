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
  assert.doesNotMatch(blocks('max-width: 30rem'), /\.pjmid \{[^}]*order:/);
  assert.match(html, /function pjPhoneOrder\(\) \{/);
  assert.match(html, /grid\.insertBefore\(mid, grid\.firstElementChild\)/);
  assert.match(html, /split\.after\(mid\)/);
  assert.match(html, /pjPhoneMq\.addEventListener\('change', pjPhoneOrder\)/);
});

test('on a touchscreen only a tap (or focus) opens the room reaction bar, never sticky hover', () => {
  const t = blocks('hover: none');
  assert.match(t, /#pj-room \.msg\.rxn-show \.rxn-quick \{ opacity: 1; pointer-events: auto; \}/);
  assert.match(t, /#pj-room \.msg:hover:not\(\.rxn-show\) \.rxn-quick:not\(:focus-within\) \{ opacity: 0; pointer-events: none; \}/);
  assert.match(t, /#pj-room \.msg:not\(\.you\) \.rxn-quick \{ right: auto; left: 0; \}/, 'an agent bar starts at its bubble, not past the thread edge');
});

test('the tap listener is registered before the data-open-agent one, which must stay last', () => {
  const tap = html.indexOf("if (e.target.closest('.rxn-pick')) { room.querySelectorAll('.msg.rxn-show')");
  const last = html.indexOf('Keep this one last among the room\'s click listeners');
  assert.ok(tap > 0 && last > 0 && tap < last, 'tap listener at ' + tap + ', last listener at ' + last);
});
