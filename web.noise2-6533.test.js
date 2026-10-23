'use strict';

/**
 * noise2: lines that repeated what the same screen already said, removed (kosmos#6533 and #6535 to #6538, the 0.7.57
 * board noise read; #6534 was withdrawn in review, so the update chip stays beside the update-stopped notice).
 * Removals and merges (the #6536 cannot-restart tail is a merge, and the projects read now paints the offline
 * note; see the plan): each arm runs the page's own function where one is cheap to lift, asserts the removed words are
 * gone, and has a control that the line which already says it is still there, so a removal that took the kept line
 * with it reds here too.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const page = require('./test-support/page');
const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = page.scriptOf(PAGE);
const esc = (x) => String(x == null ? '' : x);

function updateSettleText() {
  // eslint-disable-next-line no-new-func
  return new Function(page.liftAll(SCRIPT, [...page.PLATFORM_COPY_FNS, 'esc', 'updateRefusedText', 'updateSettleText'])
    + '\nreturn updateSettleText;')();
}

/* The real renderUpdateToast. */
function toast({ offer = null, engine = null }) {
  const slot = { dataset: {}, innerHTML: '' };
  const doc = {
    getElementById: (id) => (id === 'utoast-slot' ? slot : { addEventListener() {}, focus() {}, hidden: true }),
    querySelector: () => ({ getAttribute: () => '0.7.57' }),
  };
  // eslint-disable-next-line no-new-func
  new Function('document', 'esc', 'UPDATING_NOW', 'SERVED_VERSION', 'updateLaterSuppresses', 'UPD_CONFIRM_OPENER', 'OFFER', 'ENGINE_STALE',
    page.liftAll(SCRIPT, [...page.PLATFORM_COPY_FNS, 'bakedVersion', 'pageIsStale', 'updateNothingToLose', 'updateSafeReload', 'renderUpdateToast'])
    + '\nrenderUpdateToast(OFFER);')(doc, esc, false, '0.7.57', () => false, null, offer, engine);
  return slot.innerHTML;
}

function boardEmpty(failed, offline) {
  // eslint-disable-next-line no-new-func
  return new Function('BOARD_SEEN', 'BOARD_LOOK_FAILED', 'BOARD_NEEDS_SIGNIN', 'BOARD_SIGNED_OUT', 'BOARD_DEVICE_OFFLINE',
    page.liftAll(SCRIPT, page.PLATFORM_COPY_FNS) + '\n'
    + page.liftAll(SCRIPT, ['esc', 'boardSigninHtml', 'deviceSignedOutHtml', 'deviceOfflineHtml', 'kplusRemote', 'boardEmpty']) + '\n'
    + page.liftConst(SCRIPT, 'ORG_SIGNED_OUT_SENTENCE') + '\n' + page.liftConst(SCRIPT, 'DEVICE_SIGNIN_BUTTON') + '\n'
    + page.liftConst(SCRIPT, 'OFFLINE_SENTENCE')
    + '\nreturn boardEmpty();')(true, failed, false, false, offline);
}

test('#6533: the update overlay has one Reload button, and did-not-take says the same version once', () => {
  assert.doesNotMatch(SCRIPT, /Reload and try again|upd-again/, 'the second button that also only reloaded is back');
  // CONTROL: the kept button is still drawn and wired.
  assert.match(SCRIPT, /<button class="btn uprime" type="button" id="upd-reload">Reload<\/button><\/div>/);
  assert.match(SCRIPT, /msg\.querySelector\('#upd-reload'\)\.addEventListener\('click', \(\) => location\.reload\(\)\);/);
  const settle = updateSettleText();
  const t = settle('did-not-take', '0.7.57', null, null, 'darwin');
  assert.equal(t, '<b>The update did not take.</b>Kosmos is still on 0.7.57.');
  assert.doesNotMatch(t, /came back on the same version/);
  // CONTROL: the kept version line is still the whole small line with the installer notes after it.
  assert.equal(settle('did-not-take', '0.7.57', null, '/logs/install.log', 'darwin'),
    '<b>The update did not take.</b>Kosmos is still on 0.7.57. The installer\'s notes are at <code>/logs/install.log</code>.');
  // And the old no-version fallback sentence is gone.
  // In the page's strings only (opened by a quote), so a comment that names the old sentence neither trips nor satisfies it.
  assert.doesNotMatch(SCRIPT, /['"`]Kosmos came back on the same version/);
});

test('#6533: did-not-take with no version stops at the bold line and never names an empty version', () => {
  const settle = updateSettleText();
  assert.equal(settle('did-not-take', '', null, null, 'darwin'), '<b>The update did not take.</b>');
  assert.equal(settle('did-not-take', null, null, null, 'darwin'), '<b>The update did not take.</b>');
  const withNotes = settle('did-not-take', '', null, '/logs/install.log', 'darwin');
  assert.equal(withNotes, '<b>The update did not take.</b> The installer\'s notes are at <code>/logs/install.log</code>.');
  assert.doesNotMatch(withNotes, /still on/);
});

test('#6535: the restart notice small lines no longer open with the bold line', () => {
  const fn = page.lift(SCRIPT, 'engineRestartClick');
  assert.doesNotMatch(fn, /Kosmos could not restart itself, so it keeps|could not be reached to restart it|taking longer than it should to come back/);
  assert.match(fn, /small\.textContent = 'It keeps running the old copy until it is next started\.';/);
  assert.equal((fn.match(/small\.textContent = 'Try again in a moment\.';/g) || []).length, 2);
  // CONTROL: the bold lines that carry the news stay.
  for (const head of ['Kosmos could not restart itself', 'Kosmos could not be reached', 'Kosmos is taking longer than it should']) {
    assert.ok(fn.includes("said('" + head + "')") || fn.includes(": '" + head + "')"), 'the bold line is gone: ' + head);
  }
});

test('#6536: the restart notice drops "A restart picks it up." and keeps its title and button', () => {
  const engine = { startedAt: '2026-10-18T10:00:00Z', staleSince: '2026-10-18T10:05:00Z', changed: ['server.js'], canRestart: true };
  const html = toast({ engine });
  assert.doesNotMatch(html, /A restart picks it up/);
  assert.match(html, /\(server\.js\), and Kosmos is still running the old copy\. Your agents keep running\.<\/small>/);
  // CONTROL: the title and the gold button that say it.
  assert.match(html, /<b>Kosmos needs a quick restart<\/b>/);
  assert.match(html, /id="ut-engine-restart">Restart Kosmos<\/button>/);
});

test('#6537: the offline card says only that the board tries again; "You are offline" stays in the top note', () => {
  const card = boardEmpty('Load failed', true);
  assert.doesNotMatch(card, /You are offline|not connected to the internet/, 'the card repeats the top note');
  assert.match(card, /<p>The board tries again by itself when you are online again\.<\/p>/);
  assert.match(card, /data-board-retry>Try again<\/button>/);
  // CONTROL: the top note still says it, through the real paintOfflineNote.
  const slot = { dataset: {}, innerHTML: '' };
  const doc = { getElementById: (id) => (id === 'uoffline-slot' ? slot : null), querySelector: () => ({ getAttribute: () => '0.7.57' }) };
  // eslint-disable-next-line no-new-func
  new Function('document', 'esc', 'location',
    page.liftAll(SCRIPT, page.PLATFORM_COPY_FNS) + '\n'
    + page.liftAll(SCRIPT, ['bakedVersion', 'kplusRemote', 'offlineRemoteView', 'paintOfflineNote']) + '\n'
    + page.liftConst(SCRIPT, 'MAC_ASLEEP_SENTENCE') + '\npaintOfflineNote(true, true);')(doc, esc, { host: 'mac.kosmosplus.com' });
  assert.match(slot.innerHTML, /<b>You are offline<\/b><small>This phone or computer is not connected to the internet/);
});

test('#6537: the projects poll puts the top note up when it finds the device offline, as the status poll does', () => {
  /* The shortened boxes lean on the top note, so every path that can set BOARD_DEVICE_OFFLINE true paints it. A phone that
     goes offline and opens Projects before the next status poll reaches loadProjects' catch first. */
  const fn = page.lift(SCRIPT, 'loadProjects');
  const katch = fn.slice(fn.indexOf('} catch {'));
  /* One span, inside the catch: the assignment, then (comments only between, never the catch's own closing brace)
     the offline-guarded paint. Moving the call out of the catch or dropping its guard breaks the match. */
  assert.match(katch, /BOARD_DEVICE_OFFLINE = !reached && deviceOffline\(\);(?:(?!\n  \})[\s\S]){0,700}?\n    if \(BOARD_DEVICE_OFFLINE\) \{ try \{ paintOfflineNote\(true, true\); \}/,
    'the projects catch does not paint the top note right after it finds the device offline');
  // CONTROL: the status poll still paints it from its own failed read.
  assert.match(SCRIPT, /BOARD_DEVICE_OFFLINE = !answered && deviceOffline\(\);[\s\S]{0,1500}?paintOfflineNote\(!answered, BOARD_DEVICE_OFFLINE\);/);
  // And no other place sets the flag true without painting the note.
  assert.deepEqual(offlineFlagSites(PAGE).map((s) => s.paints), [true, true],
    'a place that can set BOARD_DEVICE_OFFLINE true does not paint the top note in the same branch');
});

/* The page's REAL loadProjects, run end to end (the harness web.projects-signed-out-718.test.js uses), against the real
   paintOfflineNote and one top-note slot. paintFirst puts a note up before the read; answer is the read's outcome;
   offline is what deviceOffline() says. Returns the slot after the read. */
const PJ_GLOBALS = ['PJ_GEN', 'PJ_DRAGGING', 'PROJECTS', 'PJ_LOADED_ONCE', 'WANT_PROJECT', 'PJ_CURRENT', 'WANT_PROJECT_DONE',
  'PJ_AUTO_OPENED_ONCE', 'PJ_SORT', 'WANT_TASK', 'PARAMS', 'PJ_AGENTS_UNREADABLE', 'PJ_READ_FAILED', 'BOARD_NEEDS_SIGNIN',
  'BOARD_SIGNED_OUT', 'TK_OPEN', 'BOARD_DEVICE_OFFLINE'];
async function projectsNoteRun(paintFirst, answer, offline = false) {
  const slot = { dataset: {}, innerHTML: '' };
  const els = {};
  const doc = {
    getElementById: (id) => (id === 'uoffline-slot' ? slot : (els[id] = els[id] || { hidden: true, textContent: '' })),
    querySelector: () => ({ getAttribute: () => '0.7.57' }),
    documentElement: { getAttribute: () => null },
    body: { classList: { contains: () => false } },   // #6910: loadProjects asks whether the layout is consolidated
  };
  // eslint-disable-next-line no-new-func
  const paintOfflineNote = new Function('document', 'esc', 'location', 'ENGINE_RESTARTING',
    page.liftAll(SCRIPT, page.PLATFORM_COPY_FNS) + '\n'
    + page.liftAll(SCRIPT, ['bakedVersion', 'kplusRemote', 'offlineRemoteView', 'paintOfflineNote']) + '\n'
    + page.liftConst(SCRIPT, 'MAC_ASLEEP_SENTENCE') + '\nreturn paintOfflineNote;')(doc, esc, { host: 'localhost' }, false);
  paintOfflineNote(...paintFirst);
  const G = globalThis;
  Object.assign(G, {
    PJ_GEN: 0, PJ_DRAGGING: false, PROJECTS: [], PJ_LOADED_ONCE: false, WANT_PROJECT: null, PJ_CURRENT: null,
    WANT_PROJECT_DONE: false, PJ_AUTO_OPENED_ONCE: true, PJ_SORT: 'newest', WANT_TASK: null, PARAMS: new URLSearchParams(''),
    PJ_AGENTS_UNREADABLE: false, PJ_READ_FAILED: false, BOARD_NEEDS_SIGNIN: false, BOARD_SIGNED_OUT: false, TK_OPEN: null,
    BOARD_DEVICE_OFFLINE: false,
  });
  try {
    // eslint-disable-next-line no-new-func
    const loadProjects = new Function('fetch', 'document', 'paintOfflineNote', 'setIfChanged', 'deviceSignedOutHtml', 'boardSigninHtml',
      'paintPjNone', 'pjTilesUnknown', 'ringNewMessages', 'pjById', 'openProject', 'sortProjects',
      'SIGNED_OUT_SENTENCE', 'SIGNIN_SENTENCE', 'paintProjects', 'paintOneProject', 'paintRailPjNotice', 'paintTaskPage',
      'paintSettingsFacts', 'staleReadMsg', 'openTaskPage', 'openDocsView',
      'deviceOffline', 'deviceOfflineHtml', 'OFFLINE_SENTENCE', 'paintConsProjects',
      page.lift(SCRIPT, 'relaySignedOut') + '\n' + page.lift(SCRIPT, 'loadProjects') + '\nreturn loadProjects;')(
      answer, doc, paintOfflineNote, () => {}, () => '', () => '',
      () => {}, () => {}, () => {}, () => null, () => {}, (list) => list,
      '', '', () => {}, () => {}, () => {}, () => {},
      () => {}, () => '', () => {}, () => {},
      () => offline, () => '', '', () => {});
    await loadProjects();
    return { slot, readFailed: G.PJ_READ_FAILED, deviceOffline: G.BOARD_DEVICE_OFFLINE };
  } finally {
    for (const k of PJ_GLOBALS) delete G[k];
  }
}
const readable = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ projects: [] }) });
const failed = () => Promise.reject(new TypeError('Load failed'));
const answered500 = () => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({ error: 'boom' }) });

test('#6537: once a projects read finds the device online, the offline note comes down, and the not-answering one never does', async () => {
  // The offline note is up (painted by this path or by the status poll); the next projects read is readable.
  let r = await projectsNoteRun([true, true], readable);
  assert.equal(r.readFailed, false, 'the readable response did not land as a success');
  assert.equal(r.slot.innerHTML, '', 'the offline note stays up over a readable projects response');
  assert.equal(r.slot.dataset.on, undefined, 'the note was cleared but its shown-flag was kept, so a second outage draws nothing');
  // The offline note is up; the next read fails with the device online (no answer, and an answered 500): same rule.
  for (const answer of [failed, answered500]) {
    r = await projectsNoteRun([true, true], answer, false);
    assert.equal(r.readFailed, true);
    assert.equal(r.deviceOffline, false);
    assert.equal(r.slot.innerHTML, '', 'a failed read with the device online left the offline note up');
    assert.equal(r.slot.dataset.on, undefined);
  }
  // The status poll drew "not answering" (the device is online); no projects read clears it, readable or failed.
  for (const answer of [readable, failed, answered500]) {
    r = await projectsNoteRun([true, false], answer, false);
    assert.equal(r.slot.dataset.on, 'mac');
    assert.match(r.slot.innerHTML, /not answering/, 'the projects path cleared the status poll note');
  }
  // CONTROL: a failed read with the device offline puts the offline note up.
  r = await projectsNoteRun([false], failed, true);
  assert.equal(r.deviceOffline, true);
  assert.equal(r.slot.dataset.on, 'device');
  assert.match(r.slot.innerHTML, /<b>You are offline<\/b>/);
});

/* Every code line in the page that assigns BOARD_DEVICE_OFFLINE anything but a literal false (so any assignment that
   can make it true, whatever its right side), each with whether a code line after it, before its branch closes,
   calls paintOfflineNote. Comment lines are skipped; a comparison (== or ===) is not an assignment. */
function offlineFlagSites(html) {
  const lines = html.split('\n');
  const isComment = (l) => /^\s*(\/\/|\/\*|\*)/.test(l);
  const sites = [];
  lines.forEach((line, i) => {
    if (isComment(line) || !/BOARD_DEVICE_OFFLINE\s*=(?!=)(?!\s*false\b)/.test(line)) return;
    const indent = line.match(/^ */)[0].length;
    let paints = false;
    for (let j = i; j < lines.length; j++) {
      const l = lines[j];
      if (j > i && new RegExp('^ {0,' + Math.max(0, indent - 1) + '}\\}').test(l)) break;
      if (!isComment(l) && /paintOfflineNote\(/.test(l.slice(j === i ? l.indexOf('BOARD_DEVICE_OFFLINE') : 0))) { paints = true; break; }
    }
    sites.push({ line: i + 1, paints });
  });
  return sites;
}

test('#6537: the flag-site count sees a stray assignment that does not paint the top note', () => {
  // CONTROL for the count above: a copy of the page with one more true assignment and no paint reds it.
  const stray = PAGE.replace('let BOARD_DEVICE_OFFLINE = false;', 'let BOARD_DEVICE_OFFLINE = false;\nfunction strayOffline() {\n  BOARD_DEVICE_OFFLINE = true;\n}');
  assert.notEqual(stray, PAGE, 'the stray assignment did not go in');
  const sites = offlineFlagSites(stray);
  assert.equal(sites.length, 3);
  assert.equal(sites.filter((s) => !s.paints).length, 1, 'the stray assignment was counted as painting the note');
});

test('#6538: the cannot-read card no longer says "did not answer" or "not telling you the board is empty"', () => {
  const card = boardEmpty('nothing answered for 10 seconds', false);
  assert.doesNotMatch(card, /did not answer|not telling you the board is empty/, 'the repeated sentence is back');
  // CONTROL: the bold line, the one "not the same as having none", the reason, and Try again stay.
  assert.match(card, /<b>We cannot read your agents right now\.<\/b><br>This is not the same as having none\. \(nothing answered for 10 seconds\)<\/p>/);
  assert.match(card, /data-board-retry>Try again<\/button>/);
});
