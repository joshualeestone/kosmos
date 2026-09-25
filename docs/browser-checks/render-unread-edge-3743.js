// Browser-check-surface: msg msg-bd data-unread data-mid unread-edge d-dmthread pj-room
'use strict';

/**
 * The unread edge (#3743, Josh 2026-09-25 09:15): "the stroke would be cool for an unread message and then as you
 * read it it fades away".
 *
 * An agent message the person has not read carries a thin gold edge, and it fades once the message has been on
 * screen a moment with the window in front. Unread is the app's own count as the thread opens (a DM's dmUnread, a
 * project's unread) plus any agent message that lands while it is open. History never shows it.
 *
 * Harness: loaded over file:// with fetch answered here (render-agentdm-3414.js's posture), so the DM goes through
 * the real paintTalk and the room through the real pjMarkSeen and paintRoom.
 *
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-unread-edge-3743.js [shots-dir]
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
const EDGE_LIGHT = 'rgb(245, 228, 188)';

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await page.addInitScript(() => {
      window.setInterval = () => 0;   // no polls: the check paints when it chooses
      const enc = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
      window.fetch = async (url) => {
        const u = String(url);
        if (u.includes('/thread')) return enc(window.__fx);
        return enc({});
      };
    });
    await page.goto(PAGE);
    await page.bringToFront();
    const t0 = Date.parse('2026-09-25T09:00:00Z');
    /* The person's own row has no `from` and carries its delivery (render-agentdm-3414.js's fixture shape). */
    const row = (i, from) => (from === 'april' ? { from, at: new Date(t0 + i * 60000).toISOString(), text: 'April line ' + i }
      : { at: new Date(t0 + i * 60000).toISOString(), text: 'My line ' + i, delivery: { state: 'placed', paneState: 'idle' } });
    const fx = { messages: [row(1, 'april'), row(2, 'you'), row(3, 'april'), row(4, 'april'), row(5, 'april')] };
    await page.evaluate((f) => {
      window.__fx = f;
      CURRENT = { sessionName: 'april', name: 'April' };
      LAST = [{ sessionName: 'april', name: 'April', state: 'idle', dmUnread: 2 }];
      document.getElementById('panel-detail').hidden = false;
      const fr = document.getElementById('firstrun'); if (fr) fr.hidden = true;
      document.querySelectorAll('body > *').forEach((el) => { el.inert = false; });
    }, fx);
    const dmState = () => page.evaluate(() => [...document.querySelectorAll('#d-dmthread .msg:not(.you)')].map((r) => ({
      text: (r.querySelector('.msg-bd p') || r.querySelector('.msg-bd')).textContent.replace(/\s+/g, ' ').trim().replace(/ \d.*$/, ''),
      unread: r.querySelector('.msg-bd').hasAttribute('data-unread'),
      edge: getComputedStyle(r.querySelector('.msg-bd')).boxShadow })));

    // U1: opening a DM with two unread: the newest two agent messages carry the edge, the older ones do not.
    // Measured at once, before any of them could have been read.
    await page.evaluate(() => paintTalk('april', 'April'));
    const u1 = await dmState();
    const flags = u1.map((r) => r.unread);
    chk(u1.length === 4 && JSON.stringify(flags) === JSON.stringify([false, false, true, true]), 'U1 the two unread agent messages have the edge; history does not', JSON.stringify(flags));
    chk(u1[3] && u1[3].edge.includes(EDGE_LIGHT) && !u1[0].edge.includes(EDGE_LIGHT), 'U1 the edge is the gold #f5e4bc, inside the bubble', JSON.stringify([u1[0] && u1[0].edge, u1[3] && u1[3].edge]));
    if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, 'unread-dm-before-read.png') }); }

    // U2: on screen with the window in front, the edge goes after a moment, and it fades rather than snapping.
    const tr = await page.evaluate(() => getComputedStyle(document.querySelectorAll('#d-dmthread .msg:not(.you) .msg-bd')[0]).transitionDuration);
    chk(/1\.2s/.test(tr), 'U2 a read edge fades (a 1.2s transition), not a snap', tr);
    await page.waitForTimeout(2600);
    const u2 = await dmState();
    chk(u2.every((r) => !r.unread), 'U2 once on screen a moment, the edge goes', JSON.stringify(u2.map((r) => r.unread)));
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'unread-dm-after-read.png') });

    // U3: a repaint does not bring back what was read, and a message that lands while open arrives with the edge.
    await page.evaluate(() => { window.__fx = { messages: window.__fx.messages.concat([{ from: 'april', at: '2026-09-25T09:10:00Z', text: 'April line 6' }]) }; });
    await page.evaluate(() => paintTalk('april', 'April'));
    const u3 = await dmState();
    chk(JSON.stringify(u3.map((r) => r.unread)) === JSON.stringify([false, false, false, false, true]), 'U3 a message that lands while open has the edge; the ones already read do not come back', JSON.stringify(u3.map((r) => r.unread)));

    // U4: not while the window is behind another (CONTROL for U2: the same message, same wait, stays unread).
    await page.evaluate(() => { Object.defineProperty(document, 'hasFocus', { value: () => false, configurable: true }); });
    await page.evaluate(() => { window.__fx = { messages: window.__fx.messages.concat([{ from: 'april', at: '2026-09-25T09:11:00Z', text: 'April line 7' }]) }; });
    await page.evaluate(() => paintTalk('april', 'April'));
    await page.waitForTimeout(2600);
    const u4 = await dmState();
    chk(u4[u4.length - 1].unread === true, 'U4 with the window behind another, a new message keeps its edge', JSON.stringify(u4.map((r) => r.unread)));
    await page.evaluate(() => { delete document.hasFocus; window.dispatchEvent(new Event('focus')); });
    await page.waitForTimeout(2600);
    chk((await dmState()).every((r) => !r.unread), 'U4 and coming back to the window starts the clock: it goes');

    // U5: reduced motion drops the edge without the fade.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const tr5 = await page.evaluate(() => getComputedStyle(document.querySelector('#d-dmthread .msg:not(.you) .msg-bd')).transitionDuration);
    chk(tr5 === '0s', 'U5 with reduced motion there is no fade', tr5);
    await page.emulateMedia({ reducedMotion: 'no-preference' });

    // U6: the project room, through pjMarkSeen and paintRoom: three unread, the newest three agent posts have it.
    const rrow = (i, from) => ({ id: 'r' + i, kind: 'post', from: from === 'you' ? undefined : from, operator: from === 'you', at: new Date(t0 + i * 60000).toISOString(), text: 'Room line ' + i });
    const room = { rows: [rrow(1, 'april'), rrow(2, 'bo'), rrow(3, 'you'), rrow(4, 'april'), rrow(5, 'bo'), rrow(6, 'april')] };
    const u6 = await page.evaluate((body) => {
      PROJECTS = [{ id: 'p1', name: 'Room', unread: 3, agents: [{ sessionName: 'april', name: 'April' }, { sessionName: 'bo', name: 'Bo' }] }];
      PJ_CURRENT = 'p1';
      document.getElementById('panel-detail').hidden = true;
      const pr = document.getElementById('panel-projects'); if (pr) pr.hidden = false;
      const one = document.getElementById('pj-one-view'); if (one) one.hidden = false;
      pjMarkSeen('p1');
      paintRoom(body);
      return [...document.querySelectorAll('#pj-room .msg:not(.you)')].map((r) => r.querySelector('.msg-bd').hasAttribute('data-unread'));
    }, room);
    chk(JSON.stringify(u6) === JSON.stringify([false, false, true, true, true]), 'U6 a project room opened with three unread: the newest three agent posts have the edge', JSON.stringify(u6));

    chk(errs.length === 0, 'U7 no page errors', errs.join(' | '));
  } finally {
    await browser.close();
  }
  if (fail.length) { console.log('\n' + fail.length + ' FAILED'); process.exit(1); }
  console.log('\nall unread-edge checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
