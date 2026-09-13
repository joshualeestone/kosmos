'use strict';
/**
 * win32-board-copy: the board speaks Windows on Windows, and the Mac board is unchanged.
 *
 * 🛑 WHAT THIS EXISTS FOR. #12 (0.6.39) deleted the page's platform copy cluster, and every
 * Mac screen, word and dead button reached Windows users from then on: the first-run macOS
 * dialogs, "applications folder" and "dock", the Dock and tmux boxes in Settings, Finder
 * and Terminal buttons, a not-signed-in panel pointing at ~/.local, and "Quit and reopen"
 * (installer nativeness audit C/D, parity audit P0-3..6). The page now has ONE layer:
 * servedPlatform/onWindows decide, windowsCopyTable holds every Windows sentence, and
 * data-win-copy / data-win-hide carry it into static markup.
 *
 * 🔑 EVERY ARM RUNS TWICE. Each painter below is the page's own source, lifted, and run
 * against a document whose <meta name="kosmos-platform"> says win32 and then darwin. The
 * Windows run asserts the Windows words are there and the Mac words are not; the darwin
 * run asserts the Mac output against a SNAPSHOT of what origin/main renders, so a Windows
 * change that leaks into the Mac page goes red here rather than on a Mac.
 *
 *   node --test web.win32-board-copy.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const page = require('./test-support/page');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = page.scriptOf(PAGE);
const SERVER = fs.readFileSync(nodePath.join(__dirname, 'server.js'), 'utf8');
const LAYER = page.liftAll(SCRIPT, page.PLATFORM_COPY_FNS);
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A document stub whose served platform meta says `platform` (undefined = unstamped). */
function docFor(platform, byId = {}) {
  return {
    querySelector: (sel) => (sel === 'meta[name="kosmos-platform"]' && platform !== undefined
      ? { getAttribute: () => platform } : null),
    getElementById: (id) => byId[id] || null,
  };
}

/** Run page source (the layer plus `names`) with `document` bound, returning `expr`'s value. */
function runPage(platform, names, expr, extra = {}) {
  const params = ['document', ...Object.keys(extra)];
  // eslint-disable-next-line no-new-func
  return new Function(...params, LAYER + '\n' + page.liftAll(SCRIPT, names) + '\nreturn ' + expr + ';')(
    extra.document || docFor(platform, extra.__byId), ...Object.values(extra));
}

const table = runPage('win32', [], 'windowsCopyTable()');

/* ---------------------------------------------------------------------------
   The fact: stamped by the server, read by one function
--------------------------------------------------------------------------- */

test('the server stamps the page with ITS platform, per request, and leaves an unmarked page alone', () => {
  const marker = SERVER.match(/const PAGE_PLATFORM_MARKER = '([^']+)';/);
  const fnAt = SERVER.indexOf('function stampServedPlatform(');
  assert.ok(marker && fnAt > -1, 'the stamp moved out of server.js');
  const fnSrc = SERVER.slice(fnAt, SERVER.indexOf('\n}\n', fnAt) + 2);
  const stampWith = (platform) => new Function('platformGate', 'const PAGE_PLATFORM_MARKER = ' + JSON.stringify(marker[1]) + ';\n'
    + fnSrc + '\nreturn stampServedPlatform;')({ describe: () => ({ platform }) });
  const buf = Buffer.from(PAGE.slice(0, PAGE.indexOf('</head>')));
  assert.match(stampWith('win32')(buf), /<meta name="kosmos-platform" content="win32">/);
  assert.match(stampWith('darwin')(buf), /<meta name="kosmos-platform" content="darwin">/);
  const unmarked = Buffer.from('<html>no marker</html>');
  assert.equal(stampWith('win32')(unmarked), unmarked, 'a page without the marker was rewritten');
  assert.ok(SERVER.includes('res.end(stampServedPlatform(buf));'), 'the page route no longer stamps what it serves');
  assert.match(PAGE, /<meta name="kosmos-platform" content="__KOSMOS_PLATFORM__">/, 'the marker left the page head');
  assert.ok(PAGE.indexOf('name="kosmos-platform"') < PAGE.indexOf('</head>'));
});

test('servedPlatform: unstamped is not Windows, win32 is, and a payload\'s own platform wins', () => {
  assert.equal(runPage(undefined, [], 'onWindows()'), false, 'a file:// page read as Windows');
  assert.equal(runPage('__KOSMOS_PLATFORM__', [], 'onWindows()'), false, 'the unstamped marker read as a platform');
  assert.equal(runPage('darwin', [], 'onWindows()'), false);
  assert.equal(runPage('win32', [], 'onWindows()'), true);
  assert.equal(runPage('darwin', [], "onWindows('win32')"), true, 'the connect card\'s served platform did not win');
  assert.equal(runPage('win32', [], "onWindows('darwin')"), false);
  /* No document at all (a Node eval of the whole script) is not Windows and does not throw. */
  // eslint-disable-next-line no-new-func
  assert.equal(new Function(LAYER + '\nreturn onWindows();')(), false);
});

test('ONE comparison: the page compares against win32 in exactly one place', () => {
  /* Counts COMPARISONS (===, !==, ==, != against the literal, either side), not every
     appearance of the word: the <html> stamp writes the literal and decides nothing. */
  const code = SCRIPT.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '');
  const comparisons = code.match(/[!=]==?\s*['"]win32['"]|['"]win32['"]\s*[!=]==?/g) || [];
  assert.deepEqual(comparisons, ["=== 'win32'"], 'the page compares against win32 somewhere other than onWindows');
  assert.match(code, /return known === 'win32';/);
  /* CONTROL: the counter really sees a comparison written the other way round. */
  assert.equal(("if ('win32' === p) {}").match(/[!=]==?\s*['"]win32['"]|['"]win32['"]\s*[!=]==?/g).length, 1);
});

/* ---------------------------------------------------------------------------
   The table and the markup it feeds
--------------------------------------------------------------------------- */

const COPY_KEYS_IN_MARKUP = ['s3Lead', 's3SleepCaption', 's3SleepHow', 's3BatteryNote', 's7Body', 's7Tip',
  'settingsRevealButton', 'settingsOpenKosmos', 'terminalTab', 'terminalBoxTitle', 'trustRestartHint', 'docsOpenFolder',
  'updateOpenFolder'];

test('every data-win-copy key in the markup has a Windows string, and the list is the one expected', () => {
  const keys = [...PAGE.matchAll(/data-win-copy="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(keys)].sort(), [...COPY_KEYS_IN_MARKUP].sort());
  for (const k of keys) assert.equal(typeof table[k], 'string', `no Windows copy for ${k}`);
  assert.throws(() => runPage('win32', [], "windowsCopy('noSuchKey')"), /no Windows copy named noSuchKey/);
});

test('no Windows string carries Mac words, "log in", or a brace the lifter would miscount', () => {
  const MAC = /\bFinder\b|\bDock\b|System Settings|macOS|\bMac\b|applications folder|\bTerminal\b|\bunpack\b|\bQuit\b|\blog in\b|~\/|kosmos agents|kosmos restart|fix(es)? itself/i;
  for (const [key, value] of Object.entries(table)) {
    const words = value.replace(/<[^>]+>/g, ' ');
    assert.doesNotMatch(words, MAC, `the Windows copy "${key}" says something only true on a Mac: ${words}`);
    assert.doesNotMatch(value, /[{}]/, `"${key}" has a brace, which breaks every harness that lifts the table`);
  }
});

test('applyPlatformCopy: on Windows it stamps <html>, swaps every keyed element and reveals the Windows-only ones; on a Mac it touches nothing', () => {
  const build = () => {
    const html = { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } };
    const copyEls = [...PAGE.matchAll(/<(\w+)([^>]*?)data-win-copy="([^"]+)"([^>]*)>([^<]*)/g)]
      .map((m) => ({ key: m[3], innerHTML: m[5], getAttribute: (n) => (n === 'data-win-copy' ? m[3] : null) }));
    const onlyEls = [...PAGE.matchAll(/<p data-win-only hidden data-win-copy="([^"]+)">/g)].map(() => ({ hidden: true }));
    const ariaEls = [...PAGE.matchAll(/<(\w+)[^>]*?aria-label="([^"]*)"[^>]*?data-win-aria-label="([^"]+)"/g)].map((m) => ({
      key: m[3], attrs: { 'aria-label': m[2] },
      getAttribute(n) { return n === 'data-win-aria-label' ? m[3] : this.attrs[n]; },
      setAttribute(n, v) { this.attrs[n] = v; },
    }));
    const root = { querySelectorAll: (sel) => (sel === '[data-win-copy]' ? copyEls : sel === '[data-win-only]' ? onlyEls
      : sel === '[data-win-aria-label]' ? ariaEls : []) };
    return { html, copyEls, onlyEls, ariaEls, root };
  };
  const apply = (platform, world) => {
    const doc = { ...docFor(platform), documentElement: world.html };
    // eslint-disable-next-line no-new-func
    new Function('document', 'root', LAYER + '\n' + page.lift(SCRIPT, 'applyPlatformCopy') + '\napplyPlatformCopy(root);')(doc, world.root);
  };

  const mac = build();
  const before = mac.copyEls.map((e) => e.innerHTML);
  apply('darwin', mac);
  assert.deepEqual(mac.html.attrs, {}, 'a Mac page was stamped as Windows');
  assert.deepEqual(mac.copyEls.map((e) => e.innerHTML), before, 'a Mac element was rewritten');
  assert.ok(mac.onlyEls.length === 2 && mac.onlyEls.every((e) => e.hidden), 'a Windows-only paragraph showed on a Mac');
  assert.deepEqual(mac.ariaEls.map((e) => e.attrs['aria-label']), ['Terminal'], 'a Mac accessible name was renamed');

  const win = build();
  apply('win32', win);
  assert.equal(win.html.attrs['data-kosmos-platform'], 'win32');
  assert.ok(win.copyEls.length >= COPY_KEYS_IN_MARKUP.length);
  for (const el of win.copyEls) assert.equal(el.innerHTML, table[el.key], `${el.key} was not swapped`);
  assert.ok(win.onlyEls.every((e) => e.hidden === false), 'a Windows-only paragraph stayed hidden on Windows');
  for (const el of win.ariaEls) assert.equal(el.attrs['aria-label'], table[el.key], `${el.key} accessible name was not swapped`);

  assert.match(PAGE, /applyPlatformCopy\(typeof document === 'undefined' \? null : document\);/, 'the layer is never applied at load');
});

test('BUG a11y (review round 1): the agent\'s Terminal section is NAMED what its tab says, "Live output" on Windows', () => {
  /* The tab's visible label and the section's accessible name are one fact, so they come
     from one key: a screen reader must not announce "Terminal" under a "Live output" tab. */
  assert.match(PAGE, /<button type="button" data-go="term" aria-controls="d-sec-term" data-win-copy="terminalTab">Terminal<\/button>/);
  assert.match(PAGE, /<section class="dsec" id="d-sec-term" data-sec="term" tabindex="-1" aria-label="Terminal" data-win-aria-label="terminalTab" data-tied="1" hidden>/,
    'the Terminal section is not named from the same key as its tab');
  assert.match(page.lift(SCRIPT, 'applyPlatformCopy'),
    /querySelectorAll\('\[data-win-aria-label\]'\)\.forEach\(\(el\) => \{ el\.setAttribute\('aria-label', windowsCopy\(el\.getAttribute\('data-win-aria-label'\)\)\); \}\)/);
  assert.equal(table.terminalTab, 'Live output');
});

test('CONVENTION (review round 1): the Copy button, the folder button and every composed Windows sentence read the table', () => {
  const copy = page.lift(SCRIPT, 'copyCommandFrom');
  assert.match(copy, /button\.textContent = windowsCopy\(copied \? 'copyDone' : 'copyFallback'\);/);
  assert.match(copy, /button\.textContent = windowsCopy\('copyLabel'\);/);
  assert.doesNotMatch(copy, /'Copied'|'Select it and copy'|'Copy'/, 'a Copy button label is inline again');
  assert.deepEqual([table.copyLabel, table.copyDone, table.copyFallback], ['Copy', 'Copied', 'Select it and copy']);
  assert.equal(table.updateOpenFolder, 'Open my Kosmos folder');
  const handlerAt = SCRIPT.indexOf("getElementById('upd-open-folder').addEventListener('click'");
  const handler = SCRIPT.slice(handlerAt, SCRIPT.indexOf('\n});', handlerAt));
  assert.equal((handler.match(/windowsCopy\('openKosmosFolderFailure'\)/g) || []).length, 2);
  assert.doesNotMatch(handler, /We could not open your Kosmos folder/, 'the folder failure sentence is inline again');
  assert.match(page.lift(SCRIPT, 'paintUpdateAbort'), /\? windowsCopy\('updateAbortRemedy'\)/);
  assert.match(page.lift(SCRIPT, 'renderUpdateToast'), /\? windowsCopy\('engineStaleRemedy'\)/);
});

test('SAFETY 1 UI (review round 1): every Documents open handler shows the sentence when Windows showed a file instead of opening it', () => {
  const handlers = [];
  let at = SCRIPT.indexOf("/open-file',");
  while (at > -1) {
    handlers.push(SCRIPT.slice(at, at + 900));
    at = SCRIPT.indexOf("/open-file',", at + 1);
  }
  assert.equal(handlers.length, 3, 'an open-file handler was added or lost');
  for (const h of handlers) {
    assert.match(h, /b && b\.revealedInstead && b\.say/, 'an open-file handler drops the "shown instead of opened" sentence: ' + h.slice(0, 160));
  }
  assert.ok(SERVER.includes("opened.revealedInstead ? { ok: true, revealedInstead: true, say: opened.say } : { ok: true }"),
    'the open-file route no longer carries the sentence to the page');
});

test('one CSS rule hides the Mac-only surfaces, and it is on each one the audits named', () => {
  assert.match(PAGE, /html\[data-kosmos-platform="win32"\] \[data-win-hide\] \{ display: none !important; \}/);
  const HIDDEN_ON_WINDOWS = {
    'S3 Energy mock (traffic lights)': /<div class="s3-mock" data-win-hide>\s*<div class="s3-win" aria-hidden="true">\s*<div class="s3-bar">[^\n]*>Energy</,
    'S3 Accessibility mock': /<div class="s3-mock" data-win-hide>\s*<div class="s3-win" aria-hidden="true">\s*<div class="s3-bar">[^\n]*>Accessibility</,
    'S3 Accessibility caption': /<p class="s3-step-cap" data-win-hide>2 &middot; when prompted, switch Kosmos to On<\/p>/,
    'S3 Accessibility gate row': /<div class="s3-gate-row" data-gate="tmux" data-win-hide>/,
    'S7 Dock drawing': /<div class="s7-dock-wrap" id="fr-success" data-win-hide>/,
    'Settings Dock icon': /<img class="dockrow-i" data-win-hide /,
    'Settings Accessibility sentence': /<p class="dhint" id="set-a11y-say"[^>]*data-win-hide>/,
    'Settings Accessibility button': /<button class="btn" id="set-a11y-open" type="button" data-win-hide>/,
    'Settings tmux box': /<section class="dbox" data-win-hide>\s*<!-- The tmux permission box/,
    'Update Kosmos automatically (P0-5)': /<div class="setrow" id="auto-row" style="margin-top:12px;" data-win-hide>/,
    'its status line': /<p class="dhint" id="auto-msg"[^>]*data-win-hide>/,
    'Open Terminal (W-18)': /<div class="field" data-win-hide>\s*<button class="btn" id="d-open-terminal"/,
  };
  for (const [name, re] of Object.entries(HIDDEN_ON_WINDOWS)) assert.match(PAGE, re, `${name} is not hidden on Windows`);
  /* Counted on the MARKUP only (scripts, styles and comments stripped), so the rule and the
     comments that explain the attribute are not counted as uses of it. */
  const markup = PAGE.replace(/<script\b[\s\S]*?<\/script>/g, '').replace(/<style\b[\s\S]*?<\/style>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  assert.equal((markup.match(/\sdata-win-hide[\s>]/g) || []).length, Object.keys(HIDDEN_ON_WINDOWS).length,
    'a data-win-hide was added or lost without this list');
});

test('the Windows first-run gate poll does not wait on a gate the platform hides', () => {
  const hidden = { closest: (sel) => (sel === '[data-win-hide]' ? {} : null) };
  const shown = { closest: () => null };
  assert.equal(runPage('win32', ['platformHides'], 'platformHides(E)', { E: hidden }), true);
  assert.equal(runPage('win32', ['platformHides'], 'platformHides(E)', { E: shown }), false);
  assert.equal(runPage('darwin', ['platformHides'], 'platformHides(E)', { E: hidden }), false, 'a Mac skipped a gate');
  const poll = page.lift(SCRIPT, 'frPollGates');
  assert.match(poll, /querySelectorAll\('\[data-gate\]'\)\)\.filter\(\(row\) => !platformHides\(row\)\)/);
});

/* ---------------------------------------------------------------------------
   The wizard (W-10, W-12, W-11, W-15)
--------------------------------------------------------------------------- */

function wizard(platform, expr) {
  return runPage(platform, ['frStepSequence', 'frStepAfter', 'frStepProgress'], expr, { FR_STEPS: 9 });
}

test('a Windows wizard skips S2 (macOS file-access dialog) and S4 (macOS background notice), and counts honestly', () => {
  assert.deepEqual(wizard('win32', 'frStepSequence()'), [1, 3, 5, 6, 7, 8, 9]);
  assert.equal(wizard('win32', 'frStepAfter(1)'), 3, 'Get Started still lands on the macOS permission dialog');
  assert.equal(wizard('win32', 'frStepAfter(3)'), 5, 'S3 Next still lands on the macOS notification mock');
  assert.equal(wizard('win32', 'frStepAfter(2)'), 3, 'a deep link to S2 does not move on');
  assert.equal(wizard('win32', 'frStepAfter(4)'), 5, 'a deep link to S4 does not move on');
  assert.equal(wizard('win32', 'frStepProgress(3)'), 1 / 6, 'the progress still counts the skipped steps');
  assert.equal(wizard('win32', 'frStepProgress(9)'), 1);
  const go = page.lift(SCRIPT, 'frGo');
  assert.match(go, /if \(!frStepSequence\(\)\.includes\(step\)\) step = frStepAfter\(step\);/, 'frGo paints a skipped step on a deep link');
  assert.match(go, /frDots\.progress\(frStepProgress\(step\)\);/);
  for (const hop of ['frGo(frStepAfter(1))', 'frGo(frStepAfter(2))', 'frGo(frStepAfter(3))', 'frGo(frStepAfter(4))']) {
    assert.ok(go.includes(hop), `frGo lost the hop ${hop}`);
  }
});

test('MAC UNCHANGED: the wizard walks all nine steps, and progress is the number it always was', () => {
  assert.deepEqual(wizard('darwin', 'frStepSequence()'), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  for (let s = 1; s <= 9; s += 1) {
    assert.equal(wizard('darwin', `frStepAfter(${s})`), Math.min(s + 1, 9));
    assert.equal(wizard('darwin', `frStepProgress(${s})`), (s - 1) / (9 - 1), `step ${s} progress moved on a Mac`);
  }
  assert.deepEqual(wizard(undefined, 'frStepSequence()'), [1, 2, 3, 4, 5, 6, 7, 8, 9], 'an unstamped page skipped steps');
});

test('S3 and S7 on Windows: the audit\'s words, no Accessibility, no Dock', () => {
  assert.equal(table.s3Lead, 'To get the most out of your agents, this PC needs to stay awake while they work.');
  assert.match(table.s3SleepHow, /Settings &gt; System &gt; Power &amp; battery &gt; Screen, sleep, &amp; hibernate timeouts/);
  assert.match(table.s3SleepHow, /When plugged in, put my device to sleep after<\/b> to <b>Never<\/b>/);
  assert.equal(table.s3BatteryNote, 'On battery your PC will still sleep to save power. For overnight work, leave it plugged in.');
  assert.equal(table.s7Body, 'To open Kosmos later, double-click <b>Kosmos.exe</b> in the folder you extracted it to.');
  assert.equal(table.s7Tip, 'Tip: right-click <b>Kosmos.exe</b> and choose <b>Pin to Start</b>.');
  assert.equal(runPage('win32', [], "platformCopy('firePermissionFailure', 'we could not open System Settings')"), 'we could not open Settings');
});

/* ---------------------------------------------------------------------------
   Not signed in (W-24), toasts (W-26), the Claude card, Settings rows
--------------------------------------------------------------------------- */

const MAC_SIGNIN_PANEL = '<div class="pj-empty boardfail">'
  + '<p><b>This board is not signed in.</b><br>'
  + 'It cannot read your agents or projects yet. It will fix itself the next '
  + 'time Kosmos updates, with no action from you. A bookmark or a typed '
  + '127.0.0.1 address reaches the board without its access token; the next '
  + 'update hands the token over.</p>'
  + '<details class="fr-hatch"><summary>Need it sooner?</summary>'
  + 'Run <code>~/.local/share/kosmos/bin/kosmos open</code> in a terminal. Use '
  + 'the full path shown: the bare name is not always on your PATH.</details>'
  + '<button class="btn" type="button" data-board-retry>Reload</button>'
  + '</div>';
const MAC_SIGNIN_SENTENCE = 'This board is not signed in, so it cannot read your agents or projects. It fixes itself the next time Kosmos updates.';

function boardEmpty(platform, failed) {
  return runPage(platform, ['esc', 'boardSigninHtml', 'boardEmpty'], 'boardEmpty()',
    { BOARD_SEEN: true, BOARD_LOOK_FAILED: failed || null, BOARD_NEEDS_SIGNIN: !failed });
}

test('the not-signed-in panel on Windows points at Kosmos.exe, with no Mac path, no self-heal and no kosmos command', () => {
  const html = runPage('win32', ['boardSigninHtml'], 'boardSigninHtml()');
  assert.match(html, /open Kosmos by double-clicking <b>Kosmos\.exe<\/b> in your Kosmos folder/);
  assert.match(html, /data-board-retry/, 'the panel lost its Reload');
  assert.doesNotMatch(html, /~\/\.local|kosmos open|fix(es)? itself|Terminal|terminal/);
  const sentence = runPage('win32', [], page.liftConst(SCRIPT, 'SIGNIN_SENTENCE').replace(/^const SIGNIN_SENTENCE = /, '').replace(/;$/, ''));
  assert.equal(sentence, 'This board is not signed in, so it cannot read your agents or projects. To fix it, open Kosmos by double-clicking Kosmos.exe in your Kosmos folder.');
  assert.doesNotMatch(boardEmpty('win32', 'tmux is not answering'), /kosmos agents|Already use Terminal/, 'the kosmos agents hatch shows on Windows');
});

test('MAC UNCHANGED: the not-signed-in panel, the sentence, and the kosmos agents hatch', () => {
  assert.equal(runPage('darwin', ['boardSigninHtml'], 'boardSigninHtml()'), MAC_SIGNIN_PANEL);
  assert.equal(runPage(undefined, ['boardSigninHtml'], 'boardSigninHtml()'), MAC_SIGNIN_PANEL);
  const expr = page.liftConst(SCRIPT, 'SIGNIN_SENTENCE').replace(/^const SIGNIN_SENTENCE = /, '').replace(/;$/, '');
  assert.equal(runPage('darwin', [], expr), MAC_SIGNIN_SENTENCE);
  assert.match(boardEmpty('darwin', 'tmux is not answering'),
    /<details class="fr-hatch"><summary>Already use Terminal\?<\/summary>Run <code>kosmos agents<\/code> to look for yourself\.<\/details><button class="btn" type="button" data-board-retry>Try again<\/button>/);
});

function abortToast(platform) {
  const slot = { dataset: {}, innerHTML: '' };
  runPage(platform, ['paintUpdateAbort'], 'paintUpdateAbort(AB)', { AB: { count: 2 }, __byId: { 'uabort-slot': slot } });
  return slot.innerHTML;
}
function engineToast(platform) {
  const slot = { dataset: {}, innerHTML: '' };
  const doc = { ...docFor(platform, { 'utoast-slot': slot }) };
  runPage(platform, ['bakedVersion', 'pageIsStale', 'renderUpdateToast'], 'renderUpdateToast(null)', {
    document: doc, esc, UPDATING_NOW: false, SERVED_VERSION: null, updateLaterSuppresses: () => false,
    UPD_CONFIRM_OPENER: null, ENGINE_STALE: { startedAt: 'not a date', staleSince: '2026-09-12T00:00:00Z' },
  });
  return slot.innerHTML;
}
function offlineNote(platform) {
  const slot = { dataset: {}, innerHTML: '' };
  runPage(platform, ['bakedVersion', 'paintOfflineNote'], 'paintOfflineNote(true)', {
    esc, location: { host: '127.0.0.1:16180' }, __byId: { 'uoffline-slot': slot },
  });
  return slot.innerHTML;
}

test('the recovery toasts on Windows say to restart Kosmos by double-clicking Kosmos.exe or signing out, never Quit', () => {
  const restart = 'restart Kosmos by double-clicking Kosmos.exe in your Kosmos folder, or by signing out of Windows and signing back in.';
  const abort = abortToast('win32');
  assert.ok(abort.includes('Kosmos was busy each time. To clear it, ' + restart), abort);
  assert.doesNotMatch(abort, /Quit/);
  const engine = engineToast('win32');
  assert.ok(engine.includes('Only a restart picks it up: ' + restart + '</small>'), engine);
  assert.doesNotMatch(engine, /kosmos restart/);
  const offline = offlineNote('win32');
  assert.match(offline, /Double-click Kosmos\.exe in your Kosmos folder and it will start again if it needs to\./);
  assert.doesNotMatch(offline, /Applications folder/);
  const sw = page.lift(SCRIPT, 'worldswSwitch');
  assert.match(sw, /\? windowsCopy\('worldSwitchRestart'\)\.replace\('%NAME%', \(\) => switchedName\)/);
  assert.equal(table.worldSwitchRestart.replace('%NAME%', () => 'Side $& Project'),
    'Kosmos could not restart itself. To finish switching to Side $& Project, ' + restart,
    'a Kosmos name is not inserted literally (a replacement pattern in the name was interpreted)');
});

test('MAC UNCHANGED: the three recovery toasts and the world-switch sentence', () => {
  assert.equal(abortToast('darwin'), '<div class="utoast stale" role="status"><span class="udot" aria-hidden="true"></span>'
    + '<div class="utxt"><b>A new version of Kosmos is ready.</b><small>This computer has tried to install it 2 times and could not, because '
    + 'Kosmos was busy each time. Quit and reopen Kosmos: reopening usually clears whatever '
    + 'was holding the update, so the next one can finish. Your agents keep working, they do '
    + 'not live in this window.</small></div></div>');
  assert.equal(engineToast('darwin'), '<div class="utoast stale" role="status"><span class="udot" aria-hidden="true"></span>'
    + '<div class="utxt"><b>Kosmos changed on disk</b><small>The board is running older code. '
    + 'Only a restart picks it up: <code>kosmos restart</code></small></div></div>');
  assert.equal(offlineNote('darwin'), '<div class="utoast stale" role="status"><span class="udot" aria-hidden="true"></span>'
    + '<div class="utxt"><b>Kosmos is not answering on this computer</b><small>Nothing answered at 127.0.0.1:16180. '
    + 'Open Kosmos from your Applications folder and it will start again if it needs to.</small></div></div>');
  assert.match(page.lift(SCRIPT, 'worldswSwitch'),
    /: 'Kosmos could not restart itself\. Quit and reopen Kosmos to finish switching to ' \+ switchedName \+ '\.'\);/);
});

function confirmSentence(platform, conn) {
  return runPage(platform, ['frRoughMB', 'frClaudeDownloadBytes', 'frClaudeConfirmSentence'], 'frClaudeConfirmSentence(CONN)', { FR: null, CONN: conn });
}

test('the Claude card on Windows: PowerShell steps, a Copy button, no macOS clause, and no promise to install', () => {
  assert.match(table.claudeInstallNote, /^Kosmos can&rsquo;t install Claude Code for you on Windows yet, so this one step is yours\. Open the Start menu, type <b>PowerShell<\/b>, and press Enter\./);
  assert.match(table.claudeInstallNote, /<pre class="fr-cmd">irm https:\/\/claude\.ai\/install\.ps1 \| iex<\/pre><button class="btn-quiet fr-copy" type="button" data-copy-command>Copy<\/button>/);
  assert.doesNotMatch(table.claudeInstallNote, /macOS/);
  assert.match(table.claudeTerminalHatch, /^<details class="fr-hatch"><summary>Already use PowerShell\?<\/summary>/);
  assert.match(table.claudeTerminalHatch, /Type <b>claude<\/b>, press Enter, and follow its sign-in\. Then come back here and click <b>Try again<\/b>\./);
  const win = confirmSentence('win32', { platform: 'win32', canInstallClaude: false, willInstall: true });
  assert.equal(win, table.claudeConfirmSentence);
  assert.doesNotMatch(win, /we need to install Claude Code first|we will install it/);
  /* The gate reads the capability too: the day Kosmos can install on Windows, the Mac sentence is true again. */
  assert.match(confirmSentence('win32', { platform: 'win32', canInstallClaude: true, willInstall: true }), /we need to install Claude Code first/);
  assert.match(PAGE, /async function copyCommandFrom\(button\)/);
  assert.match(page.lift(SCRIPT, 'copyCommandFrom'), /navigator\.clipboard\.writeText\(text\)/);
});

test('MAC UNCHANGED: both confirm sentences', () => {
  assert.equal(confirmSentence('darwin', { platform: 'darwin', canInstallClaude: true, willInstall: true }),
    'In order to connect to Claude, we need to install Claude Code first. It is a large download, about 231MB.');
  assert.equal(confirmSentence('darwin', { platform: 'darwin', canInstallClaude: true }),
    'Connecting to Claude needs Claude Code on this computer. If it is not here already we will install it, a large download, about 231MB.');
});

function machineRows(platform, report) {
  return runPage(platform, ['esc', 'chkRow', 'machineRows'], 'machineRows(REPORT)', {
    CHK_CLASS: { ok: 'ok', attention: 'att', unknown: 'unk' }, CHK_MARK: { ok: '✓', attention: '!', unknown: '?' }, REPORT: report,
  });
}

test('the Windows autostart row keeps its schtasks line behind "For IT admins", escaped', () => {
  const html = machineRows('win32', { checks: [{ key: 'autostart', state: 'ok', title: 'Kosmos starts itself when you sign in',
    detail: 'Kosmos starts when you sign in to Windows, and your agents come back on their own after a restart.',
    admin: 'To remove its startup job (Kosmos\\board): schtasks /Delete /F /TN "Kosmos\\board"' }] });
  assert.match(html, /<details class="fr-hatch"><summary>For IT admins<\/summary><p class="dhint" style="margin:6px 0 0;"><code>To remove its startup job \(Kosmos\\board\): schtasks \/Delete \/F \/TN &quot;Kosmos\\board&quot;<\/code><\/p><\/details>/);
  assert.doesNotMatch(html.slice(0, html.indexOf('<details')), /schtasks/, 'the command is in front of the person again');
});

test('MAC UNCHANGED: a machine row with its sleep button renders exactly as before', () => {
  assert.equal(machineRows('darwin', { checks: [{ key: 'sleep', state: 'ok', title: 'T', detail: 'D', settings: true }] }),
    '<div class="chk ok"><div class="chk-m" aria-hidden="true">✓</div><div><div class="chk-t">T</div><div class="chk-d">D</div>'
    + '<button class="btn-quiet" type="button" data-sleep-settings style="margin-top:10px;font-size:.875rem;padding:calc(.45em - 1px) calc(1em - 1px);">Open sleep settings</button>'
    + '</div></div>');
});

test('Settings, Documents and the agent page on Windows: File Explorer, the Kosmos folder, Live output', () => {
  assert.equal(table.settingsRevealButton, 'Open the Kosmos folder');
  assert.equal(table.settingsOpenKosmos, 'To open Kosmos later, double-click <b>Kosmos.exe</b> in your Kosmos folder. Tip: right-click Kosmos.exe and choose <b>Pin to Start</b>.');
  assert.equal(table.docsOpenFolder, 'Open in File Explorer');
  assert.equal(table.terminalTab, 'Live output');
  assert.equal(table.trustRestartHint, 'Approves this agent&rsquo;s folder so it can start without asking each time.');
  /* "Show them all in Finder" is no longer a rendered label on main (it became "View All" in
     #535), so there is nothing to reword: this pins that it has not come back. */
  assert.doesNotMatch(PAGE.replace(/<!--[\s\S]*?-->/g, ''), />Show them all in Finder</);
});

test('MAC UNCHANGED: every static Mac string this branch keyed or hid still reads exactly as on main', () => {
  const MAC_MARKUP = [
    />To get the most out of your agents we need to ensure they can stay awake and access the computer\.<\/p>/,
    />1 &middot; keep this computer awake<\/p>/,
    />2 &middot; when prompted, switch Kosmos to On<\/p>/,
    /<span class="s3-title">Energy<\/span>/,
    /<span class="s3-mtxt">Kosmos<small>Control your computer<\/small><\/span>/,
    /<h2>Kosmos needs your permission<\/h2>/,
    /<p class="s2-say">"Terminal" would like to access files in your folders\.<\/p>/,
    /<h2>Random notifications may appear<\/h2>/,
    /"bash" can run in the background\. You can manage background activity in Login Items &amp; Extensions\./,
    /<h2>Kosmos is installed and configured\.<\/h2>/,
    />Kosmos is now in your applications folder, and you will see Kosmos in your dock\.<\/p>/,
    />Drag the Kosmos icon to the far left so it stays there and is easy to find later\.<\/p>/,
    />Show me where it is<\/button>/,
    />\s*Kosmos is already in your Dock\. Drag it to the far left so it stays handy\.\s*<\/p>/,
    />Turning on accessibility lets Kosmos agents work in your other applications on this computer\.<\/p>/,
    />Open Accessibility settings<\/button>/,
    /<h3 class="dlab">If you see a box asking about &ldquo;tmux&rdquo;<\/h3>/,
    /<b>Update Kosmos automatically<\/b>\s*<p class="dhint" style="margin:2px 0 0;">On by default\. New versions install themselves, which takes a few seconds and reloads this board\. Agents keep running throughout\.<\/p>/,
    />Terminal<\/button>/,
    />This agent&rsquo;s Terminal<\/h3>/,
    />Open Terminal<\/button>/,
    />Opens this agent&rsquo;s Terminal window on this computer\.<\/p>/,
    />Approves this agent's folder so it can start without the macOS permission prompt each time\.<\/p>/,
    />Open this folder in Finder<\/button>/,
  ];
  for (const re of MAC_MARKUP) assert.match(PAGE, re, `a Mac string changed: ${re}`);
});
