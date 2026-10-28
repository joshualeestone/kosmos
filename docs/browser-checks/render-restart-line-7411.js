'use strict';

/**
 * kosmos#7411 step 4: the line naming the running agents that need a restart to get a fix in this update.
 *
 * engine/restartline.js decides who and which fixes; GET /api/restart-line serves it; the page paints it into
 * #rline-slot (Mona Lisa's design review on the card: the words say what they get and what a restart costs, once;
 * Restart all and Show who on the line; each agent's Restart in the list; Not now). This drives the REAL page by
 * stubbing only the restart-line routes and the per-agent restart at the network edge:
 *
 *   none        -> the slot is EMPTY (the control: the line shows only when there is one)
 *   words       -> "Ada, Kai and 3 more need a restart to get: Hooks fix." and "Restarting stops what they are doing now."
 *   show who    -> the list opens with one Restart per agent; "3 more" opens the same list
 *   one         -> an agent's Restart POSTs its restart; the re-check drops it from the line
 *   all         -> Restart all POSTs each agent's restart in order; one the engine refuses is named with its reason
 *   not now     -> POSTs this version and empties the slot; a refusal keeps the line and says why
 *   tones       -> neutral (--label-2) in light and dark
 *   phone       -> at 390px the line fits the screen (no sideways scroll) and the list opens
 *
 *   AGENT_WORKFORCE_DATA=/tmp/rl PORT=17373 node server.js &
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" \
 *     KOSMOS_URL=http://127.0.0.1:17373 node docs/browser-checks/render-restart-line-7411.js /tmp/rlshots
 *
 * HEADED by default. HEADED=0 on a machine with no console session.
 */

const { chromium } = require('playwright');
const path = require('node:path');

const URL = process.env.KOSMOS_URL || 'http://127.0.0.1:17373';
const OUT = process.argv[2] || '/tmp/rlshots';
const fail = [];
const say = (ok, label, extra) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : '')); if (!ok) fail.push(label); };

const AGENTS = ['Ada', 'Kai', 'Lee', 'Mo', 'Ty'].map((l) => ({ name: l.toLowerCase(), label: l }));
const LINE = { version: '0.7.73', notes: [{ version: '0.7.73', title: 'Hooks fix' }], agents: AGENTS };

/* One page with the routes stubbed. `state.line` is what GET answers; `state.refuse` names agents whose restart the
   engine refuses; `state.notNow` is the status Not now answers. Every POST is recorded in order. */
async function open(b, viewport, state) {
  const pg = await b.newPage({ viewport });
  const errs = [];
  pg.on('pageerror', (e) => errs.push(e.message));
  const posts = [];
  await pg.route('**/api/restart-line', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ line: state.line }) }).catch(() => {}));
  await pg.route('**/api/restart-line/not-now', (route) => {
    posts.push('not-now ' + route.request().postData());
    const ok = state.notNow === 200;
    if (ok) state.line = null;
    return route.fulfill({ status: state.notNow, contentType: 'application/json', body: JSON.stringify(ok ? { hidden: true } : { error: 'Kosmos has been updated again since this page loaded. Reload to see what is new.' }) }).catch(() => {});
  });
  await pg.route(/\/api\/agent\/[^/]+\/restart$/, (route) => {
    const name = decodeURIComponent(route.request().url().split('/api/agent/')[1].split('/')[0]);
    posts.push('restart ' + name);
    const refused = state.refuse.includes(name);
    if (!refused && state.line) {
      const left = state.line.agents.filter((a) => a.name !== name);
      state.line = left.length ? { ...state.line, agents: left } : null;
    }
    return route.fulfill({ status: refused ? 400 : 200, contentType: 'application/json', body: JSON.stringify(refused ? { outcome: 'refused', because: 'Kosmos could not find its window.' } : { outcome: 'restarted' }) }).catch(() => {});
  });
  const asked = pg.waitForResponse((r) => r.url().endsWith('/api/restart-line'), { timeout: 15000 }).then(() => true, () => false);
  await pg.goto(URL, { waitUntil: 'networkidle' });
  if (!(await pg.$('#firstrun[hidden]'))) { await pg.keyboard.press('Escape'); await pg.waitForTimeout(400); }
  const wasAsked = await asked;
  await pg.waitForTimeout(300);
  return { pg, errs, posts, wasAsked };
}
const text = (pg, sel) => pg.evaluate((s) => { const el = document.querySelector(s); return el ? el.textContent.replace(/\s+/g, ' ').trim() : null; }, sel);

(async () => {
  const b = await chromium.launch({ headless: process.env.HEADED === '0' });

  {
    const { pg, errs, wasAsked } = await open(b, { width: 1400, height: 800 }, { line: null, refuse: [], notNow: 200 });
    say(wasAsked, 'none: the page asked the board for the line');
    const html = await pg.evaluate(() => { const s = document.getElementById('rline-slot'); return s ? s.innerHTML.trim() : null; });
    say(html === '', 'none: no line, the slot is empty (control)', JSON.stringify(html));
    say(errs.length === 0, 'none: no page errors', errs.join(' | '));
    await pg.close();
  }

  {
    const state = { line: JSON.parse(JSON.stringify(LINE)), refuse: ['lee'], notNow: 200 };
    const { pg, errs, posts } = await open(b, { width: 1400, height: 800 }, state);
    say(await text(pg, '#rline-slot .utxt b') === 'Ada, Kai and 3 more need a restart to get: Hooks fix.', 'words: who, and what they get', JSON.stringify(await text(pg, '#rline-slot .utxt b')));
    say(await text(pg, '#rline-slot .utxt > small:last-of-type') === 'Restarting stops what they are doing now.', 'words: the cost, once');
    const acts = await pg.$$eval('#rline-slot .uacts button', (x) => x.map((e) => e.textContent.trim()).join('|'));
    say(acts === 'Restart all|Show who|Not now', 'buttons: Restart all, Show who and Not now on the line', JSON.stringify(acts));
    say(!(await pg.$('#rline-slot [data-rl-one]')), 'show who: no per-agent buttons before the list opens');
    const tone = await pg.evaluate(() => { const t = document.querySelector('#rline-slot .utoast'); return getComputedStyle(t).getPropertyValue('--utone').trim() === getComputedStyle(t).getPropertyValue('--label-2').trim(); });
    say(tone, 'tone: neutral in light');
    await pg.screenshot({ path: path.join(OUT, 'rline-desktop-light.png') }).catch(() => {});

    await pg.click('#rline-slot .rlmore');
    await pg.waitForTimeout(200);
    const rows = await pg.$$eval('#rline-slot .rlrow', (r) => r.map((x) => x.querySelector('span').textContent + '|' + x.querySelector('button').textContent));
    say(rows.length === 5 && rows[0] === 'Ada|Restart', 'show who: "3 more" opens the list, one Restart per agent', JSON.stringify(rows));
    const focus = await pg.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-rl-one'));
    say(focus === 'ada', 'show who: focus goes to the first agent\'s Restart', JSON.stringify(focus));
    say(await text(pg, '#rline-slot [aria-controls="rl-who"]') === 'Hide who', 'show who: the button now says Hide who');
    await pg.screenshot({ path: path.join(OUT, 'rline-desktop-list.png') }).catch(() => {});

    await pg.click('#rline-slot [data-rl-one="kai"]');
    await pg.waitForFunction(() => !document.querySelector('#rline-slot [data-rl-one="kai"]'), null, { timeout: 5000 }).catch(() => {});
    say(posts.join(',') === 'restart kai', 'one: Restart posts only that agent\'s restart', JSON.stringify(posts));
    say(await text(pg, '#rline-slot .utxt b') === 'Ada, Lee and 2 more need a restart to get: Hooks fix.', 'one: the re-check drops it from the line', JSON.stringify(await text(pg, '#rline-slot .utxt b')));

    posts.length = 0;
    await pg.click('#rline-slot [data-rl-all]');
    await pg.waitForFunction(() => /did not restart/.test((document.querySelector('#rline-slot') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
    say(posts.join(',') === 'restart ada,restart lee,restart mo,restart ty', 'all: Restart all posts each agent\'s restart, in order', JSON.stringify(posts));
    const left = await text(pg, '#rline-slot .utxt b');
    say(left === 'Lee needs a restart to get: Hooks fix.', 'all: only the refused agent is left on the line', JSON.stringify(left));
    const why = await text(pg, '#rline-slot .rerr');
    say(why === 'Lee did not restart: Kosmos could not find its window.', 'all: the refused agent is named with the engine\'s reason', JSON.stringify(why));
    say(await text(pg, '#rline-slot [data-rl-all]') === 'Restart Lee', 'one left: its button is named for it');
    say(errs.length === 0, 'restart: no page errors', errs.join(' | '));
    await pg.close();
  }

  {
    const state = { line: JSON.parse(JSON.stringify(LINE)), refuse: [], notNow: 409 };
    const { pg, errs, posts } = await open(b, { width: 1400, height: 800 }, state);
    await pg.click('#rline-slot [data-rl-later]');
    await pg.waitForTimeout(300);
    const refused = await text(pg, '#rline-slot .rerr');
    say(Boolean(await pg.$('#rline-slot .utoast')) && /updated again since this page loaded/.test(refused || ''), 'not now refused: the line stays and says why', JSON.stringify(refused));
    state.notNow = 200;
    await pg.focus('#rline-slot [data-rl-later]');
    await pg.keyboard.press('Enter');
    await pg.waitForTimeout(300);
    say(posts[posts.length - 1] === 'not now {"version":"0.7.73"}'.replace('not now', 'not-now'), 'not now: posts this version', JSON.stringify(posts));
    say(await pg.evaluate(() => document.getElementById('rline-slot').innerHTML.trim() === ''), 'not now: the slot empties');
    const away = await pg.evaluate(() => { const a = document.activeElement; return a ? (a.id || a.tagName) : null; });
    say(away === 'klink', 'not now: keyboard focus moves to the K mark', JSON.stringify(away));
    await pg.evaluate(async () => { await restartLineCheck(); });
    say(await pg.evaluate(() => document.getElementById('rline-slot').innerHTML.trim() === ''), 'not now: a later re-check keeps it hidden');
    say(errs.length === 0, 'not now: no page errors', errs.join(' | '));
    await pg.close();
  }

  {
    const { pg, errs } = await open(b, { width: 1400, height: 800 }, { line: JSON.parse(JSON.stringify(LINE)), refuse: [], notNow: 200 });
    await pg.emulateMedia({ colorScheme: 'dark' });
    await pg.waitForTimeout(200);
    const tone = await pg.evaluate(() => { const t = document.querySelector('#rline-slot .utoast'); return getComputedStyle(t).getPropertyValue('--utone').trim() === getComputedStyle(t).getPropertyValue('--label-2').trim(); });
    say(tone, 'tone: neutral in dark');
    await pg.screenshot({ path: path.join(OUT, 'rline-desktop-dark.png') }).catch(() => {});
    say(errs.length === 0, 'dark: no page errors', errs.join(' | '));
    await pg.close();
  }

  {
    const { pg, errs } = await open(b, { width: 390, height: 844 }, { line: JSON.parse(JSON.stringify(LINE)), refuse: [], notNow: 200 });
    const fits = await pg.evaluate(() => { const t = document.querySelector('#rline-slot .utoast'); const r = t && t.getBoundingClientRect(); return Boolean(r) && r.left >= 0 && r.right <= innerWidth && document.documentElement.scrollWidth <= innerWidth; });
    say(fits, 'phone: the line fits at 390px, no sideways scroll');
    const cost = await pg.evaluate(() => { const sm = document.querySelector('#rline-slot .utxt > small:last-of-type'); return sm ? { shown: getComputedStyle(sm).display !== 'none' && sm.getBoundingClientRect().height > 0, text: sm.textContent } : null; });
    say(Boolean(cost) && cost.shown && cost.text === 'Restarting stops what they are doing now.', 'phone: the cost line still shows (phones hide other notices\' small lines)', JSON.stringify(cost));
    await pg.click('#rline-slot .uacts [data-rl-who]');
    await pg.waitForTimeout(200);
    say((await pg.$$('#rline-slot .rlrow')).length === 5, 'phone: Show who opens the list');
    await pg.screenshot({ path: path.join(OUT, 'rline-phone-list.png') }).catch(() => {});
    say(errs.length === 0, 'phone: no page errors', errs.join(' | '));
    await pg.close();
  }

  await b.close();
  console.log(fail.length ? 'FAILED ' + fail.length + ': ' + fail.join('; ') : 'ALL PASS');
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
