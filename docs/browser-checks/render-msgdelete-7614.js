// Browser-check-surface: pj-room d-dmthread rxns rxn-quick rxn-dots msg-menu msg-menu-del msgdel-modal msgdel-title msgdel-small msgdel-keep msgdel-go msgdel-msg msg-toast
'use strict';
/* kosmos#7614 (Josh): a compact bar with "..." on room and direct messages, and Delete message for the person's own.
 * In the real page (web/index.html from disk, fetch stubbed), at 1200x900 in Chromium:
 *
 *   D1  an agent's room post: "..." opens the menu with no Delete message
 *   D2  the person's own room post: "..." opens it with Delete message last
 *   D3  Delete message opens the dialog in the agreed words (the phone's too), Keep it focused
 *   D4  Keep it, and Escape, close it with nothing sent, focus back on "..."
 *   D5  a refusal shows in the dialog in a sentence, the dialog stays, Delete can be pressed again
 *   D6  Delete posts to the OPEN ROOM's route (PJ_CURRENT), never the webhooks pane's project, closes the dialog,
 *       names who was told, and asks the room to repaint
 *   D7  a direct message: the person's own row has "..." alone; its menu has Delete message; an agent's row has none
 *   D8  Delete posts {at} to the DM route, says "Deleted.", and the thread repaints without the message
 *   D9  a DM refusal (an earlier part was already given) shows in the dialog
 *
 * CONTROL: D6 runs with the webhooks pane open on ANOTHER project, so a page that read that pane's project fails it.
 *
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-msgdelete-7614.js
 */
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts
const path = require('node:path');
const { chromium } = require('playwright');

const PAGE = 'file://' + path.join(path.resolve(__dirname, '..', '..'), 'web', 'index.html');
const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}
const SMALL = 'It goes from this conversation for everyone. Agents who already read it still remember it, and Kosmos tells them you withdrew it.';
const A1 = '2026-10-30T13:00:01.000Z';
const OWN = '2026-10-30T13:00:02.000Z';
const A2 = '2026-10-30T13:00:03.000Z';
const FX = {
  messages: [
    { from: 'april', at: A1, text: 'Done with the login fix' },
    { at: OWN, text: 'great, ship it', delivery: { state: 'placed' } },
    { from: 'april', at: A2, text: 'Tests are green too' },
  ],
  olderCount: 0, historyBecause: null, historyUnfilable: false,
  presence: 'on', presenceBecause: null, asking: false, question: null, questionBecause: null, options: null,
};

const menuItems = () => { const m = document.getElementById('msg-menu');
  return m && !m.hidden ? [...m.querySelectorAll('.msg-menu-i:not([hidden])')].map((i) => i.textContent.trim()).join('|') : null; };

(async () => {
  let browser;
  try { browser = await chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch (err) {
    console.error('FAIL  render-msgdelete-7614: could not start a browser' + (process.env.HEADED === '0' ? '.' : ' (headed; try HEADED=0).'));
    console.error('  ' + (err && err.message ? err.message.split('\n')[0] : err));
    process.exit(1);
  }
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  await page.addInitScript(() => {
    window.__fx = null;
    window.__dels = [];
    window.__answer = { status: 200, body: { deleted: true, told: [] } };
    const enc = (o, status) => new Response(JSON.stringify(o), { status: status || 200, headers: { 'content-type': 'application/json' } });
    window.setInterval = () => 0;
    window.fetch = async (url, opts) => {
      const u = String(url);
      if (/\/delete$/.test(u)) {
        window.__dels.push({ url: u, method: opts && opts.method, body: opts && opts.body });
        return enc(window.__answer.body, window.__answer.status);
      }
      if (u.includes('/thread')) return enc(window.__fx);
      if (u.includes('/api/status')) return enc({ agents: [], version: '0.0.0' });
      return enc({});
    };
  });
  await page.goto(PAGE);

  try {
    // ---- the room ----
    await page.evaluate(() => {
      document.getElementById('panel-projects').hidden = false;
      const fr = document.getElementById('firstrun'); if (fr) fr.hidden = true;
      const bc = document.getElementById('boot-cover'); if (bc) bc.hidden = true;
      document.querySelectorAll('body > *').forEach((el) => { el.inert = false; });
      document.getElementById('pj-one-name').textContent = 'Kosmos Growth';
      const p = { id: 'p1', name: 'Kosmos Growth', agents: [{ sessionName: 'april', name: 'April' }] };
      const rows = [
        { kind: 'post', id: 'm530', from: 'april', to: [], project: 'p1', at: '2026-10-30T13:00:00Z', text: 'The AtlasGrid deck is ready for review.' },
        { kind: 'post', id: 'm531', operator: true, to: [], project: 'p1', at: '2026-10-30T13:01:00Z', text: 'Thanks, I will look tonight.' },
      ];
      PJ_ROOM_POSTS = new Map(rows.map((r) => [r.id, r])); PJ_CURRENT = 'p1'; PJ_ROOM_POSTS_OF = 'p1';
      LAST = [{ sessionName: 'april', name: 'April' }];   // the board poll's agent list, which names who was told
      PJS_HOOKS.projectId = 'p9';   // CONTROL: the webhooks pane is open on another project
      const room = document.getElementById('pj-room');
      const paint = () => { room.innerHTML = [...PJ_ROOM_POSTS.values()].map((m) => pjRoomRow(m, p, false)).join(''); };
      paint();
      /* The repaint after a delete is loadRoom's (a room read this file does not stub); recorded, and done from the posts the
         server would now hold, so what is measured is that the page asks for it. */
      window.__roomLoads = 0;
      window.loadRoom = async () => { window.__roomLoads++; PJ_ROOM_POSTS.delete('m531'); paint(); };
      for (let el = room; el && el !== document.body; el = el.parentElement) {
        if (el.hidden) el.hidden = false;
        if (getComputedStyle(el).display === 'none') el.style.display = 'block';
      }
      room.scrollIntoView();
    });
    const agentPost = page.locator('#pj-room .msg[data-mid="m530"]');
    const ownPost = page.locator('#pj-room .msg[data-mid="m531"]');

    await agentPost.hover(); await agentPost.locator('.rxn-dots').click(); await page.waitForTimeout(100);
    const d1 = await page.evaluate(menuItems);
    chk(d1 === 'Copy message|Copy message id', 'D1 an agent\'s room post: "..." opens the menu with no Delete message', d1);
    await page.keyboard.press('Escape'); await page.waitForTimeout(100);

    const own = await ownPost.evaluate((r) => r.getAttribute('data-own'));
    await ownPost.hover(); await ownPost.locator('.rxn-dots').click(); await page.waitForTimeout(100);
    const d2 = await page.evaluate(menuItems);
    chk(own === '1' && d2 === 'Copy message|Copy message id|Delete message', 'D2 the person\'s own room post: "..." opens the menu with Delete message last', JSON.stringify({ own, d2 }));

    await page.click('#msg-menu-del'); await page.waitForTimeout(100);
    const d3 = await page.evaluate(() => ({ open: !document.getElementById('msgdel-modal').hidden, menu: !document.getElementById('msg-menu').hidden,
      title: document.getElementById('msgdel-title').textContent, small: document.getElementById('msgdel-small').textContent,
      keep: document.getElementById('msgdel-keep').textContent, go: document.getElementById('msgdel-go').textContent,
      focus: document.activeElement && document.activeElement.id }));
    chk(d3.open && !d3.menu && d3.title === 'Delete this message?' && d3.small === SMALL && d3.keep === 'Keep it' && d3.go === 'Delete' && d3.focus === 'msgdel-keep',
      'D3 Delete message opens the dialog in the agreed words, the menu closed, Keep it focused', JSON.stringify(d3));

    await page.click('#msgdel-keep'); await page.waitForTimeout(100);
    const d4a = await page.evaluate(() => ({ open: !document.getElementById('msgdel-modal').hidden, sent: window.__dels.length,
      focus: document.activeElement && document.activeElement.className, row: !!document.querySelector('#pj-room .msg[data-mid="m531"] .rxn-dots') && document.activeElement === document.querySelector('#pj-room .msg[data-mid="m531"] .rxn-dots') }));
    chk(!d4a.open && d4a.sent === 0 && d4a.row, 'D4 Keep it closes the dialog, sends nothing, and puts focus back on that post\'s "..."', JSON.stringify(d4a));
    await ownPost.hover(); await ownPost.locator('.rxn-dots').click(); await page.click('#msg-menu-del'); await page.waitForTimeout(100);
    await page.keyboard.press('Escape'); await page.waitForTimeout(100);
    const d4b = await page.evaluate(() => ({ open: !document.getElementById('msgdel-modal').hidden, sent: window.__dels.length }));
    chk(!d4b.open && d4b.sent === 0, 'D4 Escape closes it too, with nothing sent', JSON.stringify(d4b));

    await page.evaluate(() => { window.__answer = { status: 403, body: { error: 'that message is not yours to delete' } }; });
    await ownPost.hover(); await ownPost.locator('.rxn-dots').click(); await page.click('#msg-menu-del'); await page.waitForTimeout(100);
    await page.click('#msgdel-go'); await page.waitForTimeout(200);
    const d5 = await page.evaluate(() => ({ open: !document.getElementById('msgdel-modal').hidden, say: document.getElementById('msgdel-msg').textContent,
      disabled: document.getElementById('msgdel-go').disabled, row: !!document.querySelector('#pj-room .msg[data-mid="m531"]'), loads: window.__roomLoads }));
    chk(d5.open && d5.say === 'That message is not yours to delete.' && !d5.disabled && d5.row && d5.loads === 0,
      'D5 a refusal shows in the dialog as a sentence, the dialog stays, Delete can be pressed again, the post stays', JSON.stringify(d5));

    await page.evaluate(() => { window.__dels = []; window.__answer = { status: 200, body: { deleted: true, told: ['april'] } }; });
    await page.click('#msgdel-go'); await page.waitForTimeout(250);
    const d6 = await page.evaluate(() => ({ open: !document.getElementById('msgdel-modal').hidden, dels: window.__dels,
      toast: (() => { const t = document.getElementById('msg-toast'); return t && !t.hidden ? t.textContent : null; })(),
      row: !!document.querySelector('#pj-room .msg[data-mid="m531"]'), loads: window.__roomLoads }));
    const sent = d6.dels[0] || {};
    chk(d6.dels.length === 1 && sent.url === '/api/project/p1/room/m531/delete' && sent.method === 'POST',
      'D6 Delete posts to the open room\'s route (p1, not the webhooks pane\'s p9)', JSON.stringify(d6.dels));
    chk(!d6.open && /Deleted\. Kosmos told April you withdrew it\./.test(d6.toast || '') && d6.loads === 1 && !d6.row,
      'D6 the dialog closes, the toast names who was told, and the room repaints without the post', JSON.stringify(d6));

    // ---- a direct message ----
    await page.evaluate((f) => {
      document.getElementById('panel-projects').hidden = true;
      window.__fx = f;
      window.__dels = [];
      window.__answer = { status: 409, body: { error: 'part of that message was already given to April, so it cannot be deleted' } };
      CURRENT = { sessionName: 'april', name: 'April' };
      document.getElementById('panel-detail').hidden = false;
    }, FX);
    await page.evaluate(() => paintTalk('april', 'April'));
    await page.waitForTimeout(200);
    const d7 = await page.evaluate((OWN) => {
      const you = [...document.querySelectorAll('#d-dmthread .msg.you')];
      const ownRow = you.find((r) => r.querySelector('.rxns[data-at="' + OWN + '"]'));
      const q = ownRow && ownRow.querySelector('.rxn-quick');
      return { own: ownRow ? ownRow.getAttribute('data-own') : null, kids: q ? [...q.children].map((k) => k.className.split(' ')[0]).join(',') : null };
    }, OWN);
    chk(d7.own === '1' && d7.kids === 'rxn-dots', 'D7 the person\'s own direct message carries a bar with "..." alone', JSON.stringify(d7));
    const agentDm = page.locator('#d-dmthread .msg:not(.you)').first();
    await agentDm.hover(); await agentDm.locator('.rxn-dots').click(); await page.waitForTimeout(100);
    const d7a = await page.evaluate(menuItems);
    chk(!!d7a && !/Delete message/.test(d7a), 'D7 an agent\'s direct message offers no Delete message', d7a);
    await page.keyboard.press('Escape'); await page.waitForTimeout(100);

    const ownDm = page.locator('#d-dmthread .msg.you[data-own="1"]').first();
    await ownDm.hover(); await ownDm.locator('.rxn-dots').click(); await page.waitForTimeout(100);
    const d7b = await page.evaluate(menuItems);
    chk(!!d7b && /Delete message$/.test(d7b), 'D7 the person\'s own direct message: the menu ends with Delete message', d7b);
    await page.click('#msg-menu-del'); await page.waitForTimeout(100);
    await page.click('#msgdel-go'); await page.waitForTimeout(200);
    const d9 = await page.evaluate(() => ({ open: !document.getElementById('msgdel-modal').hidden, say: document.getElementById('msgdel-msg').textContent, n: window.__dels.length }));
    chk(d9.open && d9.n === 1 && d9.say === 'Part of that message was already given to April, so it cannot be deleted.',
      'D9 a DM refusal (an earlier part already given) shows in the dialog', JSON.stringify(d9));

    await page.evaluate((OWN) => { window.__dels = []; window.__answer = { status: 200, body: { deleted: true, told: [] } };
      window.__fx = Object.assign({}, window.__fx, { messages: window.__fx.messages.filter((m) => m.at !== OWN) }); }, OWN);
    await page.click('#msgdel-go'); await page.waitForTimeout(300);
    const d8 = await page.evaluate((OWN) => ({ open: !document.getElementById('msgdel-modal').hidden, dels: window.__dels,
      toast: (() => { const t = document.getElementById('msg-toast'); return t && !t.hidden ? t.textContent : null; })(),
      gone: !document.querySelector('#d-dmthread .rxns[data-at="' + OWN + '"]'), agents: document.querySelectorAll('#d-dmthread .msg:not(.you)').length }), OWN);
    const dm = d8.dels[0] || {};
    chk(d8.dels.length === 1 && dm.url === '/api/agent/april/thread/delete' && dm.method === 'POST' && dm.body === JSON.stringify({ at: OWN }),
      'D8 Delete posts {at} to the direct-message route', JSON.stringify(d8.dels));
    chk(!d8.open && d8.toast === 'Deleted.' && d8.gone && d8.agents === 2, 'D8 the dialog closes, the toast says "Deleted.", and the thread repaints without that message only', JSON.stringify(d8));
  } catch (e) {
    chk(false, 'the run finished', e && e.message ? e.message.split('\n')[0] : String(e));
  }
  chk(errs.length === 0, 'no page errors', errs.join(' | '));
  await browser.close();
  console.log(fail.length ? fail.length + ' failed' : 'all passed');
  process.exit(fail.length ? 1 : 0);
})();
