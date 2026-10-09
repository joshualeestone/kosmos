'use strict';
/**
 * kosmos#5624 (Josh 2026-10-08: "conversation mode ... as soon as an agent posts in a project or direct agent message
 * it plays audio"): a Read-new-messages-aloud toggle beside the mic in a conversation's box.
 *
 * Harness: file:// with fetch answered here and speechSynthesis a recording stand-in, as render-voice-4409.js (a voice
 * cannot run in CI; what is under test is the page's half of the seam). The direct thread is drawn by the real
 * paintTalk; the project room calls the same convFollow from paintRoom (pinned at C8).
 *   C0 HELD (Josh 2026-10-09 10:49, 10:52: not in the input box): by default no toggle is drawn and a conversation stored as on reads nothing
 *   C1 the toggle is drawn beside the mic and starts off (aria-pressed false), with the mode's switch on
 *   C2 with the mode OFF, a new agent message is not read (CONTROL for C4)
 *   C3 turning it on reads nothing already on screen
 *   C4 with it on, a new agent message is read, with an on-device voice, code announced not spelled
 *   C5 the person's own new message is not read
 *   C6 two new agent messages at once: only the newest is read, after a cancel of anything playing
 *   C7 turning it off stops what is playing and nothing more is read; the state is remembered per conversation
 *   C8 the project room, drawn by the real paintRoom: off reads nothing, on reads a new agent post, a guest's is not read
 *   C10 an agent's first reply in an EMPTY direct thread is read (review 1)
 *   C8b a guest from outside is drawn and not read (review 3)
 *   C10b a thread with only another agent's row is not read, on open or on the next poll (review 3)
 *   C11 going to another agent and back does not read what arrived meanwhile (review 1)
 *   C12 a hidden window reads nothing, and nothing it missed is read late when it shows again (review 1)
 *   C12b hiding the window while a message is read stops it (review 1)
 *   C13 an empty voice list (Chrome before voiceschanged) reads once the list arrives (review 1)
 *   C13b turning the mode off during a voice-list wait means nothing is read (review 2)
 *   C14 nothing is read while the mic is listening (review 1)
 *   C15 a no-match search, then clearing it, reads nothing late (review 4)
 *   C16 the no-voice notice clears when the toggle changes (review 4)
 *   C17 pressing the mic, through its real handler, stops a reading (review 4)
 *   C18 opening the same agent again (openDetail) reads nothing that arrived meanwhile (reviews 5, 6)
 *   C19 a real tab change away from a room and back reads nothing that arrived meanwhile (review 7)
 *   C9 no page errors
 *
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-convmode-5624.js [shots-dir]
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

const T0 = Date.parse('2026-10-08T20:00:00Z');
const at = (i) => new Date(T0 + i * 60000).toISOString();
const agentRow = (i, text) => ({ from: 'april', at: at(i), text });
const youRow = (i, text) => ({ at: at(i), text, delivery: { state: 'placed', paneState: 'idle' } });

function harness() {
  // o (C0 only): { enabled: false, seed: <kosmos.convmode JSON> }, applied in this one init script so order is fixed.
  return (o) => {
    window.setInterval = () => 0;
    window.__spoken = [];
    const full = [
      { name: 'Cloud Voice', lang: 'en-US', localService: false, default: true },
      { name: 'Samantha', lang: 'en-US', localService: true, default: false },
    ];
    let voices = full;
    const listeners = [];
    window.__noVoicesYet = () => { voices = []; };
    window.__voicesArrive = () => { voices = full; listeners.splice(0).forEach((f) => f()); };
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
      getVoices: () => voices,
      speak: (u) => window.__spoken.push({ text: u.text, voice: u.voice && u.voice.name }),
      cancel: () => { window.__spoken.push({ cancel: true }); },
      addEventListener: (ev, f) => { if (ev === 'voiceschanged') listeners.push(f); },
    } });
    window.SpeechSynthesisUtterance = function (text) { this.text = text; };
    // The app's on-device dictation bridge, recording only (C17 presses the mic through its real handler).
    window.__voice = [];
    window.webkit = { messageHandlers: { kosmosVoice: { postMessage: (m) => window.__voice.push(m) } } };
    try {
      localStorage.removeItem('kosmos.convmode');
      if (o && o.enabled === false) localStorage.removeItem('kosmos.convmode.enabled'); else localStorage.setItem('kosmos.convmode.enabled', '1');
      if (o && o.seed) localStorage.setItem('kosmos.convmode', o.seed);
    } catch { /* fresh */ }
    const enc = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
    window.fetch = async (url) => (String(url).includes('/thread') ? enc(window.__fx) : enc({}));
  };
}

async function paint(page, msgs) {
  await page.evaluate((m) => { window.__fx = { messages: m }; }, msgs);
  await page.evaluate(() => paintTalk('april', 'April'));
  await page.waitForTimeout(150);
}
const spoken = (page) => page.evaluate(() => window.__spoken.filter((x) => x.text).map((x) => x.text).join(' '));
const resetSpoken = (page) => page.evaluate(() => { window.__spoken = []; });

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  const errs = [];
  try {
    {
      // C0: the default page, as it ships while held. A conversation stored as on from before the hold must stay silent.
      const p0 = await browser.newPage({ viewport: { width: 1200, height: 800 } });
      p0.on('pageerror', (e) => errs.push(e.message));
      await p0.addInitScript(harness(), { enabled: false, seed: JSON.stringify({ 'dm:april': true }) });
      await p0.goto(PAGE);
      await p0.evaluate(() => {
        CURRENT = { sessionName: 'april', name: 'April' };
        LAST = [{ sessionName: 'april', name: 'April', state: 'idle' }];
        document.getElementById('panel-detail').hidden = false;
        const fr = document.getElementById('firstrun'); if (fr) fr.hidden = true;
        document.querySelectorAll('body > *').forEach((el) => { el.inert = false; });
      });
      await paint(p0, [agentRow(1, 'Already on screen.')]);
      await paint(p0, [agentRow(1, 'Already on screen.'), agentRow(2, 'A new message after the hold.')]);
      const c0 = await p0.evaluate(() => {
        const shown = (id) => { const b = document.getElementById(id); return !!b && getComputedStyle(b).display !== 'none'; };
        return { dm: shown('d-conv'), pj: shown('pj-conv'), speakable: document.documentElement.classList.contains('has-speak'),
          stored: localStorage.getItem('kosmos.convmode'),
          // The rows the mode would read: two distinct agent messages, the new one among them.
          drawn: (() => {
            const rows = [...document.querySelectorAll('#panel-detail .msg:not(.you):not(.ext)[data-mid]')];
            return new Set(rows.map((r) => r.getAttribute('data-mid'))).size >= 2
              && rows.some((r) => (r.textContent || '').includes('A new message after the hold.'));
          })() };
      });
      const said0 = await spoken(p0);
      chk(c0.speakable && c0.drawn && c0.stored === '{"dm:april":true}' && !c0.dm && !c0.pj && !/after the hold/.test(said0), 'C0 held: no toggle is drawn and a conversation stored as on reads nothing', JSON.stringify({ c0, said0 }));
      await p0.close();
    }
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    page.on('pageerror', (e) => errs.push(e.message));
    await page.addInitScript(harness());
    await page.goto(PAGE);
    await page.evaluate(() => {
      CURRENT = { sessionName: 'april', name: 'April' };
      LAST = [{ sessionName: 'april', name: 'April', state: 'idle' }];
      document.getElementById('panel-detail').hidden = false;
      const fr = document.getElementById('firstrun'); if (fr) fr.hidden = true;
      document.querySelectorAll('body > *').forEach((el) => { el.inert = false; });
    });
    let thread = [agentRow(1, 'Earlier work, already on screen.'), youRow(2, 'Thanks')];
    await paint(page, thread);

    // C1
    const c1 = await page.evaluate(() => {
      const b = document.getElementById('d-conv');
      const mic = document.getElementById('d-mic');
      return { exists: !!b, shown: !!b && getComputedStyle(b).display !== 'none', pressed: b && b.getAttribute('aria-pressed'),
        besideMic: !!b && !!mic && b.parentElement === mic.parentElement };
    });
    chk(c1.exists && c1.shown && c1.pressed === 'false' && c1.besideMic, 'C1 the toggle is drawn beside the mic and starts off', JSON.stringify(c1));

    // C2: mode off, a new agent message arrives: nothing is read.
    thread = [...thread, agentRow(3, 'A new thing while the mode is off.')];
    await paint(page, thread);
    chk((await spoken(page)) === '', 'C2 with the mode off a new agent message is not read (CONTROL for C4)', await spoken(page));

    // C3: turn it on: nothing already on screen is read.
    await page.click('#d-conv');
    const c3 = await page.evaluate(() => document.getElementById('d-conv').getAttribute('aria-pressed'));
    await paint(page, thread);
    chk(c3 === 'true' && (await spoken(page)) === '', 'C3 turning it on does not clear what was heard (nothing already on screen is read)', JSON.stringify({ c3, said: await spoken(page) }));
    if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.locator('#d-conv').scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(SHOTS, 'convmode-on.png') }); }

    // C4: a new agent message with a code block is read with the on-device voice.
    thread = [...thread, agentRow(4, 'The fix is in. Run this:\n```\nnpm test\n```\nthen tell me.')];
    await paint(page, thread);
    const c4 = await page.evaluate(() => window.__spoken.filter((x) => x.text));
    const c4text = c4.map((x) => x.text).join(' ');
    chk(c4.length > 0 && c4.every((x) => x.voice === 'Samantha') && /The fix is in/.test(c4text) && /Code block/.test(c4text) && !/npm test/.test(c4text),
      'C4 a new agent message is read, on-device voice, code announced not spelled', JSON.stringify(c4));

    // C5: the person's own message is not read.
    await resetSpoken(page);
    thread = [...thread, youRow(5, 'Running it now')];
    await paint(page, thread);
    chk((await spoken(page)) === '', 'C5 the person\'s own new message is not read', await spoken(page));

    // C6: two new agent messages at once: the newest only, after a cancel.
    await resetSpoken(page);
    thread = [...thread, agentRow(6, 'First of two.'), agentRow(7, 'Second of two.')];
    await paint(page, thread);
    const c6 = await page.evaluate(() => window.__spoken);
    const c6text = c6.filter((x) => x.text).map((x) => x.text).join(' ');
    const iCancel = c6.findIndex((x) => x.cancel);
    const iSpeak = c6.findIndex((x) => x.text);
    chk(/Second of two/.test(c6text) && !/First of two/.test(c6text) && iCancel >= 0 && iCancel < iSpeak, 'C6 two at once: only the newest is read, after a cancel', JSON.stringify(c6));

    // C7: off stops and reads no more; remembered for this conversation only.
    await resetSpoken(page);
    await page.click('#d-conv');
    const stopped = await page.evaluate(() => window.__spoken.some((x) => x.cancel));
    thread = [...thread, agentRow(8, 'After the mode went off.')];
    await paint(page, thread);
    const store = await page.evaluate(() => localStorage.getItem('kosmos.convmode'));
    chk(stopped && !/After the mode went off/.test(await spoken(page)) && store === '{}', 'C7 turning it off stops what plays, reads no more, and is remembered', JSON.stringify({ stopped, store, said: await spoken(page) }));
    await page.click('#d-conv');
    const remembered = await page.evaluate(() => localStorage.getItem('kosmos.convmode'));
    chk(remembered === '{"dm:april":true}', 'C7b the on state is kept for this conversation, by its key', remembered);

    // C8: the room, through the real paintRoom (pjById stood in for one project).
    const room = (rows) => page.evaluate((r) => { paintRoom({ rows: r }); }, rows);
    const post = (id, from, text, extra) => ({ kind: 'post', id, from, to: [], text, at: new Date().toISOString(), outcomes: {}, ...(extra || {}) });
    await page.evaluate(() => {
      PJ_CURRENT = 'p1';
      window.pjById = (id) => (id === 'p1' ? { id: 'p1', name: 'Launch', agents: ['april'], members: ['april'] } : null);
      // Show the room as opening a project does: unhide its panel (the direct-message panel goes behind it).
      document.getElementById('panel-detail').hidden = true;
      for (let el = document.getElementById('pj-conv'); el; el = el.parentElement) if (el.hidden) el.hidden = false;
    });
    await resetSpoken(page);
    let rr = [post('r1', 'april', 'Room backlog.')];
    await room(rr);
    rr = [...rr, post('r2', 'april', 'Room news with the mode off.')];
    await room(rr);
    const offSaid = await spoken(page);
    await page.click('#pj-conv');
    rr = [...rr, post('r3', 'april', 'Room news with the mode on.')];
    await room(rr);
    const onSaid = await spoken(page);
    chk(offSaid === '' && /Room news with the mode on/.test(onSaid) && !/backlog|mode off/.test(onSaid), 'C8 the room, through paintRoom: off reads nothing, on reads the new agent post', JSON.stringify({ offSaid, onSaid }));
    // C8b (review 3): a guest from outside posts with the mode on: drawn, and not read.
    await resetSpoken(page);
    rr = [...rr, { kind: 'external', id: 'r4', from: 'A guest', text: 'Words from outside.', at: new Date().toISOString() }];
    await room(rr);
    const hasExt = await page.evaluate(() => document.querySelectorAll('#pj-room .msg.ext').length);
    chk(hasExt > 0 && !/Words from outside/.test(await spoken(page)), 'C8b a guest from outside is drawn and not read', JSON.stringify({ hasExt, said: await spoken(page) }));
    // C19 (review 7): with the room on, a real tab change and back (the room's poll stops meanwhile), a message that
    // arrived meanwhile is drawn on return and is NOT read; the next new one is.
    await resetSpoken(page);
    await page.evaluate(() => { try { showTab('agents'); } catch (e) { window.__tabErr = String(e && e.message); } });
    rr = [...rr, post('r5', 'april', 'Room post while on another tab.')];
    await page.evaluate(() => { try { showTab('projects'); } catch (e) { window.__tabErr = String(e && e.message); } });
    await room(rr);
    const c19away = await spoken(page);
    rr = [...rr, post('r6', 'april', 'Room post after coming back.')];
    await room(rr);
    const c19 = { away: c19away, then: await spoken(page), err: await page.evaluate(() => window.__tabErr || '') };
    chk(!/another tab/.test(c19.away) && /after coming back/.test(c19.then), 'C19 a tab change and back reads nothing that arrived meanwhile, then reads again', JSON.stringify(c19));
    await page.click('#pj-conv');   // off again for the room
    await page.evaluate(() => {
      PJ_CURRENT = null;
      for (let el = document.getElementById('pj-room'); el && el !== document.body; el = el.parentElement) if (el.id && /^panel-/.test(el.id)) el.hidden = true;
      document.getElementById('panel-detail').hidden = false;
    });

    // C10: a first reply in an EMPTY direct thread.
    await resetSpoken(page);
    await page.evaluate(() => { CURRENT = { sessionName: 'june', name: 'June' }; localStorage.setItem('kosmos.convmode', JSON.stringify({ 'dm:april': true, 'dm:june': true })); CONV.on = null; });
    const jrow = (i, text) => ({ from: 'june', at: at(i), text });
    await page.evaluate((m) => { window.__fx = { messages: m }; }, []);
    await page.evaluate(() => paintTalk('june', 'June'));
    await page.waitForTimeout(150);
    await page.evaluate((m) => { window.__fx = { messages: m }; }, [jrow(20, 'My very first reply.')]);
    await page.evaluate(() => paintTalk('june', 'June'));
    await page.waitForTimeout(150);
    chk(/My very first reply/.test(await spoken(page)), 'C10 an agent\'s first reply in an empty thread is read', await spoken(page));

    // C10b (review 3): a thread with only ANOTHER agent's row, polled twice: nothing is read.
    await resetSpoken(page);
    await page.evaluate(() => { CURRENT = { sessionName: 'kai', name: 'Kai' }; localStorage.setItem('kosmos.convmode', JSON.stringify({ 'dm:april': true, 'dm:kai': true })); CONV.on = null; });
    const other = [{ from: 'june', at: at(25), text: 'June passing a note to Kai.' }];
    for (let i = 0; i < 2; i++) {
      await page.evaluate((m) => { window.__fx = { messages: m }; }, other);
      await page.evaluate(() => paintTalk('kai', 'Kai'));
      await page.waitForTimeout(120);
    }
    chk(!/passing a note/.test(await spoken(page)), 'C10b another agent\'s row in a thread is not read on open or on the next poll', await spoken(page));

    // C11: away to june, april posts meanwhile, back to april: not read.
    await resetSpoken(page);
    await page.evaluate(() => { CURRENT = { sessionName: 'april', name: 'April' }; });
    thread = [...thread, agentRow(30, 'Arrived while you were with June.')];
    await paint(page, thread);
    chk(!/while you were with June/.test(await spoken(page)), 'C11 going away and back does not read what arrived meanwhile', await spoken(page));

    // C12: hidden reads nothing, and nothing late when shown again; then a new one is read.
    await resetSpoken(page);
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
    thread = [...thread, agentRow(31, 'Posted while hidden.')];
    await paint(page, thread);
    const hiddenSaid = await spoken(page);
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
    await paint(page, thread);
    const lateSaid = await spoken(page);
    thread = [...thread, agentRow(32, 'Posted once visible.')];
    await paint(page, thread);
    const nowSaid = await spoken(page);
    chk(!/while hidden/.test(hiddenSaid) && !/while hidden/.test(lateSaid) && /once visible/.test(nowSaid), 'C12 a hidden window reads nothing, misses nothing late, then reads again', JSON.stringify({ hiddenSaid, lateSaid, nowSaid }));

    // C12b: hiding the window WHILE a message is being read stops it (review 1).
    await resetSpoken(page);
    thread = [...thread, agentRow(35, 'Being read when the window hides.')];
    await paint(page, thread);
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
    const c12b = await page.evaluate(() => window.__spoken);
    const iSaid = c12b.findIndex((x) => x.text && /window hides/.test(x.text));
    const iStop = c12b.findIndex((x, i) => i > iSaid && x.cancel);
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
    await paint(page, thread);
    chk(iSaid >= 0 && iStop > iSaid, 'C12b hiding the window while a message is read stops it', JSON.stringify(c12b));

    // C13: no voices yet, then they arrive.
    await resetSpoken(page);
    await page.evaluate(() => window.__noVoicesYet());
    thread = [...thread, agentRow(33, 'Before the voices loaded.')];
    await paint(page, thread);
    const before = await spoken(page);
    await page.evaluate(() => window.__voicesArrive());
    chk(before === '' && /Before the voices loaded/.test(await spoken(page)), 'C13 an empty voice list reads once the list arrives', JSON.stringify({ before, after: await spoken(page) }));

    // C13b: voices pending, the mode turned off, voices arrive: nothing is read (review 2).
    await resetSpoken(page);
    // The stand-in never fires onend, so mark the earlier reading as ended, as a real voice would have by now.
    await page.evaluate(() => { CONV.key = ''; CONV.where = ''; });
    await page.evaluate(() => window.__noVoicesYet());
    thread = [...thread, agentRow(36, 'Pending when the mode went off.')];
    await paint(page, thread);
    await page.click('#d-conv');   // off
    await page.evaluate(() => window.__voicesArrive());
    const c13b = await spoken(page);
    await page.click('#d-conv');   // on again for the arms below
    chk(!/mode went off/.test(c13b), 'C13b turning the mode off during a voice-list wait means nothing is read', c13b);

    // C14: the mic listening.
    await resetSpoken(page);
    await page.evaluate(() => { VOICE.btn = document.getElementById('d-mic'); });
    thread = [...thread, agentRow(34, 'Posted while the mic listens.')];
    await paint(page, thread);
    const micSaid = await spoken(page);
    await page.evaluate(() => { VOICE.btn = null; });
    chk(!/mic listens/.test(micSaid), 'C14 nothing is read while the mic is listening', micSaid);

    // C15 (review 4): a search that matches nothing, a new message, the search cleared: nothing is read late.
    await resetSpoken(page);
    await page.evaluate(() => { TALK_QUERY = 'zzzz-no-match'; });
    thread = [...thread, agentRow(40, 'Arrived during a no-match search.')];
    await paint(page, thread);
    await page.evaluate(() => { TALK_QUERY = ''; });
    await paint(page, thread);
    chk(!/no-match search/.test(await spoken(page)), 'C15 a no-match search then clearing it reads nothing late', await spoken(page));

    // C16 (review 4): the no-voice notice clears when the mode is turned off and on.
    await page.evaluate(() => { CONV.novoice = true; convPaint(); });
    const before16 = await page.evaluate(() => document.getElementById('d-conv').title);
    await page.click('#d-conv'); await page.click('#d-conv');
    const after16 = await page.evaluate(() => document.getElementById('d-conv').title);
    chk(/No voice/.test(before16) && !/No voice/.test(after16), 'C16 the no-voice notice clears when the toggle changes', JSON.stringify({ before16, after16 }));

    // C17 (review 4): pressing the mic, through its real handler, stops a reading.
    await resetSpoken(page);
    thread = [...thread, agentRow(41, 'Being read when the mic is pressed.')];
    await paint(page, thread);
    await page.evaluate(() => { voiceToggle(document.getElementById('d-mic')); });
    const c17 = await page.evaluate(() => window.__spoken);
    const i17s = c17.findIndex((x) => x.text && /mic is pressed/.test(x.text));
    const i17c = c17.findIndex((x, i) => i > i17s && x.cancel);
    await page.evaluate(() => { if (VOICE.btn) voiceCancel(); });
    chk(i17s >= 0 && i17c > i17s, 'C17 pressing the mic stops a reading', JSON.stringify(c17));

    // C18 (reviews 5 and 6): away from the conversation (its poll stopped), a message arrives, the agent is opened
    // again through the real openDetail: what arrived meanwhile is not read; the next new one is.
    await resetSpoken(page);
    thread = [...thread, agentRow(42, 'Arrived while the board was open.')];   // already there when the agent is reopened
    await page.evaluate((m) => { window.__fx = { messages: m }; }, thread);
    await page.evaluate(() => { try { openDetail('april'); } catch (e) { window.__openErr = String(e && e.message); } });
    await paint(page, thread);
    const away = await spoken(page);
    thread = [...thread, agentRow(43, 'Arrived once back.')];
    await paint(page, thread);
    chk(!/board was open/.test(away) && /once back/.test(await spoken(page)), 'C18 opening the agent again reads nothing that arrived meanwhile, then reads again', JSON.stringify({ away, then: await spoken(page) }));

    chk(errs.length === 0, 'C9 no page errors', errs.slice(0, 3).join(' | '));
    await page.close();
  } finally {
    await browser.close();
  }
  if (fail.length) { console.error('FAILURES: ' + fail.length); process.exit(1); }
  console.log('\nall passed');
})().catch((e) => {
  console.error('render-convmode-5624 threw: ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
