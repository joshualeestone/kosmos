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
