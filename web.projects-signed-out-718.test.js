'use strict';
/* #718 state 3: loadProjects sets BOARD_SIGNED_OUT from the relay's signed-out 401 and clears it on
   every other answer, the same no-latch rule tick has (web.offline-note.test.js). This runs the
   page's REAL loadProjects, cut out of web/index.html, through signed-out -> 500 -> signed-out ->
   network failure -> a good read, so a stale "Sign in again" can never sit over an outage. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const nodePath = require('path');
const page = require('./test-support/page');

const SCRIPT = page.scriptOf(fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8'));

const RELAY_401 = { error: 'this device is not signed in to this Mac', signed_out: true };
const answer = (status, body) => () => Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) });

test('#718 loadProjects: the signed-out flag follows each read and never latches', async () => {
  const el = () => ({ hidden: true, textContent: '' });
  const els = {};
  const document = {
    getElementById: (id) => (els[id] = els[id] || el()),
    documentElement: { getAttribute: () => null },
  };
  let pjList = '';
  let fetchImpl;
  let offline = false; // what deviceOffline() answers: kplusRemote and navigator.onLine === false
  const G = globalThis;
  Object.assign(G, {
    PJ_GEN: 0, PJ_DRAGGING: false, PROJECTS: [], PJ_LOADED_ONCE: false, WANT_PROJECT: null,
    PJ_CURRENT: null, WANT_PROJECT_DONE: false, PJ_AUTO_OPENED_ONCE: true, PJ_SORT: 'newest',
    WANT_TASK: null, PARAMS: new URLSearchParams(''), PJ_AGENTS_UNREADABLE: false,
    PJ_READ_FAILED: false, BOARD_NEEDS_SIGNIN: false, BOARD_SIGNED_OUT: false, TK_OPEN: null,
    BOARD_DEVICE_OFFLINE: false,
    // #4583: loadProjects numbers each read (PJ_READ_SEQ) and records the one painted (PJ_READ_SHOWN).
    PJ_READ_SEQ: 0, PJ_READ_SHOWN: 0,
  });
  // eslint-disable-next-line no-new-func
  const loadProjects = new Function('fetch', 'document', 'setIfChanged', 'deviceSignedOutHtml', 'boardSigninHtml',
    'paintPjNone', 'pjTilesUnknown', 'ringNewMessages', 'pjById', 'openProject', 'sortProjects',
    'SIGNED_OUT_SENTENCE', 'SIGNIN_SENTENCE', 'paintProjects', 'paintOneProject', 'paintRailPjNotice', 'paintTaskPage',
    'paintSettingsFacts', 'staleReadMsg', 'openTaskPage', 'openDocsView',
    'deviceOffline', 'deviceOfflineHtml', 'OFFLINE_SENTENCE', 'paintConsProjects',
    page.lift(SCRIPT, 'relaySignedOut') + '\n' + page.lift(SCRIPT, 'loadProjects') + '\nreturn loadProjects;')(
    (...a) => fetchImpl(...a), document, (_node, html) => { pjList = html; },
    (what) => 'SIGNED-OUT-CARD:' + what, () => 'SIGNIN-CARD',
    () => {}, () => {}, () => {}, () => null, () => {}, (list) => list,
    'signed out sentence', 'signin sentence', () => {}, () => {}, () => {}, () => {},
    () => {}, () => '', () => {}, () => {},
    () => offline, () => 'OFFLINE-CARD', 'offline sentence', () => {} /* #4377: the full projects page */);
  try {
    const step = async (fetcher) => { fetchImpl = fetcher; await loadProjects(); };

    await step(answer(401, RELAY_401));
    assert.strictEqual(G.BOARD_SIGNED_OUT, true, 'the relay signed-out 401 did not set the flag');
    assert.strictEqual(pjList, 'SIGNED-OUT-CARD:projects');

    await step(answer(500, { error: 'boom' }));
    assert.strictEqual(G.BOARD_SIGNED_OUT, false, 'a 500 left the signed-out flag standing');
    assert.match(pjList, /We cannot read your projects/);

    await step(answer(401, RELAY_401));
    assert.strictEqual(G.BOARD_SIGNED_OUT, true);

    await step(() => Promise.reject(new TypeError('network down')));
    assert.strictEqual(G.BOARD_SIGNED_OUT, false, 'a network failure left the signed-out flag standing');

    await step(answer(401, RELAY_401));
    await step(answer(200, { projects: [] }));
    assert.strictEqual(G.BOARD_SIGNED_OUT, false, 'a good read left the signed-out flag standing');
    assert.strictEqual(G.PJ_READ_FAILED, false);

    // CONTROL: a bare 401 without the relay's field is not signed out.
    await step(answer(401, { error: 'unauthorized' }));
    assert.strictEqual(G.BOARD_SIGNED_OUT, false, 'a bare 401 was read as signed out');

    // #718 state 1: no answer while this device is offline sets the offline flag and card, and
    // any answer clears it.
    offline = true;
    await step(() => Promise.reject(new TypeError('Load failed')));
    assert.strictEqual(G.BOARD_DEVICE_OFFLINE, true, 'an offline device with no answer was not flagged offline');
    assert.strictEqual(pjList, 'OFFLINE-CARD');
    offline = false;
    await step(answer(200, { projects: [] }));
    assert.strictEqual(G.BOARD_DEVICE_OFFLINE, false, 'a good read left the offline flag standing');
    // An open project (and its settings) told "offline" loses the line on the next good read,
    // and so does the signed-out line (#718 states 1 and 3).
    els['pj-one-view'] = { hidden: false, textContent: '' };
    els['pj-settings-view'] = { hidden: false, textContent: '' };
    offline = true;
    await step(() => Promise.reject(new TypeError('Load failed')));
    assert.strictEqual(els['pj-one-msg'].textContent, 'offline sentence', 'the open project was not told it is offline');
    assert.strictEqual(els['pjs-read-msg'].textContent, 'offline sentence');
    offline = false;
    await step(answer(200, { projects: [] }));
    assert.strictEqual(els['pj-one-msg'].textContent, '', 'back online, the open project still says offline');
    assert.strictEqual(els['pjs-read-msg'].textContent, '', 'back online, settings still says offline');
    await step(answer(401, RELAY_401));
    assert.strictEqual(els['pj-one-msg'].textContent, 'signed out sentence');
    await step(answer(200, { projects: [] }));
    assert.strictEqual(els['pj-one-msg'].textContent, '', 'signed back in, the open project still says signed out');
    els['pj-one-view'].hidden = true; els['pj-settings-view'].hidden = true;

    // CONTROL: an answered failure is not offline, even if the browser says so.
    offline = true;
    await step(answer(500, { error: 'boom' }));
    assert.strictEqual(G.BOARD_DEVICE_OFFLINE, false, 'an answered 500 was read as the device being offline');
  } finally {
    for (const k of ['PJ_GEN', 'PJ_DRAGGING', 'PROJECTS', 'PJ_LOADED_ONCE', 'WANT_PROJECT', 'PJ_CURRENT',
      'WANT_PROJECT_DONE', 'PJ_AUTO_OPENED_ONCE', 'PJ_SORT', 'WANT_TASK', 'PARAMS', 'PJ_AGENTS_UNREADABLE',
      'PJ_READ_FAILED', 'BOARD_NEEDS_SIGNIN', 'BOARD_SIGNED_OUT', 'TK_OPEN', 'BOARD_DEVICE_OFFLINE']) delete G[k];
  }
});
