'use strict';

/**
 * #6160 (Josh, 10-14): the streak in the Kosmos. engine/streak.js counts the days in a row this person opened the
 * board; POST /api/streak records a visit on the page's own local date and answers { count, congrats }. The page puts
 * the count in a label under the K mark (shown on hover, focus, or a long press on a phone) and, when congrats is
 * true, a small note there in Josh's words. This drives the REAL page with only /api/streak stubbed:
 *
 *   note       -> 12 days, congrats: the note says "Congrats you've been in the Kosmos for 12 days!", and the label
 *                 is hidden while it shows; the page sent ITS local date
 *   dismiss    -> the X hides the note; from the keyboard, focus moves to the K mark
 *   no note    -> 12 days, no congrats: no note (the control for the arm above); hovering shows the label
 *   day 1      -> "1 day in the Kosmos", and no note even if the board said congrats (nothing to congratulate yet)
 *   none       -> count 0: no label, and the K mark is not described by an empty one
 *   click      -> a click on the K mark still goes to Agents
 *   long press -> on a touch screen, a long press shows the label and does NOT navigate; a tap still does (control)
 *   midnight   -> a page left open across the person's midnight asks again with the new date
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
  await pg.goto(URL, { waitUntil: 'domcontentloaded' });
  if (!(await pg.$('#firstrun[hidden]'))) { await pg.keyboard.press('Escape'); await pg.waitForTimeout(300); }
  say(await asked, (opts.key || 'page') + ': the page asked the board for the streak');
  await pg.waitForTimeout(250);
  return { pg, errs, posts };
}
const read = (pg) => pg.evaluate(() => {
  const note = document.getElementById('kcongrats'), lab = document.getElementById('kstreak'), k = document.getElementById('klink');
  const r = note && !note.hidden ? note.getBoundingClientRect() : null;
  return {
    note: note ? { hidden: note.hidden, text: (note.querySelector('.kcongrats-txt') || {}).textContent, role: note.getAttribute('role'), x: (note.querySelector('.ux') || { getAttribute: () => null }).getAttribute('aria-label'), right: r ? r.right : null, left: r ? r.left : null } : null,
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
    say(Boolean(g.note) && !g.note.hidden, 'note: it shows');
    say(g.note && g.note.text === JOSH, "note: Josh's sentence, word for word", JSON.stringify(g.note && g.note.text));
    say(g.note && g.note.role === 'status' && g.note.x === 'Dismiss', 'note: role=status, and the X is labelled Dismiss', JSON.stringify(g.note));
    say(g.label && g.label.text === '12 days in a row in the Kosmos', 'note: the label carries the count', JSON.stringify(g.label));
    say(g.label && g.label.display === 'none', 'note: the label is hidden while the note shows (never two bubbles)', JSON.stringify(g.label));
    say(posts.length >= 1 && posts[0].method === 'POST' && posts[0].body.today === localDay(NOON), "note: the page sent its own local date", JSON.stringify(posts[0]));
    await pg.screenshot({ path: path.join(OUT, 'streak-note.png') }).catch(() => {});
    await pg.focus('#kcongrats .ux');
    await pg.keyboard.press('Enter');
    await pg.waitForTimeout(200);
    const after = await read(pg);
    say(after.note && after.note.hidden, 'dismiss: the X hides the note');
    const focus = await pg.evaluate(() => (document.activeElement || {}).id || null);
    say(focus === 'klink', 'dismiss: focus moves to the K mark', JSON.stringify(focus));
    say(errs.length === 0, 'note: no page errors', errs.join(' | '));
    await pg.close();
  }

  // no note (control) + hover
  {
    const { pg, errs } = await open(b, () => ({ count: 12, congrats: false }), { key: 'no note' });
    const g = await read(pg);
    say(g.note && g.note.hidden, 'no note: no congrats, no note (control)');
    say(g.label && g.label.opacity === '0', 'no note: the label waits for a hover', JSON.stringify(g.label));
    say(g.described === 'kstreak', 'no note: the K mark is described by the label', JSON.stringify(g.described));
    await pg.hover('#klink');
    await pg.waitForTimeout(250);
    const h = await read(pg);
    say(h.label && h.label.opacity === '1' && h.label.text === '12 days in a row in the Kosmos', 'hover: the label shows the streak', JSON.stringify(h.label));
    await pg.screenshot({ path: path.join(OUT, 'streak-hover.png') }).catch(() => {});
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
    // A real tap leaves :hover stuck on a touch screen; the label must not hang under the mark after it.
    await pg.tap('#klink');
    await pg.waitForTimeout(300);
    const afterTap = await read(pg);
    say(afterTap.label && afterTap.label.opacity === '0', 'touch: after a real tap the label does not stay up', JSON.stringify(afterTap.label));
    say(errs.length === 0, 'long press: no page errors', errs.join(' | '));
    await pg.close();
  }

  // midnight: a page open across the person's midnight asks again with the new date
  {
    const before = (() => { const d = new Date(); d.setHours(23, 59, 30, 0); return d.getTime(); })();
    const { pg, posts } = await open(b, (body) => ({ count: 3, congrats: false, echo: body.today }), { key: 'midnight', clockInstall: before });
    const first = posts.length ? posts[posts.length - 1].body.today : null;
    await pg.clock.runFor(2 * 60 * 1000);
    await pg.waitForTimeout(300);
    const days = posts.map((p) => p.body.today);
    say(first === localDay(before), 'midnight: the first visit is the old day', JSON.stringify(first));
    say(days.includes(localDay(before + 60 * 1000)), 'midnight: after midnight the page asks again with the new day', JSON.stringify(days));
    say(days.filter((d) => d === localDay(before)).length === 1, 'midnight: the old day was asked once, not every minute', JSON.stringify(days));
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
