// Browser-check-surface: d-talk-older d-talk-older-text d-talk-older-show d-talk-older-hide d-dmthread
'use strict';

/**
 * kosmos#5841: a direct conversation shows its latest 200 messages and says how many older ones are kept; until now
 * there was no way to them. The earlier messages are drawn IN the thread, before the latest, by the thread's own paint.
 * This asserts, on the REAL rendered DM:
 *   - with older messages kept, the line offers "Show earlier messages" (CONTROL: with none, no line and no button);
 *   - pressing it puts the page before the latest at the TOP of the thread, oldest first, fetched with
 *     thread/older?before=<the thread's olderCount>, and focus stays on the button; again pages back to the start,
 *     where "Show earlier" goes and the line says it is the whole conversation;
 *   - the thread's repaint (the 5 s poll) keeps them; a reply among them names its original; Hide takes them away and
 *     focus moves back to "Show earlier messages";
 *   - messages that leave the latest while it is open are fetched into the earlier rows (no gap);
 *   - another agent on screen starts closed, including when that agent's read FAILS (no cross-agent rows);
 *   - Hide then Show while a page loads draws it once.
 *
 * Harness posture mirrors render-agentdm-3414.js: load over file://, answer the fetches from fixtures, set CURRENT,
 * call paintTalk. The fixture's pages are 2 rows.
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
// 'msg-N!' and not 'mN': a bubble's text runs into its time ('m0' then '7:00' read as 'm07').
const row = (i) => (i % 2 ? { from: 'April', at: at(i), text: 'msg-' + i + '!' } : { at: at(i), text: 'msg-' + i + '!' });

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    const errs = [];
    page.on('pageerror', (e) => errs.push('pageerror ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/ERR_FILE_NOT_FOUND/.test(m.text())) errs.push('console ' + m.text()); });
    await page.addInitScript(() => {
      // The kept messages, per agent; the thread route shows the last 3, the older route pages of 2.
      window.__all = {};
      window.__asked = [];
      window.__failThread = null;   // a 404 read (a borrowed name): paintTalk's catch arm
      window.__nullThread = null;   // a 200 read that FAILED: messages null + historyBecause (the shape the guard sees)
      window.__olderDelay = 0;
      const enc = (o, s) => new Response(JSON.stringify(o), { status: s || 200, headers: { 'content-type': 'application/json' } });
      window.setInterval = () => 0;
      window.fetch = async (url) => {
        const u = String(url);
        const who = (u.match(/\/api\/agent\/([^/]+)\/thread/) || [])[1];
        const all = window.__all[who] || [];
        const m = u.match(/\/thread\/older\?before=(\d+)/);
        if (m) {
          window.__asked.push(who + ':' + m[1]);
          if (window.__olderDelay) await new Promise((r) => setTimeout(r, window.__olderDelay));
          const before = Math.min(Number(m[1]), all.length);
          const start = Math.max(0, before - 2);
          return enc({ messages: all.slice(start, before), olderCount: start });
        }
        if (who && window.__failThread === who) return enc({ error: 'no agent by that name', because: 'borrowed' }, 404);
        if (who && window.__nullThread === who) {
          return enc({ messages: null, olderCount: 0, historyBecause: 'we cannot read what you have sent this agent', historyUnfilable: false,
            presence: 'on', presenceBecause: null, asking: false, question: null, questionBecause: null, options: null });
        }
        if (who) {
          return enc({ messages: all.slice(-3), olderCount: Math.max(0, all.length - 3), historyBecause: null, historyUnfilable: false,
            presence: 'on', presenceBecause: null, asking: false, question: null, questionBecause: null, options: null });
        }
        if (u.includes('/api/status')) return enc({ agents: [], version: '0.0.0' });
        return enc({});
      };
    });
    await page.goto(PAGE);
    await page.evaluate(() => {
      document.getElementById('panel-detail').hidden = false;
      const fr = document.getElementById('firstrun'); if (fr) fr.hidden = true;
      document.querySelectorAll('body > *').forEach((el) => { el.inert = false; });
    });
    const open = (who, Who) => page.evaluate(([a, b]) => { CURRENT = { sessionName: a, name: b }; return paintTalk(a, b); }, [who, Who]);
    const setAll = (who, n, extra) => page.evaluate(([w, list]) => { window.__all[w] = list; }, [who, Array.from({ length: n }, (_, i) => ({ ...row(i), ...((extra && extra[i]) || {}) }))]);
    const state = () => page.evaluate(() => {
      const older = document.getElementById('d-talk-older');
      const show = document.getElementById('d-talk-older-show');
      const hide = document.getElementById('d-talk-older-hide');
      // A row's label is its LAST "mN": a reply's header quotes its original first.
      const rows = [...document.querySelectorAll('#d-dmthread .msg')].map((r) => ((r.querySelector('.msg-bd') || r).textContent.match(/msg-\d+!/g) || ['?']).pop().replace(/^msg-(\d+)!$/, 'm$1'));
      return {
        line: older.hidden ? '' : document.getElementById('d-talk-older-text').textContent.trim(),
        show: !show.hidden && !older.hidden, showLabel: show.textContent.trim(), hide: !hide.hidden && !older.hidden,
        rows, asked: window.__asked.slice(),
        reply: [...document.querySelectorAll('#d-dmthread .msg-replyto, #d-dmthread .vh')].map((x) => x.textContent.trim()).join(' | '),
        focus: document.activeElement ? (document.activeElement.id || document.activeElement.tagName) : '',
      };
    });
    const settle = () => page.waitForTimeout(200);

    // CONTROL: three messages, nothing older.
    await setAll('april', 3);
    await open('april', 'April');
    let s = await state();
    chk(!s.line && !s.show && s.rows.join(',') === 'm0,m1,m2', 'CONTROL: with nothing older there is no line and no "Show earlier messages"', JSON.stringify(s));

    // Eight kept (m4 answers m3): the latest 3 show, 5 are older.
    await setAll('april', 8, { 4: { replyTo: at(3) } });
    await open('april', 'April');
    s = await state();
    chk(s.show && /Showing the latest 3\. 5 older messages are still kept\./.test(s.line) && !s.hide, 'with 5 older kept, the line offers "Show earlier messages"', JSON.stringify(s));

    await page.focus('#d-talk-older-show');
    await page.click('#d-talk-older-show'); await settle();
    s = await state();
    chk(s.rows.join(',') === 'm3,m4,m5,m6,m7' && s.asked.join(',') === 'april:5', 'pressing it puts the page before the latest at the top of the thread, oldest first (before=5)', JSON.stringify(s));
    chk(/Showing 2 earlier and the latest 3\. 3 older messages are still kept\./.test(s.line) && s.show && s.hide, 'the line says what is shown and offers more and Hide', JSON.stringify(s));
    chk(s.focus === 'd-talk-older-show', 'focus stays on the button (a load is aria-disabled, never disabled)', s.focus);
    chk(/Answers [^|]*msg-3!/.test(s.reply) && !/further back|unavailable/i.test(s.reply), 'a reply among the earlier rows names its original', JSON.stringify(s.reply));

    await page.click('#d-talk-older-show'); await settle();
    await open('april', 'April'); await settle();   // the 5 s poll's repaint
    s = await state();
    chk(s.rows.join(',') === 'm1,m2,m3,m4,m5,m6,m7' && s.asked.join(',') === 'april:5,april:3', 'it pages back with before=3, and the repaint keeps the earlier rows', JSON.stringify(s));

    await page.click('#d-talk-older-show'); await settle();
    s = await state();
    chk(s.rows.join(',') === 'm0,m1,m2,m3,m4,m5,m6,m7' && !s.show && /whole conversation/.test(s.line) && s.hide, 'at the start "Show earlier" goes and the line says it is the whole conversation', JSON.stringify(s));

    // Two new messages arrive while it is open: m5 and m6 leave the latest 3; they must land in the earlier rows.
    await setAll('april', 10, { 4: { replyTo: at(3) } });
    await open('april', 'April'); await page.waitForTimeout(500);
    s = await state();
    chk(s.rows.join(',') === 'm0,m1,m2,m3,m4,m5,m6,m7,m8,m9', 'messages that leave the latest while it is open are fetched in: no gap', JSON.stringify(s));

    await page.click('#d-talk-older-hide'); await settle();
    s = await state();
    chk(s.rows.join(',') === 'm7,m8,m9' && s.show && !s.hide, 'Hide takes the earlier rows away and the line offers them again', JSON.stringify(s));
    chk(s.focus === 'd-talk-older-show', 'hiding moves focus to "Show earlier messages"', s.focus);

    // Open again, then another agent: a successful read, and a FAILING read.
    await page.click('#d-talk-older-show'); await settle();
    await setAll('mona', 6);
    await open('mona', 'Mona'); await settle();
    s = await state();
    chk(!s.hide && s.rows.join(',') === 'm3,m4,m5', 'another agent on screen starts closed, with only its own rows', JSON.stringify(s));
    await open('april', 'April'); await settle();
    await page.click('#d-talk-older-show'); await settle();
    s = await state();
    chk(s.rows.length === 5, 'coming back to an agent starts it closed, so one press shows one page (2 earlier + the latest 3)', JSON.stringify(s));
    await page.evaluate(() => { window.__failThread = 'mona'; });
    await open('mona', 'Mona'); await settle();
    s = await state();
    chk(!s.rows.some((r) => /^m\d+$/.test(r)) && !s.hide, 'switching to an agent whose read is refused (404) shows none of the other agent\'s rows', JSON.stringify(s));

    // April's OWN latest read FAILS (a 200 with messages null) while her earlier rows are open.
    await page.evaluate(() => { window.__failThread = null; });
    await open('april', 'April'); await settle();
    await page.click('#d-talk-older-show'); await settle();
    await page.evaluate(() => { window.__nullThread = 'april'; });
    await open('april', 'April'); await settle();
    s = await state();
    const note = await page.evaluate(() => document.getElementById('d-dmthread').textContent.trim());
    chk(s.rows.length === 0 && /cannot read/.test(note), 'when the latest read fails while earlier rows are open, the thread shows the failure, not old rows', JSON.stringify({ rows: s.rows, note: note.slice(0, 80) }));
    chk(!s.line && !s.show && !s.hide, 'and no count or button stands over the failure', JSON.stringify({ line: s.line, show: s.show, hide: s.hide }));
    // ...and one failed poll does not throw away the pages already loaded (a failed read reports olderCount 0).
    await page.evaluate(() => { window.__nullThread = null; });
    await open('april', 'April'); await settle();
    s = await state();
    chk(s.rows.length === 5 && s.hide, 'when the read recovers, the earlier rows are still open (a failed poll is not a shrink)', JSON.stringify(s));
    await page.click('#d-talk-older-hide'); await settle();

    // The thread SHRINKS below the earlier rows' end (a file set aside): the earlier rows close, nothing doubles.
    await open('april', 'April'); await settle();
    await page.click('#d-talk-older-show'); await settle();
    await setAll('april', 4);
    await open('april', 'April'); await settle();
    s = await state();
    chk(s.rows.join(',') === 'm1,m2,m3' && !s.hide, 'a thread that shrinks below the earlier rows closes them (no duplicate rows)', JSON.stringify(s));
    await setAll('april', 10, { 4: { replyTo: at(3) } });

    // Hide then Show while a page loads draws it once.
    await page.evaluate(() => { window.__failThread = null; window.__olderDelay = 400; });
    await open('april', 'April'); await settle();
    await page.click('#d-talk-older-show');
    await page.click('#d-talk-older-hide');
    await page.click('#d-talk-older-show');
    await page.waitForTimeout(1200);
    s = await state();
    chk(s.rows.join(',') === 'm5,m6,m7,m8,m9', 'Hide then Show during a load draws the page once, not twice', JSON.stringify(s));

    chk(errs.length === 0, 'no page errors', JSON.stringify(errs));
  } finally {
    await browser.close();
  }
  if (fail.length) { console.log('FAIL: ' + fail.length); process.exit(1); }
  console.log('All checks passed');
})().catch((e) => { console.error(e); process.exit(2); });
