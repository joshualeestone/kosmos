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

/* install-flow-9screen: the Files & Folders door (Screen 2 "Allow Access"). Same
   door-not-claim contract as the Accessibility button, opening the Files & Folders
   privacy pane in the SAME Privacy & Security bundle (so it reuses that probe and
   only swaps the anchor). */
test('9screen: with the pane present openFileAccessSettings opens, and the URL names Files & Folders', () => {
  const w = world();
  const out = machine.openFileAccessSettings(w.runner, w.lister);
  assert.deepEqual(out, { ok: true }, JSON.stringify(out));
  const opened = w.calls.find((c) => c.bin === '/usr/bin/open');
  assert.ok(opened, 'open was never called, so the Allow Access button would do nothing');
  const url = opened.args[0];
  assert.match(url, /^x-apple\.systempreferences:/, url);
  /* THE ANCHOR IS THE WHOLE POINT: Files & Folders, not Accessibility, and not
     Privacy & Security generally (which would leave the person to find it). */
  assert.match(url, /Privacy_FilesAndFolders/, url);
  assert.doesNotMatch(url, /Privacy_Accessibility/, url);
});

test('9screen: with no pane openFileAccessSettings refuses honestly and NEVER calls open', () => {
  const w = world({ ids: ['com.apple.something.else'] });
  const out = machine.openFileAccessSettings(w.runner, w.lister);
  assert.equal(out.ok, false);
  assert.match(out.because, /could not find/i, out.because);
  assert.equal(w.calls.filter((c) => c.bin === '/usr/bin/open').length, 0,
    'it refused and opened something anyway');
});

test('9screen: when open itself fails, openFileAccessSettings says so rather than claiming success', () => {
  const w = world({ openOk: false });
  const out = machine.openFileAccessSettings(w.runner, w.lister);
  assert.equal(out.ok, false);
  assert.match(out.because, /System Settings did not open/, out.because);
});

test('9screen SECURITY: openFileAccessSettings derives its URL, so a caller cannot choose what opens', () => {
  assert.equal(machine.openFileAccessSettings.length, 2,
    'the signature grew a parameter; if one is a target, this route is now an open-anything');
});

/* install-flow-9screen: the Allow Access button exists AND is now wired -- a
   labelled primary button that does nothing on the first permission screen was a
   real defect (a blind review caught it). Assert both the markup and the handler. */
test('9screen: the S2 Allow Access button is present and wired to open-file-access-settings', () => {
  assert.match(PAGE, /class="s2-allow"[^>]*>Allow Access</, 'the S2 Allow Access button is gone');
  // Bound the slice to the handler's OWN closing `});` rather than a fixed offset:
  // the handler has no nested `});`, so this captures exactly its body and can never
  // read the removal-guard assertions below into the next handler's code (a fixed
  // window both guessed the size and risked exactly that).
  const start = PAGE.indexOf("getElementById('fr-pane-2').addEventListener");
  const handler = PAGE.slice(start, PAGE.indexOf('});', start) + 3);
  assert.match(handler, /closest\('\.s2-allow'\)/, 'nothing keys on the .s2-allow button');
  assert.match(handler, /\/api\/open-file-access-settings/, 'the Allow Access click does not POST the file-access opener');
  // #2451: the mock dialog's blue Allow forwards a click through the real .s2-allow
  // button, guarded so it cannot re-fire. Pin the forward + both guards against
  // silent removal (a static presence check, matching this handler's existing
  // string-assertion style; the render check covers the screen, the guard LOGIC was
  // reviewed).
  assert.match(handler, /closest\('\.s2-mockallow'\)/, 'the mock Allow no longer forwards a click');
  assert.match(handler, /querySelector\('#fr-pane-2 \.s2-allow'\)/, 'the mock no longer routes through the real Allow Access button');
  assert.match(handler, /b\.disabled\)\s*return/, 'the in-flight guard (return when the real button is disabled) is gone');
  assert.match(handler, /data-granted'\)\)\s*return/, 'the post-grant guard (return when the gate row is granted) is gone');
});
