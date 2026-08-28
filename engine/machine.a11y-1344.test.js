'use strict';

/**
 * The Accessibility door (#1344): a sentence saying why, and a button that opens
 * the pane.
 *
 * 🔑 Josh, from the fresh-machine install: "I'd love to see a message to say
 * 'Turning accessibility on so that Kosmos agents can work on this computer' and
 * have a button to open that setting so that they can okay it as well."
 *
 * 🛑 THE RUNNER IS INJECTED, SO NO TEST EVER OPENS SYSTEM SETTINGS. The engine
 * function takes `(runner, lister)` for exactly this reason, and an injected pair
 * also bypasses the module cache in both directions so test order is not
 * load-bearing.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const machine = require('./machine');

const PAGE = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');

/* A world where the Privacy pane exists, and a recorder for what `open` was
   handed. The recorder is the point of several assertions below: what reaches
   /usr/bin/open is the thing that must never come from a caller. */
function world({ ids = ['com.apple.settings.PrivacySecurity.extension'], openOk = true } = {}) {
  const calls = [];
  const runner = (bin, args) => {
    calls.push({ bin, args });
    if (bin === '/usr/bin/defaults') return { ok: true, stdout: ids[0] };
    if (bin === '/usr/bin/open') return { ok: openOk };
    return { ok: false };
  };
  const lister = () => ['PrivacySecurity.appex', 'Battery-Settings.appex'];
  return { runner, lister, calls };
}

test('#1344: with the pane present it opens, and the URL names Accessibility', () => {
  const w = world();
  const out = machine.openAccessibilitySettings(w.runner, w.lister);
  assert.deepEqual(out, { ok: true }, JSON.stringify(out));
  const opened = w.calls.find((c) => c.bin === '/usr/bin/open');
  assert.ok(opened, 'open was never called, so nothing would happen on the click');
  const url = opened.args[0];
  assert.match(url, /^x-apple\.systempreferences:/, url);
  /* 🔑 THE ANCHOR IS THE WHOLE POINT. Without it this opens Privacy & Security
     generally and the person still has to find Accessibility themselves, which
     is the errand Josh asked us to remove. */
  assert.match(url, /Privacy_Accessibility/, url);
});

test('#1344: with no pane it refuses honestly and NEVER calls open', () => {
  const w = world({ ids: ['com.apple.something.else'] });
  const out = machine.openAccessibilitySettings(w.runner, w.lister);
  assert.equal(out.ok, false);
  assert.match(out.because, /could not find/i, out.because);
  /* 🛑 A REFUSAL THAT STILL SHELLED OUT WOULD BE WORSE THAN THE BUG: it would
     open something while telling the person it could not. */
  assert.equal(w.calls.filter((c) => c.bin === '/usr/bin/open').length, 0,
    'it refused and opened something anyway');
});

test('#1344: when open itself fails, it says so rather than claiming success', () => {
  const w = world({ openOk: false });
  const out = machine.openAccessibilitySettings(w.runner, w.lister);
  assert.equal(out.ok, false);
  assert.match(out.because, /System Settings did not open/, out.because);
});

test('#1344 SECURITY: the URL is DERIVED, so a caller cannot choose what is opened', () => {
  /* The sleep sibling states this as a comment: "the route that fronts this must
     not become a way for a page to `open` arbitrary URLs on the machine." A
     comment cannot fail, so this asserts it. The function takes no target, and
     what reaches `open` must come from the probe, not from anything a caller
     supplied. */
  assert.equal(machine.openAccessibilitySettings.length, 2,
    'the signature grew a parameter; if one of them is a target, this route is now an open-anything');
  const w = world();
  machine.openAccessibilitySettings(w.runner, w.lister);
  const url = w.calls.find((c) => c.bin === '/usr/bin/open').args[0];
  assert.ok(url.includes('com.apple.settings.PrivacySecurity.extension'),
    'the opened URL did not come from the probe: ' + url);
});

test('#1344: the route exists, is POST, and takes no parameter', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(server, /'\/api\/open-accessibility-settings' && req\.method === 'POST'/,
    'the route is gone or is no longer POST-only');
  const at = server.indexOf("'/api/open-accessibility-settings'");
  const block = server.slice(at, at + 400);
  assert.match(block, /machine\.openAccessibilitySettings\(\)/,
    'the route now passes something to the engine, which is how it becomes an open-anything');
});

test('#1344: the button is on the page and attached exactly ONCE', () => {
  assert.equal((PAGE.match(/id="set-a11y-open"/g) || []).length, 1);
  /* 🛑 ONCE. This is static markup, so a listener attached inside the settings
     painter would be added again on every repaint and one click would open
     System Settings once per paint. */
  assert.equal((PAGE.match(/getElementById\('set-a11y-open'\)\.addEventListener/g) || []).length, 1,
    'the accessibility button is attached more or less than once');
});

test('#1344: the sentence says why, and does not soften the app-control half', () => {
  const m = PAGE.match(/id="set-a11y-say"[^>]*>([^<]+)</);
  assert.ok(m, 'the accessibility sentence is gone');
  const say = m[1];
  assert.match(say, /accessibilit/i, say);
  /* Josh's ruling, relayed 2026-08-28 and honoured by #1214 in the box above:
     agents acting in your other applications IS the feature, and softening it is
     what would make it false. */
  assert.match(say, /other applications/i, say);
  /* ⚠️ AND IT CLAIMS NO STATE. Nothing here can read whether the permission is
     granted, so the sentence must not imply it has been checked. */
  for (const forbidden of [/already/i, /you have (granted|turned)/i, /is (on|enabled|granted)/i]) {
    assert.doesNotMatch(say, forbidden, 'the sentence claims a permission state nobody checked: ' + say);
  }
});
