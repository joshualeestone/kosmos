// Browser-check-surface: d-talk-older d-talk-older-text d-talk-older-show dm-earlier d-dmthread
'use strict';

/**
 * kosmos#5841 and kosmos#6086: a direct conversation shows its latest 200 messages, and the ones before them load by
 * SCROLLING BACK, a page at a time, drawn IN the thread by the thread's own paint. No button, and nothing under the
 * newest message. This asserts, on the REAL rendered DM:
 *   - opened at the newest message, nothing is asked for and nothing stands on screen about earlier messages
 *     (CONTROL: the thread really scrolls; and with nothing older, nothing ever is asked);
 *   - reaching the top asks for the page before the latest (thread/older?before=<the thread's olderCount>); WHILE it
 *     loads a line over the top of the thread says so, over the thread and never between the newest message and
 *     the composer; when it lands the rows are at the top, oldest first, the line is gone, and THE MESSAGE THE
 *     READER WAS ON HAS NOT MOVED;
 *   - reaching the top again pages back to the first message, where nothing more is asked;
 *   - the thread's repaint (the 5 s poll) keeps them; a reply among them names its original;
 *   - messages that leave the latest while earlier ones are loaded are fetched in (no gap);
 *   - another agent on screen starts with only its own rows, including when that agent's read FAILS;
 *   - a failed load says so at the top with Try again, and scrolling does not ask again until the person does;
 *   - a thread too short to scroll loads the earlier pages by itself.
 *
 * Harness posture mirrors render-agentdm-3414.js: load over file://, answer the fetches from fixtures, set CURRENT,
 * call paintTalk. The fixture's pages are 2 rows, each row several lines tall, in a thread held 300 px high: one
 * page is taller than the "near the top" distance, as a real page of 200 messages is, so one arrival at the top
 * loads one page.
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
// Seven lines tall, so two rows (one fixture page) are taller than the thread's "near the top" distance.
const TALL = '\n.\n.\n.\n.\n.\n.';
const row = (i) => (i % 2 ? { from: 'April', at: at(i), text: 'msg-' + i + '!' + TALL } : { at: at(i), text: 'msg-' + i + '!' + TALL });

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
      window.__olderFail = false;   // the older route answers 500
      window.__olderHold = false;   // the older route waits until the check calls __olderRelease(): no timing in the arms
      window.__olderRelease = () => {};
      window.__olderMoved = false;  // the older route answers a DIFFERENT range than asked (the thread changed under it)
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
          if (window.__olderHold) await new Promise((r) => { window.__olderRelease = r; });
          if (window.__olderFail) return enc({ error: 'no' }, 500);
          if (window.__olderMoved) return enc({ messages: all.slice(0, 1), olderCount: 0 });
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
    /* Opening a DIFFERENT agent's conversation, as the app does it (its agent-open block): the thread shows a note
       and FORGETS the reader's place, which belongs to the agent being left. `open` alone is a repaint of the agent
       on screen (the 5 s poll), which keeps the place. Without this the next agent inherits "scrolled to the top"
       from the last one and is not opened at its newest message, which the app never does. */
    const switchTo = (who, Who) => page.evaluate(([a, b]) => {
      const th = document.getElementById('d-dmthread');
      setThread(th, '<p class="dmnone">Opening&hellip;</p>', null);
      th.__heldTop = undefined; th.__heldAtBottom = undefined;
      CURRENT = { sessionName: a, name: b }; return paintTalk(a, b);
    }, [who, Who]);
    const setAll = (who, n, extra) => page.evaluate(([w, list]) => { window.__all[w] = list; }, [who, Array.from({ length: n }, (_, i) => ({ ...row(i), ...((extra && extra[i]) || {}) }))]);
    const state = () => page.evaluate(() => {
      const older = document.getElementById('d-talk-older');
      const retry = document.getElementById('d-talk-older-show');
      const thread = document.getElementById('d-dmthread');
      // A row's label is its LAST "mN": a reply's header quotes its original first.
      const rows = [...thread.querySelectorAll('.msg')].map((r) => ((r.querySelector('.msg-bd') || r).textContent.match(/msg-\d+!/g) || ['?']).pop().replace(/^msg-(\d+)!$/, 'm$1'));
      return {
        line: older.hidden ? '' : document.getElementById('d-talk-older-text').textContent.trim(),
        retry: !retry.hidden && !older.hidden,
        rows, asked: window.__asked.slice(),
        reply: [...thread.querySelectorAll('.msg-replyto, .vh')].map((x) => x.textContent.trim()).join(' | '),
        scrollTop: Math.round(thread.scrollTop), scrolls: thread.scrollHeight > thread.clientHeight + 1,
        atBottom: thread.scrollHeight - thread.clientHeight - thread.scrollTop <= 2,
      };
    });
    const settle = () => page.waitForTimeout(250);
    /* Where things are painted: the line, the thread, its first and last rows, the composer; and where the row that
       holds a given message sits in the window (to see whether a page landing above it moved it). */
    const where = (label) => page.evaluate((lab) => {
      const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), h: Math.round(b.height) }; };
      const thread = document.getElementById('d-dmthread'); const rows = [...thread.querySelectorAll('.msg')];
      const older = document.getElementById('d-talk-older');
      const of = lab ? rows.find((x) => (x.textContent.match(/msg-\d+!/g) || []).pop() === lab) : null;
      return { line: older.hidden ? null : r(older), thread: r(thread), first: r(rows[0]), last: r(rows[rows.length - 1]), composer: r(document.getElementById('d-say')), row: r(of) };
    }, label || '');
    /* The reader scrolls up to the top of what is loaded. */
    const toTop = () => page.evaluate(() => { const t = document.getElementById('d-dmthread'); t.scrollTop = 0; t.dispatchEvent(new Event('scroll')); });
    /* A thread 300 px high, so three tall rows scroll (the real page gives it the height of the window). */
    await page.addStyleTag({ content: '#d-dmthread { height: 300px !important; max-height: 300px !important; min-height: 0 !important; flex: none !important; }' });

    // CONTROL: three messages, nothing older. Nothing is asked for, at the bottom or at the top.
    await setAll('april', 3);
    await switchTo('april', 'April'); await settle();
    let s = await state();
    chk(s.scrolls && s.atBottom, 'CONTROL: the thread scrolls, and opens at the newest message', JSON.stringify(s));
    await toTop(); await settle();
    s = await state();
    chk(!s.line && !s.retry && s.rows.join(',') === 'm0,m1,m2' && s.asked.length === 0, 'CONTROL: with nothing older, reaching the top asks for nothing and shows no line', JSON.stringify(s));

    // Eight kept (m4 answers m3): the latest 3 show, 5 are older.
    await page.evaluate(() => { window.__asked.length = 0; });
    await setAll('mona', 3);
    await switchTo('mona', 'Mona'); await settle();   // another agent between, so April opens fresh, at the bottom
    await setAll('april', 8, { 4: { replyTo: at(3) } });
    await switchTo('april', 'April'); await settle();
    s = await state();
    let w = await where();
    chk(s.atBottom && s.rows.join(',') === 'm5,m6,m7' && s.asked.length === 0, 'opened at the newest message, nothing earlier is asked for', JSON.stringify(s));
    chk(!s.line && !s.retry && !w.line, '#6086: and nothing about earlier messages stands on screen: no line, no button', JSON.stringify({ line: s.line, retry: s.retry }));
    chk(!!w.last && !!w.composer && w.last.h > 0 && w.composer.h > 0, '#6086 CONTROL: the newest message and the composer are painted', JSON.stringify([w.last, w.composer]));

    // The reader scrolls to the top: the page before the latest loads, with a line over the top of the thread meanwhile.
    await page.evaluate(() => { window.__olderHold = true; });
    await toTop(); await settle();
    s = await state(); w = await where('msg-5!');
    const before5 = w.row;
    chk(/^Loading earlier messages/.test(s.line) && !s.retry, '#6086: while a page loads, a line at the top says so (no button)', JSON.stringify(s));
    chk(!!w.line && w.line.h > 0 && w.line.top >= w.thread.top - 2 && w.line.bottom <= w.thread.top + 60, '#6086: the line is over the top of the thread', JSON.stringify([w.line, w.thread]));
    chk(!!w.line && !(w.line.top >= w.last.bottom - 2 && w.line.bottom <= w.composer.top + 2) && w.line.bottom < w.composer.top, '#6086: and not between the newest message and the composer', JSON.stringify([w.line, w.last, w.composer]));
    const threadTopBefore = w.thread.top;
    chk(s.asked.join(',') === 'april:5', 'CONTROL: the page was asked for and has not come back yet', JSON.stringify(s.asked));
    await page.evaluate(() => { window.__olderHold = false; window.__olderRelease(); }); await settle();
    s = await state(); w = await where('msg-5!');
    chk(s.rows.join(',') === 'm3,m4,m5,m6,m7' && s.asked.join(',') === 'april:5', 'reaching the top loads the page before the latest, at the top of the thread, oldest first (before=5)', JSON.stringify(s));
    chk(!s.line && !s.retry, '#6086: when the page has landed the line is gone', JSON.stringify(s));
    chk(!!before5 && !!w.row && Math.abs(w.row.top - before5.top) <= 2, '#6086: THE VIEW DOES NOT JUMP: the message the reader was on is where it was', JSON.stringify([before5, w.row]));
    chk(w.thread.top === threadTopBefore, '#6086: showing and hiding the line does not move the thread', JSON.stringify([threadTopBefore, w.thread.top]));
    chk(s.scrollTop > 120, '#6086 CONTROL: one page is taller than the near-the-top distance, so one arrival loaded one page', String(s.scrollTop));
    chk(/Answers [^|]*msg-3!/.test(s.reply) && !/further back|unavailable/i.test(s.reply), 'a reply among the earlier rows names its original', JSON.stringify(s.reply));

    // Near the top is enough: the reader does not have to land on 0 exactly. And far from it asks nothing.
    await page.evaluate(() => { const t = document.getElementById('d-dmthread'); t.scrollTop = 200; t.dispatchEvent(new Event('scroll')); }); await settle();
    s = await state();
    chk(s.asked.join(',') === 'april:5', '#6086 CONTROL: 200 px from the top asks for nothing', JSON.stringify(s.asked));
    await page.evaluate(() => { const t = document.getElementById('d-dmthread'); t.scrollTop = 60; t.dispatchEvent(new Event('scroll')); }); await settle();
    await open('april', 'April'); await settle();   // the 5 s poll's repaint
    s = await state();
    chk(s.rows.join(',') === 'm1,m2,m3,m4,m5,m6,m7' && s.asked.join(',') === 'april:5,april:3', 'coming within 60 px of the top pages back with before=3, and the repaint keeps the earlier rows', JSON.stringify(s));

    await toTop(); await settle();
    s = await state();
    chk(s.rows.join(',') === 'm0,m1,m2,m3,m4,m5,m6,m7' && s.asked.join(',') === 'april:5,april:3,april:1' && !s.line, 'and again reaches the first message', JSON.stringify(s));
    await toTop(); await settle(); await toTop(); await settle();
    s = await state();
    chk(s.asked.join(',') === 'april:5,april:3,april:1' && !s.line && !s.retry, 'at the first message, reaching the top asks for nothing more', JSON.stringify(s));

    // Two new messages arrive while earlier ones are loaded: m5 and m6 leave the latest 3; they must land in the earlier rows.
    await setAll('april', 10, { 4: { replyTo: at(3) } });
    await open('april', 'April'); await page.waitForTimeout(500);
    s = await state();
    chk(s.rows.join(',') === 'm0,m1,m2,m3,m4,m5,m6,m7,m8,m9', 'messages that leave the latest while earlier ones are loaded are fetched in: no gap', JSON.stringify(s));

    // Another agent: a successful read, and a FAILING read.
    await setAll('mona', 6);
    await switchTo('mona', 'Mona'); await settle();
    s = await state();
    chk(s.rows.join(',') === 'm3,m4,m5' && s.atBottom && !s.line, 'another agent on screen starts with only its own rows, at its newest message', JSON.stringify(s));
    await switchTo('april', 'April'); await settle();
    s = await state();
    chk(s.rows.join(',') === 'm7,m8,m9' && s.atBottom, 'coming back to an agent starts it at the newest message, with the earlier rows to load again', JSON.stringify(s));
    await toTop(); await settle();
    s = await state();
    chk(s.rows.length === 5, 'and one arrival at the top shows one page (2 earlier + the latest 3)', JSON.stringify(s));
    await page.evaluate(() => { window.__failThread = 'mona'; });
    await switchTo('mona', 'Mona'); await settle();
    s = await state();
    chk(!s.rows.some((r) => /^m\d+$/.test(r)) && !s.line, 'switching to an agent whose read is refused (404) shows none of the other agent\'s rows', JSON.stringify(s));

    // April's OWN latest read FAILS (a 200 with messages null) while her earlier rows are loaded.
    await page.evaluate(() => { window.__failThread = null; });
    await switchTo('april', 'April'); await settle();
    await toTop(); await settle();
    await page.evaluate(() => { window.__nullThread = 'april'; });
    await open('april', 'April'); await settle();
    s = await state();
    const note = await page.evaluate(() => document.getElementById('d-dmthread').textContent.trim());
    chk(s.rows.length === 0 && /cannot read/.test(note), 'when the latest read fails while earlier rows are loaded, the thread shows the failure, not old rows', JSON.stringify({ rows: s.rows, note: note.slice(0, 80) }));
    chk(!s.line && !s.retry, 'and no line or button stands over the failure', JSON.stringify({ line: s.line, retry: s.retry }));
    // ...and one failed poll does not throw away the pages already loaded (a failed read reports olderCount 0).
    await page.evaluate(() => { window.__nullThread = null; });
    await open('april', 'April'); await settle();
    s = await state();
    chk(s.rows.length === 5, 'when the read recovers, the earlier rows are still there (a failed poll is not a shrink)', JSON.stringify(s));

    // The thread SHRINKS below the earlier rows' end (a file set aside): the earlier rows close, nothing doubles.
    await setAll('april', 4);
    await open('april', 'April'); await settle();
    s = await state();
    chk(s.rows.slice(-3).join(',') === 'm1,m2,m3' && new Set(s.rows).size === s.rows.length, 'a thread that shrinks below the earlier rows closes them (no duplicate rows)', JSON.stringify(s));

    // A load that FAILS: said at the top, with Try again; scrolling does not ask again until the person does.
    await setAll('june', 8);
    await page.evaluate(() => { window.__asked.length = 0; window.__olderFail = true; });
    await switchTo('june', 'June'); await settle();
    await toTop(); await settle();
    s = await state(); w = await where();
    chk(/could not read the earlier messages/i.test(s.line) && s.retry && s.asked.join(',') === 'june:5', '#6086: a failed load says so at the top, with Try again', JSON.stringify(s));
    chk(!!w.line && w.line.bottom <= w.thread.top + 80 && w.line.bottom < w.composer.top, '#6086: that too is over the top of the thread', JSON.stringify([w.line, w.thread]));
    await toTop(); await settle(); await toTop(); await settle();
    s = await state();
    chk(s.asked.join(',') === 'june:5', '#6086: scrolling at the top does not ask again after a failure', JSON.stringify(s.asked));
    await page.evaluate(() => { const t = document.getElementById('d-dmthread'); t.scrollTop = t.scrollHeight; t.dispatchEvent(new Event('scroll')); }); await settle();
    s = await state();
    chk(!s.line && !s.retry, '#6086: away from the top the failure does not stand over the messages', JSON.stringify(s));
    await toTop(); await settle();
    s = await state();
    chk(/could not read the earlier messages/i.test(s.line) && s.retry && s.asked.join(',') === 'june:5', '#6086: back at the top it is said again, still without asking', JSON.stringify(s));
    await page.evaluate(() => { window.__olderFail = false; });
    await page.click('#d-talk-older-show'); await settle();
    s = await state();
    chk(s.asked.join(',') === 'june:5,june:5' && s.rows.join(',') === 'm3,m4,m5,m6,m7' && !s.line && !s.retry, '#6086: Try again asks for the same page, and it lands', JSON.stringify(s));

    // The older route keeps answering a different range (the thread and the route disagree): asked twice, then it is
    // a failed load. Not once per scroll or per poll, for ever.
    await setAll('nora', 8);
    await page.evaluate(() => { window.__asked.length = 0; window.__olderMoved = true; });
    await switchTo('nora', 'Nora'); await settle();
    for (let i = 0; i < 6; i++) { await toTop(); await settle(); await open('nora', 'Nora'); await settle(); }
    s = await state();
    chk(s.asked.length === 2 && s.asked.every((a) => a === 'nora:5'), '#6086: a thread that keeps changing under the page is asked twice, not without end', JSON.stringify(s.asked));
    chk(/could not read the earlier messages/i.test(s.line) && s.retry && s.rows.join(',') === 'm5,m6,m7', '#6086: then it says so, with Try again, and the latest rows stand', JSON.stringify(s));
    await page.evaluate(() => { window.__olderMoved = false; });
    await page.click('#d-talk-older-show'); await settle();
    s = await state();
    chk(s.rows.join(',') === 'm3,m4,m5,m6,m7' && !s.line, '#6086: Try again starts from where the thread is now, and the page lands', JSON.stringify(s));

    // A search on: the thread is short because it is filtered, not because the reader is at the top. Nothing is asked.
    await setAll('pia', 8);
    await page.evaluate(() => { window.__asked.length = 0; });
    await switchTo('pia', 'Pia'); await settle();
    await page.evaluate(() => { TALK_QUERY = 'msg-7'; });
    await toTop(); await settle(); await open('pia', 'Pia'); await settle();
    s = await state();
    chk(s.asked.length === 0, '#6086: with a search on, reaching the top asks for nothing', JSON.stringify(s.asked));
    await page.evaluate(() => { TALK_QUERY = ''; });

    // Another agent opened while a page is still on its way: the page is dropped, not drawn under the new name.
    await setAll('quin', 8); await setAll('rae', 3);
    await page.evaluate(() => { window.__asked.length = 0; window.__olderHold = true; });
    await switchTo('quin', 'Quin'); await settle();
    await toTop(); await settle();
    await switchTo('rae', 'Rae'); await settle();
    await page.evaluate(() => { window.__olderHold = false; window.__olderRelease(); }); await settle();
    s = await state();
    chk(s.asked.join(',') === 'quin:5' && s.rows.join(',') === 'm0,m1,m2' && !s.line, '#6086: a page that lands after another agent was opened is dropped (only that agent\'s rows, no line)', JSON.stringify(s));

    // A thread too short to scroll has no scroll to wait for: it loads the earlier pages by itself, to the first message.
    await page.addStyleTag({ content: '#d-dmthread { height: 4000px !important; max-height: 4000px !important; }' });
    await setAll('opal', 8);
    await page.evaluate(() => { window.__asked.length = 0; });
    await switchTo('opal', 'Opal'); await page.waitForTimeout(900);
    s = await state();
    chk(!s.scrolls && s.rows.join(',') === 'm0,m1,m2,m3,m4,m5,m6,m7' && s.asked.join(',') === 'opal:5,opal:3,opal:1', '#6086: a thread too short to scroll loads every earlier page by itself', JSON.stringify(s));

    chk(errs.length === 0, 'no page errors', JSON.stringify(errs));
  } finally {
    await browser.close();
  }
  if (fail.length) { console.log('FAIL: ' + fail.length); process.exit(1); }
  console.log('All checks passed');
})().catch((e) => { console.error(e); process.exit(2); });
