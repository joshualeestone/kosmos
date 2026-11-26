'use strict';
/* kosmos#9103 (Josh 11-25 16:49: "we are not going to have the blue background anywhere in the app"): inside the iPhone
 * app (html.kapptabs) Settings > Kosmos Plus is shown without its navy skin (body.plus-active), while Kosmos+ in a
 * browser keeps it. This runs the page's own syncPlusChrome with the section on screen, once with the app's class on
 * <html> and once without, and reads body.plus-active. It also checks that the app's colour rules are all scoped to
 * html.kapptabs, so none can reach the browser. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const HTML = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');

function fn(name) {
  const at = HTML.indexOf('function ' + name + '(');
  assert.ok(at > -1, name + ' is in web/index.html');
  return HTML.slice(at, HTML.indexOf('\n}\n', at) + 3);
}

function run(inApp) {
  const cls = (set) => ({ contains: (c) => set.has(c), toggle: (c, on) => { if (on) set.add(c); else set.delete(c); } });
  const htmlSet = new Set(inApp ? ['kremote', 'kapptabs'] : ['kremote']);
  const bodySet = new Set();
  const calls = { mount: 0, teardown: 0 };
  const ctx = {
    document: { documentElement: { classList: cls(htmlSet) }, body: { classList: cls(bodySet) }, getElementById: () => null },
    plusOnScreen: () => true, plusMounted: false,
    plusMount: () => { calls.mount += 1; ctx.plusMounted = true; }, plusTeardown: () => { calls.teardown += 1; },
  };
  vm.runInNewContext(fn('syncPlusChrome') + '\nsyncPlusChrome();', ctx);
  return { plusActive: bodySet.has('plus-active'), calls };
}

test('#9103: in the app, Kosmos Plus on screen gets NO navy skin, and the section still mounts', () => {
  const r = run(true);
  assert.equal(r.plusActive, false, 'body.plus-active must stay off inside the app');
  assert.equal(r.calls.mount, 1, 'the section (its wordmark) still mounts in the app');
});

test('#9103 control: in a browser, Kosmos Plus on screen keeps its navy skin', () => {
  const r = run(false);
  assert.equal(r.plusActive, true, 'Kosmos+ in a browser keeps body.plus-active');
  assert.equal(r.calls.mount, 1);
});

test('#9103: every rule the change adds for the app is scoped to html.kapptabs', () => {
  const lines = HTML.split('\n').filter((l) => /^html\.kapptabs [^{]*(#s-sec-plus|#plus-|\.pnav|#pb|\.askreq|\.askcard|\.plus-)/.test(l));
  assert.ok(lines.length >= 30, 'the app rules are present (found ' + lines.length + ')');
  for (const l of lines) {
    const sel = l.slice(0, l.indexOf('{'));
    for (const part of sel.split(/,(?![^(]*\))/)) {
      if (part.trim()) assert.match(part.trim(), /^html\.kapptabs\b/, 'a selector reaches the browser: ' + part.trim());
    }
  }
});

/* Review 2: a surface repainted light in the app must not keep text or fills written for navy. Every rule in the
   app-visible scopes that hard-codes one of the navy-era colours needs an html.kapptabs override naming the same target
   (the selector's last part). Scopes are where the app shows these screens; rules for the signed-out marketing view
   (state 1) and the browser-only canvases are outside them. */
test('#9103: every navy-era colour in the app-visible scopes has an in-app override', () => {
  const NAVY = /#(fff|ffffff|E6EBF7|c3cde3|9fb0d4|8fa0c4|b8c4de|7ea0f0|9ab6ff|16223e|2f57c4|3a68d8|17233d|1f3360|132449|5c78a6|7d95c2)\b/i;
  const SCOPE = /(\.askreq|\.askcard|\.askrow|\.askbrand|#plus-state2|#s-sec-plus|#pb\b|#plus-org|\.pnav|\.plus-signin-link)/;
  const css = HTML.slice(0, HTML.indexOf('</style>'));
  const app = css.split('\n').filter((l) => l.includes('html.kapptabs')).join('\n');   // continuation lines of a selector list too
  const missing = [];
  for (const m of css.matchAll(/^\s*([^{}\n/*@][^{}\n]*)\{([^}]*)\}/gm)) {
    const sel = m[1].trim(), body = m[2];
    if (sel.startsWith('html.kapptabs') || !SCOPE.test(sel) || !/(^|;)\s*(color|background|background-color|border(-color)?|outline|caret-color|-webkit-text-fill-color)\s*:/.test(body) || !NAVY.test(body)) continue;
    if (/plus-active|:hover|::placeholder|\.plus-sash|\.plus-qr-box|\.tk-inp:-webkit-autofill|plus-state1|\.plus-btn|\.plus-val|\.plus-signin-pill|\.pnav-badge|pb-printing/.test(sel)) continue;   // the skin itself; hover follows the base; the QR stays white; state 1 is signed-out only; the badge is white on red (meaning); the printout is paper
    for (const part of sel.split(/,(?![^(]*\))/)) {
      const last = part.trim().split(/\s+/).slice(-2).join(' ').replace(/:(focus-visible|focus-within|focus|disabled|not\([^)]*\))/g, '');
      const key = last.split(' ').pop();
      if (!app.includes(key)) missing.push(part.trim());
    }
  }
  assert.deepEqual(missing, [], 'navy-era colours with no in-app override:\n' + missing.join('\n'));
});
