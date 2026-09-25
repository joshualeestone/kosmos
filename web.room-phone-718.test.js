'use strict';
/* #718 mobile: the project room on a phone. The geometry and the tap behaviour are measured
   by docs/browser-checks/render-room-msgbox-2806.js (phone, touch and hover arms). This file
   pins the phone rules that check does not render: the conversation first on the project
   page, and the touchscreen rules that keep the reaction bar reachable and closable. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
const blocks = (q) => [...html.matchAll(new RegExp('@media \\(' + q + '\\) \\{([\\s\\S]*?)\\n\\}', 'g'))].map((m) => m[1]).join('\n');

test('on a phone the conversation comes first on the project page', () => {
  assert.match(blocks('max-width: 30rem'), /\.pj3 > \.pjmid \{ order: -1; \}/);
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
