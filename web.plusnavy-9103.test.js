'use strict';
require('./test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)
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

/* Review (navyweb-9101): read whole RULES, across lines, not single lines that already start with the scope: a selector
   list wrapped onto a second line, with an unscoped part there, was never read. Any rule that names html.kapptabs and an
   in-app target must have every part of its selector list scoped. Known limit: a new rule with no html.kapptabs at all
   cannot be told from the browser's own rules by reading the page. */
const APP_TARGET = /(#s-sec-plus|#plus-|\.pnav|#pb\b|\.askreq|\.askcard|\.plus-)/;
function unscopedParts(css) {
  const bad = [];
  let found = 0;
  for (const m of css.matchAll(/([^{}]+)\{[^}]*\}/g)) {
    const sel = m[1].replace(/\/\*[\s\S]*?\*\//g, '').trim();
    if (!sel.includes('html.kapptabs') || !APP_TARGET.test(sel)) continue;
    found += 1;
    for (const part of sel.split(/,(?![^(]*\))/)) if (part.trim() && !/^html\.kapptabs\b/.test(part.trim())) bad.push(part.trim());
  }
  return { found, bad };
}
test('#9103: every rule the change adds for the app is scoped to html.kapptabs', () => {
  const css = HTML.slice(0, HTML.indexOf('</style>'));
  const { found, bad } = unscopedParts(css);
  assert.ok(found >= 30, 'the app rules are present (found ' + found + ')');
  assert.deepEqual(bad, [], 'a selector reaches the browser');
});
test('#9103 control: the scope check catches an unscoped part on a wrapped second line', () => {
  const planted = 'html.kapptabs .pnav-x,\n  .pnav-back { color: red; }\n';
  assert.deepEqual(unscopedParts(planted).bad, ['.pnav-back'], 'a wrapped unscoped part was not caught');
  assert.deepEqual(unscopedParts('html.kapptabs .pnav-x,\n  html.kapptabs .pnav-back { color: red; }\n').bad, [], 'CONTROL: a fully scoped list was flagged');
});

/* Review 2: a surface repainted light in the app must not keep text or fills written for navy. Every rule in the
   app-visible scopes that hard-codes one of the navy-era colours needs an html.kapptabs override naming the same target
   (the selector's last part). Scopes are where the app shows these screens; rules for the signed-out marketing view
   (state 1) and the browser-only canvases are outside them. */
test('#9103: every navy-era colour in the app-visible scopes has an in-app override', () => {
  const NAVY = /#(fff|ffffff|E6EBF7|c3cde3|9fb0d4|8fa0c4|b8c4de|7ea0f0|9ab6ff|16223e|2f57c4|3a68d8|17233d|1f3360|132449|5c78a6|7d95c2)\b/i;
  const SCOPE = /(\.askreq|\.askcard|\.askrow|\.askbrand|#plus-state2|#s-sec-plus|#pb\b|#plus-org|\.pnav|\.plus-signin-link)/;
  const css = HTML.slice(0, HTML.indexOf('</style>'));
  /* Review (navyweb-9101): an override must set the same KIND of property for the same target, not merely mention the
     class. The in-app rules, each as its selector and the properties it sets. */
  const KIND = (prop) => /^(background|background-color)$/.test(prop) ? 'bg' : /^border/.test(prop) ? 'border'
    : /^(outline|outline-color)$/.test(prop) ? 'outline' : prop === 'caret-color' ? 'caret' : prop === '-webkit-text-fill-color' ? 'fill' : 'color';
  const appRules = [];
  for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const sel = m[1].replace(/\/\*[\s\S]*?\*\//g, '').trim();
    if (!sel.includes('html.kapptabs')) continue;
    const kinds = new Set([...m[2].matchAll(/(?:^|;)\s*([a-z-]+)\s*:/g)].map((p) => KIND(p[1])));
    appRules.push({ sel, kinds });
  }
  // The same target as a whole token, with the same states stripped on both sides (focus, disabled, :not(...)), as the
  // base rules' key already is. Known limit: a rule naming the key as an ANCESTOR (`.pnav .x`) still counts as its
  // override; a mutation removing the menu's own in-app colour was therefore not caught (11-26). Matching only the last
  // compound needs a real selector parser (`:is(a, b)` holds spaces), left for later.
  const esc = (k) => k.replace(/[.*+?^${}()|[\]\\#]/g, '\\$&');
  const overridden = (key, kind) => appRules.some((r) => new RegExp('(^|[\\s,(>+~])' + esc(key) + '(?![\\w.\\-:\\[#])')
    .test(r.sel.replace(/:(focus-visible|focus-within|focus|disabled|not\([^)]*\))/g, '')) && r.kinds.has(kind));
  const missing = [];
  for (const m of css.matchAll(/^\s*([^{}\n/*@][^{}\n]*)\{([^}]*)\}/gm)) {
    const sel = m[1].trim(), body = m[2];
    if (sel.startsWith('html.kapptabs') || !SCOPE.test(sel) || !/(^|;)\s*(color|background|background-color|border(-color)?|outline|caret-color|-webkit-text-fill-color)\s*:/.test(body) || !NAVY.test(body)) continue;
    if (/plus-active|:hover|::placeholder|\.plus-sash|\.plus-qr-box|\.tk-inp:-webkit-autofill|plus-state1|\.plus-btn|\.plus-val|\.plus-signin-pill|\.pnav-badge|pb-printing/.test(sel)) continue;   // the skin itself; hover follows the base; the QR stays white; state 1 is signed-out only; the badge is white on red (meaning); the printout is paper
    const kinds = [...body.matchAll(/(?:^|;)\s*([a-z-]+)\s*:([^;]*)/g)].filter((p) => NAVY.test(p[2])).map((p) => KIND(p[1]));
    for (const part of sel.split(/,(?![^(]*\))/)) {
      const last = part.trim().split(/\s+/).slice(-2).join(' ').replace(/:(focus-visible|focus-within|focus|disabled|not\([^)]*\))/g, '');
      const key = last.split(' ').pop();
      for (const kind of new Set(kinds)) if (!overridden(key, kind)) missing.push(part.trim() + ' (' + kind + ')');
    }
  }
  assert.deepEqual(missing, [], 'navy-era colours with no in-app override:\n' + missing.join('\n'));
});
