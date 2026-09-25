// Browser-check-surface: msg msg-bd data-unread data-mid d-dmthread pj-room asp-th asp-m
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
const EDGE_LIGHT = 'rgb(214, 166, 46)';   // --gold, #d6a62e (#3743 follow-up, 18:16: noticeable)

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
    chk(u1[3] && u1[3].edge.includes(EDGE_LIGHT) && !u1[0].edge.includes(EDGE_LIGHT), 'U1 the edge is the brand gold #d6a62e, inside the bubble', JSON.stringify([u1[0] && u1[0].edge, u1[3] && u1[3].edge]));
    if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, 'unread-dm-before-read.png') }); }

    // U2: on screen with the window in front, the edge goes after a moment, and it fades rather than snapping.
    const tr = await page.evaluate(() => getComputedStyle(document.querySelectorAll('#d-dmthread .msg:not(.you) .msg-bd')[0]).transitionDuration);
    chk(/1\.2s/.test(tr), 'U2 a read edge fades (a 1.2s transition), not a snap', tr);
    await page.waitForTimeout(2600);
    const u2 = await dmState();
    chk(u2.length === 4 && u2.every((r) => !r.unread), 'U2 once on screen a moment, the edge goes', JSON.stringify(u2.map((r) => r.unread)));
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
    const u4b = await dmState();
    chk(u4b.length === 6 && u4b.every((r) => !r.unread), 'U4 and coming back to the window starts the clock: it goes');

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

    // U8: a message taller than the window is read a screenful at a time: it still loses its edge.
    await page.evaluate(() => { document.getElementById('panel-detail').hidden = false; const pr = document.getElementById('panel-projects'); if (pr) pr.hidden = true; });
    await page.evaluate(() => { window.__fx = { messages: window.__fx.messages.concat([{ from: 'april', at: '2026-09-25T09:12:00Z', text: Array.from({ length: 200 }, (_, i) => 'A long report, line ' + (i + 1) + '.').join('\n') }]) }; });
    await page.evaluate(() => paintTalk('april', 'April'));
    const tall = await page.evaluate(() => { const b = [...document.querySelectorAll('#d-dmthread .msg:not(.you) .msg-bd')].pop(); return { h: Math.round(b.getBoundingClientRect().height), vh: innerHeight, unread: b.hasAttribute('data-unread') }; });
    await page.evaluate(() => { const b = [...document.querySelectorAll('#d-dmthread .msg:not(.you) .msg-bd')].pop(); b.scrollIntoView({ block: 'start' }); });
    await page.waitForTimeout(2600);
    const tallAfter = await page.evaluate(() => [...document.querySelectorAll('#d-dmthread .msg:not(.you) .msg-bd')].pop().hasAttribute('data-unread'));
    chk(tall.h > 2 * tall.vh && tall.unread && !tallAfter, 'U8 a message taller than twice the window arrives with the edge and loses it once read', JSON.stringify({ ...tall, after: tallAfter }));

    // U12: the moment on screen is continuous: leaving the window inside it starts it again on the way back.
    const add = (t, text) => page.evaluate(([at, tx]) => { window.__fx = { messages: window.__fx.messages.concat([{ from: 'april', at, text: tx }]) }; return paintTalk('april', 'April'); }, [t, text]);
    await add('2026-09-25T09:13:00Z', 'April line 12');
    await page.evaluate(() => [...document.querySelectorAll('#d-dmthread .msg:not(.you) .msg-bd')].pop().scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(700);
    await page.evaluate(() => { Object.defineProperty(document, 'hasFocus', { value: () => false, configurable: true }); window.dispatchEvent(new Event('blur')); });
    await page.waitForTimeout(200);
    await page.evaluate(() => { delete document.hasFocus; window.dispatchEvent(new Event('focus')); });
    await page.waitForTimeout(500);   // 1.4s since it arrived, 0.5s since the window came back
    const u12a = await page.evaluate(() => [...document.querySelectorAll('#d-dmthread .msg:not(.you) .msg-bd')].pop().hasAttribute('data-unread'));
    await page.waitForTimeout(1300);
    const u12b = await page.evaluate(() => [...document.querySelectorAll('#d-dmthread .msg:not(.you) .msg-bd')].pop().hasAttribute('data-unread'));
    chk(u12a === true && u12b === false, 'U12 leaving the window inside the moment starts it again: still edged 0.5s after coming back, gone after 1.2s', JSON.stringify({ u12a, u12b }));

    // U13: a message far taller than the window, read by scrolling down it a little at a time, still loses its edge.
    await add('2026-09-25T09:14:00Z', Array.from({ length: 1200 }, (_, i) => 'A very long report, line ' + (i + 1) + '.').join('\n'));
    /* The thread scrolls inside its own box. Put the new message's first 10px at that box's bottom, then read down it
       60px at a time: no ratio threshold is crossed on the way (it is over twenty boxes tall). */
    const huge = await page.evaluate(() => {
      const b = [...document.querySelectorAll('#d-dmthread .msg:not(.you) .msg-bd')].pop();
      let sc = b.parentElement; while (sc && !(sc.scrollHeight > sc.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(sc).overflowY))) sc = sc.parentElement;
      if (!sc) return { scroller: false };
      window.__sc = sc;
      const box = sc.getBoundingClientRect(), r = b.getBoundingClientRect();
      sc.scrollTop += (r.top - box.bottom) + 10;
      return { scroller: true, h: Math.round(r.height), box: Math.round(box.height), onScreen: Math.round(box.bottom - b.getBoundingClientRect().top) };
    });
    await page.waitForTimeout(400);
    const before13 = await page.evaluate(() => [...document.querySelectorAll('#d-dmthread .msg:not(.you) .msg-bd')].pop().hasAttribute('data-unread'));
    for (let i = 0; i < 6; i++) { await page.evaluate(() => { window.__sc.scrollTop += 60; }); await page.waitForTimeout(120); }
    await page.waitForTimeout(1600);
    const u13 = await page.evaluate(() => [...document.querySelectorAll('#d-dmthread .msg:not(.you) .msg-bd')].pop().hasAttribute('data-unread'));
    chk(huge.scroller && huge.h > 20 * huge.box && huge.onScreen <= 20 && before13 && u13 === false, 'U13 a message over twenty thread-heights tall, read down a little at a time, loses its edge', JSON.stringify({ ...huge, before13, stillUnread: u13 }));

    // U14: the edge in the dark looks: the gold at half strength, forced dark and Kosmos+ navy.
    const edgeIn = (setup) => page.evaluate((how) => {
      if (how === 'dark') document.documentElement.setAttribute('data-theme', 'dark'); else document.body.classList.add('plus-active');
      const b = document.createElement('div'); b.className = 'msg'; b.innerHTML = '<div class="msg-b"><div class="msg-bd" data-unread>x</div></div>';
      document.getElementById('d-dmthread').appendChild(b);
      const v = getComputedStyle(b.querySelector('.msg-bd')).boxShadow; b.remove();
      document.documentElement.removeAttribute('data-theme'); document.body.classList.remove('plus-active');
      return v;
    }, setup);
    const dark14 = await edgeIn('dark'), navy14 = await edgeIn('navy');
    chk(/rgba\(227, 179, 65, 0\.5\)/.test(dark14) && /rgba\(227, 179, 65, 0\.5\)/.test(navy14), 'U14 in dark and on Kosmos+ navy the edge is the gold at half strength', JSON.stringify({ dark14, navy14 }));

    // U9: a room whose first read did not answer (ok false, no rows) does not make its history look new on the next.
    const u9 = await page.evaluate((body) => {
      document.getElementById('panel-detail').hidden = true;
      const pr = document.getElementById('panel-projects'); if (pr) pr.hidden = false;
      PROJECTS.push({ id: 'p2', name: 'Other', unread: 0, agents: [{ sessionName: 'april', name: 'April' }] });
      PJ_CURRENT = 'p2';
      pjMarkSeen('p2');
      paintRoom({ ok: false, rows: [] });
      paintRoom(body);
      return [...document.querySelectorAll('#pj-room .msg:not(.you)')].map((r) => r.querySelector('.msg-bd').hasAttribute('data-unread'));
    }, room);
    chk(u9.length === 5 && u9.every((x) => !x), 'U9 after a room read that did not answer, the next one shows history without the edge', JSON.stringify(u9));

    // U10: a count read before its /seen landed does not bring the edge back to a post already read.
    await page.evaluate(() => { PJ_CURRENT = 'p1'; });
    await page.evaluate((body) => paintRoom(body), room);
    // Read one at a time into view: the room scrolls with its column, not inside #pj-room.
    for (let i = 0; i < 5; i++) {
      await page.evaluate((k) => { const b = document.querySelectorAll('#pj-room .msg:not(.you) .msg-bd')[k]; if (b) b.scrollIntoView({ block: 'center' }); }, i);
      await page.waitForTimeout(1500);
    }
    await page.waitForTimeout(1300);
    const read10 = await page.evaluate(() => [...document.querySelectorAll('#pj-room .msg:not(.you) .msg-bd')].map((b) => b.hasAttribute('data-unread')));
    const u10 = await page.evaluate((body) => {
      pjById('p1').unread = 1;   // a poll computed before the /seen landed
      pjMarkSeen('p1');
      paintRoom({ ...body, rows: body.rows.concat([{ id: 'r7', kind: 'post', operator: true, at: '2026-09-25T09:20:00Z', text: 'My next post' }]) });
      return [...document.querySelectorAll('#pj-room .msg:not(.you) .msg-bd')].map((b) => b.hasAttribute('data-unread'));
    }, room);
    chk(read10.length === 5 && read10.every((x) => !x), 'U10 precondition: the room\'s unread posts were read', JSON.stringify(read10));
    chk(u10.length === 5 && u10.every((x) => !x), 'U10 a stale count does not bring the edge back to a post already read', JSON.stringify(u10));

    // U11: what a thread remembers is bounded by what it shows: a post that leaves the thread leaves its sets.
    const u11 = await page.evaluate((body) => {
      paintRoom({ ...body, rows: body.rows.slice(1) });
      const st = UNREAD_EDGE.get('pj:p1');
      return { known: st.known.size, read: st.read.size, shown: document.querySelectorAll('#pj-room .msg:not(.you) .msg-bd').length, hasR1: st.known.has('r1') || st.read.has('r1') };
    }, room);
    chk(u11.shown === 4 && u11.known === 4 && !u11.hasR1, 'U11 the thread\'s sets hold only the posts it shows', JSON.stringify(u11));

    // U15: the setup assistant's chat. Replies that came while it was folded arrive with the edge (by id: the poll's
    // asbNoteReplies records the replies at its first read, folded, and marks any other new when it is open), history does not, a reply landing while it is open gets it, each goes once read, and the
    // hosted assistant's words (typed back in this page) never do. Painted through the real asbPaintThread.
    const asbState = () => page.evaluate(() => [...document.querySelectorAll('#asp-th .asp-m.him[data-mid]')].map((d) => ({ id: d.dataset.mid, unread: d.hasAttribute('data-unread'), edge: getComputedStyle(d).boxShadow })));
    const gRows = [{ id: 'g1', from: 'guide', text: 'Hello, I can help.' }, { id: 'y1', from: 'you', text: 'Make me an agent' }, { id: 'g2', from: 'guide', text: 'Done, meet April.' }];
    await page.evaluate((rows) => {
      document.getElementById('panel-projects').hidden = true;
      asbLayerEnsure();
      document.getElementById('asp').hidden = false;
      ASB.replyIds = null;
      asbNoteReplies('guide', rows.slice(0, 1), false);   // the folded first read: g1 is history
      asbNoteReplies('guide', rows, true);                // opened: g2 came while folded
      ASB.shown = '';
      asbPaintThread(rows, 'guide');
    }, gRows);
    const u15a = await asbState();
    chk(u15a.length === 2 && !u15a[0].unread && u15a[1].unread && u15a[1].edge.includes(EDGE_LIGHT), 'U15 the assistant\'s reply that came while folded has the edge; its history does not', JSON.stringify(u15a));
    await page.waitForTimeout(2600);
    const u15b = await asbState();
    chk(u15b.length === 2 && u15b.every((r) => !r.unread), 'U15 once on screen a moment, it goes', JSON.stringify(u15b));
    await page.evaluate((rows) => asbPaintThread(rows.concat([{ id: 'g3', from: 'guide', text: 'Anything else?' }]), 'guide'), gRows);
    const u15c = await asbState();
    chk(u15c.length === 3 && !u15c[0].unread && !u15c[1].unread && u15c[2].unread, 'U15 a reply landing while it is open gets the edge, and the read ones keep theirs off', JSON.stringify(u15c));
    await page.waitForTimeout(2600);
    chk((await asbState()).every((r) => !r.unread), 'U15 and it goes once read');
    const u15h = await page.evaluate(() => {
      unreadEdgeBacklog('asb:hosted', 2); ASB.shown = '';
      asbPaintThread([{ id: 'h1', from: 'hosted', text: 'Hi' }, { id: 'h2', from: 'hosted', text: 'Ask me anything' }], 'hosted');
      return document.querySelectorAll('#asp-th [data-unread]').length;
    });
    chk(u15h === 0, 'U15 the hosted assistant\'s words never carry it (CONTROL for the arms above: the same backlog, no edge)', 'edged=' + u15h);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'unread-asb.png') });
    // U16: a guide forgotten and a new one made under the same name: the new one's thread is its own history, not new.
    // CONTROL: without the forget, the same ids painted again under the same name are known, so this reads a real reset.
    const u16 = await page.evaluate(() => {
      ASB.guide = { sessionName: 'guide' };
      asbForgetGuide();
      document.getElementById('asp').hidden = false;
      const rows = [{ id: 'n1', from: 'guide', text: 'Hi, I am new.' }, { id: 'n2', from: 'guide', text: 'Shall we start?' }];
      asbNoteReplies('guide', rows, true);   // the new guide's first read, open: a baseline, nothing new
      ASB.shown = '';
      asbPaintThread(rows, 'guide');
      return { left: [...UNREAD_EDGE.keys()].filter((k) => k.startsWith('asb:') && k !== 'asb:guide').length, edged: document.querySelectorAll('#asp-th [data-unread]').length };
    });
    chk(u16.edged === 0 && u16.left === 0, 'U16 a new guide under the same name shows its history without the edge', JSON.stringify(u16));

    chk(errs.length === 0, 'U7 no page errors', errs.join(' | '));
  } finally {
    await browser.close();
  }
  if (fail.length) { console.log('\n' + fail.length + ' FAILED'); process.exit(1); }
  console.log('\nall unread-edge checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
