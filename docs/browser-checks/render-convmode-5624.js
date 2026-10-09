'use strict';
/**
 * kosmos#5624 (Josh 2026-10-08: "conversation mode ... as soon as an agent posts in a project or direct agent message
 * it plays audio"): a Read-new-messages-aloud toggle beside the mic in a conversation's box.
 *
 * Harness: file:// with fetch answered here and speechSynthesis a recording stand-in, as render-voice-4409.js (a voice
 * cannot run in CI; what is under test is the page's half of the seam). The direct thread is drawn by the real
 * paintTalk; the project room calls the same convFollow from paintRoom (pinned at C8).
 *   C1 the toggle is drawn beside the mic and starts off (aria-pressed false)
 *   C2 with the mode OFF, a new agent message is not read (CONTROL for C4)
 *   C3 turning it on reads nothing already on screen
 *   C4 with it on, a new agent message is read, with an on-device voice, code announced not spelled
 *   C5 the person's own new message is not read
 *   C6 two new agent messages at once: only the newest is read, after a cancel of anything playing
 *   C7 turning it off stops what is playing and nothing more is read; the state is remembered per conversation
 *   C8 the project room's painter calls convFollow and paintRoom's box carries the room's key
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
  return () => {
    window.setInterval = () => 0;
    window.__spoken = [];
    const voices = [
      { name: 'Cloud Voice', lang: 'en-US', localService: false, default: true },
      { name: 'Samantha', lang: 'en-US', localService: true, default: false },
    ];
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
      getVoices: () => voices,
      speak: (u) => window.__spoken.push({ text: u.text, voice: u.voice && u.voice.name }),
      cancel: () => { window.__spoken.push({ cancel: true }); },
    } });
    window.SpeechSynthesisUtterance = function (text) { this.text = text; };
    try { localStorage.removeItem('kosmos.convmode'); } catch { /* fresh */ }
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
    chk(c3 === 'true' && (await spoken(page)) === '', 'C3 turning it on reads nothing already on screen', JSON.stringify({ c3, said: await spoken(page) }));
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
    chk(/Second of two/.test(c6text) && !/First of two/.test(c6text) && c6.some((x) => x.cancel), 'C6 two at once: only the newest is read, after a cancel', JSON.stringify(c6));

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

    // C8: the room path.
    const c8 = await page.evaluate(() => {
      const src = paintRoom.toString();
      return { calls: /convFollow\(box, 'pj:' \+ PJ_CURRENT\)/.test(src), button: !!document.getElementById('pj-conv') };
    });
    chk(c8.calls && c8.button, 'C8 the project room\'s painter calls convFollow and has its own toggle', JSON.stringify(c8));

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
