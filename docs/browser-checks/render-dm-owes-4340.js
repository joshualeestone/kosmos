// Browser-check-surface: d-dmthread dmnone
'use strict';
/**
 * #4340: "Nothing back yet." under a DIRECT message. The thread route now computes `owes` from the one-to-one
 * thread's own rows (engine/chat.js dmOwes) instead of the `kosmos msg` / room log, which never holds a
 * person's DM, so the line can finally appear in the case it was written for.
 *
 * The fixture's `owes` is not typed in: it is computed by the REAL engine (chat.dmOwes) from the very rows the
 * page is served, so this check breaks if that rule regresses as well as if the page stops drawing the line.
 *   OWES     a person DM that reached the agent 5 minutes ago, no reply: the line shows.
 *   ANSWERED the agent replied after it: no line.
 *   GRACE    a DM that landed 30 seconds ago: owes, but inside the 2-minute grace, so no line yet.
 *   NOT DELIVERED  a DM that never reached the agent: no line (it was never received).
 *   MENU ANSWER  a DM owed 10 minutes, then a menu button pressed 30 seconds ago (a `wire` row): the line still shows,
 *            because the grace is timed from the message owed, not from the button (the page's own filter).
 *            (A TYPED answer to a question is not told apart: a known limit, recorded on #4340.)
 * Every arm also asserts the thread's message rows really rendered, so a "no line" arm cannot pass on a blank paint.
 * Harness posture mirrors render-agentdm-3414.js: load over file://, answer the thread poll from the fixture,
 * set CURRENT, call paintTalk.
 *
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" HEADED=0 node docs/browser-checks/render-dm-owes-4340.js
 */
const path = require('node:path');
const { chromium } = require('playwright');
const chat = require(path.resolve(__dirname, '..', '..', 'engine', 'chat.js'));

const PAGE = 'file://' + path.join(path.resolve(__dirname, '..', '..'), 'web', 'index.html');
const LINE = 'Nothing back yet.';
const fail = [];
const chk = (ok, label, extra) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
};
const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
const dm = (min, state = chat.DELIVERY.PLACED) => ({ at: ago(min), text: 'could you check the invoice?', delivery: { state, paneState: 'idle' } });
const reply = (min) => ({ from: 'april', at: ago(min), text: 'checked: it is paid.' });

function fixture(messages) {
  return {
    messages, owes: chat.dmOwes(messages, 'april'),
    olderCount: 0, historyBecause: null, historyUnfilable: false,
    presence: 'on', presenceBecause: null, asking: false, question: null, questionBecause: null, options: null,
  };
}

const ARMS = [
  { name: 'OWES', rows: [dm(5)], owes: 'owes', line: true },
  { name: 'ANSWERED', rows: [dm(5), reply(3)], owes: 'clear', line: false },
  { name: 'GRACE', rows: [dm(0.5)], owes: 'owes', line: false },
  { name: 'NOT DELIVERED', rows: [dm(5, chat.DELIVERY.COULD_NOT)], owes: 'clear', line: false },
  { name: 'MENU ANSWER', rows: [dm(10), { ...dm(0.5), text: 'Yes, and don\'t ask again', wire: '2' }], owes: 'owes', line: true },
];

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    for (const arm of ARMS) {
      const fx = fixture(arm.rows);
      chk(fx.owes.state === arm.owes, arm.name + ': the engine reads this thread as ' + arm.owes, JSON.stringify(fx.owes));
      const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
      const errs = [];
      page.on('pageerror', (e) => errs.push('pageerror ' + e.message));
      await page.addInitScript(() => {
        window.__fx = null;
        const enc = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
        window.setInterval = () => 0;
        window.fetch = async (url) => {
          const u = String(url);
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
        document.querySelectorAll('body > *').forEach((el) => { el.inert = false; });
      }, fx);
      await page.evaluate(() => paintTalk('april', 'April'));
      await page.waitForTimeout(300);
      const seen = await page.evaluate((line) => {
        const box = document.getElementById('d-dmthread');
        const hits = box ? [...box.querySelectorAll('.dmnone')].filter((p) => p.textContent.trim() === line) : [];
        return { box: !!box, rows: box ? box.querySelectorAll('.msg').length : 0, shown: hits.length, visible: hits.some((p) => p.checkVisibility()) };
      }, LINE);
      chk(seen.box && seen.rows === arm.rows.length, arm.name + ': the DM thread rendered its ' + arm.rows.length + ' row(s)', JSON.stringify(seen));
      if (arm.line) chk(seen.shown === 1 && seen.visible, arm.name + ': "' + LINE + '" shows under the thread', JSON.stringify(seen));
      else chk(seen.shown === 0, arm.name + ': "' + LINE + '" does not show', JSON.stringify(seen));
      chk(errs.length === 0, arm.name + ': no page errors', errs.join(' | '));
      await page.close();
    }
  } finally {
    await browser.close();
  }
  console.log('\nrender-dm-owes-4340: ' + (fail.length ? fail.length + ' failed' : 'all good'));
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error('FAIL  render-dm-owes-4340 threw: ' + (e && e.message || e)); process.exit(1); });
