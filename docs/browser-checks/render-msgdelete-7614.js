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
 *   D9  a DM refusal (a real 409: being sent again right now) shows in the dialog
 *   D12 on a phone (390px, touch): a tap opens the person's own bar, "..." alone at its right end; "..." opens the menu
 *       and closes the bar; Delete opens the dialog
 *   D11 the person's row from an earlier part of the conversation offers no Delete (the server keeps those as they were)
 *   D10 a message already gone (another tab deleted it, 404): the dialog closes, says so, and the thread repaints
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

/* The page's network, stubbed: deletes are recorded and answered with window.__answer; the thread read serves __fx. */
const STUBS = () => {
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
};

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
  await page.addInitScript(STUBS);
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
      window.__answer = { status: 409, body: { error: 'that message is being sent again right now, so wait a moment and try deleting it again' } };   // a real wording (engine/chat.js)
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
    chk(d9.open && d9.n === 1 && d9.say === 'That message is being sent again right now, so wait a moment and try deleting it again.',
      'D9 a DM refusal (being sent again right now, a real 409) shows in the dialog', JSON.stringify(d9));

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

    // D10: gone already (another tab deleted it): the dialog closes, says so, and the thread repaints without it.
    await page.evaluate(({ f, OWN }) => { window.__fx = f; window.__dels = []; window.__answer = { status: 404, body: { error: 'there is no message of yours at that time here', gone: true } }; }, { f: FX, OWN });
    await page.evaluate(() => paintTalk('april', 'April'));
    await page.waitForTimeout(200);
    const again = page.locator('#d-dmthread .msg.you[data-own="1"]').first();
    await again.hover(); await again.locator('.rxn-dots').click(); await page.waitForTimeout(100);
    await page.click('#msg-menu-del'); await page.waitForTimeout(100);
    await page.evaluate((OWN) => { window.__fx = Object.assign({}, window.__fx, { messages: window.__fx.messages.filter((m) => m.at !== OWN) }); }, OWN);
    await page.click('#msgdel-go'); await page.waitForTimeout(300);
    const d10 = await page.evaluate((OWN) => ({ open: !document.getElementById('msgdel-modal').hidden, n: window.__dels.length,
      toast: (() => { const t = document.getElementById('msg-toast'); return t && !t.hidden ? t.textContent : null; })(),
      gone: !document.querySelector('#d-dmthread .rxns[data-at="' + OWN + '"]') }), OWN);
    chk(!d10.open && d10.n === 1 && d10.toast === 'That message was already gone.' && d10.gone,
      'D10 a message already gone (404, gone): the dialog closes, says so, and the thread repaints without it', JSON.stringify(d10));
    // CONTROL (review 5): any other 404 (the agent was renamed, say) is not "already gone": its own sentence shows in the dialog.
    await page.evaluate((f) => { window.__fx = f; window.__answer = { status: 404, body: { error: 'there is no agent by that name' } }; }, FX);
    await page.evaluate(() => paintTalk('april', 'April')); await page.waitForTimeout(200);
    const again2 = page.locator('#d-dmthread .msg.you[data-own="1"]').first();
    await again2.hover(); await again2.locator('.rxn-dots').click(); await page.waitForTimeout(100);
    await page.click('#msg-menu-del'); await page.waitForTimeout(100);
    await page.click('#msgdel-go'); await page.waitForTimeout(250);
    const d10c = await page.evaluate(() => ({ open: !document.getElementById('msgdel-modal').hidden, say: document.getElementById('msgdel-msg').textContent }));
    chk(d10c.open && d10c.say === 'There is no agent by that name.', 'D10 control: a 404 that is not "gone" shows its own sentence and keeps the dialog', JSON.stringify(d10c));
    await page.click('#msgdel-keep'); await page.waitForTimeout(100);

    // D11: a row from an earlier part of the conversation (those files are kept as they were): no Delete offered.
    const EARLY = '2026-10-30T12:00:01.000Z';
    await page.evaluate(({ f, EARLY }) => {
      window.__fx = f;
      // The scroll-back route marks a rolled-over file's rows `earlierPart`; a row of the current file has no mark.
      Object.assign(EARLIER, { session: 'april', open: true, before: 0, rows: [
        { at: EARLY, text: 'from an earlier part', earlierPart: true },
        { at: '2026-10-30T12:30:01.000Z', text: 'scrolled back, same file' }] });
    }, { f: FX, EARLY });
    await page.evaluate(() => paintTalk('april', 'April'));
    await page.waitForTimeout(200);
    const d11 = await page.evaluate(({ EARLY, OWN }) => {
      const row = (at) => { const b = document.querySelector('#d-dmthread .rxns[data-at="' + at + '"]'); return b ? b.closest('.msg') : null; };
      const early = [...document.querySelectorAll('#d-dmthread .msg.you')].find((r) => /from an earlier part/.test(r.textContent));
      const same = [...document.querySelectorAll('#d-dmthread .msg.you')].find((r) => /scrolled back, same file/.test(r.textContent));
      return { earlyShown: !!early, earlyOwn: early ? early.getAttribute('data-own') : 'none', earlyBar: early ? !!early.querySelector('.rxn-dots') : null,
        sameOwn: same ? same.getAttribute('data-own') : 'none', tailOwn: row(OWN) ? row(OWN).getAttribute('data-own') : null };
    }, { EARLY, OWN });
    chk(d11.earlyShown && d11.earlyOwn === null && d11.earlyBar === false && d11.sameOwn === '1' && d11.tailOwn === '1',
      'D11 the person\'s row from a rolled-over file shows no "..." and no Delete; a scrolled-back row of the current file, and the newest, still have it', JSON.stringify(d11));
  } catch (e) {
    chk(false, 'the run finished', e && e.message ? e.message.split('\n')[0] : String(e));
  }
  // D12: on a phone (390px, touch): a tap on the person's own message opens its bar, "..." alone at the message's right
  // end; "..." opens the menu with Delete message and closes the bar (its menu takes over, as Copy did); Delete opens the
  // same dialog.
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const ph = await ctx.newPage();
    ph.on('pageerror', (e) => errs.push('pageerror (phone) ' + e.message));
    await ph.addInitScript(STUBS);
    await ph.goto(PAGE);
    await ph.evaluate((f) => {
      // Opened the way render-dm-tapreact-718 opens it (openDetail), so the phone's tap handler is the page's own.
      window.__fx = f;
      const fr = document.getElementById('firstrun'); if (fr) fr.hidden = true;
      document.querySelectorAll('body > *').forEach((el) => { el.inert = false; });
      LAST = [{ sessionName: 'april', name: 'April', status: 'working', isNamedOurs: true, nameDerived: true }];
      openDetail('april', 'talk');
    }, FX);
    await ph.evaluate(() => paintTalk('april', 'April'));
    await ph.waitForTimeout(250);
    const mine = ph.locator('#d-dmthread .msg.you[data-own="1"] .msg-bd').first();
    await mine.scrollIntoViewIfNeeded();
    await mine.tap(); await ph.waitForTimeout(250);
    const bar = await ph.evaluate(() => {
      const row = document.querySelector('#d-dmthread .msg.rxn-show');
      const q = row && row.querySelector('.rxn-quick'); const bd = row && row.querySelector('.msg-bd');
      if (!q || !bd) return { open: false };
      const a = q.getBoundingClientRect(), b = bd.getBoundingClientRect(), d = q.querySelector('.rxn-dots').getBoundingClientRect();
      return { open: true, you: row.classList.contains('you'), kids: [...q.children].filter((k) => k.getClientRects().length).map((k) => k.className.split(' ')[0]).join(','),
        atRight: a.left >= b.left - 1 && Math.abs(a.right - b.right) <= 24, dots: [Math.round(d.width), Math.round(d.height)] };
    });
    chk(bar.open && bar.you && bar.kids === 'rxn-dots' && bar.atRight && bar.dots[0] >= 36 && bar.dots[1] >= 36,
      'D12 phone: a tap on the person\'s own message opens its bar, "..." alone at its right end, a 36px target', JSON.stringify(bar));
    await ph.locator('#d-dmthread .msg.rxn-show .rxn-dots').tap(); await ph.waitForTimeout(250);
    const menu = await ph.evaluate(() => ({ items: (() => { const m = document.getElementById('msg-menu'); return m && !m.hidden ? [...m.querySelectorAll('.msg-menu-i:not([hidden])')].map((i) => i.textContent.trim()).join('|') : null; })(),
      barOpen: !!document.querySelector('#d-dmthread .msg.rxn-show') }));
    chk(menu.items === 'Copy message|Copy message id|Delete message' && !menu.barOpen, 'D12 phone: "..." opens the menu with Delete message last and closes the bar', JSON.stringify(menu));
    if (menu.items) { await ph.locator('#msg-menu-del').tap(); await ph.waitForTimeout(150); }
    const dlg = await ph.evaluate(() => ({ open: !document.getElementById('msgdel-modal').hidden, focus: document.activeElement && document.activeElement.id }));
    chk(dlg.open && dlg.focus === 'msgdel-keep', 'D12 phone: Delete message opens the dialog, Keep it focused', JSON.stringify(dlg));
    // Review 5: closing the dialog, or copying from the menu, must not bring the closed bar back (focus on "..." would).
    const barsShown = () => ph.evaluate(() => [...document.querySelectorAll('#d-dmthread .rxn-quick')].filter((q) => getComputedStyle(q).opacity !== '0').length);
    await ph.locator('#msgdel-keep').tap(); await ph.waitForTimeout(250);
    const afterKeep = await barsShown();
    await mine.tap(); await ph.waitForTimeout(250);
    await ph.locator('#d-dmthread .msg.rxn-show .rxn-dots').tap(); await ph.waitForTimeout(250);
    await ph.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => {} } }); });
    await ph.locator('#msg-menu-text').tap(); await ph.waitForTimeout(250);
    const afterCopy = await barsShown();
    chk(afterKeep === 0 && afterCopy === 0, 'D12 phone: after Keep it, and after Copy message, no bar is showing', JSON.stringify({ afterKeep, afterCopy }));
    await ctx.close();
  } catch (e) {
    chk(false, 'D12 the phone arm finished', e && e.message ? e.message.split('\n')[0] : String(e));
  }
  chk(errs.length === 0, 'no page errors', errs.join(' | '));
  await browser.close();
  console.log(fail.length ? fail.length + ' failed' : 'all passed');
  process.exit(fail.length ? 1 : 0);
})();
