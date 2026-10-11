// Browser-check-surface: d-talk-older d-talk-older-text d-talk-older-show d-talk-earlier d-talk-earlier-rows d-talk-earlier-more d-talk-earlier-hide d-talk-earlier-note
'use strict';

/**
 * kosmos#5841: a direct conversation shows its latest 200 messages and says how many older ones are kept; until now
 * there was no way to them. This asserts, on the REAL rendered DM:
 *   - with older messages kept, the line under the thread offers "Show earlier messages" (CONTROL: with none, no button);
 *   - pressing it opens an "Earlier messages" section ABOVE the thread, drawn with the thread's own row renderer,
 *     oldest first, fetched from .../thread/older?before=<the thread's olderCount>;
 *   - "Show earlier" pages back with before=<the page's olderCount> until the start, then goes away;
 *   - the thread's own repaint (the 5 s poll) does not wipe the earlier rows;
 *   - "Hide earlier messages" closes it and the line's button comes back; another agent on screen starts clean.
 *
 * Harness posture mirrors render-agentdm-3414.js: load over file://, answer the fetches from fixtures, set CURRENT,
 * call paintTalk. The fixture's pages are 2 rows, so three presses reach the start.
 *
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" HEADED=0 node docs/browser-checks/render-dm-earlier-5841.js
 */
const path = require('node:path');
const { chromium } = require('playwright');

const PAGE = 'file://' + path.join(path.resolve(__dirname, '..', '..'), 'web', 'index.html');

const fail = [];
const chk = (ok, label, extra) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
};

const at = (i) => new Date(Date.UTC(2026, 9, 1, 0, 0, i)).toISOString();
// Eight messages kept: 0..4 older, 5..7 the latest the thread shows.
const ALL = Array.from({ length: 8 }, (_, i) => (i % 2 ? { from: 'April', at: at(i), text: 'm' + i } : { at: at(i), text: 'm' + i }));
ALL[4].replyTo = at(3);   // a reply whose original sits beside it in the earlier section
const TAIL = (older) => ({
  messages: ALL.slice(5), olderCount: older, historyBecause: null, historyUnfilable: false,
  presence: 'on', presenceBecause: null, asking: false, question: null, questionBecause: null, options: null,
});

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    const errs = [];
    page.on('pageerror', (e) => errs.push('pageerror ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/ERR_FILE_NOT_FOUND/.test(m.text())) errs.push('console ' + m.text()); });
    await page.addInitScript((all) => {
      window.__tail = null;
      window.__asked = [];
      window.__failThread = null;   // a session whose thread read fails (a 404 that stands, a tmux blip)
      window.__olderDelay = 0;
      const enc = (o, s) => new Response(JSON.stringify(o), { status: s || 200, headers: { 'content-type': 'application/json' } });
      window.setInterval = () => 0;
      window.fetch = async (url) => {
        const u = String(url);
        const m = u.match(/\/thread\/older\?before=(-?\d+)/);
        if (m) {
          window.__asked.push(Number(m[1]));
          if (window.__olderDelay) await new Promise((r) => setTimeout(r, window.__olderDelay));
          const before = Math.min(Number(m[1]), all.length);
          const start = Math.max(0, before - 2);   // fixture pages are 2 rows
          return enc({ messages: all.slice(start, before), olderCount: start });
        }
        if (window.__failThread && u.includes('/api/agent/' + window.__failThread + '/thread')) return enc({ error: 'no agent by that name', because: 'borrowed' }, 404);
        if (u.includes('/thread')) return enc(window.__tail);
        if (u.includes('/api/status')) return enc({ agents: [], version: '0.0.0' });
        return enc({});
      };
    }, ALL);
    await page.goto(PAGE);
    await page.evaluate(() => {
      CURRENT = { sessionName: 'april', name: 'April' };
      document.getElementById('panel-detail').hidden = false;
      const fr = document.getElementById('firstrun'); if (fr) fr.hidden = true;
      document.querySelectorAll('body > *').forEach((el) => { el.inert = false; });
    });
    const state = () => page.evaluate(() => {
      const older = document.getElementById('d-talk-older');
      const box = document.getElementById('d-talk-earlier');
      // A row's label is its LAST "mN": a reply's header quotes its original first (m4 answers m3).
      const rows = [...document.querySelectorAll('#d-talk-earlier-rows .msg')].map((r) => ((r.querySelector('.msg-bd') || r).textContent.match(/m\d/g) || ['?']).pop());
      const more = document.getElementById('d-talk-earlier-more');
      const thread = document.getElementById('d-dmthread');
      return {
        olderText: older.hidden ? '' : older.textContent.trim(),
        showBtn: (() => { const b = document.getElementById('d-talk-older-show'); return !!(b && !b.hidden && !older.hidden); })(),
        earlierButtons: document.querySelectorAll('#d-talk-earlier-rows button').length,
        // Under its original the header is the screen-reader line (.vh); elsewhere the visible .msg-replyto (#3745's rule).
        replyHead: (document.querySelector('#d-talk-earlier-rows .msg-replyto, #d-talk-earlier-rows .vh') || {}).textContent || '',
        open: !box.hidden, rows, moreShown: !more.hidden,
        note: document.getElementById('d-talk-earlier-note').textContent.trim(),
        aboveThread: !!(box.compareDocumentPosition(thread) & Node.DOCUMENT_POSITION_FOLLOWING),
        threadRows: document.querySelectorAll('#d-dmthread .msg').length,
        asked: window.__asked.slice(),
      };
    });
    const settle = () => page.waitForTimeout(150);

    // CONTROL: nothing older, no button.
    await page.evaluate((t) => { window.__tail = t; }, TAIL(0));
    await page.evaluate(() => paintTalk('april', 'April'));
    let s = await state();
    chk(!s.showBtn && !s.olderText, 'CONTROL: with no older messages kept there is no "Show earlier messages"', JSON.stringify(s));

    // Five older kept.
    await page.evaluate((t) => { window.__tail = t; }, TAIL(5));
    await page.evaluate(() => paintTalk('april', 'April'));
    s = await state();
    chk(s.showBtn && /5 older messages are still kept\./.test(s.olderText) && /Show earlier messages/.test(s.olderText),
      'with 5 older kept, the line offers "Show earlier messages"', JSON.stringify(s));
    chk(!s.open, 'the earlier section starts closed', JSON.stringify(s));

    await page.click('#d-talk-older-show'); await settle();
    s = await state();
    chk(s.open && s.aboveThread && s.rows.join(',') === 'm3,m4' && s.asked.join(',') === '5',
      'pressing it opens "Earlier messages" above the thread with the page just before the latest (before=5), oldest first', JSON.stringify(s));
    chk(s.moreShown && /3 older still kept/.test(s.note) && !s.showBtn, 'it says how many are older still and offers "Show earlier"; the line\'s button is gone', JSON.stringify(s));

    await page.click('#d-talk-earlier-more'); await settle();
    s = await state();
    chk(s.rows.join(',') === 'm1,m2,m3,m4' && s.asked.join(',') === '5,3', '"Show earlier" pages back with before=3 and keeps the order', JSON.stringify(s));
    chk(s.earlierButtons === 0, 'the earlier rows are read-only: no button is left in them (their controls are wired to the thread)', JSON.stringify(s));
    chk(/m3/.test(s.replyHead) && !/further back|unavailable/i.test(s.replyHead), 'a reply whose original is beside it in the earlier section names it (m3), not "further back"', JSON.stringify(s.replyHead));

    // The thread's own repaint, as the 5 s poll does it.
    await page.evaluate(() => paintTalk('april', 'April')); await settle();
    s = await state();
    chk(s.open && s.rows.join(',') === 'm1,m2,m3,m4' && s.threadRows >= 3 && !s.showBtn, 'the thread\'s repaint leaves the earlier rows (and no second button)', JSON.stringify(s));

    await page.click('#d-talk-earlier-more'); await settle();
    s = await state();
    chk(s.rows.join(',') === 'm0,m1,m2,m3,m4' && !s.moreShown && /start of this conversation/.test(s.note) && s.asked.join(',') === '5,3,1',
      'at the start, "Show earlier" goes away and the note says so', JSON.stringify(s));

    await page.click('#d-talk-earlier-hide'); await settle();
    s = await state();
    chk(!s.open && s.showBtn, '"Hide earlier messages" closes it and the line\'s button comes back', JSON.stringify(s));

    // Open again, then another agent comes on screen.
    await page.click('#d-talk-older-show'); await settle();
    await page.evaluate(() => { CURRENT = { sessionName: 'mona', name: 'Mona' }; });
    await page.evaluate(() => paintTalk('mona', 'Mona')); await settle();
    s = await state();
    chk(!s.open && s.rows.length === 0 && s.showBtn, 'another agent on screen starts with the earlier section closed and empty', JSON.stringify(s));

    // Review 1's blocker: another agent whose thread read FAILS must not show this agent's earlier rows, not for a moment.
    // Each arm from here starts from a clean section (test setup), so an earlier arm's state cannot decide it.
    await page.evaluate(() => { earlierReset(null); CURRENT = { sessionName: 'april', name: 'April' }; window.__tail = null; });
    await page.evaluate((t) => { window.__tail = t; }, TAIL(5));
    await page.evaluate(() => paintTalk('april', 'April'));
    await page.click('#d-talk-older-show'); await settle();
    s = await state();
    chk(s.open && s.rows.length === 2, 'premise: april\'s earlier section is open', JSON.stringify(s));
    await page.evaluate(() => { window.__failThread = 'mona'; CURRENT = { sessionName: 'mona', name: 'Mona' }; });
    await page.evaluate(() => paintTalk('mona', 'Mona')); await settle();
    s = await state();
    chk(!s.open && s.rows.length === 0, 'switching to an agent whose read fails clears the earlier section (no cross-agent rows)', JSON.stringify(s));

    // Hide then Show while a page is loading draws it once.
    await page.evaluate(() => { earlierReset(null); window.__failThread = null; CURRENT = { sessionName: 'april', name: 'April' }; window.__olderDelay = 400; });
    await page.evaluate(() => paintTalk('april', 'April')); await settle();
    await page.click('#d-talk-older-show');
    await page.click('#d-talk-earlier-hide');
    await page.click('#d-talk-older-show');
    await page.waitForTimeout(1200);
    s = await state();
    chk(s.open && s.rows.join(',') === 'm3,m4', 'Hide then Show during a load draws the page once, not twice', JSON.stringify(s));
    await page.evaluate(() => { window.__olderDelay = 0; });

    chk(errs.length === 0, 'no page errors', JSON.stringify(errs));
  } finally {
    await browser.close();
  }
  if (fail.length) { console.log('FAIL: ' + fail.length); process.exit(1); }
  console.log('All checks passed');
})().catch((e) => { console.error(e); process.exit(2); });
