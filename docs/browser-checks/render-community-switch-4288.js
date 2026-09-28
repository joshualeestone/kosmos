'use strict';

/*
 * #4288: the Kosmos Community switch in Settings > Automation (Mona Lisa's design on the card).
 *
 * Every /api/community-setting request is answered at the browser (page.route), so this check
 * writes nothing to the board and each arm sees exactly the state it names:
 *   DEFAULT   the board's own read (a sandboxed board has no community.json): the row shows
 *             under Automation, below the Daily report box, reads ON, the share says "not
 *             measured yet" (never 0), and the OFF note is hidden.
 *   OFF       a read of on:false: the knob reads Off and the OFF note says posts stay up.
 *   403       a gated read: the knob is HIDDEN with no position (never a false Off), and the
 *             share line says the setting could not be read.
 *   SHARE     a measured share renders Token Usage's own units (usageAbbr, "3% (12K of 410K)"), and a
 *             community spend of 0 renders "none".
 *   CLICK     pressing the knob PUTs on:false and paints what the board answered.
 * The DEFAULT arm is also the control for the others: it proves the row is found and read.
 *
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 \
 *     node docs/browser-checks/render-community-switch-4288.js http://127.0.0.1:PORT
 */

const { chromium } = require('playwright');

const BASE = process.argv[2] || process.env.KOSMOS_URL || 'http://127.0.0.1:17461';
const ROUTE = '**/api/community-setting';

const fails = [];
function check(name, pass, detail) {
  console.log((pass ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  ' + detail : ''));
  if (!pass) fails.push(name);
}

// Open Settings > Automation. Escape the first-run overlay rather than completing it, so the
// check writes nothing.
async function openAutomation(pg) {
  await pg.goto(BASE, { waitUntil: 'networkidle' });
  if (!(await pg.$('#firstrun[hidden]'))) { await pg.keyboard.press('Escape'); await pg.waitForTimeout(400); }
  await pg.waitForTimeout(800);
  await pg.evaluate(() => showTab('settings'));
  await pg.waitForTimeout(400);
  await pg.click('#s-nav button[data-go="automation"]');
  await pg.waitForTimeout(400);
}

function readRow(pg) {
  return pg.evaluate(() => {
    const tog = document.getElementById('community-toggle');
    const row = document.getElementById('community-row');
    const daily = document.getElementById('feedback-row');
    const off = document.getElementById('community-off-note');
    const box = row && row.getBoundingClientRect();
    const dbox = daily && daily.getBoundingClientRect();
    return {
      found: Boolean(tog && row),
      shown: Boolean(box && box.width > 0 && box.height > 0),
      belowDaily: Boolean(box && dbox && dbox.height > 0 && box.top > dbox.bottom),
      hidden: tog ? tog.hidden : null,
      checked: tog ? tog.getAttribute('aria-checked') : null,
      share: (document.getElementById('community-share') || {}).textContent || '',
      offNoteHidden: off ? off.hidden : null,
      offNote: off ? off.textContent : '',
    };
  });
}

const answer = (body, status = 200) => (route) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function run() {
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  const page = () => browser.newPage({ viewport: { width: 1400, height: 1000 } });
  try {
    // DEFAULT: the board's own read. GET only; any PUT here would be a write, so it is refused.
    const p1 = await page();
    let wrote = false;
    await p1.route(ROUTE, (route) => { if (route.request().method() === 'GET') return route.continue(); wrote = true; return route.abort(); });
    await openAutomation(p1);
    const d = await readRow(p1);
    check('DEFAULT: the Community row exists', d.found, JSON.stringify(d));
    check('DEFAULT: it is visible under Settings > Automation', d.shown, JSON.stringify(d));
    check('DEFAULT: it sits below the Daily report box', d.belowDaily, JSON.stringify(d));
    check('DEFAULT: the knob shows and reads ON (Josh: default ON)', d.hidden === false && d.checked === 'true', JSON.stringify(d));
    check('DEFAULT: the share says "not measured yet", never 0', /: not measured yet$/.test(d.share) && !/\b0(%|\b)/.test(d.share), JSON.stringify(d.share));
    check('DEFAULT: the OFF note is hidden while ON', d.offNoteHidden === true, String(d.offNoteHidden));
    check('DEFAULT: opening the page wrote nothing', wrote === false);
    await p1.close();

    // OFF: the knob reads Off and the note says what OFF does.
    const p2 = await page();
    await p2.route(ROUTE, answer({ on: false, ok: true, share: null }));
    await openAutomation(p2);
    const o = await readRow(p2);
    check('OFF: the knob shows and reads Off', o.hidden === false && o.checked === 'false', JSON.stringify(o));
    check('OFF: the OFF note shows', o.offNoteHidden === false, String(o.offNoteHidden));
    // It must not promise a delete nobody can do yet (review 1): no author delete exists in slice 1.
    check('OFF: the note says posts stay up, and promises no delete', /Posts already in the community stay up\.$/.test(o.offNote) && !/delete/i.test(o.offNote), JSON.stringify(o.offNote));
    await p2.close();

    // 403: a gated read draws could-not-read, never a false Off.
    const p3 = await page();
    await p3.route(ROUTE, answer({ error: 'this board belongs to the account that started it' }, 403));
    await openAutomation(p3);
    const g = await readRow(p3);
    check('403: the knob is HIDDEN', g.hidden === true, JSON.stringify(g));
    check('403: the knob keeps NO position', g.checked === null, String(g.checked));
    check('403: the share line says the setting could not be read', /could not read this setting/.test(g.share), JSON.stringify(g.share));
    check('403: the OFF note stays hidden (the position is unknown)', g.offNoteHidden === true, String(g.offNoteHidden));
    await p3.close();

    // SHARE: a measured share in Token Usage's units, and a zero community spend as "none".
    const p4 = await page();
    let shareBody = { on: true, ok: true, share: { community: 12400, total: 410000 } };
    await p4.route(ROUTE, (route) => answer(shareBody)(route));
    await openAutomation(p4);
    const s1 = await readRow(p4);
    // Token Usage's own formatter, so the two screens agree (#4244); the percentage is literal.
    const units = await p4.evaluate(() => [usageAbbr(12400), usageAbbr(410000)]);
    check('SHARE: a measured share renders "3% (<Token Usage units>)"', s1.share.endsWith(': 3% (' + units[0] + ' of ' + units[1] + ')'), JSON.stringify([s1.share, units]));
    // A share that rounds UP (2.5% -> 3%), so a floor in place of the rounding reds.
    shareBody = { on: true, ok: true, share: { community: 1000, total: 40000 } };
    await p4.evaluate(() => refreshCommunity());
    await p4.waitForTimeout(300);
    const sr = await readRow(p4);
    const ru = await p4.evaluate(() => [usageAbbr(1000), usageAbbr(40000)]);
    check('SHARE: a share of 2.5% rounds to 3%', sr.share.endsWith(': 3% (' + ru[0] + ' of ' + ru[1] + ')'), JSON.stringify([sr.share, ru]));
    shareBody = { on: true, ok: true, share: { community: 0, total: 410000 } };
    await p4.evaluate(() => refreshCommunity());
    await p4.waitForTimeout(300);
    const s2 = await readRow(p4);
    check('SHARE: a community spend of 0 renders "none"', /: none$/.test(s2.share), JSON.stringify(s2.share));
    await p4.close();

    // CLICK: the knob PUTs on:false and paints what the board answered.
    const p5 = await page();
    const puts = [];
    await p5.route(ROUTE, (route) => {
      const req = route.request();
      if (req.method() === 'PUT') { puts.push(req.postData()); return answer({ on: false, ok: true, share: null })(route); }
      return answer({ on: true, ok: true, share: null })(route);
    });
    await openAutomation(p5);
    await p5.click('#community-toggle');
    await p5.waitForTimeout(400);
    const c = await readRow(p5);
    check('CLICK: one PUT with on:false', puts.length === 1 && JSON.parse(puts[0]).on === false, JSON.stringify(puts));
    check('CLICK: the knob now reads Off and the OFF note shows', c.checked === 'false' && c.offNoteHidden === false, JSON.stringify(c));
    await p5.close();
  } finally {
    await browser.close();
  }
  console.log('\nrender-community-switch-4288: ' + (fails.length ? fails.length + ' failed' : 'all good'));
  process.exit(fails.length ? 1 : 0);
}

run().catch((e) => { console.error('FAIL  render-community-switch-4288 threw: ' + (e && e.message || e)); process.exit(1); });
