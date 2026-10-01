// Browser-check-surface: micbtn d-mic pj-mic asp-mic rxn-speak asp-speak d-say d-send d-dmthread has-voice has-speak fieldmic micwrap pj-name pj-add-desc pj-add-done pj-add-msg nt-detail create-instr d-instr pjs-name pjs-desc
'use strict';

/**
 * Voice in Kosmos (#4409, Josh 2026-09-28 15:02: "it would be so great to be able to get an agent to speak and
 * to be able to speak to them through Kosmos"). Two halves, both on the REAL rendered page:
 *
 *   V1  a browser (no kosmosVoice bridge) draws NO mic, in any composer: Chrome's own recognizer sends audio
 *       to Google, so the page never offers it. CONTROL for V2: the same page, the same composer.
 *   V2  in the app (the bridge present) the DM's mic is drawn, and pressing it asks the bridge to start
 *   V3  heard words land in the box at the caret, between what was typed before and after it; the box grows
 *   V4  the button says it is listening (aria-pressed) and a second press asks the bridge to stop
 *   V5  Send while listening cancels: a word the recognizer delivers after Send does not reach the emptied box
 *   V6  a refusal from the bridge is said under the box in plain words
 *   V7  an agent's message is read aloud with an ON-DEVICE voice: its words only (no name, no time, no button
 *       label), a code block announced; the person's own row offers no read-aloud
 *   V8  a second press stops reading
 *   V9  no page errors
 *   V10 (slice 2) HOLD the mic to talk: the words land while held, and letting go asks the bridge to stop
 *   V11 (slice 2) a short TAP still toggles: letting go keeps listening, and the next tap stops
 *   V12 (slice 2) the dialogs' text boxes carry a mic (every one listed), and holding the New project
 *       description's mic puts the spoken sentence in that box
 *
 * Harness: file:// with fetch answered here (render-dm-reply-4256.js's posture), the real paintTalk. The
 * bridge and speechSynthesis are stand-ins that RECORD what the page asked of them: a microphone and a voice
 * cannot run in CI, and what is under test is the page's half of each seam.
 *
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-voice-4409.js [shots-dir]
 */
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const PAGE = 'file://' + path.join(path.resolve(__dirname, '..', '..'), 'web', 'index.html');
const SHOTS = process.argv[2] || null;
const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

const T0 = Date.parse('2026-09-28T14:00:00Z');
const at = (i) => new Date(T0 + i * 60000).toISOString();
const agentRow = (i, text) => ({ from: 'april', at: at(i), text });
const youRow = (i, text) => ({ at: at(i), text, delivery: { state: 'placed', paneState: 'idle' } });
const THREAD = [agentRow(1, 'The fix is in. Run this:\n```\nnpm test\n```\nthen tell me.'), youRow(2, 'Will do')];

function harness(withBridge) {
  return ([bridge]) => {
    window.setInterval = () => 0;
    window.__posts = [];
    window.__voice = [];
    window.__spoken = [];
    if (bridge) window.webkit = { messageHandlers: { kosmosVoice: { postMessage: (m) => window.__voice.push(m) } } };
    /* A synthesizer that records instead of speaking: one on-device voice and one network voice, so V7 can see
       which the page picked. */
    const voices = [
      { name: 'Cloud Voice', lang: 'en-US', localService: false, default: true },
      { name: 'Samantha', lang: 'en-US', localService: true, default: false },
    ];
    // defineProperty, not assignment: Chromium's speechSynthesis is a read-only getter, and a plain assignment
    // is dropped without an error (the first run of this check spoke through the REAL synthesizer and recorded nothing).
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
      getVoices: () => voices,
      speak: (u) => window.__spoken.push({ text: u.text, voice: u.voice && u.voice.name, u }),
      cancel: () => { window.__spoken.push({ cancel: true }); },
    } });
    window.SpeechSynthesisUtterance = function (text) { this.text = text; };
    const enc = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
    window.fetch = async (url, init) => {
      const u = String(url);
      if (u.includes('/thread') && init && init.method === 'POST') {
        const body = JSON.parse(init.body || '{}');
        window.__posts.push(body);
        return enc({ delivery: { state: 'placed', at: new Date().toISOString() }, recorded: true });
      }
      if (u.includes('/thread')) return enc(window.__fx);
      return enc({});
    };
  };
}

async function openDm(page) {
  await page.evaluate((msgs) => {
    window.__fx = { messages: msgs };
    CURRENT = { sessionName: 'april', name: 'April' };
    LAST = [{ sessionName: 'april', name: 'April', state: 'idle' }];
    document.getElementById('panel-detail').hidden = false;
    const fr = document.getElementById('firstrun'); if (fr) fr.hidden = true;
    document.querySelectorAll('body > *').forEach((el) => { el.inert = false; });
  }, THREAD);
  await page.evaluate(() => paintTalk('april', 'April'));
}

const shown = (page, sel) => page.evaluate((s) => { const el = document.querySelector(s); return !!el && getComputedStyle(el).display !== 'none'; }, sel);

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  const errs = [];
  try {
    // V1: a browser, no bridge.
    const plain = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    plain.on('pageerror', (e) => errs.push(e.message));
    await plain.addInitScript(harness(false), [false]);
    await plain.goto(PAGE);
    await openDm(plain);
    const v1 = { cls: await plain.evaluate(() => document.documentElement.classList.contains('has-voice')), dm: await shown(plain, '#d-mic'), room: await shown(plain, '#pj-mic'),
      exists: await plain.evaluate(() => !!document.getElementById('d-mic') && !!document.getElementById('pj-mic')) };
    chk(v1.exists && !v1.cls && !v1.dm && !v1.room, 'V1 a browser with no on-device bridge draws no mic (the buttons exist, hidden)', JSON.stringify(v1));
    await plain.close();

    // V2-V6: the app.
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    page.on('pageerror', (e) => errs.push(e.message));
    await page.addInitScript(harness(true), [true]);
    await page.goto(PAGE);
    await openDm(page);
    const v2shown = await shown(page, '#d-mic');
    await page.fill('#d-say', 'Please  check');
    await page.evaluate(() => { const b = document.getElementById('d-say'); b.focus(); b.setSelectionRange(7, 7); });   // between the two spaces
    const h0 = await page.evaluate(() => document.getElementById('d-say').offsetHeight);
    await page.click('#d-mic');
    const asked = await page.evaluate(() => window.__voice.slice());
    chk(v2shown && asked.length === 1 && asked[0].op === 'start', 'V2 in the app the DM\'s mic is drawn, and pressing it asks the bridge to start', JSON.stringify({ v2shown, asked }));

    await page.evaluate(() => window.kosmosVoiceEvent({ kind: 'listening', lang: 'en-US' }));
    await page.evaluate(() => window.kosmosVoiceEvent({ kind: 'partial', text: 'the login' }));
    await page.evaluate(() => window.kosmosVoiceEvent({ kind: 'final', text: 'the login page on staging, and tell me what breaks when the session expires in the middle of a long form' }));
    const v3 = await page.evaluate(() => { const b = document.getElementById('d-say'); return { v: b.value, caret: b.selectionStart, h: b.offsetHeight }; });
    const wantV3 = 'Please the login page on staging, and tell me what breaks when the session expires in the middle of a long form check';
    chk(v3.v === wantV3 && v3.caret === wantV3.length - ' check'.length, 'V3 heard words land at the caret, between the typed words, and the partial is replaced by the final', JSON.stringify(v3));
    chk(v3.h > h0, 'V3 the box grows with the words, as it does when typing', JSON.stringify({ before: h0, after: v3.h }));

    const pressed = await page.getAttribute('#d-mic', 'aria-pressed');
    const label = await page.getAttribute('#d-mic', 'aria-label');
    await page.click('#d-mic');
    const stopAsk = await page.evaluate(() => window.__voice[window.__voice.length - 1]);
    chk(pressed === 'true' && label === 'Stop listening' && stopAsk.op === 'stop', 'V4 while listening the button says so, and a second press asks the bridge to stop', JSON.stringify({ pressed, label, stopAsk }));
    await page.evaluate(() => window.kosmosVoiceEvent({ kind: 'stopped' }));
    const off = await page.getAttribute('#d-mic', 'aria-pressed');
    chk(off === 'false', 'V4 stopped: the button is back to off', off);
    if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, 'voice-dm.png') }); }

    // V5: Send while listening.
    await page.fill('#d-say', '');
    await page.click('#d-mic');
    await page.evaluate(() => { window.kosmosVoiceEvent({ kind: 'listening' }); window.kosmosVoiceEvent({ kind: 'partial', text: 'ship it' }); });
    await page.click('#d-send');
    await page.waitForFunction(() => window.__posts.length === 1);
    const cancelAsk = await page.evaluate(() => window.__voice.slice(-1)[0]);
    await page.evaluate(() => window.kosmosVoiceEvent({ kind: 'final', text: 'ship it now' }));   // the recognizer's late answer
    await page.waitForTimeout(200);
    const v5 = await page.evaluate(() => ({ sent: window.__posts[0].text, box: document.getElementById('d-say').value, pressed: document.getElementById('d-mic').getAttribute('aria-pressed') }));
    chk(cancelAsk.op === 'cancel' && v5.sent === 'ship it' && v5.box === '' && v5.pressed === 'false',
      'V5 Send while listening sends what the box shows, cancels, and a late word does not refill the box', JSON.stringify({ cancelAsk, ...v5 }));

    // V6: a refusal is said in words.
    await page.click('#d-mic');
    await page.evaluate(() => { window.kosmosVoiceEvent({ kind: 'error', reason: 'mic-denied' }); window.kosmosVoiceEvent({ kind: 'stopped' }); });
    const said = await page.evaluate(() => document.getElementById('d-say-msg').textContent);
    chk(/not allowed to use the microphone/.test(said) && /System Settings, Privacy & Security, Microphone/.test(said), 'V6 a refused microphone is said under the box, with where to turn it on', said);

    // V10: hold to talk. A real pointer press, the words while held, and the release.
    await page.evaluate(() => { const b = document.getElementById('d-say'); b.value = ''; b.focus(); });
    const micBox = await page.locator('#d-mic').boundingBox();
    await page.mouse.move(micBox.x + micBox.width / 2, micBox.y + micBox.height / 2);
    const n0 = await page.evaluate(() => window.__voice.length);
    await page.mouse.down();
    await page.evaluate(() => { window.kosmosVoiceEvent({ kind: 'listening' }); window.kosmosVoiceEvent({ kind: 'partial', text: 'hold to talk works' }); });
    await page.waitForTimeout(450);
    await page.mouse.up();
    const v10 = await page.evaluate((n) => ({ ops: window.__voice.slice(n).map((m) => m.op), box: document.getElementById('d-say').value, focus: document.activeElement && document.activeElement.id }), n0);
    chk(JSON.stringify(v10.ops) === '["start","stop"]' && v10.box === 'hold to talk works' && v10.focus === 'd-say',
      'V10 holding the mic starts it, the words land while held, letting go asks the bridge to stop, and the caret stays in the box', JSON.stringify(v10));
    await page.evaluate(() => window.kosmosVoiceEvent({ kind: 'stopped' }));

    // V11: a short tap still toggles. Found again: V10's words grew the box, which moved the mic.
    const micBox2 = await page.locator('#d-mic').boundingBox();
    await page.mouse.move(micBox2.x + micBox2.width / 2, micBox2.y + micBox2.height / 2);
    const n1 = await page.evaluate(() => window.__voice.length);
    await page.mouse.down();
    await page.mouse.up();
    await page.evaluate(() => window.kosmosVoiceEvent({ kind: 'listening' }));
    await page.waitForTimeout(450);
    const tapOps = await page.evaluate((n) => window.__voice.slice(n).map((m) => m.op), n1);
    const tapOn = await page.getAttribute('#d-mic', 'aria-pressed');
    // The listening line pushes the composer up, so the mic is found again where it is now.
    const micBox3 = await page.locator('#d-mic').boundingBox();
    await page.mouse.move(micBox3.x + micBox3.width / 2, micBox3.y + micBox3.height / 2);
    await page.mouse.down();
    await page.mouse.up();
    const tap2 = await page.evaluate((n) => window.__voice.slice(n).map((m) => m.op), n1);
    chk(JSON.stringify(tapOps) === '["start"]' && tapOn === 'true' && JSON.stringify(tap2) === '["start","stop"]',
      'V11 a short tap starts and keeps listening after letting go, and the next tap stops', JSON.stringify({ tapOps, tapOn, tap2 }));
    await page.evaluate(() => window.kosmosVoiceEvent({ kind: 'stopped' }));

    // V12: the dialogs' text boxes carry a mic, and the New project description's takes a held dictation.
    const wired = await page.evaluate(() => [...document.querySelectorAll('.micbtn.fieldmic')].map((b) => b.getAttribute('data-voice-for')).sort());
    const want = ['create-instr', 'd-instr', 'nt-detail', 'pj-add-desc', 'pj-add-done', 'pj-name', 'pjs-desc', 'pjs-name'];
    chk(JSON.stringify(wired) === JSON.stringify(want), 'V12 every dialog text box in scope carries its own mic', JSON.stringify(wired));
    await page.evaluate(() => {
      document.getElementById('panel-detail').hidden = true;
      const pp = document.getElementById('panel-projects'); if (pp) pp.hidden = false;
      if (typeof openAddProject === 'function') openAddProject();
      const view = document.getElementById('pj-add-view'); if (view) view.hidden = false;
    });
    const descMic = page.locator('.fieldmic[data-voice-for="pj-add-desc"]');
    const dm = await descMic.boundingBox();
    const descBox = await page.locator('#pj-add-desc').boundingBox();
    const inside = !!dm && !!descBox && dm.x >= descBox.x && dm.x + dm.width <= descBox.x + descBox.width + 1 && dm.y >= descBox.y && dm.y + dm.height <= descBox.y + descBox.height + 1;
    const n2 = await page.evaluate(() => window.__voice.length);
    await page.mouse.move(dm.x + dm.width / 2, dm.y + dm.height / 2);
    await page.mouse.down();
    await page.evaluate(() => { window.kosmosVoiceEvent({ kind: 'listening' }); window.kosmosVoiceEvent({ kind: 'final', text: 'A shared plan for the spring launch.' }); });
    await page.waitForTimeout(450);
    await page.mouse.up();
    const v12 = await page.evaluate((n) => ({ ops: window.__voice.slice(n).map((m) => m.op), desc: document.getElementById('pj-add-desc').value, listening: document.getElementById('pj-add-msg').textContent }), n2);
    chk(inside && JSON.stringify(v12.ops) === '["start","stop"]' && v12.desc === 'A shared plan for the spring launch.',
      'V12 the New project description\'s mic sits inside its box, and holding it puts the spoken sentence in the box', JSON.stringify({ inside, ...v12 }));
    await page.evaluate(() => window.kosmosVoiceEvent({ kind: 'stopped' }));
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'voice-newproject.png') });
    await page.evaluate(() => { const pp = document.getElementById('panel-projects'); if (pp) pp.hidden = true; document.getElementById('pj-add-view').hidden = true; document.getElementById('panel-detail').hidden = false; });

    // V7: read aloud, on a freshly painted thread (V5's send left a "Sending" row of the person's).
    await page.evaluate(() => { for (const k of Object.keys(TALK_PENDING)) delete TALK_PENDING[k]; });
    await openDm(page);
    const rows = await page.evaluate(() => [...document.querySelectorAll('#d-dmthread .msg')].map((r) => ({ you: r.classList.contains('you'), speak: !!r.querySelector('.rxn-speak') })));
    chk(rows.length === 2 && rows.some((r) => !r.you && r.speak) && rows.every((r) => !r.you || !r.speak), 'V7 an agent\'s message offers read-aloud; the person\'s own row does not', JSON.stringify(rows));
    await page.hover('#d-dmthread .msg:not(.you)');
    await page.click('#d-dmthread .msg:not(.you) .rxn-speak');
    const spoken = await page.evaluate(() => window.__spoken.filter((x) => !x.cancel).map((x) => ({ text: x.text, voice: x.voice })));
    const words = spoken.map((x) => x.text).join(' ');
    chk(words === 'The fix is in. Run this: Code block. then tell me.', 'V7 it reads the message\'s words, with the code block announced, and not the name, time or buttons', JSON.stringify(words));
    chk(spoken.length > 0 && spoken.every((x) => x.voice === 'Samantha'), 'V7 it uses the ON-DEVICE voice, never the network one (which is the default here)', JSON.stringify(spoken.map((x) => x.voice)));
    const on = await page.getAttribute('#d-dmthread .msg:not(.you) .rxn-speak', 'aria-pressed');
    await page.click('#d-dmthread .msg:not(.you) .rxn-speak');
    const v8 = await page.evaluate(() => ({ cancelled: window.__spoken.slice(-1)[0].cancel === true, pressed: document.querySelector('#d-dmthread .msg:not(.you) .rxn-speak').getAttribute('aria-pressed') }));
    chk(on === 'true' && v8.cancelled && v8.pressed === 'false', 'V8 while reading the button says so, and a second press stops it', JSON.stringify({ on, ...v8 }));

    chk(errs.length === 0, 'V9 no page errors', errs.join(' | '));
  } finally {
    await browser.close();
  }
  if (fail.length) { console.log('\n' + fail.length + ' failed'); process.exit(1); }
  console.log('\nall voice checks passed');
})();
