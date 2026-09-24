// Browser-check-surface: d-dmthread rxns rxn rxn-quick rxn-pick rxn-more rxn-picker
'use strict';
/**
 * kosmos#3650: the person reacts to an agent's messages in a Direct Message, with the
 * room's own pills, hover quick bar and shared picker. HERMETIC (file://, fetch stubbed).
 * Paints a DM thread through the real paintTalk and asserts:
 *   - every AGENT row carries a reaction row keyed by its `at`; the person's own row does not;
 *   - a stored reaction shows as a pressed pill;
 *   - a quick-bar click POSTs {at, emoji} to /api/agent/<name>/thread/react and repaints the
 *     row from the response;
 *   - the grey smiley opens the SHARED picker for that DM row (data-at), and a pick from it
 *     goes to the DM route, not the room's, then closes the picker.
 *
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" HEADED=0 node docs/browser-checks/render-dm-reactions-3650.js
 */
const path = require('node:path');
let chromium;
try { ({ chromium } = require('playwright')); }
catch { console.log('render-dm-reactions-3650: playwright not on NODE_PATH - SKIPPED, not passed.'); process.exit(0); }

const PAGE = 'file://' + path.join(path.resolve(__dirname, '..', '..'), 'web', 'index.html');
const fail = [];
const chk = (ok, label, extra) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
};

const A1 = '2026-09-24T21:00:01.000Z';
const A2 = '2026-09-24T21:00:03.000Z';
const FX = {
  messages: [
    { from: 'april', at: A1, text: 'Done with the login fix', reactions: [{ emoji: '👍', count: 1, who: ['you'], mine: true }] },
    { at: '2026-09-24T21:00:02.000Z', text: 'great', delivery: { state: 'placed' } },
    { from: 'april', at: A2, text: 'Tests are green too' },
  ],
  olderCount: 0, historyBecause: null, historyUnfilable: false,
  presence: 'on', presenceBecause: null, asking: false, question: null, questionBecause: null, options: null,
};

(async () => {
  let browser;
  try { browser = await chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch (err) {
    console.error('FAIL  render-dm-reactions-3650: could not start a browser'
      + (process.env.HEADED === '0' ? '.' : ' (headed; try HEADED=0).'));
    console.error('  ' + (err && err.message ? err.message.split('\n')[0] : err));
    process.exit(1);
  }
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  await page.addInitScript(() => {
    window.__fx = null;
    window.__reacts = [];
    const enc = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
    window.setInterval = () => 0;
    window.fetch = async (url, opts) => {
      const u = String(url);
      if (/\/api\/agent\/[^/]+\/thread\/react$/.test(u) && opts && opts.method === 'POST') {
        const body = JSON.parse(opts.body);
        window.__reacts.push({ url: u, body });
        if (window.__hold) await window.__hold;   // lets a check switch agents mid-request
        return enc({ ok: true, op: 'add', emoji: body.emoji, at: body.at, reactions: [{ emoji: body.emoji, count: 1, who: ['you'], mine: true }] });
      }
      if (/\/api\/project\/.*\/react$/.test(u)) { window.__reacts.push({ url: u, room: true }); return enc({ ok: true, reactions: [] }); }
      if (u.includes('/thread')) return enc(window.__fx);
      if (u.includes('/api/status')) return enc({ agents: [], version: '0.0.0' });
      return enc({});
    };
  });
  await page.goto(PAGE);
  await page.evaluate((f) => {
    window.__fx = f;
    CURRENT = { sessionName: 'april', name: 'April' };
    document.getElementById('panel-detail').hidden = false;
    const fr = document.getElementById('firstrun'); if (fr) fr.hidden = true;
  }, FX);
  await page.evaluate(() => paintTalk('april', 'April'));

  const r1 = await page.evaluate(({ A1, A2 }) => {
    const rows = [...document.querySelectorAll('#d-dmthread .msg')];
    const agentRows = rows.filter((r) => !r.classList.contains('you'));
    const youRows = rows.filter((r) => r.classList.contains('you'));
    const rx1 = document.querySelector('#d-dmthread .rxns[data-at="' + A1 + '"]');
    const pill = rx1 && rx1.querySelector('.rxn');
    return {
      agentRows: agentRows.length,
      agentWithRx: agentRows.filter((r) => r.querySelector('.rxns[data-at]')).length,
      youWithRx: youRows.filter((r) => r.querySelector('.rxns')).length,
      youRows: youRows.length,
      pill: pill ? { emoji: pill.getAttribute('data-emoji'), pressed: pill.getAttribute('aria-pressed') } : null,
      a2HasRow: !!document.querySelector('#d-dmthread .rxns[data-at="' + A2 + '"]'),
    };
  }, { A1, A2 });
  chk(r1.agentRows === 2 && r1.agentWithRx === 2 && r1.a2HasRow, 'every agent row carries a reaction row keyed by its at', JSON.stringify(r1));
  chk(r1.youRows === 1 && r1.youWithRx === 0, 'the person\'s own row carries no reaction row', JSON.stringify(r1));
  chk(!!r1.pill && r1.pill.emoji === '👍' && r1.pill.pressed === 'true', 'a stored reaction shows as a pressed pill', JSON.stringify(r1.pill));

  // Quick bar: react to the second agent message with the first quick default.
  const r2 = await page.evaluate(async (A2) => {
    const box = document.querySelector('#d-dmthread .rxns[data-at="' + A2 + '"]');
    const quick = box.querySelector('.rxn-quick .rxn-pick');
    const emoji = quick.getAttribute('data-emoji');
    quick.click();
    for (let i = 0; i < 50 && !box.querySelector('.rxn'); i++) await new Promise((res) => setTimeout(res, 20));
    const pill = box.querySelector('.rxn');
    return { emoji, sent: window.__reacts.slice(), pill: pill ? pill.getAttribute('data-emoji') : null };
  }, A2);
  const q = r2.sent[r2.sent.length - 1] || {};
  chk(q.url && /\/api\/agent\/april\/thread\/react$/.test(q.url) && q.body && q.body.at === A2 && q.body.emoji === r2.emoji,
    'a quick-bar click POSTs {at, emoji} to the DM react route', JSON.stringify(r2.sent));
  chk(r2.pill === r2.emoji, 'the row repaints from the route\'s answer', JSON.stringify(r2));

  // Shared picker: open from the first agent row's smiley, pick the last emoji.
  const r3 = await page.evaluate(async (A1) => {
    window.__reacts.length = 0;
    const box = document.querySelector('#d-dmthread .rxns[data-at="' + A1 + '"]');
    box.querySelector('.rxn-more').click();
    const picker = document.getElementById('rxn-picker');
    const opened = { visible: !!picker && !picker.hidden, at: picker && picker.getAttribute('data-at'), post: picker && picker.getAttribute('data-post') };
    const picks = picker ? [...picker.querySelectorAll('.rxn-pick')] : [];
    const pick = picks[picks.length - 1];
    const emoji = pick && pick.getAttribute('data-emoji');
    if (pick) pick.click();
    for (let i = 0; i < 50 && !window.__reacts.length; i++) await new Promise((res) => setTimeout(res, 20));
    await new Promise((res) => setTimeout(res, 50));
    return { opened, emoji, sent: window.__reacts.slice(), closed: !!picker && picker.hidden };
  }, A1);
  chk(r3.opened.visible && r3.opened.at === A1 && r3.opened.post === null, 'the smiley opens the shared picker for that DM row', JSON.stringify(r3.opened));
  const p = r3.sent[0] || {};
  chk(r3.sent.length === 1 && !p.room && p.body && p.body.at === A1 && p.body.emoji === r3.emoji,
    'a pick from the shared picker goes to the DM route with that row\'s at', JSON.stringify(r3.sent));
  chk(r3.closed, 'the picker closes after a pick', JSON.stringify(r3));
  // A response that lands after the person moved to another agent must not repaint.
  const r4 = await page.evaluate(async (A1) => {
    window.__reacts.length = 0;
    let release;
    window.__hold = new Promise((res) => { release = res; });
    const box = document.querySelector('#d-dmthread .rxns[data-at="' + A1 + '"]');
    const pills = () => [...box.querySelectorAll('.rxn')].map((b) => b.getAttribute('data-emoji')).join(',');
    const before = pills();
    const quicks = [...box.querySelectorAll('.rxn-quick .rxn-pick')];
    const other = quicks.find((b) => b.getAttribute('data-emoji') !== '👍') || quicks[quicks.length - 1];
    other.click();
    for (let i = 0; i < 50 && !window.__reacts.length; i++) await new Promise((res) => setTimeout(res, 10));
    CURRENT = { sessionName: 'someone-else', name: 'Someone' };
    release();
    window.__hold = null;
    await new Promise((res) => setTimeout(res, 150));
    const after = pills();   // the emojis, not the count: a repaint can swap one pill for another
    CURRENT = { sessionName: 'april', name: 'April' };
    return { sent: window.__reacts.length, before, after };
  }, A1);
  chk(r4.sent === 1 && r4.after === r4.before, 'a late answer after switching agents does not repaint the old row', JSON.stringify(r4));

  // A pick into a DM that is no longer on screen goes nowhere.
  const r5 = await page.evaluate(async (A1) => {
    window.__reacts.length = 0;
    const box = document.querySelector('#d-dmthread .rxns[data-at="' + A1 + '"]');
    box.querySelector('.rxn-more').click();
    const picker = document.getElementById('rxn-picker');
    const opened = !picker.hidden;
    document.getElementById('panel-detail').hidden = true;
    const pick = picker.querySelector('.rxn-pick');
    pick.click();
    await new Promise((res) => setTimeout(res, 150));
    document.getElementById('panel-detail').hidden = false;
    return { opened, sent: window.__reacts.length };
  }, A1);
  chk(r5.opened && r5.sent === 0, 'a pick into a DM that is no longer on screen sends nothing', JSON.stringify(r5));
  chk(errs.length === 0, 'no page errors', errs.join(' | '));

  await browser.close();
  if (fail.length) {
    console.error('render-dm-reactions-3650: ' + fail.length + ' check(s) failed');
    process.exit(1);
  }
  console.log('render-dm-reactions-3650: a person can react to an agent\'s DM messages with the room\'s pills, quick bar and shared picker.');
})().catch((err) => {
  console.error('FAIL  render-dm-reactions-3650: the check itself threw: ' + (err && err.message ? err.message.split('\n')[0] : err));
  process.exit(1);
});
