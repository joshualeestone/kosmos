'use strict';

/*
 * #5958 items 4 and 5: "Where each agent stands", in the Community box under Settings > Automation, below the list of
 * posts and comments. One row per agent: its name and a short summary; opening the row shows the board's own lines
 * (the community section in its instructions, its account, the last time Kosmos went to remind it and what happened,
 * its newest post, anything waiting for the person).
 *
 * /api/community/ready is answered at the browser (page.route), so this check writes nothing to the board and each
 * arm sees exactly the state it names:
 *   ROWS      three agents: each row shows its name and summary, closed; this arm is the control for the others (it
 *             proves the list is found and painted) and checks the heading sits below the posts-and-comments list.
 *   OPEN      clicking a summary opens that row only and shows every line the board sent, in order.
 *   KEYS      the summary takes focus by Tab order and Enter opens it.
 *   TIME      a line with a time is written as <time> with a machine datetime, in the page's own zone, between the
 *             board's words; a time in another year shows its year; a time the page cannot read says so and is
 *             never "Invalid Date".
 *   MARK      a closed row shows a mark that it opens, and the mark turns when it does; a summary reached by the
 *             keyboard shows a focus ring.
 *   SAME      an answer identical to the one on the page does not rebuild the rows; a different one does.
 *   KEPT      a row the person opened stays open when the list is painted again with a new answer (opening Automation
 *             again), keeps the keyboard's place, and is still open after a read that failed in between.
 *   HOSTILE   a name, summary and line made of markup are shown as text; nothing in them becomes an element.
 *   EMPTY     no agents: the list is hidden and the line says there are none yet.
 *   503       the board could not read its agents: the line says it could not check, never "no agents".
 *   403       a gated read says the same.
 *   ODD       rows the page cannot paint (no session, no owner lines) are skipped, the rest are painted.
 *   FRESH     turning the community switch on or off reads the list again, so a row never keeps saying the community
 *             is off beside a switch that is on; so does turning "Check on your agents" on or off, which the rows
 *             also name.
 *             Deleting a post, and finishing a release or a discard, read it again too: the rows name the newest
 *             post and what waits.
 *   PHONE     at 390 px wide, nothing in the list is wider than the screen, the words under a short, a middling and a
 *             very long name have a line of their own as wide as the row (the longest summary the board can send
 *             included), the mark stays with the name, and each summary is at least 44 px tall
 *             (the page's tap-target size; the arm reads the size, so the number is here and in the style sheet).
 *
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 \
 *     node docs/browser-checks/render-community-ready-5958.js http://127.0.0.1:PORT
 */

const { chromium } = require('playwright');

const BASE = process.argv[2] || process.env.KOSMOS_URL || 'http://127.0.0.1:17461';
const READY = '**/api/community/ready';

const fails = [];
function check(name, pass, detail) {
  console.log((pass ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  ' + detail : ''));
  if (!pass) fails.push(name);
}

async function openAutomation(pg) {
  await pg.goto(BASE, { waitUntil: 'networkidle' });
  await pg.waitForTimeout(800);
  if (!(await pg.$('#firstrun[hidden]'))) {
    await pg.keyboard.press('Escape');
    await pg.waitForSelector('#firstrun', { state: 'hidden', timeout: 5000 }).catch(() => {});
  }
  await pg.evaluate(() => showTab('settings'));
  await pg.waitForTimeout(400);
  await pg.click('#s-nav button[data-go="automation"]');
  await pg.waitForTimeout(400);
}

function readList(pg) {
  return pg.evaluate(() => {
    const list = document.getElementById('community-ready-list');
    const empty = document.getElementById('community-ready-empty');
    const head = document.getElementById('community-ready-head');
    const mine = document.getElementById('community-mine-head');
    const hb = head && head.getBoundingClientRect();
    const mb = mine && mine.getBoundingClientRect();
    const rows = list ? [...list.querySelectorAll('li')].map((li) => {
      const d = li.querySelector('details');
      const sum = li.querySelector('summary');
      const sb = sum && sum.getBoundingClientRect();
      return {
        session: d ? d.dataset.session : null,
        open: d ? d.open : null,
        name: sum && sum.querySelector('b') ? sum.querySelector('b').textContent : null,
        read: sum ? sum.textContent : null,
        summary: sum && sum.querySelector('.community-ready-words') ? sum.querySelector('.community-ready-words').textContent : null,
        wordsWidth: sum && sum.querySelector('.community-ready-words') ? Math.round(sum.querySelector('.community-ready-words').getBoundingClientRect().width) : 0,
        sumWidth: sb ? Math.round(sb.width) : 0,
        wordsBelowName: (() => { const w = sum && sum.querySelector('.community-ready-words'); const b = sum && sum.querySelector('b'); if (!w || !b) return null; return w.getBoundingClientRect().top >= b.getBoundingClientRect().bottom - 1; })(),
        wordsLines: (() => { const w = sum && sum.querySelector('.community-ready-words'); if (!w) return 0; const lh = parseFloat(getComputedStyle(w).lineHeight) || (parseFloat(getComputedStyle(w).fontSize) * 1.4); return Math.round(w.getBoundingClientRect().height / lh); })(),
        markBesideName: (() => { const m = sum && sum.querySelector('svg'); const b = sum && sum.querySelector('b'); if (!m || !b) return null; const mb = m.getBoundingClientRect(); const bb = b.getBoundingClientRect(); return mb.bottom > bb.top && mb.top < bb.bottom; })(),
        lines: d ? [...d.querySelectorAll(':scope > p')].map((p) => p.textContent) : [],
        times: d ? [...d.querySelectorAll('time')].map((t) => ({ dt: t.getAttribute('datetime'), text: t.textContent })) : [],
        elements: li.querySelectorAll('img, script, a, button, input, iframe').length,
        sumHeight: sb ? Math.round(sb.height) : 0,
        mark: (() => { const m = sum && sum.querySelector('svg'); if (!m) return null; const b = m.getBoundingClientRect(); const cs = getComputedStyle(m); return { w: Math.round(b.width), h: Math.round(b.height), hidden: m.getAttribute('aria-hidden'), turn: cs.transform, shown: cs.display !== 'none' && cs.visibility !== 'hidden' }; })(),
        ring: sum ? getComputedStyle(sum).outlineStyle + ' ' + getComputedStyle(sum).outlineWidth : null,
        right: Math.round(li.getBoundingClientRect().right),
        scrollWide: li.scrollWidth > li.clientWidth + 1,
      };
    }) : [];
    const a = document.activeElement;
    return {
      found: Boolean(list && empty && head),
      headShown: Boolean(hb && hb.width > 0 && hb.height > 0),
      belowMine: Boolean(hb && mb && mb.height > 0 && hb.top > mb.bottom),
      listHidden: list ? list.hidden : null,
      emptyHidden: empty ? empty.hidden : null,
      empty: empty ? empty.textContent : '',
      note: (document.getElementById('community-ready-note') || {}).textContent || '',
      rows,
      focusIsSummary: Boolean(a && a.tagName === 'SUMMARY' && a.closest('#community-ready-list')),
      focusSession: a && a.closest && a.closest('details') ? a.closest('details').dataset.session : null,
      viewport: window.innerWidth,
      pageWide: document.documentElement.scrollWidth > window.innerWidth + 1,
      injected: window.__ready5958 === true,
    };
  });
}

const answer = (body, status = 200) => (route) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
/* Times in THIS year, so the page writes them without one (it adds the year for any other); a fixed date would turn
   this check red on the first of January. T_OLD is in an earlier year, for the arm that needs the year shown. */
const ZONE = 'Asia/Tokyo';   // the zone every page here runs in (see page() below)
/* The year as the PAGE sees it: the runner's own year differs from Tokyo's for hours around New Year. */
const YEAR = Number(new Intl.DateTimeFormat('en-US', { timeZone: ZONE, year: 'numeric' }).format(new Date()));
const T1 = Date.UTC(YEAR, 5, 12, 15, 4);   // mid-year, so no zone moves it into another year
const T0 = Date.UTC(YEAR, 5, 12, 10, 0);
const T_OLD = Date.UTC(YEAR - 2, 5, 3, 9, 30);
const agent = (session, name, owner) => ({ session, name, switch: 'on', addressOk: true, block: 'present', connected: false, rereadOwed: false, account: 'yes', reminder: null, lastPost: null, held: 0, owner });
const AVA = agent('ava', 'Ava', { summary: 'Newest post is in the community', lines: [
  { text: 'The community section is in its instructions.' },
  { text: 'It has a community account.' },
  { text: 'Kosmos last went to remind it on ', at: T1, after: '. Delivered.' },
  { text: 'Its newest post, “Weekly ops”, is in the community.' },
] });
const BO = agent('bo', 'Bo', { summary: 'No community section in its instructions. Has not posted yet', lines: [
  { text: 'No community section in its instructions. It works in a folder of your own, and Kosmos does not add the section to instructions there.' },
  { text: 'No community account yet. Kosmos makes one the first time something it wrote goes to the community.' },
  { text: 'Kosmos has no record of going to remind it.' },
  { text: 'It has not posted yet.' },
] });
const CY = agent('cy', 'Cy', { summary: 'Has not posted yet. 2 waiting for you', lines: [
  { text: 'The community section is in its instructions.' },
  { text: 'It has a community account.' },
  { text: 'Kosmos last went to remind it on ', at: T1, after: '. Not sent: this computer had reached its hourly limit for messages to agents.' },
  { text: 'The last reminder that reached it was on ', at: T0, after: '.' },
  { text: 'It has not posted yet.' },
  { text: '2 items it wrote are under Waiting for you.' },
] });

async function run() {
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  /* A fixed zone that is not UTC, and a fixed locale: the TIME arm asserts an hour, and on a runner in UTC a page that
     wrote UTC would otherwise look right. */
  const page = (viewport = { width: 1400, height: 1000 }) => browser.newPage({ viewport, timezoneId: ZONE, locale: 'en-US' });
  try {
    // ROWS (the control)
    const p1 = await page();
    await p1.route(READY, answer({ agents: [AVA, BO, CY] }));
    await openAutomation(p1);
    const r = await readList(p1);
    check('ROWS: the list exists and its heading shows under Automation', r.found && r.headShown, JSON.stringify({ found: r.found, headShown: r.headShown }));
    check('ROWS: the heading sits below the posts-and-comments heading', r.belowMine, JSON.stringify(r.belowMine));
    check('ROWS: three rows, each with its name and summary, all closed', r.listHidden === false && r.emptyHidden === true && r.rows.length === 3
      && JSON.stringify(r.rows.map((x) => [x.session, x.name, x.summary, x.open])) === JSON.stringify([['ava', 'Ava', 'Newest post is in the community', false], ['bo', 'Bo', 'No community section in its instructions. Has not posted yet', false], ['cy', 'Cy', 'Has not posted yet. 2 waiting for you', false]]), JSON.stringify(r.rows.map((x) => [x.session, x.name, x.summary, x.open])));
    check('ROWS: the row\'s text has a space between the name and its words', r.rows[0].read === 'Ava Newest post is in the community', JSON.stringify(r.rows[0].read));
    check('ROWS: the note says a reminder only asks and the agent decides', /^Kosmos may remind an agent that has gone quiet to post, and only while the community and .Check on your agents. are both on\./.test(r.note) && /A reminder only asks: whether to post, and what to say, is the agent[’']s own decision\./.test(r.note), r.note);

    // OPEN
    await p1.click('#community-ready-list details[data-session="cy"] > summary');
    await p1.waitForTimeout(300);   // the mark's turn is a short transition; read it once it has ended
    const o = await readList(p1);
    check('OPEN: clicking a summary opens that row only', JSON.stringify(o.rows.map((x) => x.open)) === JSON.stringify([false, false, true]), JSON.stringify(o.rows.map((x) => x.open)));
    check('OPEN: the row holds every line the board sent, in order', o.rows[2].lines.length === CY.owner.lines.length
      && o.rows[2].lines.every((t, i) => t.startsWith(CY.owner.lines[i].text) && t.endsWith(CY.owner.lines[i].after || CY.owner.lines[i].text)), JSON.stringify(o.rows[2].lines));

    // TIME
    const tm = o.rows[2].times;
    check('TIME: each time is a <time> with a machine datetime', tm.length === 2 && tm[0].dt === new Date(T1).toISOString() && tm[1].dt === new Date(T0).toISOString(), JSON.stringify(tm));
    const local = await p1.evaluate((ms) => new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }), T1);
    // 15:04 UTC on the 12th is 00:04 on the 13th in Tokyo: the page's zone, not UTC and not this runner's.
    check('TIME CONTROL: the page is in a zone that is not UTC', /Jun 13/.test(local) && /12:04\s?AM/.test(local), local);
    check('TIME: it is written in the page\'s own zone, between the board\'s words', tm[0].text === local && o.rows[2].lines[2] === 'Kosmos last went to remind it on ' + local + '. Not sent: this computer had reached its hourly limit for messages to agents.', JSON.stringify([tm[0].text, local, o.rows[2].lines[2]]));

    // MARK
    check('MARK: every row shows a mark that it opens, hidden from a screen reader', o.rows.every((x) => x.mark && x.mark.shown && x.mark.w >= 8 && x.mark.h >= 8 && x.mark.hidden === 'true'), JSON.stringify(o.rows.map((x) => x.mark)));
    check('MARK: the open row\'s mark is turned and a closed row\'s is not', o.rows[2].mark.turn !== 'none' && o.rows[0].mark.turn === 'none', JSON.stringify([o.rows[0].mark.turn, o.rows[2].mark.turn]));

    // KEPT: the second answer differs, so a repaint that never happened cannot pass
    await p1.unroute(READY);
    await p1.route(READY, answer({ agents: [AVA, BO, { ...CY, owner: { ...CY.owner, summary: 'Newest post is in the community' } }] }));
    await p1.click('#s-nav button[data-go="automation"]');
    await p1.waitForFunction(() => { const d = document.querySelector('#community-ready-list details[data-session="cy"] summary .community-ready-words'); return d && d.textContent === 'Newest post is in the community'; }, null, { timeout: 5000 }).catch(() => {});
    const k = await readList(p1);
    check('KEPT CONTROL: the list was painted again from the new answer', k.rows.length === 3 && k.rows[2].summary === 'Newest post is in the community', JSON.stringify(k.rows.map((x) => x.summary)));
    check('KEPT: the opened row is still open, and the others still closed', k.rows.length === 3 && k.rows[2].open === true && k.rows[0].open === false && k.rows[1].open === false, JSON.stringify(k.rows.map((x) => x.open)));
    // a read that fails clears the list; the next good one must still know which row was open
    await p1.unroute(READY);
    await p1.route(READY, answer({ error: 'x' }, 503));
    await p1.click('#s-nav button[data-go="automation"]');
    await p1.waitForFunction(() => document.getElementById('community-ready-list').hidden === true, null, { timeout: 5000 }).catch(() => {});
    const kf = await readList(p1);
    check('KEPT CONTROL: the failed read cleared the list', kf.listHidden === true && kf.rows.length === 0, JSON.stringify([kf.listHidden, kf.rows.length]));
    await p1.unroute(READY);
    await p1.route(READY, answer({ agents: [AVA, BO, CY] }));
    await p1.click('#s-nav button[data-go="automation"]');
    await p1.waitForFunction(() => document.querySelectorAll('#community-ready-list li').length === 3, null, { timeout: 5000 }).catch(() => {});
    const k2 = await readList(p1);
    check('KEPT: after a read that failed, the row the person opened is open again', k2.rows.length === 3 && k2.rows[2].open === true && k2.rows[0].open === false, JSON.stringify(k2.rows.map((x) => x.open)));
    await p1.close();

    // KEYS
    const p2 = await page();
    await p2.route(READY, answer({ agents: [AVA, BO] }));
    await openAutomation(p2);
    await p2.focus('#community-ready-list details[data-session="ava"] > summary');
    const f1 = await readList(p2);
    check('KEYS CONTROL: the first summary can take focus', f1.focusIsSummary && f1.focusSession === 'ava', JSON.stringify([f1.focusIsSummary, f1.focusSession]));
    await p2.keyboard.press('Tab');
    const f2 = await readList(p2);
    check('KEYS: Tab moves to the next row\'s summary', f2.focusIsSummary && f2.focusSession === 'bo', JSON.stringify([f2.focusIsSummary, f2.focusSession]));
    check('MARK: a summary reached by the keyboard shows a focus ring', /^solid /.test(f2.rows[1].ring) && parseFloat(f2.rows[1].ring.split(' ')[1]) >= 2 && !/^solid /.test(f2.rows[0].ring), JSON.stringify([f2.rows[0].ring, f2.rows[1].ring]));
    await p2.keyboard.press('Enter');
    const f3 = await readList(p2);
    check('KEYS: Enter opens the focused row', f3.rows[1].open === true && f3.rows[0].open === false, JSON.stringify(f3.rows.map((x) => x.open)));
    // SAME: an identical answer leaves the rows on the page alone (a marked node is still there)
    await p2.evaluate(() => { document.querySelector('#community-ready-list details[data-session="bo"]').dataset.mark = 'kept'; });
    await p2.evaluate(() => refreshCommunityReady());
    await p2.waitForTimeout(500);
    const sameMark = await p2.evaluate(() => { const d = document.querySelector('#community-ready-list details[data-session="bo"]'); return d ? d.dataset.mark || null : 'gone'; });
    check('SAME: an identical answer does not rebuild the rows', sameMark === 'kept', String(sameMark));
    // a repaint under the keyboard keeps its place
    await p2.unroute(READY);
    await p2.route(READY, answer({ agents: [AVA, { ...BO, owner: { ...BO.owner, summary: 'Painted again' } }] }));
    await p2.evaluate(() => refreshCommunityReady());
    await p2.waitForFunction(() => { const d = document.querySelector('#community-ready-list details[data-session="bo"] summary .community-ready-words'); return d && d.textContent === 'Painted again'; }, null, { timeout: 5000 }).catch(() => {});
    const f4 = await readList(p2);
    check('KEPT CONTROL: the list was painted again under the keyboard', f4.rows.length === 2 && f4.rows[1].summary === 'Painted again', JSON.stringify(f4.rows.map((x) => x.summary)));
    const rebuilt = await p2.evaluate(() => { const d = document.querySelector('#community-ready-list details[data-session="bo"]'); return d ? d.dataset.mark || null : 'gone'; });
    check('SAME CONTROL: a different answer does rebuild them (the mark is gone)', rebuilt === null, String(rebuilt));
    check('KEPT: a repaint leaves the keyboard on the same row\'s summary', f4.focusIsSummary && f4.focusSession === 'bo' && f4.rows[1].open === true, JSON.stringify([f4.focusIsSummary, f4.focusSession, f4.rows.map((x) => x.open)]));
    // a read that fails takes the row away: the keyboard goes to the heading, not to nothing
    await p2.unroute(READY);
    await p2.route(READY, answer({ error: 'x' }, 503));
    await p2.evaluate(() => refreshCommunityReady());
    await p2.waitForFunction(() => document.getElementById('community-ready-list').hidden === true, null, { timeout: 5000 }).catch(() => {});
    const onHead = await p2.evaluate(() => document.activeElement && document.activeElement.id);
    check('KEPT: when a failed read takes the focused row away, focus goes to the heading', onHead === 'community-ready-head', String(onHead));
    // the same when the read is good and that agent is simply gone
    await p2.unroute(READY);
    await p2.route(READY, answer({ agents: [AVA, BO] }));
    await p2.evaluate(() => refreshCommunityReady());
    await p2.waitForFunction(() => document.querySelectorAll('#community-ready-list li').length === 2, null, { timeout: 5000 }).catch(() => {});
    await p2.focus('#community-ready-list details[data-session="bo"] > summary');
    await p2.unroute(READY);
    await p2.route(READY, answer({ agents: [AVA] }));
    await p2.evaluate(() => refreshCommunityReady());
    await p2.waitForFunction(() => document.querySelectorAll('#community-ready-list li').length === 1, null, { timeout: 5000 }).catch(() => {});
    const gone = await p2.evaluate(() => [document.querySelectorAll('#community-ready-list li').length, document.activeElement && document.activeElement.id]);
    check('KEPT: when the focused agent is gone from a good read, focus goes to the heading', gone[0] === 1 && gone[1] === 'community-ready-head', JSON.stringify(gone));
    await p2.close();

    // TIME a time the page cannot read
    const p3 = await page();
    await p3.route(READY, answer({ agents: [agent('dee', 'Dee', { summary: 'Newest post is in the community', lines: [{ text: 'Kosmos last went to remind it on ', at: 1e20, after: '. Delivered.' }, { text: 'It went again on ', at: 'soon', after: '.' }, { text: 7 }, null, { text: 'Last line.' }, { text: 'Long ago, on ', at: T_OLD, after: '.' }, { text: 'Its time was lost on ', after: '.' }] })] }));
    await openAutomation(p3);
    const bt = await readList(p3);
    check('TIME: a time the page cannot read says so, with no datetime and never "Invalid Date"', bt.rows.length === 1 && bt.rows[0].lines.length === 5
      && bt.rows[0].lines[0] === 'Kosmos last went to remind it on a date Kosmos could not read. Delivered.' && bt.rows[0].lines[1] === 'It went again on a date Kosmos could not read.'
      && !/Invalid/.test(bt.rows[0].lines.join(' ')) && bt.rows[0].times.slice(0, 2).every((t) => t.dt === null), JSON.stringify(bt.rows[0]));
    check('ODD: a line with no words is skipped, not painted as an empty paragraph', bt.rows[0].lines.length === 5 && bt.rows[0].lines[2] === 'Last line.', JSON.stringify(bt.rows[0].lines));
    check('TIME: a line whose time was lost on the way still ends, saying the date could not be read', bt.rows[0].lines[4] === 'Its time was lost on a date Kosmos could not read.', JSON.stringify(bt.rows[0].lines[4]));
    const oldLocal = await p3.evaluate((ms) => new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }), T_OLD);
    check('TIME: a time in another year shows its year', bt.rows[0].lines[3] === 'Long ago, on ' + oldLocal + '.' && oldLocal.includes(String(YEAR - 2)), JSON.stringify([bt.rows[0].lines[3], oldLocal]));
    await p3.close();

    // HOSTILE
    const p4 = await page();
    const X = '<img src=x onerror="window.__ready5958=true"><script>window.__ready5958=true</script><b>bold</b>';
    await p4.route(READY, answer({ agents: [agent('mal', X, { summary: X, lines: [{ text: X }, { text: X, at: T1, after: X }] })] }));
    await openAutomation(p4);
    await p4.waitForTimeout(300);
    const h = await readList(p4);
    check('HOSTILE: markup in a name, summary and line is shown as text, after a time too', h.rows.length === 1 && h.rows[0].name === X && h.rows[0].summary === X && h.rows[0].lines[0] === X && h.rows[0].lines[1].startsWith(X) && h.rows[0].lines[1].endsWith(X), JSON.stringify(h.rows[0]));
    check('HOSTILE: nothing in it became an element or ran', h.rows[0].elements === 0 && h.injected === false, JSON.stringify([h.rows[0].elements, h.injected]));
    await p4.close();

    // EMPTY
    const p5 = await page();
    await p5.route(READY, answer({ agents: [] }));
    await openAutomation(p5);
    const e = await readList(p5);
    check('EMPTY: the list is hidden and the line says there are no agents yet', e.listHidden === true && e.emptyHidden === false && e.empty === 'Kosmos lists no agents yet.', JSON.stringify([e.listHidden, e.emptyHidden, e.empty]));
    await p5.close();

    // 503 and 403
    for (const [status, body] of [[503, { error: 'we could not check which agents are running just now; try again' }], [403, { error: 'no' }]]) {
      const p = await page();
      await p.route(READY, answer(body, status));
      await openAutomation(p);
      const s = await readList(p);
      check(status + ': the line says it could not check, never "no agents"', s.listHidden === true && s.emptyHidden === false && /^We could not check where your agents stand just now\./.test(s.empty) && !/no agents/.test(s.empty), JSON.stringify([s.listHidden, s.emptyHidden, s.empty]));
      await p.close();
    }

    // ODD
    const p6 = await page();
    await p6.route(READY, answer({ agents: [null, { name: 'No session', owner: AVA.owner }, { session: 'nolines', name: 'No lines' }, { session: 'badlines', name: 'Bad', owner: { summary: 's', lines: 'x' } }, { ...BO, name: { odd: true } }] }));
    await openAutomation(p6);
    const od = await readList(p6);
    check('ODD: rows the page cannot paint are skipped and the rest are painted', od.rows.length === 1 && od.rows[0].session === 'bo' && od.listHidden === false, JSON.stringify(od.rows.map((x) => x.session)));
    check('ODD: a name that is not words falls back to the agent\'s session name', od.rows.length === 1 && od.rows[0].name === 'bo', JSON.stringify(od.rows.map((x) => x.name)));
    await p6.close();
    const p7 = await page();
    await p7.route(READY, answer({ agents: [{ session: 'nolines', name: 'No lines' }] }));
    await openAutomation(p7);
    const od2 = await readList(p7);
    check('ODD: when rows came and none can be painted, the line says it could not check, never "no agents"', od2.listHidden === true && od2.emptyHidden === false && /^We could not check where your agents stand just now\./.test(od2.empty) && !/no agents/.test(od2.empty), JSON.stringify([od2.listHidden, od2.emptyHidden, od2.empty]));
    await p7.close();

    // FRESH: the switch changes what every row says, so saving it must read the list again
    const p9 = await page();
    let reads = 0;
    const OFF = { ...AVA, owner: { summary: 'The community is off', lines: [{ text: 'The community is off on this computer.' }] } };
    let onNow = false;
    await p9.route(READY, (route) => { reads += 1; return answer({ agents: [onNow ? AVA : OFF] })(route); });
    await p9.route('**/api/community-setting', (route) => {
      if (route.request().method() === 'PUT') { onNow = true; return answer({ ok: true, on: true })(route); }
      return answer({ ok: true, on: onNow })(route);
    });
    await openAutomation(p9);
    const fr0 = await readList(p9);
    check('FRESH CONTROL: with the community off, the row says so', fr0.rows.length === 1 && fr0.rows[0].summary === 'The community is off', JSON.stringify(fr0.rows.map((x) => x.summary)));
    const before = reads;
    const toggle = await p9.evaluate(() => { const t = document.getElementById('community-toggle'); return { shown: Boolean(t) && !t.hidden, on: t ? t.getAttribute('aria-checked') : null }; });
    check('FRESH CONTROL: the community switch is there to press, and reads off', toggle.shown && toggle.on === 'false', JSON.stringify(toggle));
    await p9.click('#community-toggle');
    await p9.waitForFunction(() => { const d = document.querySelector('#community-ready-list summary .community-ready-words'); return d && d.textContent === 'Newest post is in the community'; }, null, { timeout: 5000 }).catch(() => {});
    const fr1 = await readList(p9);
    check('FRESH: turning the switch on reads the list again and the row stops saying it is off', reads > before && fr1.rows.length === 1 && fr1.rows[0].summary === 'Newest post is in the community', JSON.stringify([reads - before, fr1.rows.map((x) => x.summary)]));
    // the other switch the rows name
    const NOTREM = { ...AVA, owner: { summary: '“Check on your agents” is off', lines: [{ text: '“Check on your agents” is off on this computer.' }] } };
    let hbOn = true;
    let hbPuts = 0;
    await p9.unroute(READY);
    await p9.route(READY, (route) => { reads += 1; return answer({ agents: [hbOn ? AVA : NOTREM] })(route); });
    await p9.route('**/api/heartbeat-setting', (route) => {
      if (route.request().method() === 'PUT') { hbPuts += 1; hbOn = !hbOn; }
      return answer({ ok: true, on: hbOn, intervalMinutes: 15 })(route);
    });
    await p9.click('#s-nav button[data-go="automation"]');
    await p9.waitForFunction(() => { const t = document.getElementById('hb-toggle'); return t && !t.hidden && t.getAttribute('aria-checked') === 'true'; }, null, { timeout: 5000 }).catch(() => {});
    const hb = await p9.evaluate(() => { const t = document.getElementById('hb-toggle'); return { shown: Boolean(t) && !t.hidden, on: t ? t.getAttribute('aria-checked') : null }; });
    check('FRESH CONTROL: "Check on your agents" is there to press, and reads on', hb.shown && hb.on === 'true', JSON.stringify(hb));
    const beforeHb = reads;
    await p9.click('#hb-toggle');
    await p9.waitForFunction(() => { const d = document.querySelector('#community-ready-list summary .community-ready-words'); return d && /Check on your agents/.test(d.textContent); }, null, { timeout: 5000 }).catch(() => {});
    const fr2 = await readList(p9);
    check('FRESH CONTROL: pressing it saved the setting', hbPuts === 1, String(hbPuts));
    check('FRESH: turning "Check on your agents" off reads the list again and the row says that switch is off', reads > beforeHb && fr2.rows.length === 1 && fr2.rows[0].summary === '“Check on your agents” is off', JSON.stringify([reads - beforeHb, fr2.rows.map((x) => x.summary)]));
    await p9.close();

    // FRESH: deleting a post reads the rows again (they name the newest post)
    const p10 = await page();
    let readsD = 0;
    await p10.route(READY, (route) => { readsD += 1; return answer({ agents: [AVA] })(route); });
    await p10.route('**/api/community/mine', answer({ posts: [{ id: 'p1', title: 'Weekly ops', agent: 'Ava', postedAt: new Date().toISOString(), state: 'sent', deleteRequested: false, takenDown: false, takeDownReason: null, agentRefused: false, canDelete: true }], comments: [] }));
    let deletes = 0;
    await p10.route('**/api/community/delete', (route) => { deletes += 1; return answer({ ok: true, state: 'sent' })(route); });
    await openAutomation(p10);
    await p10.waitForSelector('#community-mine-list .community-mine-start', { timeout: 5000 }).catch(() => {});
    const beforeD = readsD;
    await p10.click('#community-mine-list .community-mine-start').catch(() => {});
    await p10.click('#community-mine-list .community-mine-del').catch(() => {});
    await p10.waitForFunction(() => !document.querySelector('#community-mine-list .community-mine-ask'), null, { timeout: 5000 }).catch(() => {});   // the ask closes once the delete is answered
    await p10.waitForTimeout(500);   // and the repaint that follows it
    check('FRESH CONTROL: the delete was asked for', deletes === 1, String(deletes));
    check('FRESH: deleting a post reads the rows again', readsD > beforeD, JSON.stringify([beforeD, readsD]));
    // and finishing a release or a discard (the handler both of them end in)
    const beforeH = readsD;
    const hasDone = await p10.evaluate(() => typeof communityHeldDone === 'function');
    check('FRESH CONTROL: the held list\'s finishing step is there to call', hasDone, String(hasDone));
    await p10.evaluate(() => communityHeldDone());
    await p10.waitForTimeout(800);
    check('FRESH: finishing a release or a discard reads the rows again', readsD > beforeH, JSON.stringify([beforeH, readsD]));
    await p10.close();

    // PHONE
    const p8 = await page({ width: 390, height: 844 });
    const LONG = agent('long', 'An agent with a very long name that has no reason to fit on one line of a phone', { summary: 'Its community account is waiting on an earlier try', lines: [
      { text: 'An earlier try made a community account under its name and Kosmos never received the key, so it waits rather than make a second.' },
      { text: 'Its newest post, “' + 'averyveryverylongunbrokenwordthatcannotwrapanywhereonitsown'.repeat(3) + '”, is not in the community.' },
    ] });
    /* The longest summary the board can send: every part at once. Beside a name it would be a narrow column. */
    const ALL = 'The community is off. This computer’s community address is not one Kosmos sends to. “Check on your agents” is off. No community section in its instructions. The community has refused this agent. Newest post has not gone to the community. Kosmos could not check everything just now. 2 waiting for you';
    const MID = agent('mid', 'Quartermaster of the northern depot', { summary: ALL, lines: [{ text: 'No community section in its instructions.' }] });
    await p8.route(READY, answer({ agents: [LONG, CY, MID] }));
    await openAutomation(p8);
    await p8.evaluate(() => document.querySelectorAll('#community-ready-list details').forEach((d) => { d.open = true; }));
    await p8.evaluate(() => document.getElementById('community-ready-head').scrollIntoView());
    const ph = await readList(p8);
    check('PHONE CONTROL: the rows are painted at 390 px', ph.viewport === 390 && ph.rows.length === 3 && ph.rows[0].lines.length === 2, JSON.stringify([ph.viewport, ph.rows.length]));
    check('PHONE: under a name of any length the words have a line of their own, as wide as the row', ph.rows.every((x) => x.wordsBelowName === true && x.sumWidth > 200 && x.wordsWidth >= x.sumWidth - 2), JSON.stringify(ph.rows.map((x) => [x.name.length, x.wordsBelowName, x.wordsWidth, x.sumWidth])));
    check('PHONE: the longest summary the board can send wraps into a few full lines, not a column', ph.rows[2].summary.length > 250 && ph.rows[2].wordsLines >= 2 && ph.rows[2].wordsLines <= 12, JSON.stringify([ph.rows[2].summary.length, ph.rows[2].wordsLines]));
    check('PHONE: the mark stays on the name\'s line, never alone above it', ph.rows.every((x) => x.markBesideName === true), JSON.stringify(ph.rows.map((x) => x.markBesideName)));
    check('PHONE: no row is wider than the screen or scrolls sideways', ph.rows.every((x) => x.right <= ph.viewport && !x.scrollWide) && !ph.pageWide, JSON.stringify(ph.rows.map((x) => [x.right, x.scrollWide]).concat([ph.pageWide])));
    check('PHONE: each summary is at least 44 px tall', ph.rows.every((x) => x.sumHeight >= 44), JSON.stringify(ph.rows.map((x) => x.sumHeight)));
    await p8.close();
  } finally {
    await browser.close();
  }
  if (fails.length) { console.log('\n' + fails.length + ' FAILED'); process.exit(1); }
  console.log('\nall passed');
}

run().catch((e) => { console.error(e); process.exit(1); });
