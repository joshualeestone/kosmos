'use strict';

/**
 * #6160 (Josh, 10-14): the streak in the Kosmos. engine/streak.js counts the days in a row this person opened the
 * board; POST /api/streak records a visit on the page's own local date and answers { count, congrats }. The page puts
 * the count in a label under the K mark (shown on hover, focus, or a long press on a phone) and, when congrats is
 * true, a notice in #topnotes (#streak-slot) in Josh's words. This drives the REAL page with /api/streak stubbed:
 *
 *   note       -> 12 days, congrats: the notice says "Congrats you've been in the Kosmos for 12 days!", in the notice
 *                 stack (not under the K mark), gold-toned; the page sent ITS local date
 *   together   -> with the restart notice also showing, the two never overlap
 *   dismiss    -> the X empties the slot; from the keyboard, focus moves to the K mark
 *   no note    -> 12 days, no congrats: no note (the control for the arm above); hovering shows the label
 *   day 1      -> "1 day in the Kosmos", and no note even if the board said congrats (nothing to congratulate yet)
 *   refused    -> the board's own refusal (403 to the streak, 404 to the first-run read): every refused request
 *                 finishes, so the page's network goes quiet (#6188). Every arm but the first-run one loads through
 *                 gotoReady, which answers first run as done.
 *   none       -> count 0: no label, and the K mark is not described by an empty one
 *   click      -> a click on the K mark still goes to Agents
 *   long press -> on a touch screen, a long press shows the label and does NOT navigate; a tap still does (control)
 *   midnight   -> a page left open across the person's midnight, with the person there, asks again with the new
 *                 date; a hidden page does not (it counts when the person comes back)
 *   narrow     -> at 360px the note stays inside the screen
 *
 *   AGENT_WORKFORCE_DATA=/tmp/st PORT=17372 node server.js &
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" \
 *     KOSMOS_URL=http://127.0.0.1:17372 node docs/browser-checks/render-streak-6160.js /tmp/stshots
 *
 * HEADED by default. HEADED=0 on a machine with no console session.
 */

const { chromium } = require('playwright');
const path = require('node:path');

const URL = process.env.KOSMOS_URL || 'http://127.0.0.1:17372';
/* #6188: first run is over for this check. The welcome overlay opens on its own after load, and the Escape below
   only puts it away when it is already open: when it opened later it took focus from the dismiss arm (a flake on
   main too). Answering /api/first-run as done keeps it shut, as render-allagents-4812 does. */
const firstRunDone = (pg) => pg.route('**/api/first-run', (route) => route.fulfill({
  status: 200, contentType: 'application/json', body: JSON.stringify({ done: true }),
}).catch(() => {}));
// Every arm loads the page through this, so none can forget the first-run answer.
const gotoReady = async (pg) => { await firstRunDone(pg); await pg.goto(URL, { waitUntil: 'domcontentloaded' }); };
const OUT = process.argv[2] || '/tmp/stshots';
const fail = [];
const say = (ok, label, extra) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : '')); if (!ok) fail.push(label); };
const JOSH = "Congrats you've been in the Kosmos for 12 days!";
const localDay = (ms) => { const d = new Date(ms); const p = (n) => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); };
const NOON = (() => { const d = new Date(); d.setHours(12, 0, 0, 0); return d.getTime(); })();

/** A page with /api/streak answering `answer` (a function of the posted body), recording every body it was sent. */
async function open(b, answer, opts = {}) {
  const pg = await b.newPage({ viewport: opts.viewport || { width: 1400, height: 800 }, hasTouch: Boolean(opts.touch), isMobile: Boolean(opts.touch) });
  const errs = [], posts = [];
  pg.on('pageerror', (e) => errs.push(e.message));
  if (opts.clockInstall) await pg.clock.install({ time: opts.clockInstall }); else await pg.clock.setFixedTime(new Date(opts.at || NOON));
  await pg.route('**/api/streak', (route) => {
    let body = {}; try { body = JSON.parse(route.request().postData() || '{}'); } catch { /* recorded as empty */ }
    posts.push({ method: route.request().method(), body });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(answer(body)) }).catch(() => {});
  });
  const asked = pg.waitForResponse((r) => r.url().endsWith('/api/streak'), { timeout: 15000 }).then(() => true, () => false);
  await gotoReady(pg);
  if (!(await pg.$('#firstrun[hidden]'))) { await pg.keyboard.press('Escape'); await pg.waitForTimeout(300); }
  say(await asked, (opts.key || 'page') + ': the page asked the board for the streak');
  // Measure the app, not its loading screen: the K mark is visible once the board view is up.
  say(await pg.waitForSelector('#klink', { state: 'visible', timeout: 15000 }).then(() => true, () => false), (opts.key || 'page') + ': the app is up (the K mark is visible)');
  await pg.waitForTimeout(250);
  return { pg, errs, posts };
}
const read = (pg) => pg.evaluate(() => {
  const note = document.querySelector('#streak-slot .utoast.streak'), lab = document.getElementById('kstreak'), k = document.getElementById('klink');
  const r = note ? note.getBoundingClientRect() : null;
  const words = note && note.querySelector('.utxt');
  return {
    slot: Boolean(document.getElementById('streak-slot')),
    note: note ? { hidden: false, text: (note.querySelector('.utxt b') || {}).textContent, role: words ? words.getAttribute('role') : null, x: (note.querySelector('.ux') || { getAttribute: () => null }).getAttribute('aria-label'), right: r.right, left: r.left, top: r.top, bottom: r.bottom, tone: getComputedStyle(note).getPropertyValue('--utone').trim(), gold: getComputedStyle(note).getPropertyValue('--gold-edge').trim(), inStack: Boolean(note.closest('#topnotes')) } : { hidden: true },
    label: lab ? { hidden: lab.hidden, text: lab.textContent, display: getComputedStyle(lab).display, opacity: getComputedStyle(lab).opacity } : null,
    described: k ? k.getAttribute('aria-describedby') : null,
    vw: window.innerWidth,
    tab: (document.querySelector('#tabs [aria-selected="true"]') || {}).dataset ? document.querySelector('#tabs [aria-selected="true"]').dataset.tab : null,
  };
});

(async () => {
  const b = await chromium.launch({ headless: process.env.HEADED === '0' });

  // note + dismiss
  {
    const { pg, errs, posts } = await open(b, () => ({ count: 12, congrats: true }), { key: 'note' });
    const g = await read(pg);
    say(g.slot && !g.note.hidden, 'note: it shows');
    say(g.note.inStack, 'note: it is a notice in the stack under the navigation (#5018), not under the K mark');
    say(g.note.tone !== '' && g.note.tone === g.note.gold, 'note: gold-toned (--gold-edge)', g.note.tone + ' vs ' + g.note.gold);
    say(g.note && g.note.text === JOSH, "note: Josh's sentence, word for word", JSON.stringify(g.note && g.note.text));
    say(g.note && g.note.role === 'status' && g.note.x === 'Dismiss', 'note: role=status on the words, and the X is labelled Dismiss', JSON.stringify(g.note));
    say(g.label && g.label.text === '12 days in a row in the Kosmos', 'note: the label carries the count', JSON.stringify(g.label));
    say(posts.length >= 1 && posts[0].method === 'POST' && posts[0].body.today === localDay(NOON), "note: the page sent its own local date", JSON.stringify(posts[0]));
    await pg.screenshot({ path: path.join(OUT, 'streak-note.png') }).catch(() => {});
    await pg.focus('#streak-slot .ux');
    await pg.keyboard.press('Enter');
    await pg.waitForTimeout(200);
    const after = await read(pg);
    say(after.note.hidden, 'dismiss: the X empties the slot');
    const focus = await pg.evaluate(() => (document.activeElement || {}).id || null);
    say(focus === 'klink', 'dismiss: focus moves to the K mark', JSON.stringify(focus));
    say(errs.length === 0, 'note: no page errors', errs.join(' | '));
    await pg.close();
  }

  // together: the restart notice and the streak notice at once never overlap, at a desk and on a phone
  for (const vp of [{ width: 1400, height: 800 }, { width: 390, height: 844 }]) {
    const pg = await b.newPage({ viewport: vp });
    await pg.clock.setFixedTime(new Date(NOON));
    const at = new Date(NOON - 7 * 60000).toISOString();
    await pg.route('**/api/board/restart-note', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ note: { lastAliveAt: at, bootAt: at, upAt: new Date(NOON).toISOString() } }) }).catch(() => {}));
    await pg.route('**/api/streak', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ count: 12, congrats: true }) }).catch(() => {}));
    await gotoReady(pg);
    if (!(await pg.$('#firstrun[hidden]'))) { await pg.keyboard.press('Escape'); await pg.waitForTimeout(300); }
    const up = await pg.waitForSelector('#klink', { state: 'visible', timeout: 15000 }).then(() => true, () => false);
    say(up, 'together (' + vp.width + 'px): the app is up (the K mark is visible)');
    const both = await pg.waitForFunction(() => document.querySelector('#reboot-slot .utoast') && document.querySelector('#streak-slot .utoast'), null, { timeout: 12000 }).then(() => true, () => false);
    await pg.waitForTimeout(400);   // let the stack settle before measuring it
    say(both, 'together (' + vp.width + 'px): both notices show');
    const boxes = await pg.evaluate(() => [...document.querySelectorAll('#reboot-slot .utoast, #streak-slot .utoast')].map((e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom }; }));
    const [a, c] = boxes;
    const overlap = a && c && a.l < c.r && c.l < a.r && a.t < c.b && c.t < a.b;
    say(boxes.length === 2 && !overlap, 'together (' + vp.width + 'px): the two notices do not overlap', JSON.stringify(boxes));
    /* The label's anchor must not capture the notice stack: #topnotes is a child of .headleft and floats centred under
       the navigation (#5018). Making .headleft positioned once squeezed every notice into a column at the left. */
    // Against the header's own centre, the box #topnotes anchors to: window.innerWidth counts a classic scrollbar
    // (Linux CI draws a 15px one, macOS overlays it), which would put "centre" 7.5px off with nothing wrong.
    const mid = await pg.evaluate(() => { const r = document.querySelector('.apphead header').getBoundingClientRect(); return (r.left + r.right) / 2; });
    const centred = boxes.every((x) => Math.abs((x.l + x.r) / 2 - mid) < 4);
    say(centred, 'together (' + vp.width + 'px): the notices stay centred under the navigation', JSON.stringify({ header: mid, centres: boxes.map((x) => (x.l + x.r) / 2) }));
    await pg.screenshot({ path: path.join(OUT, 'streak-together-' + vp.width + '.png') }).catch(() => {});
    await pg.close();
  }

  // Kosmos+ remote: the K mark (and so its label) is hidden only at phone width, as on main; the note still shows there
  for (const vp of [{ width: 1400, height: 800 }, { width: 390, height: 844 }]) {
    const { pg } = await open(b, () => ({ count: 12, congrats: true }), { key: 'remote ' + vp.width, viewport: vp });
    const g = await pg.evaluate(() => {
      document.documentElement.classList.add('kremote');
      const k = document.getElementById('klink'), n = document.querySelector('#streak-slot .utoast.streak');
      return { mark: k.getClientRects().length > 0, note: Boolean(n) && n.getClientRects().length > 0 };
    });
    if (vp.width > 600) say(g.mark, 'remote 1400: the K mark stays (only phones hide it)', JSON.stringify(g));
    else say(!g.mark, 'remote 390: the K mark is hidden there, as on main', JSON.stringify(g));
    say(g.note, 'remote ' + vp.width + ': the day\'s note shows', JSON.stringify(g));
    await pg.close();
  }

  // the note waits while a pointer is on it, then goes
  {
    const { pg } = await open(b, () => ({ count: 12, congrats: true }), { key: 'pause', clockInstall: NOON });
    await pg.hover('#streak-slot .utoast.streak');
    await pg.clock.runFor(20 * 1000);
    const held = await pg.evaluate(() => Boolean(document.querySelector('#streak-slot .utoast.streak')));
    await pg.mouse.move(700, 700);
    await pg.clock.runFor(7 * 1000);
    const gone = await pg.evaluate(() => !document.querySelector('#streak-slot .utoast'));
    say(held, 'pause: 20 s with the pointer on it, the note is still there');
    say(gone, 'pause: once the pointer leaves, it goes');
    await pg.close();
  }

  // no note (control) + hover
  {
    const { pg, errs } = await open(b, () => ({ count: 12, congrats: false }), { key: 'no note' });
    const g = await read(pg);
    say(g.note && g.note.hidden, 'no note: no congrats, no note (control)');
    say(g.label && g.label.opacity === '0', 'no note: the label waits for a hover', JSON.stringify(g.label));
    const vis = await pg.evaluate(() => getComputedStyle(document.getElementById('kstreak')).visibility);
    say(vis === 'hidden', 'no note: at rest the label is hidden, so a screen reader reads it once, as the description', vis);
    say(g.described === 'kstreak', 'no note: the K mark is described by the label', JSON.stringify(g.described));
    await pg.hover('#klink');
    await pg.waitForTimeout(250);
    const h = await read(pg);
    say(h.label && h.label.opacity === '1' && h.label.text === '12 days in a row in the Kosmos', 'hover: the label shows the streak', JSON.stringify(h.label));
    await pg.screenshot({ path: path.join(OUT, 'streak-hover.png') }).catch(() => {});
    // Escape puts it away without moving the pointer (WCAG 1.4.13); leaving and coming back brings it again
    await pg.keyboard.press('Escape');
    await pg.waitForTimeout(250);
    const esc1 = (await read(pg)).label;
    await pg.mouse.move(700, 700); await pg.waitForTimeout(150); await pg.hover('#klink'); await pg.waitForTimeout(250);
    const back = (await read(pg)).label;
    say(esc1.opacity === '0', 'Escape: the label goes away with the pointer still on the mark', JSON.stringify(esc1));
    say(back.opacity === '1', 'Escape: the next hover brings it back', JSON.stringify(back));
    // Escape pressed somewhere else (closing a dialog), with the label not up, must not silence the next hover
    await pg.mouse.move(700, 700); await pg.waitForTimeout(200);
    await pg.keyboard.press('Escape'); await pg.waitForTimeout(150);
    await pg.hover('#klink'); await pg.waitForTimeout(250);
    const elsewhere = (await read(pg)).label;
    say(elsewhere.opacity === '1', 'Escape elsewhere: the next hover still shows the label', JSON.stringify(elsewhere));
    // click: still goes to Agents
    await pg.evaluate(() => { const t = document.querySelector('#tabs [data-tab="projects"]'); if (t) t.click(); });
    await pg.waitForTimeout(150);
    const before = (await read(pg)).tab;
    await pg.click('#klink');
    await pg.waitForTimeout(200);
    const now = (await read(pg)).tab;
    say(before === 'projects' && now === 'agents', 'click: the K mark still goes to Agents', before + ' -> ' + now);
    say(errs.length === 0, 'no note: no page errors', errs.join(' | '));
    await pg.close();
  }

  // day 1, and no streak
  {
    const { pg } = await open(b, () => ({ count: 1, congrats: true }), { key: 'day 1' });
    const g = await read(pg);
    say(g.label && g.label.text === '1 day in the Kosmos', 'day 1: "1 day in the Kosmos"', JSON.stringify(g.label));
    say(g.note && g.note.hidden, 'day 1: no note, even if the board said congrats');
    await pg.close();
  }
  {
    const { pg } = await open(b, () => ({ count: 0, congrats: false }), { key: 'none' });
    const g = await read(pg);
    say(g.label && g.label.hidden, 'none: no label at count 0');
    say(g.described === null, 'none: the K mark is not described by an empty label', JSON.stringify(g.described));
    await pg.close();
  }

  // long press on a touch screen
  {
    const { pg, errs } = await open(b, () => ({ count: 12, congrats: false }), { key: 'long press', touch: true, viewport: { width: 390, height: 844 } });
    await pg.evaluate(() => { const t = document.querySelector('#tabs [data-tab="projects"]'); if (t) t.click(); });
    await pg.waitForTimeout(150);
    const press = async (holdMs) => pg.evaluate(async (ms) => {
      const k = document.getElementById('klink'), r = k.getBoundingClientRect();
      const o = { pointerType: 'touch', isPrimary: true, bubbles: true, clientX: r.left + 5, clientY: r.top + 5, pointerId: 7 };
      k.dispatchEvent(new PointerEvent('pointerdown', o));
      await new Promise((res) => setTimeout(res, ms));
      const shown = document.getElementById('kstreak').classList.contains('show');
      k.dispatchEvent(new PointerEvent('pointerup', o));
      k.click();
      return shown;
    }, holdMs);
    // setFixedTime pins Date only; the long-press timer runs in real time
    const held = await press(700);
    const tabAfterHold = (await read(pg)).tab;
    say(held, 'long press: the label shows');
    say(tabAfterHold === 'projects', 'long press: it does not also go to Agents', tabAfterHold);
    await pg.waitForTimeout(2800);   // the long press's label clears after 2.5s; the tap must not read it
    const cleared = await pg.evaluate(() => !document.getElementById('kstreak').classList.contains('show'));
    say(cleared, 'long press: the label goes away again on its own');
    const tapped = await press(60);
    const tabAfterTap = (await read(pg)).tab;
    say(!tapped && tabAfterTap === 'agents', 'tap (control): a short tap still goes to Agents', JSON.stringify({ tapped, tabAfterTap }));
    // A long press that ends with NO click (Android raises contextmenu instead), then an ordinary tap: the tap navigates.
    await pg.evaluate(() => { const t = document.querySelector('#tabs [data-tab="projects"]'); if (t) t.click(); });
    await pg.evaluate(async () => {
      const k = document.getElementById('klink'), r = k.getBoundingClientRect();
      const o = { pointerType: 'touch', isPrimary: true, bubbles: true, clientX: r.left + 5, clientY: r.top + 5, pointerId: 8 };
      k.dispatchEvent(new PointerEvent('pointerdown', o));
      await new Promise((res) => setTimeout(res, 700));
      k.dispatchEvent(new PointerEvent('pointerup', o));   // no click follows
    });
    await pg.waitForTimeout(2800);
    await press(60);
    const tabAfterNoClick = (await read(pg)).tab;
    say(tabAfterNoClick === 'agents', 'long press with no click, then a tap: the tap still goes to Agents', tabAfterNoClick);
    // Android: the system long press cancels the pointer and raises its own menu; that menu shows the label, and is not opened
    await pg.waitForTimeout(2800);
    const android = await pg.evaluate(async () => {
      const k = document.getElementById('klink'), r = k.getBoundingClientRect();
      const o = { pointerType: 'touch', isPrimary: true, bubbles: true, clientX: r.left + 5, clientY: r.top + 5, pointerId: 9 };
      k.dispatchEvent(new PointerEvent('pointerdown', o));
      await new Promise((res) => setTimeout(res, 150));
      k.dispatchEvent(new PointerEvent('pointercancel', o));
      const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: o.clientX, clientY: o.clientY });
      const opened = k.dispatchEvent(menu);
      return { shown: document.getElementById('kstreak').classList.contains('show'), menuBlocked: !opened };
    });
    say(android.shown && android.menuBlocked, 'Android long press: its own menu shows the label and is not opened', JSON.stringify(android));
    // and a keyboard Enter right after (a tablet with a keyboard) is a real press: it navigates
    await pg.evaluate(() => { const t = document.querySelector('#tabs [data-tab="projects"]'); if (t) t.click(); });
    await pg.focus('#klink'); await pg.keyboard.press('Enter'); await pg.waitForTimeout(200);
    const tabAfterEnter = (await read(pg)).tab;
    say(tabAfterEnter === 'agents', 'keyboard after a long press: Enter on the K mark still goes to Agents', tabAfterEnter);
    // A real tap leaves :hover stuck on a touch screen; the label must not hang under the mark after it.
    await pg.evaluate(() => document.activeElement && document.activeElement.blur());   // the arms above leave the mark focused (label up by design)
    await pg.waitForTimeout(2800);                                                       // and a long-press label still on its 2.5 s
    await pg.tap('#klink');
    await pg.waitForTimeout(300);
    const afterTap = await read(pg);
    say(afterTap.label && afterTap.label.opacity === '0', 'touch: after a real tap the label does not stay up', JSON.stringify(afterTap.label));
    say(errs.length === 0, 'long press: no page errors', errs.join(' | '));
    await pg.close();
  }

  // retry: an answer with no count (count 0) is not a settled day; the next minute asks again, so it does not hide the label all day
  {
    let calls = 0;
    const pg = await b.newPage({ viewport: { width: 1400, height: 800 } });
    await pg.clock.install({ time: NOON });
    await pg.route('**/api/streak', (route) => { calls++; return route.fulfill(calls === 1 ? { status: 200, contentType: 'application/json', body: '{"count":0,"congrats":false}' } : { status: 200, contentType: 'application/json', body: JSON.stringify({ count: 5, congrats: false }) }).catch(() => {}); });
    await gotoReady(pg);
    if (!(await pg.$('#firstrun[hidden]'))) { await pg.keyboard.press('Escape'); await pg.waitForTimeout(300); }
    await pg.waitForSelector('#klink', { state: 'visible', timeout: 15000 }).catch(() => {});
    const first = await read(pg);
    await pg.clock.runFor(61 * 1000);
    await pg.waitForTimeout(300);
    const later = await read(pg);
    say(first.label && first.label.hidden && later.label && !later.label.hidden && later.label.text === '5 days in a row in the Kosmos', 'retry: after a failed answer the next minute asks again and the label appears', JSON.stringify({ calls, first: first.label, later: later.label }));
    await pg.close();
  }

  // a page that loads hidden (a tab restored in the background) does not count the day or spend the note until it is seen
  {
    let calls = 0;
    const pg = await b.newPage({ viewport: { width: 1400, height: 800 } });
    await pg.addInitScript(() => {
      let hidden = true;
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
      window.__show = () => { hidden = false; document.dispatchEvent(new Event('visibilitychange')); };
    });
    await pg.route('**/api/streak', (route) => { calls++; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ count: 12, congrats: true }) }).catch(() => {}); });
    await gotoReady(pg);
    await pg.waitForSelector('#klink', { state: 'attached', timeout: 15000 }).catch(() => {});
    await pg.waitForTimeout(1500);
    const whileHidden = calls;
    await pg.evaluate(() => window.__show());
    await pg.waitForTimeout(800);
    const seen = await pg.evaluate(() => Boolean(document.querySelector('#streak-slot .utoast.streak')));
    say(whileHidden === 0, 'hidden load: no visit is recorded while nobody can see the page', 'calls=' + whileHidden);
    say(calls === 1 && seen, 'hidden load: once it is shown, the day counts and the note appears', JSON.stringify({ calls, seen }));
    await pg.close();
  }

  // a board that keeps saying no is asked a handful of times, not every minute forever
  {
    let calls = 0; const statuses = [];
    const pg = await b.newPage({ viewport: { width: 1400, height: 800 } });
    await pg.clock.install({ time: NOON });
    // The refusal is the BOARD's own (#6188): the request goes on to it as if from another website, and its cross-site
    // write guard answers 403. A refusal Playwright makes up arrives whole, so it cannot show a body left unread.
    await pg.route('**/api/streak', async (route) => {
      calls++;
      try {
        // 403 because elsewhere.example is not this board (crossSiteWrite compares Origin to Host, and it is not in
        // AGENT_WORKFORCE_ALLOWED_HOSTS); the request still goes to the loopback board at KOSMOS_URL.
        const resp = await route.fetch({ headers: { ...route.request().headers(), origin: 'https://elsewhere.example' } });
        statuses.push(resp.status());
        await route.fulfill({ response: resp });
      } catch { await route.abort().catch(() => {}); }
    });
    // #6188: each refused request must FINISH (the page reads the refusal's body): left unread it stays open, and a
    // page waiting for the network to go quiet waits forever.
    const streakReqs = new Set(); let ended = 0;
    pg.on('request', (q) => { if (q.url().endsWith('/api/streak')) streakReqs.add(q); });
    pg.on('requestfinished', (q) => { if (streakReqs.has(q)) ended++; });   // an aborted request is not a read body
    await gotoReady(pg);
    if (!(await pg.$('#firstrun[hidden]'))) { await pg.keyboard.press('Escape'); await pg.waitForTimeout(300); }
    await pg.waitForSelector('#klink', { state: 'visible', timeout: 15000 }).catch(() => {});
    // One minute at a time, letting each real refusal arrive and be read before the next tick, so how many times the
    // page asks does not depend on how fast this machine is (a tick while an ask is pending is skipped).
    const settle = async () => { for (let i = 0; i < 50 && ended < streakReqs.size; i++) await pg.waitForTimeout(100); };
    await settle();
    for (let m = 0; m < 30; m++) { await pg.clock.runFor(60 * 1000); await pg.waitForTimeout(50); await settle(); }
    say(calls >= 2 && calls <= 6, 'refused: asked again a few times, then not every minute (30 minutes)', 'calls=' + calls);
    say(statuses.length >= 1 && statuses.every((x) => x === 403), 'refused: the board itself refused (403)', JSON.stringify(statuses));
    say(streakReqs.size >= 1 && ended === streakReqs.size, 'refused: every refused request finished (its body was read, #6188)', 'sent=' + streakReqs.size + ' finished=' + ended);
    await pg.close();
  }

  // #6188: the first-run read at load, refused by the board, ends too (the page reads the refusal's body). The refusal
  // is the board's own 404 (a route it does not have), passed through as the answer to /api/first-run.
  {
    const pg = await b.newPage({ viewport: { width: 1400, height: 800 } });
    const sent = new Set(); let finished = 0; const statuses = [];
    pg.on('request', (q) => { if (q.url().endsWith('/api/first-run')) sent.add(q); });
    pg.on('requestfinished', (q) => { if (sent.has(q)) finished++; });
    await pg.route('**/api/first-run', async (route) => {
      try {
        const resp = await route.fetch({ url: URL.replace(/\/$/, '') + '/api/zz-no-such-route-6188' });
        statuses.push(resp.status());
        await route.fulfill({ response: resp });
      } catch { await route.abort().catch(() => {}); }
    });
    await pg.route('**/api/streak', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"count":3,"congrats":false}' }).catch(() => {}));
    await pg.goto(URL, { waitUntil: 'domcontentloaded' });
    for (let i = 0; i < 80 && (sent.size === 0 || finished < sent.size); i++) await pg.waitForTimeout(100);
    say(statuses.length >= 1 && statuses.every((x) => x === 404), 'first run refused: the board itself refused (404)', JSON.stringify(statuses));
    say(sent.size >= 1 && finished === sent.size, 'first run refused: the refused read finished (its body was read, #6188)', 'sent=' + sent.size + ' finished=' + finished);
    await pg.close();
  }

  // midnight: a page open across the person's midnight, with the person there, asks again with the new date
  {
    const before = (() => { const d = new Date(); d.setHours(23, 59, 30, 0); return d.getTime(); })();
    const { pg, posts } = await open(b, (body) => ({ count: 3, congrats: false, echo: body.today }), { key: 'midnight', clockInstall: before });
    const first = posts.length ? posts[posts.length - 1].body.today : null;
    await pg.mouse.move(5, 300); await pg.mouse.down(); await pg.mouse.up();   // the person is there
    await pg.clock.runFor(2 * 60 * 1000);
    await pg.waitForTimeout(300);
    const days = posts.map((p) => p.body.today);
    say(first === localDay(before), 'midnight: the first visit is the old day', JSON.stringify(first));
    say(days.includes(localDay(before + 60 * 1000)), 'midnight: after midnight the page asks again with the new day', JSON.stringify(days));
    say(days.filter((d) => d === localDay(before)).length === 1, 'midnight: the old day was asked once, not every minute', JSON.stringify(days));
    await pg.close();
  }
  // midnight, nobody there: a page left open with no input does not count the new day (control for the arm above)
  {
    const before = (() => { const d = new Date(); d.setHours(23, 45, 0, 0); return d.getTime(); })();   // midnight is well past the 10-minute window, whatever open() pressed
    const { pg, posts } = await open(b, () => ({ count: 3, congrats: false }), { key: 'midnight, idle', clockInstall: before });
    await pg.clock.runFor(25 * 60 * 1000);   // past midnight, and well past the ten-minute window since the last input
    await pg.waitForTimeout(300);
    const days = posts.map((p) => p.body.today);
    say(!days.includes(localDay(before + 20 * 60 * 1000)), 'midnight, idle: an open page with nobody at it does not count the new day', JSON.stringify(days));
    await pg.close();
  }

  // narrow: the note stays on screen at 360px
  {
    const { pg } = await open(b, () => ({ count: 12, congrats: true }), { key: 'narrow', viewport: { width: 360, height: 800 } });
    const g = await read(pg);
    say(g.note && !g.note.hidden && g.note.left >= 0 && g.note.right <= g.vw, 'narrow: the note is inside a 360px screen', JSON.stringify({ left: g.note && g.note.left, right: g.note && g.note.right, vw: g.vw }));
    await pg.screenshot({ path: path.join(OUT, 'streak-note-360.png') }).catch(() => {});
    await pg.close();
  }

  await b.close();
  console.log(fail.length ? `\n${fail.length} FAILED` : '\nall good');
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
