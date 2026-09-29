'use strict';

/**
 * #4470: the new look, behind a hidden switch.
 *
 * 🔑 WHAT THIS GUARDS. With the switch off, the app must be today's app byte for byte, so
 * every new-look rule has to be unreachable without html[data-look="new"], and only a stored
 * 'new' may set that attribute. With it on, every token the light set changes has to be
 * changed again in dark (system dark AND chosen dark), or a dark Mac gets the white page's
 * values on a black ground.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');

/** The head script that applies a stored look, run against a fake document and storage. */
function runBoot(stored, { throws = false } = {}) {
  const start = PAGE.indexOf("localStorage.getItem('kosmos-look')");
  assert.ok(start > 0, 'the head script that reads kosmos-look is gone');
  const open = PAGE.lastIndexOf('(function () {', start);
  const close = PAGE.indexOf('})();', start) + '})();'.length;
  const attrs = {};
  const document = { documentElement: { setAttribute: (k, v) => { attrs[k] = v; } } };
  const localStorage = { getItem: () => { if (throws) throw new Error('blocked'); return stored; } };
  new Function('document', 'localStorage', PAGE.slice(open, close))(document, localStorage);
  return attrs;
}

test('the head script sets the new look only for a stored "new"', () => {
  assert.deepEqual(runBoot('new'), { 'data-look': 'new' }, 'CONTROL: the stored choice must apply');
  assert.deepEqual(runBoot(null), {}, 'nothing stored must mean no attribute, which is today\'s look');
  assert.deepEqual(runBoot('old'), {});
  assert.deepEqual(runBoot(null, { throws: true }), {}, 'blocked storage must fall back to today\'s look');
});

test('the head script runs before the body, like the theme one', () => {
  const at = PAGE.indexOf("localStorage.getItem('kosmos-look')");
  assert.ok(at < PAGE.indexOf('<body'), 'applied after the body, the page would flash the old look first');
});

/** Every `selector { body }` whose selector mentions data-look="new", with its declared tokens. */
function lookRules() {
  const out = [];
  const re = /([^{};]*data-look="new"[^{};]*)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(PAGE))) {
    const vars = new Set([...m[2].matchAll(/(--[a-z0-9-]+)\s*:/g)].map((x) => x[1]));
    /* The capture can carry a comment in front of the selector; keep only the selector itself. */
    out.push({ sel: m[1].replace(/\/\*[\s\S]*?\*\//g, '').trim().split('\n').pop().trim(), vars });
  }
  return out;
}

test('the light, system-dark and chosen-dark token sets name the same tokens', () => {
  const rules = lookRules();
  const light = rules.find((r) => r.sel === ':root[data-look="new"]');
  const sysDark = rules.find((r) => r.sel === ':root:not([data-theme="light"])[data-look="new"]');
  const forced = rules.find((r) => r.sel === ':root[data-theme="dark"][data-look="new"]');
  assert.ok(light && sysDark && forced, 'one of the three token sets is missing: ' + rules.map((r) => r.sel).join(' | '));
  assert.ok(light.vars.size >= 10, 'the light set lost its tokens, so the comparison proves nothing');
  assert.deepEqual([...sysDark.vars].sort(), [...light.vars].sort(), 'a token changed in light is not changed in system dark');
  assert.deepEqual([...forced.vars].sort(), [...light.vars].sort(), 'a token changed in light is not changed in chosen dark');
});

test('no --nl-* token is defined outside the new look', () => {
  const defs = [...PAGE.matchAll(/([^{};]*)\{[^{}]*--nl-[a-z0-9-]+\s*:[^{}]*\}/g)].map((m) => m[1].trim());
  assert.ok(defs.length >= 3, 'CONTROL: the new-look token sets define --nl-* tokens');
  for (const sel of defs) assert.match(sel, /data-look="new"/, 'an --nl-* token is defined for everyone: ' + sel);
});

test('the switch lives in Settings > Advanced and is a real switch', () => {
  const adv = PAGE.indexOf('id="s-sec-advanced"');
  const tog = PAGE.indexOf('id="look-toggle"');
  const next = PAGE.indexOf('<section class="dsec"', adv + 1);
  assert.ok(adv > 0 && tog > adv && (next < 0 || tog < next), 'the new-look switch is not inside Advanced');
  const tag = PAGE.slice(PAGE.lastIndexOf('<button', tog), PAGE.indexOf('>', tog));
  assert.match(tag, /role="switch"/);
  assert.match(tag, /aria-label="Try the new look"/);
});

test('the switch turns the look on and off, and remembers it on this computer only', () => {
  const src = ['lookPaint', 'lookToggleClick'].map((name) => {
    const at = PAGE.indexOf('function ' + name + '(');
    assert.ok(at > 0, name + ' is gone');
    let depth = 0;
    for (let i = PAGE.indexOf('{', at); i < PAGE.length; i += 1) {
      if (PAGE[i] === '{') depth += 1;
      else if (PAGE[i] === '}' && --depth === 0) return PAGE.slice(at, i + 1);
    }
    throw new Error('unbalanced ' + name);
  }).join('\n');
  const attrs = {};
  const store = {};
  const painted = [];
  const document = { documentElement: {
    getAttribute: (k) => (k in attrs ? attrs[k] : null),
    setAttribute: (k, v) => { attrs[k] = v; },
    removeAttribute: (k) => { delete attrs[k]; },
  } };
  const localStorage = {
    setItem: (k, v) => { store[k] = v; },
    removeItem: (k) => { delete store[k]; },
  };
  const paintSwitch = (id, on) => painted.push([id, on]);
  const placed = [];
  const placeLook = (cons) => placed.push([attrs['data-look'] || null, cons]);
  document.body = { classList: { contains: (c) => c === 'consolidated' && false } };
  const click = new Function('document', 'localStorage', 'paintSwitch', 'placeLook', src + '\nreturn lookToggleClick;')(document, localStorage, paintSwitch, placeLook);
  click();
  assert.equal(attrs['data-look'], 'new');
  assert.equal(store['kosmos-look'], 'new');
  assert.deepEqual(painted.at(-1), ['look-toggle', true]);
  click();
  assert.equal('data-look' in attrs, false, 'off must remove the attribute, not set another value');
  assert.equal('kosmos-look' in store, false, 'off must forget the choice, so the head script sees nothing');
  assert.deepEqual(painted.at(-1), ['look-toggle', false]);
  assert.deepEqual(placed, [['new', false], [null, false]], 'each click re-places Tasks AFTER the attribute changes');
  assert.doesNotMatch(src, /fetch\(|api\(/, 'the look is this window only; it must not call the server');
});
