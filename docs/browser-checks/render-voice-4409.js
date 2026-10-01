// Browser-check-surface: micbtn d-mic pj-mic asp-mic rxn-speak asp-speak d-say d-send d-dmthread has-voice has-speak voice-who fieldmic micwrap pj-name pj-add-desc pj-add-done pj-add-msg nt-detail create-instr d-instr pjs-name pjs-desc
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
 *       description's mic puts the spoken sentence in that box; each box's text clears its mic, the Name field
 *       still fills its row, a one-line mic is centred, a textarea's mic is clear of its resize grip, a disabled box
 *       shows no mic, and letting go before the bridge is listening (first use asks macOS) does not stop it
 *   V13 (slice 2) the keyboard (Enter on the focused mic) and a script's click() still toggle, with no pointer
 *   V14 (slice 2) in a dialog, focus moving to another field stops listening, keeping the words
 *   V15 (slice 2) Save, Create or any other button while listening stops it, so nothing arrives after it
 *   V16 (slice 2) a press dragged off the mic does not swallow the next keyboard press; and a composer keeps
 *       listening through its other buttons (attach), as in slice 1
 *   V17 (slice 2) pressing a mic still closes an open emoji panel (its close-on-mousedown-outside runs), as in slice 1
 *   V18 (slice 2) Escape in a dialog's box stops listening and does not close the dialog
 *   V19 (slice 2) a press whose release the page never heard does not block the next press of the same pointer
 *   P1 (slice 3) a phone with no app bridge draws the mic through the browser's recognizer; a computer's browser with
 *       the same recognizer draws none
 *   P2 (slice 3) tapping it starts the recognizer inside the tap, the line says Apple hears the audio, heard words
 *       land, and the next tap stops it
 *   P3 (slice 3) a refused microphone on a phone points at the browser's settings; P3b the retry still says who hears
 *   P2a (slice 3) who hears the audio is shown in its own bar at the tap, before the start; P5 another message line is
 *       left alone; P6 a start that throws leaves the mic off; P7 a session that ends by itself leaves it off
 *   P4 (slice 3) read aloud is offered and speaks on a phone
 *   V1b in a browser (no bridge) the Name field fills its row exactly as with no wrapper: wrapping changes nothing
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
    const plainName = await plain.evaluate(() => {
      document.getElementById('panel-detail').hidden = true;
      const pp = document.getElementById('panel-projects'); if (pp) pp.hidden = false;
      if (typeof openAddProject === 'function') openAddProject();
      document.getElementById('pj-add-view').hidden = false;
      const name = document.getElementById('pj-name'), row = name.closest('.frow');
      const others = [...row.children].filter((c) => !c.contains(name)).reduce((w, c) => w + c.getBoundingClientRect().width, 0);
      return { nameW: name.getBoundingClientRect().width, rowW: row.getBoundingClientRect().width, others, mic: getComputedStyle(document.querySelector('.fieldmic')).display, pad: getComputedStyle(name).paddingRight };
    });
    const ntGap = await plain.evaluate(() => getComputedStyle(document.getElementById('nt-voice-msg')).display);
    chk(ntGap === 'none', 'V1b in a browser the New task mic line takes no room', ntGap);
    chk(plainName.mic === 'none' && plainName.nameW >= plainName.rowW - plainName.others - 24 && parseFloat(plainName.pad) < 36,
      'V1b in a browser the Name field still fills its row, with no mic and no extra padding', JSON.stringify(plainName));
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
    const geo = await page.evaluate(() => {
      const out = {};
      for (const b of document.querySelectorAll('.micbtn.fieldmic')) {
        const box = document.getElementById(b.getAttribute('data-voice-for'));
        out[box.id] = { pad: parseFloat(getComputedStyle(box).paddingRight), disabled: box.disabled };
      }
      const name = document.getElementById('pj-name'), row = name.closest('.frow');
      const nm = name.getBoundingClientRect(), mic = document.querySelector('.fieldmic[data-voice-for="pj-name"]').getBoundingClientRect();
      const ta = document.getElementById('pj-add-desc').getBoundingClientRect(), tm = document.querySelector('.fieldmic[data-voice-for="pj-add-desc"]').getBoundingClientRect();
      const others = [...row.children].filter((c) => !c.contains(name)).reduce((w, c) => w + c.getBoundingClientRect().width, 0);
      return { pads: out, nameW: nm.width, rowW: row.getBoundingClientRect().width, others,
        centred: Math.abs((mic.top + mic.height / 2) - (nm.top + nm.height / 2)), micTopGap: tm.top - ta.top, micBottomGap: ta.bottom - tm.bottom };
    });
    // An enabled box makes room for its mic; a disabled one shows no mic and takes no room (#d-instr before it loads).
    const padsOk = Object.values(geo.pads).every((x) => (x.disabled ? x.pad < 36 : x.pad >= 36));
    chk(padsOk, 'V12 every box with a mic leaves room on its right, so its text never runs under the mic', JSON.stringify(geo.pads));
    chk(geo.nameW >= geo.rowW - geo.others - 24, 'V12 the Name field still fills its row (the wrapper takes its place in the flex row)', JSON.stringify({ nameW: geo.nameW, rowW: geo.rowW, others: geo.others }));
    chk(geo.centred <= 3 && geo.micTopGap <= 10 && geo.micBottomGap >= 12, 'V12 a one-line mic is centred; a textarea\'s mic is at its top, clear of the resize grip', JSON.stringify(geo));
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
    // V12 first use: let go before the bridge is listening (macOS is asking for the microphone): no stop, so the
    // pending start is not dropped; the next tap stops.
    const n3 = await page.evaluate(() => window.__voice.length);
    const dm2 = await descMic.boundingBox();
    await page.mouse.move(dm2.x + dm2.width / 2, dm2.y + dm2.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(450);
    await page.mouse.up();
    const early = await page.evaluate((n) => window.__voice.slice(n).map((m) => m.op), n3);
    chk(JSON.stringify(early) === '["start"]', 'V12 letting go before the bridge is listening (a permission prompt) does not stop it', JSON.stringify(early));
    await page.evaluate(() => { window.kosmosVoiceEvent({ kind: 'listening' }); });
    const dm3 = await descMic.boundingBox();
    await page.mouse.move(dm3.x + dm3.width / 2, dm3.y + dm3.height / 2);
    await page.mouse.down(); await page.mouse.up();
    await page.evaluate(() => window.kosmosVoiceEvent({ kind: 'stopped' }));
    // V13: no pointer at all: the keyboard and a script's click() toggle.
    const n4 = await page.evaluate(() => window.__voice.length);
    await page.focus('.fieldmic[data-voice-for="pj-add-desc"]');
    await page.keyboard.press('Enter');
    await page.evaluate(() => window.kosmosVoiceEvent({ kind: 'listening' }));
    await page.focus('.fieldmic[data-voice-for="pj-add-desc"]');
    await page.keyboard.press('Enter');
    await page.evaluate(() => window.kosmosVoiceEvent({ kind: 'stopped' }));
    await page.evaluate(() => document.querySelector('.fieldmic[data-voice-for="pj-add-desc"]').click());
    await page.evaluate(() => window.kosmosVoiceEvent({ kind: 'listening' }));
    await page.evaluate(() => document.querySelector('.fieldmic[data-voice-for="pj-add-desc"]').click());
    await page.evaluate(() => window.kosmosVoiceEvent({ kind: 'stopped' }));
    // An assistive press (VoiceOver, Switch Control) can arrive as a click with detail 1 and no pointer before it.
    await page.evaluate(() => { const m = document.querySelector('.fieldmic[data-voice-for="pj-add-desc"]'); m.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 })); });
    await page.evaluate(() => window.kosmosVoiceEvent({ kind: 'listening' }));
    await page.evaluate(() => { const m = document.querySelector('.fieldmic[data-voice-for="pj-add-desc"]'); m.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 })); });
    await page.evaluate(() => window.kosmosVoiceEvent({ kind: 'stopped' }));
    const kb = await page.evaluate((n) => window.__voice.slice(n).map((m) => m.op), n4);
    chk(JSON.stringify(kb) === '["start","stop","start","stop","start","stop"]', 'V13 the keyboard, a script\'s click() and an assistive click (detail 1, no pointer) all toggle the mic', JSON.stringify(kb));
    // V14: focus moving to another field in the dialog stops it, keeping the words.
    const n5 = await page.evaluate(() => window.__voice.length);
    await page.evaluate(() => { document.getElementById('pj-add-desc').value = ''; document.querySelector('.fieldmic[data-voice-for="pj-add-desc"]').click(); window.kosmosVoiceEvent({ kind: 'listening' }); window.kosmosVoiceEvent({ kind: 'partial', text: 'first words' }); });
    await page.focus('#pj-name');
    await page.evaluate(() => window.kosmosVoiceEvent({ kind: 'final', text: 'first words and more' }));
    const v14 = await page.evaluate((n) => ({ ops: window.__voice.slice(n).map((m) => m.op), desc: document.getElementById('pj-add-desc').value, pressed: document.querySelector('.fieldmic[data-voice-for="pj-add-desc"]').getAttribute('aria-pressed') }), n5);
    chk(JSON.stringify(v14.ops) === '["start","cancel"]' && v14.desc === 'first words' && v14.pressed === 'false',
      'V14 focus moving to another field stops listening and keeps the words heard so far', JSON.stringify(v14));
    // V15: a dialog button while listening stops it.
    const n6 = await page.evaluate(() => window.__voice.length);
    await page.evaluate(() => { document.querySelector('.fieldmic[data-voice-for="pj-add-done"]').click(); window.kosmosVoiceEvent({ kind: 'listening' }); });
    // A button that moves no focus, so only the button rule can stop it (Add an agent focuses a field, which V14 covers).
    await page.evaluate(() => { const b = document.createElement('button'); b.type = 'button'; b.id = 'v15-btn'; b.textContent = 'Save';
      document.getElementById('pj-add-view').appendChild(b); b.click(); b.remove(); });
    const v15 = await page.evaluate((n) => window.__voice.slice(n).map((m) => m.op), n6);
    chk(JSON.stringify(v15) === '["start","cancel"]', 'V15 any other button while listening (Save, Create, Add) stops it', JSON.stringify(v15));
    // V16: a press dragged off the mic, then the keyboard: the keyboard press still toggles.
    const n7 = await page.evaluate(() => window.__voice.length);
    const dm4 = await descMic.boundingBox();
    await page.mouse.move(dm4.x + dm4.width / 2, dm4.y + dm4.height / 2);
    await page.mouse.down();
    await page.mouse.move(dm4.x - 200, dm4.y + 120);
    await page.mouse.up();
    await page.evaluate(() => window.kosmosVoiceEvent({ kind: 'listening' }));
    // A click with no key before it (VoiceOver, Switch Control), inside the window the pointer's own click would have.
    await page.evaluate(() => document.querySelector('.fieldmic[data-voice-for="pj-add-desc"]').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 })));
    await page.evaluate(() => window.kosmosVoiceEvent({ kind: 'stopped' }));
    const v16 = await page.evaluate((n) => window.__voice.slice(n).map((m) => m.op), n7);
    chk(JSON.stringify(v16) === '["start","stop"]', 'V16 a press dragged off the mic does not swallow the next assistive click', JSON.stringify(v16));
    // A permission sheet taking focus mid-press: the blur ends the press, and the click that follows is still its own.
    const n7b = await page.evaluate(() => window.__voice.length);
    const dm5 = await descMic.boundingBox();
    await page.mouse.move(dm5.x + dm5.width / 2, dm5.y + dm5.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(400);
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await page.waitForTimeout(800);
    await page.mouse.up();
    const sheet = await page.evaluate((n) => window.__voice.slice(n).map((m) => m.op), n7b);
    await page.evaluate(() => { window.kosmosVoiceEvent({ kind: 'listening' }); document.querySelector('.fieldmic[data-voice-for="pj-add-desc"]').click(); window.kosmosVoiceEvent({ kind: 'stopped' }); });
    chk(JSON.stringify(sheet) === '["start"]', 'V16 a permission sheet taking focus mid-press does not stop the start it is asking about', JSON.stringify(sheet));
    // V12 a disabled box shows no mic (the agent's instructions before they load).
    const dis = await page.evaluate(() => { const b = document.getElementById('d-instr'); const was = b.disabled; b.disabled = true;
      const m = document.querySelector('.fieldmic[data-voice-for="d-instr"]'); const shownMic = getComputedStyle(m).display !== 'none';
      b.disabled = false; const shownOn = getComputedStyle(m).display !== 'none'; const padOn = parseFloat(getComputedStyle(b).paddingRight);
      b.disabled = was; return { shownMic, shownOn, padOn }; });
    chk(!dis.shownMic && dis.shownOn && dis.padOn >= 36, 'V12 a disabled box shows no mic; enabled, it does, with room for it (beating #d-instr\'s own padding)', JSON.stringify(dis));
    await page.evaluate(() => { const pp = document.getElementById('panel-projects'); if (pp) pp.hidden = true; document.getElementById('pj-add-view').hidden = true; document.getElementById('panel-detail').hidden = false; });

    // V16: a composer keeps listening through its other buttons (attach), as in slice 1.
    const n8 = await page.evaluate(() => window.__voice.length);
    await page.evaluate(() => { document.getElementById('d-mic').click(); window.kosmosVoiceEvent({ kind: 'listening' });
      const b = document.createElement('button'); b.type = 'button'; b.textContent = 'Attach'; document.getElementById('d-say').parentElement.appendChild(b); b.click(); b.remove(); });
    const v16c = await page.evaluate((n) => ({ ops: window.__voice.slice(n).map((m) => m.op), on: document.getElementById('d-mic').getAttribute('aria-pressed') }), n8);
    await page.evaluate(() => { document.getElementById('d-mic').click(); window.kosmosVoiceEvent({ kind: 'stopped' }); });
    chk(JSON.stringify(v16c.ops) === '["start"]' && v16c.on === 'true', 'V16 a composer keeps listening through a button other than Send, as in slice 1', JSON.stringify(v16c));
    // ...and through focus moving to another field (V14's rule is for dialogs only).
    const n9 = await page.evaluate(() => window.__voice.length);
    await page.evaluate(() => { document.getElementById('d-mic').click(); window.kosmosVoiceEvent({ kind: 'listening' });
      const i = document.createElement('input'); i.id = 'v16-field'; document.getElementById('d-say').parentElement.appendChild(i); i.focus(); i.remove(); });
    const v16f = await page.evaluate((n) => window.__voice.slice(n).map((m) => m.op), n9);
    await page.evaluate(() => { document.getElementById('d-mic').click(); window.kosmosVoiceEvent({ kind: 'stopped' }); });
    chk(JSON.stringify(v16f) === '["start"]', 'V16 a composer keeps listening when focus moves to another field, as in slice 1', JSON.stringify(v16f));

    // V17: an open emoji panel closes when the mic is pressed.
    await page.click('#d-emoji-btn');
    const emoOpen = await page.evaluate(() => !document.getElementById('d-emoji').hidden);
    const mb = await page.locator('#d-mic').boundingBox();
    await page.mouse.move(mb.x + mb.width / 2, mb.y + mb.height / 2);
    await page.mouse.down(); await page.mouse.up();
    const emoAfter = await page.evaluate(() => ({ hidden: document.getElementById('d-emoji').hidden, focus: document.activeElement && document.activeElement.id }));
    await page.evaluate(() => window.kosmosVoiceEvent({ kind: 'listening' }));
    const mb2 = await page.locator('#d-mic').boundingBox();
    await page.mouse.move(mb2.x + mb2.width / 2, mb2.y + mb2.height / 2);
    await page.mouse.down(); await page.mouse.up();
    await page.evaluate(() => window.kosmosVoiceEvent({ kind: 'stopped' }));
    chk(emoOpen && emoAfter.hidden && emoAfter.focus === 'd-say', 'V17 pressing the mic closes an open emoji panel, and the caret stays in the box', JSON.stringify({ emoOpen, ...emoAfter }));
    // V18: Escape in a dialog's box stops listening and leaves the dialog open.
    const n10 = await page.evaluate(() => window.__voice.length);
    await page.evaluate(() => { const m = document.getElementById('nt-modal'); m.hidden = false; document.getElementById('nt-detail').focus();
      document.querySelector('.fieldmic[data-voice-for="nt-detail"]').click(); window.kosmosVoiceEvent({ kind: 'listening' }); });
    await page.focus('#nt-detail');
    await page.keyboard.press('Escape');
    const v18 = await page.evaluate((n) => ({ ops: window.__voice.slice(n).map((m) => m.op), open: !document.getElementById('nt-modal').hidden,
      polite: document.getElementById('nt-voice-msg').getAttribute('aria-live'), alertLine: document.getElementById('nt-msg').textContent }), n10);
    await page.evaluate(() => { window.kosmosVoiceEvent({ kind: 'stopped' }); document.getElementById('nt-modal').hidden = true; });
    chk(JSON.stringify(v18.ops) === '["start","stop"]' && v18.open, 'V18 Escape in a dialog\'s box stops listening and does not close the dialog', JSON.stringify(v18));
    chk(v18.polite === 'polite' && !/Listening/.test(v18.alertLine), 'V18 the New task mic speaks in its own polite line, never the dialog\'s assertive alert', JSON.stringify(v18));
    // V19: a press whose release the page never heard does not block the next press of the same pointer.
    await page.evaluate(() => { document.getElementById('nt-modal').hidden = true; document.getElementById('panel-detail').hidden = true;
      const pp = document.getElementById('panel-projects'); if (pp) pp.hidden = false; document.getElementById('pj-add-view').hidden = false; });
    const n11 = await page.evaluate(() => window.__voice.length);
    await page.evaluate(() => { const m = document.querySelector('.fieldmic[data-voice-for="pj-add-desc"]');
      m.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 1, isPrimary: true, button: 0 })); });
    await page.evaluate(() => window.kosmosVoiceEvent({ kind: 'listening' }));
    const dm6 = await descMic.boundingBox();
    await page.mouse.move(dm6.x + dm6.width / 2, dm6.y + dm6.height / 2);
    await page.mouse.down(); await page.mouse.up();
    await page.evaluate(() => window.kosmosVoiceEvent({ kind: 'stopped' }));
    const v19 = await page.evaluate((n) => window.__voice.slice(n).map((m) => m.op), n11);
    chk(JSON.stringify(v19) === '["start","stop"]', 'V19 a press whose release was never heard does not block the next press', JSON.stringify(v19));
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

    // P1-P4 (slice 3): a phone. A recording stand-in for the browser's recognizer, an iPhone's touch screen.
    const SR = () => {
      window.__rec = [];
      // Both names: this Chromium already has an unprefixed one, which the page prefers.
      window.SpeechRecognition = window.webkitSpeechRecognition = class { constructor() { window.__recLast = this; window.__rec.push('new'); }
        start() {
          // Started from the tap's click (a user activation), not from its touch press (which is not one). Read from the
          // event being dispatched: navigator.userActivation stays active for seconds after an EARLIER gesture.
          window.__rec.push(window.event && window.event.type === 'click' ? 'start' : 'start-outside-a-click:' + (window.event && window.event.type));
          if (window.__recThrow) throw new DOMException('refused', 'InvalidStateError');
          setTimeout(() => this.onstart && this.onstart(), 0);
        }
        // Two results, the second with no leading space, as a phone's recognizer sends them.
        stop() { window.__rec.push('stop'); setTimeout(() => { this.onresult && this.onresult({ results: [Object.assign([{ transcript: 'call the' }], { isFinal: true }), Object.assign([{ transcript: 'client' }], { isFinal: true })] }); this.onend && this.onend(); }, 0); }
        abort() { window.__rec.push('abort'); } };
    };
    const desk = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    desk.on('pageerror', (e) => errs.push(e.message));
    await desk.addInitScript(harness(false), [false]);
    await desk.addInitScript(SR);
    await desk.goto(PAGE);
    const deskMic = await desk.evaluate(() => document.documentElement.classList.contains('has-voice'));
    await desk.close();
    const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
    const phone = await phoneCtx.newPage();
    phone.on('pageerror', (e) => errs.push(e.message));
    await phone.addInitScript(harness(false), [false]);
    await phone.addInitScript(SR);
    await phone.goto(PAGE);
    await openDm(phone);
    const p1 = { cls: await phone.evaluate(() => document.documentElement.classList.contains('has-voice')), shown: await shown(phone, '#d-mic'),
      label: await phone.getAttribute('#d-mic', 'aria-label'),
      // The Guide is built when first needed, after load labelled the page's mics: build it now, as opening it does.
      guide: await phone.evaluate(() => { asbLayerEnsure(); const m = document.getElementById('asp-mic'); return m ? m.getAttribute('aria-label') : 'no Guide mic'; }) };
    // Android: Chrome is Google's recognizer and is named; another Android browser is not guessed at and gets no mic.
    const android = async (ua, brave) => {
      const c = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: ua });
      const pg = await c.newPage();
      await pg.addInitScript(harness(false), [false]);
      await pg.addInitScript(SR);
      if (brave) await pg.addInitScript(() => { Object.defineProperty(navigator, 'brave', { value: { isBrave: () => Promise.resolve(true) } }); });
      await pg.goto(PAGE);
      const r = await pg.evaluate(() => ({ cls: document.documentElement.classList.contains('has-voice'), label: document.getElementById('d-mic').getAttribute('aria-label') }));
      await c.close();
      return r;
    };
    const chrome = await android('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36');
    const samsung = await android('Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36');
    // Brave sends Chrome's exact user agent; only navigator.brave tells it apart.
    const brave = await android('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36', true);
    chk(chrome.cls && /\(Google hears the audio\)/.test(chrome.label) && !samsung.cls && !brave.cls, 'P1b Android Chrome names Google; another Android browser gets no mic, not a guess', JSON.stringify({ chrome, samsung, brave }));
    // A touch-screen computer (a Windows tablet: coarse pointer, no hover, the same recognizer) is not a phone.
    const tabCtx = await browser.newContext({ viewport: { width: 1200, height: 800 }, isMobile: true, hasTouch: true,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 Edg/129.0' });
    const tab = await tabCtx.newPage();
    await tab.addInitScript(harness(false), [false]);
    await tab.addInitScript(SR);
    await tab.goto(PAGE);
    const tabMic = await tab.evaluate(() => document.documentElement.classList.contains('has-voice'));
    await tabCtx.close();
    chk(p1.cls && p1.shown && !deskMic && !tabMic && /\(Apple hears the audio\)/.test(p1.label) && /\(Apple hears the audio\)/.test(p1.guide), 'P1 a phone draws the mic through the browser\'s recognizer, its label saying who hears it; a computer\'s browser and a touch-screen computer do not', JSON.stringify({ ...p1, deskMic, tabMic }));
    await phone.fill('#d-say', '');
    await phone.evaluate(() => document.activeElement && document.activeElement.blur());   // as after the keyboard is put away
    // Read in the same task as the tap's click: who hears the audio is on screen before the recognizer can send a word.
    const atStart = await phone.evaluate(() => { document.getElementById('d-mic').click(); return { who: (document.getElementById('voice-who') || {}).textContent || '', shown: (() => { const b = document.getElementById('voice-who'); return !!b && !b.hidden && getComputedStyle(b).display !== 'none' && b.getBoundingClientRect().height > 0; })(), rec: window.__rec.slice() }; });
    await phone.waitForFunction(() => document.getElementById('d-mic').getAttribute('aria-pressed') === 'true');
    const line = await phone.evaluate(() => (document.getElementById('voice-who') || {}).textContent || '');
    await phone.evaluate(() => window.__recLast.onresult({ results: [Object.assign([{ transcript: 'call the' }], { isFinal: false })] }));
    const mid = await phone.evaluate(() => document.getElementById('d-say').value);
    await phone.tap('#d-mic');
    await phone.waitForFunction(() => document.getElementById('d-mic').getAttribute('aria-pressed') === 'false');
    const p2 = await phone.evaluate(() => ({ rec: window.__rec.slice(), box: document.getElementById('d-say').value, focusedBox: document.activeElement === document.getElementById('d-say'), barAfter: (() => { const b = document.getElementById('voice-who'); return !!b && !b.hidden && getComputedStyle(b).display !== 'none' && b.getBoundingClientRect().height > 0; })() }));
    chk(atStart.shown && /Apple hears this audio/.test(atStart.who) && !p2.barAfter,
      'P2a who hears the audio is shown in the tap itself, before listening begins, and goes when listening ends', JSON.stringify({ atStart, barAfter: p2.barAfter }));
    // P2 taps via click() in the page for its start (a click is what a tap delivers; the stand-in records the event).
    chk(JSON.stringify(p2.rec) === '["new","start","stop"]' && mid === 'call the' && p2.box === 'call the client' && p2.focusedBox === false && /Apple hears this audio/.test(line) && !/Escape/.test(line),
      'P2 a tap starts the recognizer within the tap\'s user activation (no keyboard opened), the line says Apple hears the audio, words from two results land spaced, and the next tap stops it', JSON.stringify({ ...p2, mid, line }));
    await phone.tap('#d-mic');
    await phone.waitForFunction(() => document.getElementById('d-mic').getAttribute('aria-pressed') === 'true');
    await phone.evaluate(() => { window.__recLast.onerror({ error: 'not-allowed' }); window.__recLast.onend(); });
    const refused = await phone.evaluate(() => document.getElementById('d-say-msg').textContent);
    chk(/not allowed to use the microphone/.test(refused) && /browser/.test(refused) && !/System Settings/.test(refused), 'P3 a refused microphone on a phone points at the browser\'s settings', refused);
    // P3b: allowed now, the next tap must still say who hears the audio (the refusal is the mic's own line to clear).
    // Read in the same task as the tap's click, before the recognizer says it is listening: the old refusal is gone.
    const atTap = await phone.evaluate(() => { document.getElementById('d-mic').click(); return document.getElementById('d-say-msg').textContent; });
    await phone.waitForFunction(() => document.getElementById('d-mic').getAttribute('aria-pressed') === 'true');
    const retry = await phone.evaluate(() => (document.getElementById('voice-who') || {}).textContent || '');
    chk(atTap === '' && /Apple hears this audio/.test(retry), 'P3b after a refusal, the retry clears it at once and still says who hears the audio', JSON.stringify({ atTap, retry }));
    await phone.tap('#d-mic');
    await phone.waitForFunction(() => document.getElementById('d-mic').getAttribute('aria-pressed') === 'false');
    /* P5: another line in the box's message line is neither hidden nor touched, and its owner can still retire it while
       listening; who hears the audio is said in the bar regardless. P6: a start that throws ends cleanly. */
    await phone.evaluate(() => { document.getElementById('d-say-msg').textContent = 'Still sending your last message.'; });
    await phone.tap('#d-mic');
    await phone.waitForFunction(() => document.getElementById('d-mic').getAttribute('aria-pressed') === 'true');
    const during = await phone.evaluate(() => ({ msg: document.getElementById('d-say-msg').textContent, who: (document.getElementById('voice-who') || {}).textContent || '' }));
    await phone.evaluate(() => { document.getElementById('d-say-msg').textContent = ''; });   // its owner retires it
    await phone.tap('#d-mic');
    await phone.waitForFunction(() => document.getElementById('d-mic').getAttribute('aria-pressed') === 'false');
    const after = await phone.evaluate(() => document.getElementById('d-say-msg').textContent);
    chk(during.msg === 'Still sending your last message.' && /Apple hears this audio/.test(during.who) && after === '',
      'P5 on a phone, another message line is left alone (and stays retired), and who hears the audio is said in its own bar', JSON.stringify({ during, after }));
    // P7: a session the recognizer ends by itself (after a silence) leaves the mic off and the bar gone.
    await phone.tap('#d-mic');
    await phone.waitForFunction(() => document.getElementById('d-mic').getAttribute('aria-pressed') === 'true');
    await phone.evaluate(() => window.__recLast.onend());
    await phone.waitForFunction(() => document.getElementById('d-mic').getAttribute('aria-pressed') === 'false');
    const selfEnd = await phone.evaluate(() => ({ btn: !!VOICE.btn, bar: (() => { const b = document.getElementById('voice-who'); return !!b && !b.hidden && getComputedStyle(b).display !== 'none' && b.getBoundingClientRect().height > 0; })() }));
    chk(!selfEnd.btn && !selfEnd.bar, 'P7 a session that ends by itself leaves the mic off and the bar gone', JSON.stringify(selfEnd));
    await phone.evaluate(() => { window.__recThrow = true; });
    await phone.tap('#d-mic');
    await phone.waitForTimeout(100);
    const thrown = await phone.evaluate(() => ({ btn: !!VOICE.btn, pressed: document.getElementById('d-mic').getAttribute('aria-pressed'), asking: document.getElementById('d-mic').classList.contains('asking'), bar: (() => { const b = document.getElementById('voice-who'); return !!b && !b.hidden && getComputedStyle(b).display !== 'none' && b.getBoundingClientRect().height > 0; })() }));
    await phone.evaluate(() => { window.__recThrow = false; });
    chk(!thrown.btn && thrown.pressed === 'false' && !thrown.asking && !thrown.bar, 'P6 a recognizer that refuses to start leaves the mic off, not half on', JSON.stringify(thrown));
    const spk = await shown(phone, '#d-dmthread .msg:not(.you) .rxn-speak');
    await phone.evaluate(() => { window.__spoken.length = 0; });
    /* Pressed directly: whether a thumb reaches it is the #718 tap-to-open bar, unchanged by voice and not measurable
       in this file:// harness (its phone layout puts the thread behind the search row). What is under test is that a
       phone draws read aloud and it speaks with an on-device voice. */
    await phone.evaluate(() => document.querySelector('#d-dmthread .msg:not(.you) .rxn-speak').click());
    const heard = await phone.evaluate(() => window.__spoken.filter((x) => !x.cancel).map((x) => x.text).join(' '));
    chk(spk && heard === 'The fix is in. Run this: Code block. then tell me.', 'P4 read aloud is offered and speaks on a phone', JSON.stringify({ spk, heard }));
    await phoneCtx.close();

    chk(errs.length === 0, 'V9 no page errors', errs.join(' | '));
  } finally {
    await browser.close();
  }
  if (fail.length) { console.log('\n' + fail.length + ' failed'); process.exit(1); }
  console.log('\nall voice checks passed');
})();
