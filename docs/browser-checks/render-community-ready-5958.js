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
 *             board's words; a time the page cannot read says so and is never "Invalid Date".
 *   KEPT      a row the person opened stays open when the list is painted again (opening Automation again).
 *   HOSTILE   a name, summary and line made of markup are shown as text; nothing in them becomes an element.
 *   EMPTY     no agents: the list is hidden and the line says there are none yet.
 *   503       the board could not read its agents: the line says it could not check, never "no agents".
 *   403       a gated read says the same.
 *   ODD       rows the page cannot paint (no session, no owner lines) are skipped, the rest are painted.
 *   PHONE     at 390 px wide, nothing in the list is wider than the screen and each summary is at least 28 px tall.
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
        summary: sum && sum.querySelector('span') ? sum.querySelector('span').textContent : null,
        lines: d ? [...d.querySelectorAll(':scope > p')].map((p) => p.textContent) : [],
        times: d ? [...d.querySelectorAll('time')].map((t) => ({ dt: t.getAttribute('datetime'), text: t.textContent })) : [],
        elements: li.querySelectorAll('img, script, a, button, input, iframe').length,
        sumHeight: sb ? Math.round(sb.height) : 0,
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
const T1 = Date.parse('2026-10-12T15:04:00Z');
const T0 = Date.parse('2026-10-12T10:00:00Z');
const agent = (session, name, owner) => ({ session, name, switch: 'on', addressOk: true, block: 'present', connected: false, rereadOwed: false, account: 'yes', reminder: null, lastPost: null, held: 0, owner });
const AVA = agent('ava', 'Ava', { summary: 'Nothing found in its way', needsYou: false, lines: [
  { text: 'The community section is in its instructions.' },
  { text: 'It has a community account.' },
  { text: 'Kosmos last went to remind it ', at: T1, after: ': delivered.' },
  { text: 'Its newest post is "Weekly ops". Where that post stands is in the list of posts and comments.' },
] });
const BO = agent('bo', 'Bo', { summary: 'No community section in its instructions', needsYou: true, lines: [
  { text: 'No community section in its instructions. It works in a folder of your own, and Kosmos does not add the section to instructions there.' },
  { text: 'No community account yet. Kosmos makes one the first time something of its goes to the community.' },
  { text: 'Kosmos has no record of going to remind it.' },
  { text: 'It has not posted yet.' },
] });
const CY = agent('cy', 'Cy', { summary: 'Waiting for you', needsYou: true, lines: [
  { text: 'The community section is in its instructions.' },
  { text: 'It has a community account.' },
  { text: 'Kosmos last went to remind it ', at: T1, after: ': not sent: this board had reached its hourly limit for messages to agents.' },
  { text: 'The last reminder that reached it was ', at: T0, after: '.' },
  { text: 'It has not posted yet.' },
  { text: '2 items of its are waiting for you, under Waiting for you.' },
] });

async function run() {
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  const page = (viewport = { width: 1400, height: 1000 }) => browser.newPage({ viewport });
  try {
    // ROWS (the control)
    const p1 = await page();
    await p1.route(READY, answer({ agents: [AVA, BO, CY] }));
    await openAutomation(p1);
    const r = await readList(p1);
    check('ROWS: the list exists and its heading shows under Automation', r.found && r.headShown, JSON.stringify({ found: r.found, headShown: r.headShown }));
    check('ROWS: the heading sits below the posts-and-comments heading', r.belowMine, JSON.stringify(r.belowMine));
    check('ROWS: three rows, each with its name and summary, all closed', r.listHidden === false && r.emptyHidden === true && r.rows.length === 3
      && JSON.stringify(r.rows.map((x) => [x.session, x.name, x.summary, x.open])) === JSON.stringify([['ava', 'Ava', 'Nothing found in its way', false], ['bo', 'Bo', 'No community section in its instructions', false], ['cy', 'Cy', 'Waiting for you', false]]), JSON.stringify(r.rows.map((x) => [x.session, x.name, x.summary, x.open])));
    check('ROWS: the note says a reminder only asks and the agent decides', /A reminder only asks: whether to post, and what to say, is the agent[’']s own decision\./.test(r.note), r.note);

    // OPEN
    await p1.click('#community-ready-list details[data-session="cy"] > summary');
    const o = await readList(p1);
    check('OPEN: clicking a summary opens that row only', JSON.stringify(o.rows.map((x) => x.open)) === JSON.stringify([false, false, true]), JSON.stringify(o.rows.map((x) => x.open)));
    check('OPEN: the row holds every line the board sent, in order', o.rows[2].lines.length === CY.owner.lines.length
      && o.rows[2].lines.every((t, i) => t.startsWith(CY.owner.lines[i].text) && t.endsWith(CY.owner.lines[i].after || CY.owner.lines[i].text)), JSON.stringify(o.rows[2].lines));

    // TIME
    const tm = o.rows[2].times;
    check('TIME: each time is a <time> with a machine datetime', tm.length === 2 && tm[0].dt === new Date(T1).toISOString() && tm[1].dt === new Date(T0).toISOString(), JSON.stringify(tm));
    const local = await p1.evaluate((ms) => new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }), T1);
    check('TIME: it is written in the page\'s own zone, between the board\'s words', tm[0].text === local && o.rows[2].lines[2] === 'Kosmos last went to remind it ' + local + ': not sent: this board had reached its hourly limit for messages to agents.', JSON.stringify([tm[0].text, local, o.rows[2].lines[2]]));

    // KEPT
    await p1.click('#s-nav button[data-go="automation"]');
    await p1.waitForTimeout(500);
    const k = await readList(p1);
    check('KEPT: the opened row is still open after the list is painted again', k.rows.length === 3 && k.rows[2].open === true && k.rows[0].open === false, JSON.stringify(k.rows.map((x) => x.open)));
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
    await p2.keyboard.press('Enter');
    const f3 = await readList(p2);
    check('KEYS: Enter opens the focused row', f3.rows[1].open === true && f3.rows[0].open === false, JSON.stringify(f3.rows.map((x) => x.open)));
    await p2.close();

    // TIME a time the page cannot read
    const p3 = await page();
    await p3.route(READY, answer({ agents: [agent('dee', 'Dee', { summary: 'Nothing found in its way', needsYou: false, lines: [{ text: 'Kosmos last went to remind it ', at: 1e20, after: ': delivered.' }, { text: 'It went again ', at: 'soon', after: '.' }] })] }));
    await openAutomation(p3);
    const bt = await readList(p3);
    check('TIME: a time the page cannot read says so, with no datetime and never "Invalid Date"', bt.rows.length === 1 && bt.rows[0].lines.length === 2
      && bt.rows[0].lines.every((t) => /at a time Kosmos could not read/.test(t) && !/Invalid/.test(t)) && bt.rows[0].times.every((t) => t.dt === null), JSON.stringify(bt.rows[0]));
    await p3.close();

    // HOSTILE
    const p4 = await page();
    const X = '<img src=x onerror="window.__ready5958=true"><script>window.__ready5958=true</script><b>bold</b>';
    await p4.route(READY, answer({ agents: [agent('mal', X, { summary: X, needsYou: true, lines: [{ text: X }, { text: X, at: T1, after: X }] })] }));
    await openAutomation(p4);
    await p4.waitForTimeout(300);
    const h = await readList(p4);
    check('HOSTILE: markup in a name, summary and line is shown as text', h.rows.length === 1 && h.rows[0].name === X && h.rows[0].summary === X && h.rows[0].lines[0] === X, JSON.stringify(h.rows[0]));
    check('HOSTILE: nothing in it became an element or ran', h.rows[0].elements === 0 && h.injected === false, JSON.stringify([h.rows[0].elements, h.injected]));
    await p4.close();

    // EMPTY
    const p5 = await page();
    await p5.route(READY, answer({ agents: [] }));
    await openAutomation(p5);
    const e = await readList(p5);
    check('EMPTY: the list is hidden and the line says there are no agents yet', e.listHidden === true && e.emptyHidden === false && e.empty === 'You have no agents yet.', JSON.stringify([e.listHidden, e.emptyHidden, e.empty]));
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
    await p6.route(READY, answer({ agents: [null, { name: 'No session', owner: AVA.owner }, { session: 'nolines', name: 'No lines' }, { session: 'badlines', name: 'Bad', owner: { summary: 's', lines: 'x' } }, BO] }));
    await openAutomation(p6);
    const od = await readList(p6);
    check('ODD: rows the page cannot paint are skipped and the rest are painted', od.rows.length === 1 && od.rows[0].session === 'bo' && od.listHidden === false, JSON.stringify(od.rows.map((x) => x.session)));
    await p6.close();
    const p7 = await page();
    await p7.route(READY, answer({ agents: [{ session: 'nolines', name: 'No lines' }] }));
    await openAutomation(p7);
    const od2 = await readList(p7);
    check('ODD: when no row can be painted the list is hidden and a line shows, not an empty box', od2.listHidden === true && od2.emptyHidden === false, JSON.stringify([od2.listHidden, od2.emptyHidden, od2.empty]));
    await p7.close();

    // PHONE
    const p8 = await page({ width: 390, height: 844 });
    const LONG = agent('long', 'An agent with a very long name that has no reason to fit on one line of a phone', { summary: 'Its community account is waiting on an earlier try', needsYou: true, lines: [
      { text: 'An earlier try made a community account under its name and Kosmos never received the key, so it waits rather than make a second.' },
      { text: 'Its newest post is "' + 'averyveryverylongunbrokenwordthatcannotwrapanywhereonitsown'.repeat(3) + '". Where that post stands is in the list of posts and comments.' },
    ] });
    await p8.route(READY, answer({ agents: [LONG, CY] }));
    await openAutomation(p8);
    await p8.evaluate(() => document.querySelectorAll('#community-ready-list details').forEach((d) => { d.open = true; }));
    await p8.evaluate(() => document.getElementById('community-ready-head').scrollIntoView());
    const ph = await readList(p8);
    check('PHONE CONTROL: the rows are painted at 390 px', ph.viewport === 390 && ph.rows.length === 2 && ph.rows[0].lines.length === 2, JSON.stringify([ph.viewport, ph.rows.length]));
    check('PHONE: no row is wider than the screen or scrolls sideways', ph.rows.every((x) => x.right <= ph.viewport && !x.scrollWide) && !ph.pageWide, JSON.stringify(ph.rows.map((x) => [x.right, x.scrollWide]).concat([ph.pageWide])));
    check('PHONE: each summary is at least 28 px tall', ph.rows.every((x) => x.sumHeight >= 28), JSON.stringify(ph.rows.map((x) => x.sumHeight)));
    await p8.close();
  } finally {
    await browser.close();
  }
  if (fails.length) { console.log('\n' + fails.length + ' FAILED'); process.exit(1); }
  console.log('\nall passed');
}

run().catch((e) => { console.error(e); process.exit(1); });
