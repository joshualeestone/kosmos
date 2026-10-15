'use strict';
/* #6206: in WebKit the board's service worker answers a request before a page.route stub can, so a mobile-shots
 * screen whose `go` stubs a request with page.route must set `noServiceWorker: true` (the rule the tool's header
 * states). Three settings screens did not, and timed out on WebKit at every size. This reads the tool's source: a
 * screen stubs if its body calls page.route, calls a helper that does, or runs another screen that does. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, 'docs', 'browser-checks', 'mobile-shots.js'), 'utf8');

function unflaggedStubbers(src) {
  const fns = [];
  const fnRe = /(?:^|\n)(?:async function ([A-Za-z0-9_]+)\s*\(|const ([A-Za-z0-9_]+) = async \()/g;
  for (let m; (m = fnRe.exec(src));) fns.push({ name: m[1] || m[2], at: m.index });
  const helpers = fns.filter((f, i) => {
    const seg = src.slice(f.at, i + 1 < fns.length ? fns[i + 1].at : src.length);
    const cut = seg.indexOf("{ name: '");
    return /page\.route\(/.test(cut === -1 ? seg : seg.slice(0, cut));
  }).map((f) => f.name);
  const starts = [...src.matchAll(/^\s*\{ name: '([a-z0-9-]+)'/gm)].map((m) => ({ name: m[1], at: m.index }));
  const body = {};
  starts.forEach((s, i) => { body[s.name] = src.slice(s.at, i + 1 < starts.length ? starts[i + 1].at : src.length); });
  const stubs = (n, seen = new Set()) => {
    if (seen.has(n) || !body[n]) return false;
    seen.add(n);
    const b = body[n];
    if (/page\.route\(/.test(b) || helpers.some((h) => new RegExp('\\b' + h + '\\(').test(b))) return true;
    return [...b.matchAll(/SCREENS\.find\(\(s\) => s\.name === '([a-z0-9-]+)'\)/g)].some((m) => stubs(m[1], seen));
  };
  const stubbing = Object.keys(body).filter((n) => stubs(n));
  return { stubbing, missing: stubbing.filter((n) => !/noServiceWorker: true/.test(body[n].split('\n')[0])) };
}

test('#6206: every mobile-shots screen that stubs with page.route turns the service worker off', () => {
  const { stubbing, missing } = unflaggedStubbers(SRC);
  assert.deepEqual(missing, [], 'these screens stub a request but leave the service worker on (they time out on WebKit): ' + missing.join(', '));
  // CONTROL: the reader sees stubbing screens at all, including ones that stub directly, by helper and by another screen.
  for (const n of ['allow-card', 'connect-sheet', 'settings-accounts-landed']) assert.ok(stubbing.includes(n), 'the reader missed ' + n);
});

test('#6206 CONTROL: a screen planted without the flag is caught, and with it is not', () => {
  const plant = (flag) => SRC.replace(/^(\s*)\{ name: 'allow-card', owner: 'Kano', noServiceWorker: true, go:/m,
    (m, sp) => sp + "{ name: 'planted-6206', owner: 'x'" + (flag ? ', noServiceWorker: true' : '') + ", go: async (page) => { await page.route('**/api/x', (r) => r.abort()); } },\n" + m);
  assert.ok(plant(false).includes("planted-6206"), 'fixture: the plant did not land');
  assert.deepEqual(unflaggedStubbers(plant(false)).missing, ['planted-6206']);
  assert.deepEqual(unflaggedStubbers(plant(true)).missing, []);
});
