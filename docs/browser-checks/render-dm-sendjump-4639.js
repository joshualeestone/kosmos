// Browser-check-surface: d-dmthread d-say d-send
'use strict';

/**
 * #4639 (Josh 2026-09-29, "like Discord"), the Direct Message half; the room half is arm 4b of
 * render-room-scroll.js.
 *
 *   J1  CONTROL: the person is really scrolled back, reading
 *   J2  an agent's message arriving while they read back does not move them (the existing rule)
 *   J3  the person's OWN send takes them to the bottom, showing it
 *   J4  after that, the agent's next message keeps them at the bottom
 *   J5  with a search filtering the thread, their send does not move them
 *   J6  someone who scrolls up while a slow send is in flight is not pulled back when it lands
 *   J7  with no "Sending" bubble drawn (the thread's last read gone), the reply's repaint still ends with their message in view
 *
 * Harness: loaded over file:// with fetch answered here (render-dm-reply-4256.js's posture), so the
 * DM goes through the real paintTalk and the real sendTalk.
 *
 *   NODE_PATH=~/work/pw-runtime/node_modules node docs/browser-checks/render-dm-sendjump-4639.js
 */
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts
const path = require('node:path');
const { chromium } = require('playwright');

const PAGE = 'file://' + path.join(path.resolve(__dirname, '..', '..'), 'web', 'index.html');
const fail = [];
let ran = 0;
function chk(ok, label, extra) {
  ran++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

const T0 = Date.parse('2026-09-29T14:00:00Z');
const at = (i) => new Date(T0 + i * 60000).toISOString();
const agentRow = (i, text) => ({ from: 'april', at: at(i), text });
const youRow = (i, text) => ({ at: at(i), text, delivery: { state: 'placed', paneState: 'idle' } });

(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await page.addInitScript(() => {
      window.setInterval = () => 0;   // no polls: the check paints when it chooses
      const enc = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
      window.fetch = async (url, init) => {
        const u = String(url);
        if (u.includes('/thread') && init && init.method === 'POST') {
          const body = JSON.parse(init.body || '{}');
          if (window.__slowPost) await new Promise((r) => setTimeout(r, window.__slowPost));
          window.__fx = { messages: window.__fx.messages.concat([{ at: new Date().toISOString(), text: body.text,
            delivery: { state: 'placed', paneState: 'idle' } }]) };
          return enc({ delivery: { state: 'placed', at: new Date().toISOString() }, recorded: true });
        }
        if (u.includes('/thread')) return enc(window.__fx);
        return enc({});
      };
    });
    await page.goto(PAGE);

    const rows = [];
    for (let i = 1; i <= 40; i++) {
      rows.push(i % 3 ? agentRow(i, 'Agent message ' + i + ', long enough to take a line or two in the thread on screen.')
        : youRow(i, 'My message ' + i));
    }
    await page.evaluate((msgs) => {
      window.__fx = { messages: msgs, olderCount: 0 };
      for (const k of Object.keys(TALK_PENDING)) delete TALK_PENDING[k];
      CURRENT = { sessionName: 'april', name: 'April' };
      LAST = [{ sessionName: 'april', name: 'April', state: 'idle' }];
      document.getElementById('panel-detail').hidden = false;
      const fr = document.getElementById('firstrun'); if (fr) fr.hidden = true;
      document.querySelectorAll('body > *').forEach((el) => { el.inert = false; });
    }, rows);
    await page.evaluate(() => paintTalk('april', 'April'));

    const pos = () => page.evaluate(() => {
      const el = document.getElementById('d-dmthread');
      return { top: el.scrollTop, gap: el.scrollHeight - el.scrollTop - el.clientHeight };
    });
    const agentSays = (text) => page.evaluate(async (t) => {
      window.__fx = { messages: window.__fx.messages.concat([{ from: 'april', at: new Date().toISOString(), text: t }]) };
      await paintTalk('april', 'April');
    }, text);

    // J1
    await page.evaluate(() => { const el = document.getElementById('d-dmthread'); el.scrollTop = Math.floor(el.scrollHeight * 0.35); });
    const up = await pos();
    chk(up.gap > 200, 'J1 CONTROL: the person is really scrolled back', up.gap + 'px above the floor');

    // J2
    await agentSays('Agent reply 4639-a while they read back');
    const arrived = await page.evaluate(() => document.getElementById('d-dmthread').innerText.includes('4639-a'));
    const afterAgent = await pos();
    chk(arrived && Math.abs(afterAgent.top - up.top) <= 4, 'J2 an agent message arriving while they read back does not move them',
      JSON.stringify({ arrived, was: up.top, now: afterAgent.top }));

    // J3
    await page.fill('#d-say', 'My own message 4639-b sent while reading back');
    await page.click('#d-send');
    await page.waitForFunction(() => document.getElementById('d-dmthread').innerText.includes('4639-b'), null, { timeout: 5000 });
    await page.waitForTimeout(400);
    const afterSend = await pos();
    const ownVisible = await page.evaluate(() => {
      const el = document.getElementById('d-dmthread');
      const row = [...el.querySelectorAll('.msg.you')].reverse().find((r) => r.textContent.includes('4639-b'));
      if (!row) return false;
      const a = row.getBoundingClientRect(), b = el.getBoundingClientRect();
      return a.top >= b.top - 1 && a.bottom <= b.bottom + 1;
    });
    chk(afterSend.gap <= 8 && ownVisible, 'J3 their own send takes them to the bottom, showing it', JSON.stringify({ afterSend, ownVisible }));

    // J4
    await agentSays('Agent reply 4639-c after they sent');
    const afterNext = await pos();
    chk(afterNext.gap <= 8, 'J4 after their send, the agent\'s next message keeps them at the bottom', afterNext.gap + 'px above the floor');

    // J5
    await page.fill('#d-talk-search', 'Agent message');
    await page.waitForFunction(() => TALK_QUERY === 'Agent message', null, { timeout: 5000 });
    await page.evaluate(() => { const el = document.getElementById('d-dmthread'); el.scrollTop = Math.floor(el.scrollHeight * 0.35); });
    const filteredUp = await pos();
    await page.fill('#d-say', 'My filtered message 4639-e');
    await page.click('#d-send');
    await page.waitForFunction(() => !TALK_SENDING, null, { timeout: 5000 });
    const afterFiltered = await pos();
    await page.fill('#d-talk-search', '');
    await page.waitForFunction(() => TALK_QUERY === '', null, { timeout: 5000 });
    chk(filteredUp.gap > 200 && Math.abs(afterFiltered.top - filteredUp.top) <= 4,
      'J5 with a search filtering the thread, their send does not move them', JSON.stringify({ filteredUp, afterFiltered }));

    // J6
    await page.evaluate(() => { window.__slowPost = 2500; });
    await page.fill('#d-say', 'My slow message 4639-f');
    await page.click('#d-send');
    await page.waitForTimeout(300);
    await page.evaluate(() => { const el = document.getElementById('d-dmthread'); el.scrollTop = Math.floor(el.scrollHeight * 0.35); });
    const scrolledMid = await pos();
    await page.waitForFunction(() => !TALK_SENDING, null, { timeout: 8000 });
    await page.evaluate(() => { window.__slowPost = 0; });
    const afterSlow = await pos();
    chk(scrolledMid.gap > 200 && Math.abs(afterSlow.top - scrolledMid.top) <= 4,
      'J6 someone who scrolls up while a slow send is in flight is not pulled back when it lands', JSON.stringify({ scrolledMid, afterSlow }));

    // J7
    await page.evaluate(() => {
      const el = document.getElementById('d-dmthread');
      delete el.__lastBody;   // talkPaintPending has nothing to draw into, so no "Sending" bubble
      el.scrollTop = Math.floor(el.scrollHeight * 0.35);
    });
    const firstUp = await pos();
    await page.fill('#d-say', 'My first-open message 4639-g');
    await page.click('#d-send');
    await page.waitForFunction(() => !TALK_SENDING, null, { timeout: 5000 });
    await page.waitForTimeout(200);
    const afterFirst = await pos();
    const firstVisible = await page.evaluate(() => {
      const el = document.getElementById('d-dmthread');
      const row = [...el.querySelectorAll('.msg.you')].reverse().find((r) => r.textContent.includes('4639-g'));
      if (!row) return false;
      const a = row.getBoundingClientRect(), b = el.getBoundingClientRect();
      return a.top >= b.top - 1 && a.bottom <= b.bottom + 1;
    });
    chk(firstUp.gap > 200 && afterFirst.gap <= 8 && firstVisible,
      'J7 with no "Sending" bubble drawn, the reply\'s repaint still ends with their message in view', JSON.stringify({ firstUp, afterFirst, firstVisible }));

    chk(errs.length === 0, 'no page errors', errs.join(' | '));
  } catch (e) {
    chk(false, 'the check itself', String((e && e.message) || e));
  } finally {
    await browser.close().catch(() => {});
  }
  if (ran < 8) { console.log('dm-sendjump: only ' + ran + ' checks ran, so this proved nothing'); process.exit(1); }
  if (fail.length) { console.log('dm-sendjump: ' + fail.length + ' FAILED'); process.exit(1); }
  console.log('dm-sendjump: all good, ' + ran + ' checks');
})();
