'use strict';
/**
 * win32-board-copy: the board speaks Windows on Windows, and the Mac board is unchanged.
 * It also holds the Linux arms that share its platform-stamp harness (#5860's stuck-update toast).
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
  const stampWith = (platform, cloud = false) => new Function('platformGate', 'cloudMachine', 'const PAGE_PLATFORM_MARKER = ' + JSON.stringify(marker[1]) + ';\n'
    + fnSrc + '\nreturn stampServedPlatform;')({ describe: () => ({ platform }) }, { isCloudMachine: () => cloud });
  const buf = Buffer.from(PAGE.slice(0, PAGE.indexOf('</head>')));
  assert.match(stampWith('win32')(buf), /<meta name="kosmos-platform" content="win32">/);
  assert.match(stampWith('darwin')(buf), /<meta name="kosmos-platform" content="darwin">/);
  // kosmos#4903 S5: the cloud-machine fact is stamped beside it, "1" only when the board says so.
  assert.match(stampWith('linux', true)(buf), /<meta name="kosmos-cloud-machine" content="1">/);
  assert.match(stampWith('linux', false)(buf), /<meta name="kosmos-cloud-machine" content="0">/, 'CONTROL');
  const unmarked = Buffer.from('<html>no marker</html>');
  assert.equal(stampWith('win32')(unmarked), unmarked, 'a page without the marker was rewritten');
  // kosmos#7490: the stamped page is what the route sends (compressed or not, engine/pagecompress.js).
  assert.match(SERVER, /const page = stampServedPlatform\(buf\);\s*pageCompress\.sendPage\([^\n]*\n[^\n]*Buffer\.isBuffer\(page\) \? page : Buffer\.from\(page, 'utf8'\), compressedPage\);/,
    'the page route no longer stamps what it serves');
  assert.match(PAGE, /<meta name="kosmos-platform" content="__KOSMOS_PLATFORM__">/, 'the marker left the page head');
  assert.ok(PAGE.indexOf('name="kosmos-platform"') < PAGE.indexOf('</head>'));
});

test('kosmos#4903 S5 review 1: the page\'s REAL onCloudMachine says yes only for a stamped "1"', () => {
  // The page's own function, run against a document whose cloud-machine meta holds `content` (or no meta at all).
  const read = (content) => new Function('document', page.lift(SCRIPT, 'onCloudMachine') + '\nreturn onCloudMachine();')({
    querySelector: (q) => (q === 'meta[name="kosmos-cloud-machine"]' && content !== undefined ? { getAttribute: () => content } : null),
  });
  assert.equal(read('1'), true);
  assert.equal(read('0'), false, 'a board that is not a cloud machine read as one');
  assert.equal(read('__KOSMOS_CLOUD_MACHINE__'), false, 'the UNSTAMPED marker (file://, a harness) read as a cloud machine');
  assert.equal(read(''), false);
  assert.equal(read(undefined), false, 'a page with no meta read as a cloud machine');
  assert.equal(new Function('document', page.lift(SCRIPT, 'onCloudMachine') + '\nreturn onCloudMachine();')(undefined), false, 'no document');
  // And the page head carries the marker the server stamps.
  assert.match(PAGE, /<meta name="kosmos-cloud-machine" content="__KOSMOS_CLOUD_MACHINE__">/);
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
  'settingsRevealButton', 'settingsOpenKosmos', 'terminalBoxTitle', 'trustRestartHint', 'docsOpenFolder',
  'updateOpenFolder', 'updateConfirmBody',
  'openaiSubHow',   // #3436: the OpenAI subscription explainer (device code on Windows)
  'frOpenaiSubHow',   // #6521: the same on the first-run Model step, without the sentence its lead already says
  'openaiSubOpen'];   // 0.6.96: the OpenAI open-page link reads "again" on Windows, where Kosmos already opened it

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

test('BUG a11y (review round 1): the agent\'s Terminal section is NAMED what its tab says, "Start-up and restart" on Windows (#5239)', () => {
  /* The tab's visible label and the section's accessible name are one fact, so they come
     from one key: a screen reader must not announce "Terminal" under a "Start-up and restart" tab (#5239; "Live output" before). */
  // #2916 (Josh 6.59) renamed this nav PILL's Mac label "Terminal" -> "Advanced". #3500 made the
  // pill an icon+label box, so the data-win-copy="terminalTab" key now lives on the .dnav-lab span
  // (applyPlatformCopy sets the span's innerHTML, leaving the icon intact), and the Advanced pill's
  // aria-controls gained d-sec-remove because Remove folded under it. The one-key win32 consistency
  // this test guards (the pill read the Windows name, matching the section) is preserved.
  // #4550: the Advanced pill is gone (the Terminal section folds into AI Settings), so no pill label
  // carries the key now; the section's own accessible name still reads it, and no stale pill may.
  assert.doesNotMatch(PAGE, /<button type="button" data-go="term"/, 'an Advanced pill is back; #4550 folds Terminal into AI Settings');
  assert.doesNotMatch(PAGE, /data-win-copy="terminalTab">Advanced</, 'a stale Advanced label still carries the terminalTab key');
  assert.match(PAGE, /<section class="dsec" id="d-sec-term" data-sec="term" tabindex="-1" aria-label="Terminal" data-win-aria-label="terminalTab" data-tied="1" hidden>/,
    'the Terminal section is not named from the same key as its tab');
  assert.match(page.lift(SCRIPT, 'applyPlatformCopy'),
    /querySelectorAll\('\[data-win-aria-label\]'\)\.forEach\(\(el\) => \{ el\.setAttribute\('aria-label', windowsCopy\(el\.getAttribute\('data-win-aria-label'\)\)\); \}\)/);
  assert.equal(table.terminalTab, 'Start-up and restart');
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
  // #4408: the stale-engine arm promises no platform remedy; it is the same true sentence everywhere.
  assert.doesNotMatch(page.lift(SCRIPT, 'renderUpdateToast'), /engineStaleRemedy/);
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

test('NIT 1 (review round 2): open, then a file shown instead, then open again leaves no stale sentence, in all three handlers', async () => {
  /* Each handler is the page's own listener, run as the page runs it: the listener body is
     lifted from its addEventListener call and driven by a stub click and a stub fetch. */
  const LISTENERS = [['docs-list', 'docs-msg'], ['pj-docs', 'pj-docs-msg'], ['pj-room', 'pj-room-msg']];
  for (const [listId, msgId] of LISTENERS) {
    const anchor = "document.getElementById('" + listId + "').addEventListener('click', ";
    const at = SCRIPT.indexOf(anchor);
    assert.ok(at > -1, `the ${listId} open handler moved`);
    const body = SCRIPT.slice(at + anchor.length, SCRIPT.indexOf('\n});', at) + 2);
    const msg = { textContent: '' };
    const answers = [
      { ok: true, json: async () => ({ ok: true }) },
      { ok: true, json: async () => ({ ok: true, revealedInstead: true, say: table.copyLabel && 'SHOWN INSTEAD' }) },
      { ok: true, json: async () => ({ ok: true }) },
    ];
    // eslint-disable-next-line no-new-func
    const handler = new Function('document', 'fetch', 'PJ_CURRENT', 'pjSentence', 'asSentence',
      'PJ_DOCS_VIEW_PARTIAL', 'PJ_DOCS_PARTIAL', 'PJ_DOCS_RAIL_PARTIAL', 'kplusRemote', 'filesPvOpen', 'onLinux', 'return ' + body)(
      { getElementById: (id) => (id === msgId ? msg : null) },
      async () => answers.shift(),
      'proj', (s) => s, (s) => s, false, 'PARTIAL NOTE', false,
      () => false,   // #5165: at the computer; the Kosmos+ branch is the browser check's
      () => false,   // #4997: the full-page preview did not take this row (these arms are about the open path)
      () => false,   // #5881: not a Linux board (its Download branch: web.files-linux-download-5881.test.js)
    );
    const click = { target: { closest: () => ({ dataset: { doc: 'notes.pdf', ref: 'notes.pdf' } }) } };
    await handler(click);
    assert.equal(msg.textContent, '', `${listId}: a plain open wrote something`);
    await handler(click);
    assert.equal(msg.textContent, 'SHOWN INSTEAD', `${listId}: the shown-instead sentence did not appear`);
    await handler(click);
    assert.equal(msg.textContent, '', `${listId}: the shown-instead sentence stayed under the next document`);
  }
});

test('#2245: after an open, a list that was cut short keeps its partial note (View All and the rail)', async () => {
  for (const [listId, msgId, flag] of [['docs-list', 'docs-msg', 'view'], ['pj-docs', 'pj-docs-msg', 'rail']]) {
    const anchor = "document.getElementById('" + listId + "').addEventListener('click', ";
    const at = SCRIPT.indexOf(anchor);
    assert.ok(at > -1, `the ${listId} open handler moved`);
    const body = SCRIPT.slice(at + anchor.length, SCRIPT.indexOf('\n});', at) + 2);
    const run = async (partial) => {
      const msg = { textContent: 'before' };
      // eslint-disable-next-line no-new-func
      const handler = new Function('document', 'fetch', 'PJ_CURRENT', 'pjSentence', 'asSentence',
        'PJ_DOCS_VIEW_PARTIAL', 'PJ_DOCS_PARTIAL', 'PJ_DOCS_RAIL_PARTIAL', 'kplusRemote', 'filesPvOpen', 'onLinux', 'return ' + body)(
        { getElementById: (id) => (id === msgId ? msg : null) },
        async () => ({ ok: true, json: async () => ({ ok: true }) }),
        'proj', (s) => s, (s) => s, flag === 'view' && partial, 'PARTIAL NOTE', flag === 'rail' && partial,
        () => false,   // #5165: at the computer
        () => false,   // #4997: not a previewed row
        () => false,   // #5881: not a Linux board
      );
      await handler({ target: { closest: () => ({ dataset: { doc: 'a/b.pdf' } }) } });
      return msg.textContent;
    };
    assert.equal(await run(true), 'PARTIAL NOTE', `${listId}: the partial note was wiped by opening a file`);
    assert.equal(await run(false), '', `${listId}: CONTROL: a complete list shows nothing after an open`);
  }
});

test('one CSS rule hides the Mac-only surfaces, and it is on each one the audits named', () => {
  assert.match(PAGE, /html\[data-kosmos-platform="win32"\] \[data-win-hide\] \{ display: none !important; \}/);
  const HIDDEN_ON_WINDOWS = {
    'S3 Energy mock (traffic lights)': /<div class="s3-mock" data-win-hide>\s*<div class="s3-win" aria-hidden="true">\s*<div class="s3-bar">[^\n]*>Energy</,
    'S3 Accessibility mock': /<div class="s3-mock" data-win-hide>\s*<div class="s3-win" aria-hidden="true">\s*<div class="s3-bar">[^\n]*>Accessibility</,
    'S3 Accessibility caption': /<p class="s3-step-cap" data-win-hide>2 &middot; when prompted, switch Kosmos to On<\/p>/,
    'S3 Accessibility gate row': /<div class="s3-gate-row" data-gate="tmux" data-win-hide>/,
    // 2026-09-19 (Josh, 0.6.81 QA): the bundled-tmux own-grant gate row (data-gate="tmux-a11y")
    // was removed from onboarding, so its 'S3 tmux Accessibility gate row' key is gone from this
    // list. That drops exactly one data-win-hide element from the markup, so dropping exactly one
    // key keeps the count assertion below balanced. The single Accessibility ROW that stays is
    // the app's (data-gate="tmux"), pinned just above; the caption now reads "switch Kosmos to On".
    'S7 Dock drawing': /<div class="s7-dock-wrap" id="fr-success" data-win-hide>/,
    'Settings Dock icon': /<img class="dockrow-i" data-win-hide /,
    'Settings Accessibility sentence': /<p class="dhint" id="set-a11y-say"[^>]*data-win-hide[ >]/,
    'Settings Accessibility button': /<button class="btn" id="set-a11y-open" type="button" data-win-hide[ >]/,
    'Settings tmux box': /<section class="dbox" data-win-hide[^>]*>\s*<!-- The tmux permission box/,
    'Update Kosmos automatically (P0-5)': /<div class="setrow" id="auto-row" style="margin-top:12px;" data-win-hide>/,
    'its status line': /<p class="dhint" id="auto-msg"[^>]*data-win-hide>/,
    'Open Terminal (W-18)': /<div class="field" data-win-hide[^>]*>\s*<button class="btn" id="d-open-terminal"/,
    // #4025: the App icon switch, until a Windows taskbar count exists to switch.
    'Settings App icon box': /<section class="dbox" data-win-hide data-linux-hide>\s*<h3 class="dlab">App icon<\/h3>/,
    // #5977: the first-run Qwen row's "Add in Settings" pill; Windows cannot start a Qwen agent yet and shows "Coming to Windows".
    'First-run Qwen pill': /<b>Qwen<\/b><small>Alibaba<\/small><\/div><span class="soon" data-win-hide>Add in Settings<\/span>/,
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
  // #3112: Model (pane 5) is shown SECOND. Windows still drops Access(2) + Notifications(4)
  // by pane NUMBER, so the display order is [1,5,3,6,7,8,9] (Welcome, Model, Automation, 6-9).
  assert.deepEqual(wizard('win32', 'frStepSequence()'), [1, 5, 3, 6, 7, 8, 9]);
  assert.equal(wizard('win32', 'frStepAfter(1)'), 5, 'Get Started now lands on the Model step (#3112)');
  assert.equal(wizard('win32', 'frStepAfter(5)'), 3, 'Model Next lands on the automation step');
  assert.equal(wizard('win32', 'frStepAfter(3)'), 6, 'S3 Next lands on step 6 (Access + Notifications are macOS-only)');
  assert.equal(wizard('win32', 'frStepAfter(2)'), 3, 'a deep link to the skipped S2 falls forward BY NUMBER to Automation (pre-#3112 fallback)');
  assert.equal(wizard('win32', 'frStepAfter(4)'), 5, 'a deep link to the skipped S4 falls forward BY NUMBER to Model (the next pane number in the sequence)');
  assert.equal(wizard('win32', 'frStepProgress(3)'), 2 / 6, 'the progress counts display position, skipped steps included');
  assert.equal(wizard('win32', 'frStepProgress(9)'), 1);
  const go = page.lift(SCRIPT, 'frGo');
  assert.match(go, /if \(!frStepSequence\(\)\.includes\(step\)\) step = frStepAfter\(step\);/, 'frGo paints a skipped step on a deep link');
  assert.match(go, /frDots\.progress\(frStepProgress\(step\)\);/);
  for (const hop of ['frGo(frStepAfter(1))', 'frGo(frStepAfter(2))', 'frGo(frStepAfter(3))', 'frGo(frStepAfter(4))']) {
    assert.ok(go.includes(hop), `frGo lost the hop ${hop}`);
  }
});

test('MAC (#3112): the wizard walks all nine steps with Model shown second, progress by display position', () => {
  const order = [1, 5, 2, 3, 4, 6, 7, 8, 9];   // #3112: Model (pane 5) is shown second, right after Welcome
  assert.deepEqual(wizard('darwin', 'frStepSequence()'), order);
  // frStepAfter walks the DISPLAY order (indexOf+1), not pane number + 1, and frStepProgress
  // counts the display position; a regression to the old ascending [1..9] order fails here.
  for (let i = 0; i < order.length; i += 1) {
    const s = order[i];
    const after = i + 1 < order.length ? order[i + 1] : 9;   // the last step returns the last step (FR_STEPS is 9)
    assert.equal(wizard('darwin', `frStepAfter(${s})`), after, `frStepAfter(${s}) moved wrong on a Mac`);
    assert.equal(wizard('darwin', `frStepProgress(${s})`), i / (order.length - 1), `step ${s} progress moved on a Mac`);
  }
  assert.deepEqual(wizard(undefined, 'frStepSequence()'), order, 'an unstamped page skipped steps');
});

test('S3 and S7 on Windows: the audit\'s words, no Accessibility, no Dock', () => {
  assert.equal(table.s3Lead, 'To get the most out of your agents, this PC needs to stay awake while they work.');
  /* #3324: trimmed to the one essential line; the long Settings-path instructions were cut,
     because the Turn On button opens that page and now brings it to the foreground. */
  assert.equal(table.s3SleepHow, 'Your agents pause when your PC sleeps.');
  assert.doesNotMatch(table.s3SleepHow, /Settings &gt; System|put my device to sleep/, 'the long Settings path is gone');
  assert.equal(table.s3BatteryNote, 'On battery your PC will still sleep to save power. For overnight work, leave it plugged in.');
  /* #3324: the Windows pin-to-taskbar screen, the analog of the Mac keep-in-dock copy. */
  assert.equal(table.s7Body, 'Kosmos is running now, and its icon is on the taskbar at the bottom of your screen.');
  assert.equal(table.s7Tip, 'Right-click the Kosmos icon on the taskbar and choose <b>Pin to taskbar</b> so it stays there and is easy to find later.');
  assert.equal(runPage('win32', [], "platformCopy('firePermissionFailure', 'we could not open System Settings')"), 'we could not open Settings');
});

/* ---------------------------------------------------------------------------
   Not signed in (W-24), toasts (W-26), the Claude card, Settings rows
--------------------------------------------------------------------------- */

// #6358: a browser tab's copy (a board restart ends its sign-in; the Mac app signs itself in).
const MAC_SIGNIN_PANEL = '<div class="pj-empty boardfail">'
  + '<p><b>This board is not signed in.</b><br>'
  + 'It cannot read your agents or projects. Kosmos signs a browser tab out each time it '
  + 'restarts or updates, and after seven days. This tab stays signed out until it is signed in again, and the '
  + 'steps are just below. Or keep going in the Kosmos app from your Applications folder, which signs itself in.</p>'
  + '<details class="fr-hatch"><summary>Sign this tab in again</summary>'
  + 'Run <code>~/.local/share/kosmos/bin/kosmos open</code> in a terminal, then press Reload here, or use the tab it opens '
  + '(it opens in your default browser, so a tab in another browser stays signed out). '
  + 'Use the full path shown: the bare name is not always on your PATH.</details>'
  + '<button class="btn" type="button" data-board-retry>Reload</button>'
  + '</div>';
const MAC_SIGNIN_SENTENCE = 'This board is not signed in, so it cannot read your agents or projects. The not-signed-in note on the agents list says what to do.';

function boardEmpty(platform, failed) {
  return runPage(platform, ['esc', 'boardSigninHtml', 'kplusRemote', 'boardEmpty'], 'boardEmpty()',
    { BOARD_SEEN: true, BOARD_LOOK_FAILED: failed || null, BOARD_NEEDS_SIGNIN: !failed, BOARD_SIGNED_OUT: false, BOARD_DEVICE_OFFLINE: false });
}

test('the not-signed-in panel on Windows points at the Start menu (#6985), with no Mac path, no self-heal and no kosmos command', () => {
  const html = runPage('win32', ['boardSigninHtml'], 'boardSigninHtml()');
  assert.match(html, /open Kosmos from the <b>Start menu<\/b>\. It opens this page signed in\./);
  assert.doesNotMatch(html, /Kosmos folder|Kosmos\.exe/, '#6985: the panel sends a person to the extracted zip');
  assert.match(html, /data-board-retry/, 'the panel lost its Reload');
  assert.doesNotMatch(html, /~\/\.local|kosmos open|fix(es)? itself|Terminal|terminal/);
  const sentence = runPage('win32', [], page.liftConst(SCRIPT, 'SIGNIN_SENTENCE').replace(/^const SIGNIN_SENTENCE = /, '').replace(/;$/, ''));
  assert.equal(sentence, 'This board is not signed in, so it cannot read your agents or projects. To fix it, open Kosmos from the Start menu.');
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
  // #4675: the marker always carries a reason (engine/update.js updateAbort), and the reason now chooses the Mac sentence.
  runPage(platform, ['paintUpdateAbort'], 'paintUpdateAbort(AB)', { AB: { count: 2, reason: 'board-would-not-pause' }, __byId: { 'uabort-slot': slot } });
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
  runPage(platform, ['bakedVersion', 'offlineRemoteView', 'paintOfflineNote'], 'paintOfflineNote(true)', {
    esc, location: { host: '127.0.0.1:16180' }, __byId: { 'uoffline-slot': slot },
  });
  return slot.innerHTML;
}

test('the recovery toasts on Windows say to restart Kosmos from the Start menu or by signing out, never Quit', () => {
  const restart = 'restart Kosmos by opening it from the Start menu, or by signing out of Windows and signing back in.';
  const abort = abortToast('win32');
  /* Review round 2: for a STUCK UPDATE, double-clicking Kosmos.exe only says "already
     running" (same build), so the abort toast names the one true remedy, a fresh sign-in. */
  assert.ok(abort.includes('Kosmos was busy each time. To clear it, sign out of Windows and sign back in. That usually clears whatever'), abort);
  assert.doesNotMatch(abort, /Quit|Kosmos\.exe/, 'the stuck-update toast offers a relaunch that only says "already running"');
  const engine = engineToast('win32');
  // #4408: no remedy is promised on any platform (none is true for every board that reaches this arm).
  assert.ok(engine.includes('Kosmos cannot restart itself here, so the change takes effect when it is next started. Your agents keep running.</small>'), engine);
  assert.doesNotMatch(engine, /Kosmos\.exe/);
  assert.doesNotMatch(engine, /kosmos restart/);
  const offline = offlineNote('win32');
  assert.match(offline, /Open Kosmos from the Start menu and it will start again if it needs to\./);
  assert.doesNotMatch(offline, /Kosmos folder|Kosmos\.exe/, '#6985');
  assert.doesNotMatch(offline, /Applications folder/);
  const sw = page.lift(SCRIPT, 'worldswSwitch');
  assert.match(sw, /\? windowsCopy\('worldSwitchRestart'\)\.replace\('%NAME%', \(\) => switchedName\)/);
  assert.equal(table.worldSwitchRestart.replace('%NAME%', () => 'Side $& Project'),
    'Kosmos could not restart itself. To finish switching to Side $& Project, ' + restart,
    'a Kosmos name is not inserted literally (a replacement pattern in the name was interpreted)');
});

test('#5860: on a Linux server the stuck-update toast names kosmos restart, never a window to quit', () => {
  const ab = (reason) => ({ count: 2, reason });
  const toast = (platform, reason) => {
    const slot = { dataset: {}, innerHTML: '' };
    runPage(platform, ['paintUpdateAbort'], 'paintUpdateAbort(AB)', { AB: ab(reason), __byId: { 'uabort-slot': slot } });
    return slot.innerHTML;
  };
  const CMD = 'run <b>kosmos restart</b> in a terminal on the computer running Kosmos (over SSH on a headless server)';
  // Busy every time (#2055's stop): the remedy itself is the command.
  assert.ok(toast('linux', 'board-would-not-pause').includes('because Kosmos was busy each time. To clear it, ' + CMD
    + ': restarting usually clears whatever was holding the update, so the next one can finish. '
    + 'Your agents keep working through the restart.</small>'), toast('linux', 'board-would-not-pause'));
  // A held port or an unknown stop (#4675's "worth a try"): the command first, then restarting the computer.
  for (const reason of ['port-still-held', 'port-unreachable', 'something-new']) {
    const h = toast('linux', reason);
    assert.ok(h.includes('Your agents keep working. We do not yet know what clears this one; it is worth a try to ' + CMD
      + ', then to restart that computer.</small>'), reason + ': ' + h);
  }
  // A failed check offers only a computer restart, on every platform, so no command appears there.
  assert.ok(toast('linux', 'port-check-failed').includes('Your agents keep working. We do not yet know what clears this one; '
    + 'restarting this computer is worth a try.</small>'), toast('linux', 'port-check-failed'));
  for (const reason of ['board-would-not-pause', 'port-still-held', 'port-check-failed', 'something-new']) {
    assert.doesNotMatch(toast('linux', reason), /quit|reopen|this window|Kosmos\.exe|sign out of Windows/i,
      reason + ': a Linux server was given a Mac or Windows step');
    // CONTROL: the same painter and reason on a Mac and on Windows never names the command, so the arm is Linux's doing.
    assert.doesNotMatch(toast('darwin', reason), /kosmos restart/, reason + ' (darwin)');
    assert.doesNotMatch(toast('win32', reason), /kosmos restart/, reason + ' (win32)');
  }
  assert.match(toast('darwin', 'board-would-not-pause'), /Quit and reopen Kosmos/, 'CONTROL: the Mac words are still the Mac\'s');
});

test('#5862: on a Linux server the offline note, the restart screen and the world switch name kosmos restart, never a window or a folder', () => {
  const step = 'On the computer running Kosmos, run <b>kosmos restart</b> in a terminal (over SSH on a headless server)';
  const offline = offlineNote('linux');
  assert.ok(offline.includes(step + ' and it will start again.</small>'), offline);
  const how = runPage('linux', ['restartHowMac', 'restartHowText'], 'restartHowText()', { window: {} });
  assert.equal(how, step + '.');
  // The world switch: say() writes text, so the command is plain there. Run against the source of worldswSwitch's
  // fallback line, the platform ternary as written.
  const sw = page.lift(SCRIPT, 'worldswSwitch');
  const line = sw.slice(sw.indexOf('say(onWindows()'), sw.indexOf("switchedName + '.');") + "switchedName + '.');".length);
  assert.ok(line.length > 40, 'premise: the fallback line was found');
  const said = (platform) => runPage(platform, [], '(() => { let out = null; const say = (t) => { out = t; }; '
    + line + ' return out; })()', { switchedName: 'Side Project' });
  /* This fallback is reached on Linux only by a board that is NOT an installed one (an installed board restarts itself,
     engine/boardrestart.js), so it must not name `kosmos restart`, which would act on a different board (review 1). */
  assert.equal(said('linux'), 'Kosmos could not restart itself. To finish switching to Side Project, stop Kosmos and start it again '
    + 'the way you started it.');
  assert.doesNotMatch(said('linux'), /kosmos restart/, 'the fallback for a board that is not installed named the installed command');
  // After a self-restart that is slow to come back (an installed board on Linux), the step IS the command.
  const stuck = (platform) => runPage(platform, ['worldswStuckStep'], 'worldswStuckStep()');
  // Both of worldswReconnect's slow-restart lines take their step from it (a literal there would skip the Linux arm).
  const rc = page.lift(SCRIPT, 'worldswReconnect');
  assert.equal((rc.match(/worldswStuckStep\(\)/g) || []).length, 2, 'a reconnect line does not take its step from worldswStuckStep');
  assert.doesNotMatch(rc, /quit and reopen Kosmos/i, 'a reconnect line still hard-codes the Mac step');
  assert.equal(stuck('linux'), 'run kosmos restart in a terminal on the computer running Kosmos (over SSH on a headless server).');
  for (const text of [offline, how, said('linux'), stuck('linux')]) {
    assert.doesNotMatch(text, /Applications folder|Quit|reopen|Command-Q|Kosmos\.exe|Start menu/i, 'a Linux server was given a Mac or Windows step: ' + text);
  }
  // CONTROL: the same code on a Mac and on Windows does not name the command, so the words above are Linux's arm.
  // #5865: Windows has its own step now (its restartKosmos sentence); the Mac keeps "quit and reopen".
  assert.equal(stuck('darwin'), 'quit and reopen Kosmos.', 'darwin: the reconnect step changed off Linux');
  assert.equal(stuck('win32'), table.worldswStuck, 'win32: the reconnect step is not the Windows one');
  // It is restartHow's step, as the middle of a sentence, so the two cannot drift apart.
  assert.equal(table.worldswStuck, table.restartHow.charAt(0).toLowerCase() + table.restartHow.slice(1));
  for (const platform of ['darwin', 'win32']) {
    assert.doesNotMatch(offlineNote(platform), /kosmos restart/, platform);
    assert.doesNotMatch(runPage(platform, ['restartHowMac', 'restartHowText'], 'restartHowText()', { window: {} }), /kosmos restart/, platform);
    assert.doesNotMatch(said(platform), /kosmos restart/, platform);
  }
  assert.equal(said('darwin'), 'Kosmos could not restart itself. Quit and reopen Kosmos to finish switching to Side Project.');
  assert.equal(runPage('darwin', ['restartHowMac', 'restartHowText'], 'restartHowText()', { window: {} }), 'Open Kosmos again from your Applications folder.');
  // Windows keeps its own step through restartHowText (review 1: only the browser check pinned it before).
  assert.equal(runPage('win32', ['restartHowMac', 'restartHowText'], 'restartHowText()', { window: {} }), table.restartHow);
});

test('MAC UNCHANGED: the three recovery toasts and the world-switch sentence', () => {
  assert.equal(abortToast('darwin'), '<div class="utoast stale" role="status"><span class="udot" aria-hidden="true"></span>'
    + '<div class="utxt"><b>A new version of Kosmos is ready.</b><small>This computer has tried to install it 2 times and could not, because '
    + 'Kosmos was busy each time. Quit and reopen Kosmos: reopening usually clears whatever '
    + 'was holding the update, so the next one can finish. Your agents keep working, they do '
    + 'not live in this window.</small></div></div>');
  assert.equal(engineToast('darwin'), '<div class="utoast stale" role="status"><span class="udot" aria-hidden="true"></span>'
    /* #4408: no Terminal command on the Mac either; a board that cannot restart itself promises no remedy.
       (One that can gets a Restart Kosmos button: web.reload-toast.test.js.) */
    + '<div class="utxt"><b>Kosmos needs a quick restart</b><small>A Kosmos file was changed on this computer, '
    + 'and Kosmos is still running the old copy. Kosmos cannot restart itself here, so the change takes effect when it is next started. Your agents keep running.</small></div></div>');
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
  /* win32-signin-web-copy: shown OPEN under a plain summary, around the engine's finished
     PowerShell line (the stuck card puts it, with Copy, between these two halves). */
  assert.equal(table.claudeSigninHatchLead, '<details class="fr-hatch" open><summary>Sign in to Claude yourself</summary>'
    + 'Claude Code is already on this PC, so you can sign in to Claude outside Kosmos. Open the Start menu, type <b>PowerShell</b>, and press Enter. '
    + 'Paste this line and press Enter, then follow the steps in your browser:');
  /* Whether the sign-in finishes in the browser alone or asks for a pasted code is unmeasured
     until the live check (L-1 iii and iv), so the steps cover both. */
  assert.equal(table.claudeSigninHatchEnd, 'If PowerShell asks for a code, copy the code your browser shows and paste it into PowerShell. '
    + 'When PowerShell says <b>Login successful</b>, come back here and click <b>Try again</b>.</details>');
  assert.ok(!('claudeTerminalHatch' in table), 'the "type claude" Windows hatch is back in the table');
  const win = confirmSentence('win32', { platform: 'win32', canInstallClaude: false, willInstall: true });
  assert.equal(win, table.claudeConfirmSentence);
  assert.doesNotMatch(win, /we need to install Claude Code first|we will install it/);
  /* The gate reads the capability too: the day Kosmos can install on Windows, the Mac sentence is true again. */
  assert.match(confirmSentence('win32', { platform: 'win32', canInstallClaude: true, willInstall: true }), /we need to install Claude Code first/);
  assert.match(PAGE, /async function copyCommandFrom\(button\)/);
  assert.match(page.lift(SCRIPT, 'copyCommandFrom'), /navigator\.clipboard\.writeText\(text\)/);
});

test('MAC confirm sentences (#3341: the "large download" line is deleted from the known arm, kept in the uncertain hedge)', () => {
  // #3341 (Josh 6.83): on the screen he saw (the KNOWN arm, willInstall === true) the
  // "It is a large download." line is gone. The UNCERTAIN arm keeps the magnitude, where
  // the "if it is not here already" hedge makes a size heads-up still appropriate.
  assert.equal(confirmSentence('darwin', { platform: 'darwin', canInstallClaude: true, willInstall: true }),
    'In order to connect to Claude, we need to install Claude Code first.');
  assert.equal(confirmSentence('darwin', { platform: 'darwin', canInstallClaude: true }),
    'Connecting to Claude needs Claude Code on this computer. If it is not here already we will install it, a large download, about 231MB.');
});

test('CONVENTION 5 (win32-signin-web-copy): the Windows sign-in stuck reasons stay the engine\'s, with no second copy on the page', () => {
  /* The card shows `st.because` as the engine sent it, so the page must not hold its own
     spelling of either sentence: two copies drift. Read from the engine SOURCE, not required,
     so no data root is frozen by this file. */
  const connectSrc = fs.readFileSync(nodePath.join(__dirname, 'engine', 'connect.js'), 'utf8');
  const signinSrc = fs.readFileSync(nodePath.join(__dirname, 'engine', 'win32signin.js'), 'utf8');
  const unavailable = (connectSrc.match(/const WINDOWS_SIGNIN_UNAVAILABLE_BECAUSE = '([^']+)';/) || [])[1];
  const scriptOnly = (signinSrc.match(/const SCRIPT_ONLY_BECAUSE = '([^']+)';/) || [])[1];
  assert.equal(unavailable, 'Kosmos cannot run the Claude sign-in on Windows yet', 'the unavailable reason moved or changed shape');
  assert.equal(scriptOnly, 'Kosmos cannot start the copy of Claude Code on this computer by itself', 'the script reason moved or changed shape');
  for (const sentence of [unavailable, scriptOnly]) {
    assert.ok(!PAGE.includes(sentence), `the page carries its own copy of the engine's sentence: ${sentence}`);
  }
  /* CONTROL: the same search finds a sentence this page really does own, so the absence above
     is not an empty page or a search that can never match. */
  assert.ok(PAGE.includes('Nothing is broken by this. You can try again, or carry on and connect later from Settings.'),
    'the includes search found nothing it should, so the absence arms above prove nothing');
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

test('Settings, Documents and the agent page on Windows: File Explorer, the Kosmos folder, Start-up and restart', () => {
  // #5239: not "Live output": the section shows no output on Windows (no window), so it is named for what it holds.
  assert.equal(table.terminalBoxTitle, table.terminalTab, 'the box and the section must carry one name');
  assert.doesNotMatch(table.terminalTab + table.terminalBoxTitle, /output/i);
  assert.equal(table.settingsRevealButton, 'Open the Kosmos folder');
  assert.equal(table.settingsOpenKosmos, 'To open Kosmos later, find it in the Start menu. Tip: right-click it there and choose <b>Pin to Start</b>.');
  assert.equal(table.docsOpenFolder, 'Open in File Explorer');
  assert.equal(table.terminalTab, 'Start-up and restart');
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
    // #3031 (Josh 2026-09-14): the six folder-specific asks collapsed to a single "<app> would
    // like to access files." preview (no per-folder lines, no group labels, no group micro-note).
    // 2026-09-19 (Josh, 0.6.81 QA): the tmux preview box was removed, so S2 now shows only the
    // Kosmos preview; the single-preview structure is asserted by render-firstrun-access-onebox.js.
    /<p class="s2-say">"Kosmos" would like<br\s*\/?>to access files\.<\/p>/,
    /<h2>Random notifications may appear<\/h2>/,
    /<p class="s4-nb">"bash" can run in the background\.<\/p>/,
    /<h2>Kosmos is installed and configured\.<\/h2>/,
    />Kosmos is now in your applications folder, and you will see Kosmos in your dock\.<\/p>/,
    />Drag the Kosmos icon to the far left so it stays there and is easy to find later\.<\/p>/,
    />Show me where it is<\/button>/,
    />\s*Kosmos is already in your Dock\. Drag it to the far left so it stays handy\.\s*<\/p>/,
    />Turning on accessibility lets Kosmos agents work in your other applications on this computer\.<\/p>/,
    />Open Accessibility settings<\/button>/,
    /<h3 class="dlab">If you see a box asking about &ldquo;tmux&rdquo;<\/h3>/,
    /<b>Update Kosmos automatically<\/b>\s*<p class="dhint" style="margin:2px 0 0;">On by default\. New versions install themselves, which takes a few seconds and reloads this board\. Agents keep running throughout\.<\/p>/,
    />Advanced<\/button>/,  // #2916 renamed the nav pill Mac label Terminal -> Advanced
    />This agent&rsquo;s Terminal<\/h3>/,
    />Open Terminal<\/button>/,
    />Opens this agent&rsquo;s Terminal window on this computer\.<\/p>/,
    />Approves this agent's folder so it can start without the macOS permission prompt each time\.<\/p>/,
    />Open this folder in Finder<\/button>/,
  ];
  for (const re of MAC_MARKUP) assert.match(PAGE, re, `a Mac string changed: ${re}`);
});

test('#718 state 2: a Windows board reached remotely is never told "your Mac"', () => {
  /* The Kosmos+ wording names a Mac. A Windows host keeps its own copy whatever address it was
     reached on; the CONTROL is the same remote address on a Mac board, which does say your Mac. */
  const remote = { location: { hostname: 'pc.kosmosplus.com', host: 'pc.kosmosplus.com' } };
  const card = (platform) => runPage(platform, ['esc', 'boardSigninHtml', 'kplusRemote', 'boardEmpty'], 'boardEmpty()',
    { BOARD_SEEN: true, BOARD_LOOK_FAILED: 'no answer', BOARD_NEEDS_SIGNIN: false, BOARD_SIGNED_OUT: false, BOARD_DEVICE_OFFLINE: false, ...remote });
  assert.doesNotMatch(card('win32'), /your Mac/, 'a Windows board was told its Mac did not answer');
  /* #6538: the card no longer names a machine at all (its did-not-answer sentence repeated the top note), so the
     CONTROL is that the same Mac card renders the cannot-read card, which the Windows arm above was read from. */
  assert.match(card('darwin'), /We cannot read your agents right now/, 'CONTROL: a Mac board reached remotely renders the cannot-read card');
  assert.match(card('win32'), /We cannot read your agents right now/, 'premise: the Windows arm rendered the cannot-read card');
});

test('#4408: a refused restart promises no remedy it cannot keep, on any platform', () => {
  const fn = page.lift(SCRIPT, 'engineRestartClick');
  // #6535: the title says it could not restart itself, so the small line opens with what that leaves.
  assert.match(fn, /small\.textContent = 'It keeps running the old copy until it is next started\.';/);
  assert.doesNotMatch(fn, /restart your computer|Restarting your computer|Kosmos\.exe|sign out/i);
});

/* #5865: the rest of the Mac-only words that reached a Linux board (a headless server, often seen from a phone
   through Kosmos+): the remote "Your Mac" view and its sentences, the Settings Dock line and App icon box, and the
   daily-report "from its icon" line. Each arm runs the page's own source with the served platform set, and the Mac
   runs the same source as the control. */
const sentence = (platform, name) => runPage(platform, [], '(() => { ' + page.liftConst(SCRIPT, name) + ' return ' + name + '; })()');
function remoteNote(platform, deviceIsOffline) {
  const slot = { dataset: {}, innerHTML: '' };
  runPage(platform, ['bakedVersion', 'kplusRemote', 'offlineRemoteView', 'lastHeardSentence', 'lastHeardTrusted', 'paintOfflineNote'],
    'paintOfflineNote(true, ' + (deviceIsOffline ? 'true' : 'false') + ')', {
      esc, location: { host: 'box.kosmosplus.com', hostname: 'box.kosmosplus.com' }, __byId: { 'uoffline-slot': slot },
      MAC_ASLEEP_SENTENCE: sentence(platform, 'MAC_ASLEEP_SENTENCE'),   // the page's constant, chosen for this platform
      LAST_STATUS_OK_AT: Date.now() - 1000,   // kosmos#7416: the page heard from it a moment ago, so the splice runs on the real sentence
      STATUS_FIRST_MISS_AT: Date.now(), HEARD_GAP_MS: 2 * 60 * 1000,   // the real trust rule (lastHeardTrusted): asking up to the outage
    });
  return slot.innerHTML;
}
const SENTENCES = ['MAC_ASLEEP_SENTENCE', 'OFFLINE_SENTENCE', 'SIGNED_OUT_SENTENCE', 'ORG_SIGNED_OUT_SENTENCE'];

test('#5865: a Linux board seen from elsewhere is "the computer running Kosmos", never "your Mac"', () => {
  const asleep = remoteNote('linux', false);
  assert.ok(asleep.includes('<b>The computer running Kosmos isn\'t answering</b>'), asleep);
  assert.ok(asleep.includes('Make sure it is on, then run kosmos restart in a terminal on it'), asleep);
  assert.ok(asleep.includes('Nothing answered at box.kosmosplus.com.'), 'premise: this is the remote arm: ' + asleep);
  const offline = remoteNote('linux', true);
  assert.ok(offline.includes('so it cannot reach the computer running Kosmos.</small>'), offline);
  for (const name of SENTENCES) {
    const text = sentence('linux', name);
    assert.doesNotMatch(text, /\bMac\b|asleep|Wake it/, name + ' told a Linux board about a Mac: ' + text);
  }
  // #6537: OFFLINE_SENTENCE no longer names the machine (the top note does, checked above); it is the same everywhere.
  assert.equal(sentence('linux', 'OFFLINE_SENTENCE'), 'The board tries again by itself when you are online again.');
  assert.match(sentence('linux', 'SIGNED_OUT_SENTENCE'), /The computer running Kosmos and your agents are fine\./);
  assert.match(sentence('linux', 'ORG_SIGNED_OUT_SENTENCE'), /The computer running Kosmos and your agents are fine\./);
  // A Windows board seen from a phone is a PC (review 2: it fell into the Mac's words).
  for (const name of SENTENCES) {
    assert.doesNotMatch(sentence('win32', name), /\bMac\b/, name + ' told a Windows board about a Mac');
  }
  assert.match(sentence('win32', 'SIGNED_OUT_SENTENCE'), /Your PC and your agents are fine\./);
  // CONTROL: the same source on a Mac says "your Mac", as before.
  assert.ok(remoteNote('darwin', false).includes('<b>Your Mac isn\'t answering</b>'));
  // kosmos#7416 review 1: the time goes after the real first sentence, on every platform's own words.
  assert.match(remoteNote('darwin', false), /<small>It may be asleep, off or offline\. We last heard from it [^<]*?\. Wake it/);
  assert.match(remoteNote('linux', false), /<small>It may be turned off, or Kosmos may have stopped on it\. We last heard from it [^<]*?\. Make sure it is on/);
  assert.ok(remoteNote('darwin', true).includes('so it cannot reach your Mac.</small>'));
  assert.match(sentence('darwin', 'MAC_ASLEEP_SENTENCE'), /^It may be asleep, off or offline\. Wake it/);   // kosmos#7416, Mona Lisa's words
  for (const name of ['SIGNED_OUT_SENTENCE', 'ORG_SIGNED_OUT_SENTENCE']) {   // #6537: OFFLINE_SENTENCE names no machine
    assert.match(sentence('darwin', name), /your Mac|Your Mac/, name + ' lost the Mac words on a Mac');
  }
});

test('#5865: Settings on Linux has no Dock line, app icon, Accessibility or tmux box, and says how Kosmos starts again', () => {
  assert.match(PAGE, /html\[data-kosmos-platform="linux"\] \[data-linux-hide\] \{ display: none !important; \}/, 'the Linux hide rule is gone');
  const HIDDEN_ON_LINUX = {
    'Dock icon picture': /<img class="dockrow-i" data-win-hide data-linux-hide /,
    'App icon box': /<section class="dbox" data-win-hide data-linux-hide>\s*<h3 class="dlab">App icon<\/h3>/,
    // The engine looks for Kosmos.app (engine/machine.js appLocationCheck has no Linux arm), so on Linux this row
    // would be a warning that it "could not find the Kosmos icon" (review 1).
    'app location row': /<div id="set-applocation" data-linux-hide>/,
    'Show me where it is': /id="set-reveal" [^>]*data-linux-hide>/,
    'its message': /id="set-reveal-msg" [^>]*data-linux-hide>/,
    'Accessibility sentence': /id="set-a11y-say" [^>]*data-linux-hide>/,
    'Open Accessibility settings': /id="set-a11y-open" type="button" data-win-hide data-linux-hide>/,
    'tmux permission box': /<section class="dbox" data-win-hide data-linux-hide>\s*<!-- The tmux permission box/,
    // engine/terminal.js opens Terminal.app with osascript. (Update Kosmos automatically stays: a Linux install has the
    // Mac's runtime/bin/node layout, so engine/update.js installedRoot finds it and auto-install runs.)
    'Open Terminal': /<div class="field" data-win-hide data-linux-hide>\s*<button class="btn" id="d-open-terminal"/,
    // engine/projects.js revealFolder runs /usr/bin/open, which a Linux board does not have.
    'agent Files: Open in Finder': /id="d-files-finder" data-remote-hide type="button" data-win-copy="docsOpenFolder" data-linux-hide>/,   // #6724: hidden over Kosmos+ too
    'project docs: Open this folder in Finder': /id="docs-finder" data-remote-hide type="button" data-win-copy="docsOpenFolder" data-linux-hide>/,
    // The same revealFolder route, reached from project settings and the task page (review 5).
    'project: Show me where it is': /id="pjs-reveal" data-remote-hide type="button" data-linux-hide>/,
    'project: Show me where the conversations live': /id="pjs-chats-reveal" data-remote-hide type="button" data-linux-hide>/,
    'its hint': /data-linux-hide>One folder for every project, with a file for each conversation\./,
    'task: Show me where the task conversations live': /id="tk-chats-reveal" data-remote-hide type="button" style="margin-top:12px;" data-linux-hide>/,
    'its hint (task)': /data-linux-hide>One folder, with a file for each task's conversation\./,
  };
  for (const [name, re] of Object.entries(HIDDEN_ON_LINUX)) assert.match(PAGE, re, name + ' shows on Linux');
  const markup = PAGE.replace(/<script\b[\s\S]*?<\/script>/g, '').replace(/<style\b[\s\S]*?<\/style>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  assert.equal((markup.match(/\sdata-linux-hide[\s>]/g) || []).length, Object.keys(HIDDEN_ON_LINUX).length,
    'a data-linux-hide element is not on this list (add it, with what it hides)');
  assert.match(PAGE, /<p class="dhint" style="margin:0;" data-win-copy="settingsOpenKosmos" data-linux-copy="settingsOpenKosmos">/);
  // The real applyPlatformCopy, on a stub root holding that line: Linux stamps the page and swaps the words.
  const run = (platform) => {
    const el = { innerHTML: 'Kosmos is already in your Dock.', getAttribute: (k) => (k === 'data-linux-copy' || k === 'data-win-copy' ? 'settingsOpenKosmos' : null) };
    const html = { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } };
    const doc = Object.assign(docFor(platform), { documentElement: html });
    const root = { querySelectorAll: (sel) => (sel === '[data-linux-copy]' || sel === '[data-win-copy]' ? [el] : []) };
    runPage(platform, ['applyPlatformCopy'], 'applyPlatformCopy(root)', { document: doc, root, window: {} });
    return { text: el.innerHTML, stamp: html.attrs['data-kosmos-platform'] };
  };
  const linux = run('linux');
  assert.equal(linux.stamp, 'linux');
  assert.equal(linux.text, 'If Kosmos stops, run <b>kosmos restart</b> in a terminal on the computer it is installed on '
    + '(over SSH on a headless server).');
  assert.doesNotMatch(linux.text, /Dock|Applications|Kosmos\.exe/);
  // CONTROLS: a Mac is untouched; Windows still gets its own copy.
  assert.deepEqual(run('darwin'), { text: 'Kosmos is already in your Dock.', stamp: undefined });
  assert.equal(run('win32').text, table.settingsOpenKosmos);
});

test('#5865: every data-linux-copy key has a Linux string, the agent page drops "Terminal" and "macOS", and platformHides knows Linux', () => {
  const keys = [...new Set((PAGE.match(/data-linux-copy="([^"]+)"/g) || []).map((m) => m.slice(17, -1)))].sort();
  assert.deepEqual(keys, ['settingsOpenKosmos', 'terminalBoxTitle', 'trustRestartHint']);
  for (const k of keys) assert.equal(typeof runPage('linux', [], 'linuxCopy(' + JSON.stringify(k) + ')'), 'string', k);
  assert.equal(runPage('linux', [], "linuxCopy('terminalBoxTitle')"), 'Start-up and restart');
  assert.doesNotMatch(runPage('linux', [], "linuxCopy('trustRestartHint')"), /macOS/);
  // platformHides: the first-run gate poll asks it, so a Linux-hidden gate must not be waited on.
  const el = (attr) => ({ closest: (sel) => (sel === '[' + attr + ']' ? {} : null) });
  assert.equal(runPage('linux', [], 'platformHides(e)', { e: el('data-linux-hide') }), true);
  assert.equal(runPage('linux', [], 'platformHides(e)', { e: el('data-win-hide') }), false, 'Linux honoured a Windows-only hide');
  assert.equal(runPage('win32', [], 'platformHides(e)', { e: el('data-win-hide') }), true);
  assert.equal(runPage('darwin', [], 'platformHides(e)', { e: el('data-linux-hide') }), false, 'CONTROL: a Mac hid a Linux-only element');
});

test('#5865: on Linux the file preview offers Download, not Finder', () => {
  const offers = (platform, host) => runPage(platform, ['kplusRemote', 'pvOffersDownload'], 'pvOffersDownload()',
    { location: { hostname: host } });
  assert.equal(offers('linux', '127.0.0.1'), true, 'a Linux board at the computer was offered a Finder reveal');
  assert.equal(offers('darwin', '127.0.0.1'), false, 'CONTROL: a Mac at the computer reveals in Finder');
  assert.equal(offers('win32', '127.0.0.1'), false, 'CONTROL: Windows reveals in File Explorer');
  assert.equal(offers('darwin', 'box.kosmosplus.com'), true, 'CONTROL: through Kosmos+ it was already Download');
  assert.match(page.lift(SCRIPT, 'pvOpen'), /\} else if \(pvOffersDownload\(\)\) \{/, 'pvOpen no longer asks pvOffersDownload');
});

test('#5865: after a folder move on Linux the keyboard lands on the sentence, not the hidden reveal button', () => {
  const run = (platform) => {
    let focused = null;
    const reveal = { focus() { focused = 'reveal'; }, closest: (sel) => (sel === '[data-linux-hide]' ? {} : null) };
    const said = { tabIndex: 0, focus() { focused = 'said'; } };
    runPage(platform, ['pjsMoveDoneFocus'], 'pjsMoveDoneFocus(said)', { said, __byId: { 'pjs-reveal': reveal } });
    return { focused, tab: said.tabIndex };
  };
  assert.deepEqual(run('linux'), { focused: 'said', tab: -1 });
  assert.deepEqual(run('darwin'), { focused: 'reveal', tab: 0 }, 'CONTROL: a Mac sends the keyboard to Show me where it is');
});

test('#5865 + #6724: the Files screen\'s overflow line names no button on any platform (the browser lists the folder itself)', () => {
  const line = page.lift(SCRIPT, 'paintAgentFilesAll');
  const at = line.indexOf('more.textContent = ');
  assert.ok(at > -1, 'premise: the overflow line was found');
  const said = line.slice(at, line.indexOf(';', at));
  assert.doesNotMatch(said, /docsOpenFolder|platformCopy|Finder|File Explorer/, 'the overflow line points at a folder button');
});

test('#5865, #6538: a remote Linux board\'s failed read card names no machine, so it cannot name the wrong one', () => {
  /* #6538 removed the card's did-not-answer sentence, which was the one place it named a machine (the top note says
     which one did not answer, in each platform's words, tested above). So there is nothing here to say per platform. */
  const card = (platform, host) => runPage(platform, ['esc', 'boardSigninHtml', 'kplusRemote', 'boardEmpty'], 'boardEmpty()',
    { BOARD_SEEN: true, BOARD_LOOK_FAILED: 'no answer', BOARD_NEEDS_SIGNIN: false, BOARD_SIGNED_OUT: false, BOARD_DEVICE_OFFLINE: false,
      location: { hostname: host, host } });
  for (const [platform, host] of [['linux', 'box.kosmosplus.com'], ['darwin', 'box.kosmosplus.com'], ['linux', '127.0.0.1']]) {
    const said = card(platform, host);
    assert.match(said, /We cannot read your agents right now\.<\/b><br>This is not the same as having none\./, platform + ' ' + host + ': ' + said);
    assert.doesNotMatch(said, /did not answer|\bMac\b|computer running Kosmos|this computer/, platform + ' ' + host + ' named a machine: ' + said);
  }
  assert.ok(!page.lift(SCRIPT, 'boardEmpty').includes('hostMachine()'), 'boardEmpty names a machine again (#6538 removed that sentence)');
});

test('#5865: an unreadable daily-report setting on Linux does not send the person to an app icon', () => {
  const msg = (platform) => {
    const els = { 'feedback-toggle': { classList: { toggle() {}, remove() {} }, setAttribute() {}, removeAttribute() {}, hidden: false }, 'feedback-msg': { textContent: '' } };
    runPage(platform, ['paintSwitch', 'feedbackPaint'], 'feedbackPaint(null)', { __byId: els });
    return els['feedback-msg'].textContent;
  };
  assert.equal(msg('linux'), 'We could not check this setting here. Open Kosmos on the computer running it and you can change it.');
  assert.equal(msg('darwin'), 'We could not check this setting here. Open Kosmos from its icon and you can change it.', 'CONTROL: the Mac line changed');
});

test('#6358: on Linux the not-signed-in panel leads with the tab\'s own sign-in (#6361), offers Kosmos+, and the sentence points to the panel, never the Mac app or Kosmos.exe', () => {
  const html = runPage('linux', ['boardSigninHtml'], 'boardSigninHtml()');
  assert.match(html, /reach this board through Kosmos\+, which stays signed in/);
  assert.match(html, /<summary>Sign this tab in again<\/summary>On the computer running Kosmos, run <code>~\/\.local\/share\/kosmos\/bin\/kosmos open<\/code> in a terminal\./, 'the step #6361 made work on Linux');
  assert.match(html, /prints a one-time address: open it within 2 minutes in the browser showing this page\./, 'a computer with no browser opener (a headless server reached through a forward) gets the address, for THIS browser');
  assert.match(html, /Then press Reload here, or use that tab \(a tab in another browser stays signed out\)\./, 'the cookie is one browser\'s: Reload here is only true in the same one');
  assert.ok(html.indexOf('Sign this tab in again') < html.indexOf('data-board-retry'), 'the steps come before Reload');
  assert.doesNotMatch(html, /not available on Linux/, 'the pre-#6361 dead end is gone');
  assert.match(html, /data-board-retry/, 'the panel lost its Reload');
  assert.doesNotMatch(html, /Applications folder|Kosmos\.exe|the app signs itself in/, 'a Linux board has no app');
  const sentence = runPage('linux', [], page.liftConst(SCRIPT, 'SIGNIN_SENTENCE').replace(/^const SIGNIN_SENTENCE = /, '').replace(/;$/, ''));
  assert.match(sentence, /The not-signed-in note on the agents list says what to do\./, 'the sentence points to the panel');
  assert.doesNotMatch(sentence, /stays signed in/, 'false to a person reading this board through Kosmos+ while signed out');
  assert.doesNotMatch(sentence, /kosmos open/, 'the sentence points to the panel; the panel carries the step');
  assert.doesNotMatch(sentence, /Applications folder/);
  // platformCopy has no Linux branch: on Linux every key keeps the Mac words (the Linux panel reads linuxCopy itself).
  assert.equal(runPage('linux', [], "platformCopy('no-such-key-6358', 'MAC WORDS')"), 'MAC WORDS');
});
