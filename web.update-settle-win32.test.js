'use strict';

/**
 * win32-update-arm (S4): the update overlay's Windows wording -- the "Downloading X" -> "Updating"
 * lead, the "Nothing else was changed." failure line, and the "double-click Kosmos.exe" slow remedy
 * -- lifted from web/index.html and driven on BOTH platforms. It runs on the macOS CI host (where
 * the win32 browser-check arm skips), so this is the coverage for the Windows overlay copy.
 *
 * 🔑 THE MAC STAYS BYTE-IDENTICAL. Every arm asserts the exact Mac string too (platform defaulting
 * off Windows), so a change that shifts a Mac sentence fails here, not only in a browser check.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const page = require('./test-support/page');
const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = page.scriptOf(PAGE);

/** The real page functions, with the platform copy layer they lean on. */
function lifted() {
  // eslint-disable-next-line no-new-func
  return new Function(
    page.liftAll(SCRIPT, [...page.PLATFORM_COPY_FNS, 'esc', 'updateSettleText', 'updateOverlayLead'])
    + '\nreturn { updateSettleText, updateOverlayLead, windowsCopy };')();
}

test('the overlay lead: "Downloading X" while reachable, "Updating." during the swap; the Mac says "Updating." throughout', () => {
  const { updateOverlayLead } = lifted();
  assert.equal(updateOverlayLead(true, '0.6.60', 'win32'), 'Downloading 0.6.60.', 'win32 leads with the download while the board still answers');
  assert.equal(updateOverlayLead(false, '0.6.60', 'win32'), 'Updating.', 'win32 turns to Updating when the board goes away to swap');
  assert.equal(updateOverlayLead(true, '0.6.60', 'darwin'), 'Updating.', 'the Mac lead is unchanged');
  assert.equal(updateOverlayLead(false, '0.6.60', 'darwin'), 'Updating.');
  /* The initial overlay builds its lead through updateOverlayLead (so the Mac renders the same
     "Updating." bytes and win32 gets "Downloading X."). */
  assert.ok(PAGE.includes("'<b>' + esc(updateOverlayLead(true, downloading)) + '</b> Your agents keep working."),
    'the overlay lead is no longer built through updateOverlayLead');
});

test('win32 failure: a rollback (or refusal) says the box is unchanged; the same sentence for failed and did-not-take', () => {
  const { updateSettleText } = lifted();
  for (const verdict of ['failed', 'did-not-take']) {
    const t = updateSettleText(verdict, '0.6.55', { code: 1 }, null, 'win32');
    assert.equal(t, '<b>The update did not take.</b> Kosmos is still on 0.6.55. Nothing else was changed.',
      `win32 ${verdict}: the honest rollback sentence`);
    assert.doesNotMatch(t, /installer|Applications|same version/, `win32 ${verdict}: Mac installer vocabulary leaked in`);
  }
});

test('win32 slow: the remedy points at Kosmos.exe, never the Mac Applications', () => {
  const { updateSettleText } = lifted();
  const t = updateSettleText('deadline', '0.6.55', null, null, 'win32');
  assert.match(t, /double-click Kosmos\.exe in your Kosmos folder/, 'the win32 slow remedy is missing');
  assert.doesNotMatch(t, /Applications/, 'the Mac Applications line showed on Windows');
});

test('the Mac overlay copy is byte-identical: failed, did-not-take and slow are exactly as before the arm', () => {
  const { updateSettleText } = lifted();
  assert.equal(updateSettleText('failed', '0.6.55', { code: 7 }, null, 'darwin'),
    '<b>The update did not take.</b>The installer stopped (code 7). Kosmos is still on 0.6.55.');
  assert.equal(updateSettleText('failed', '0.6.55', { code: null }, null, 'darwin'),
    '<b>The update did not take.</b>The installer could not be started. Kosmos is still on 0.6.55.');
  assert.equal(updateSettleText('did-not-take', '0.6.55', null, null, 'darwin'),
    '<b>The update did not take.</b>Kosmos came back on the same version. Kosmos is still on 0.6.55.');
  assert.equal(updateSettleText('deadline', '0.6.55', null, null, 'darwin'),
    '<b>This is taking longer than expected.</b>Kosmos is still on 0.6.55. If Kosmos does not come back on its own, open it again from Applications.');
  /* And with no version and the installer's notes path, both platforms keep the notes tail. */
  assert.equal(updateSettleText('did-not-take', null, null, '/logs/install.log', 'darwin'),
    '<b>The update did not take.</b>Kosmos came back on the same version. The installer\'s notes are at <code>/logs/install.log</code>.');
  assert.equal(updateSettleText('did-not-take', null, null, '/logs/install.log', 'win32'),
    '<b>The update did not take.</b> Nothing else was changed. The installer\'s notes are at <code>/logs/install.log</code>.');
});

test('the confirm dialog: the Windows body names the download-then-swap, the Mac body stays inline and unchanged', () => {
  const { windowsCopy } = lifted();
  assert.equal(windowsCopy('updateConfirmBody'),
    'Kosmos downloads the update, then closes for a few seconds while it swaps it in. <b>Your agents keep working the whole time.</b>');
  /* The static element carries the key, so applyPlatformCopy swaps it on Windows and leaves the Mac
     inline text untouched. */
  assert.match(PAGE, /<p class="rm-small" id="uc-small" data-win-copy="updateConfirmBody">Kosmos closes for a few seconds while it updates\.\s*<b>Your agents keep working the whole time\.<\/b><\/p>/,
    'the confirm body lost its data-win-copy key or its Mac inline wording changed');
});
