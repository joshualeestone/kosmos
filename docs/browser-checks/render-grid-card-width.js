'use strict';

/**
 * #1310 item 2, Josh: "I want the width of those projects to be less wide. We
 * could try making them as wide as agents are. If the title needs to truncate
 * then let's truncate it."
 *
 * TWO assertions, and the second exists because the first CAUSED it: the grid
 * view was deliberately left un-truncated because it "has room", and narrowing
 * the card to the agents' width is exactly what takes that room away.
 *
 * ⚠️ Both assertions are written to FAIL on the pre-change file: the widths
 * differed (23rem vs 15.5rem) and a long title did not clip. A check that
 * cannot fail on the old bytes is decoration, so `--control` re-runs the
 * measurement with the token forced back to 23rem and requires it to go red.
 */

const { chromium } = require('playwright');

const URL = process.env.KOSMOS_URL || 'http://127.0.0.1:17401';
const OUT = process.argv[2] || '/tmp/gridwidth';
const CONTROL = process.argv.includes('--control');
const LONG = 'Quarterly Platform Reliability And Incident Response Programme 2026';
const fails = [];
const say = (ok, what) => { console.log((ok ? '  ok   ' : '  FAIL ') + what); if (!ok) fails.push(what); };

(async () => {
  const b = await chromium.launch({ headless: process.env.HEADED === '0' });
  const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
  await pg.goto(URL, { waitUntil: 'networkidle' });
  if (!(await pg.$('#firstrun[hidden]'))) { await pg.keyboard.press('Escape'); await pg.waitForTimeout(400); }
  await pg.waitForTimeout(600);

  // Seed a project with a deliberately long title, through the real route.
  const made = await pg.evaluate(async (name) => {
    const r = await fetch('/api/projects', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    return { ok: r.ok, status: r.status };
  }, LONG);
  say(made.ok, 'seeded a long-titled project through /api/projects (status ' + made.status + ')');

  if (CONTROL) {
    // Put the OLD value back and prove the assertions below can go red.
    await pg.evaluate(() => {
      document.documentElement.style.setProperty('--k-card-min', '23rem');
    });
  }

  await pg.reload({ waitUntil: 'networkidle' });
  await pg.waitForTimeout(500);
  if (CONTROL) await pg.evaluate(() => document.documentElement.style.setProperty('--k-card-min', '23rem'));

  // Projects tab, grid view.
  const pjTab = await pg.$('[data-tab="projects"], .tab[data-scope="projects"]');
  if (pjTab) { await pjTab.click(); await pg.waitForTimeout(400); }
  const gridBtn = await pg.$('.viewtoggle[data-scope="projects"] [data-layout="grid"]');
  if (gridBtn) { await gridBtn.click(); await pg.waitForTimeout(500); }

  const m = await pg.evaluate(() => {
    const pj = document.querySelector('#pj-list.asgrid .pj-row');
    const list = document.querySelector('#pj-list.asgrid');
    const track = list ? getComputedStyle(list).gridTemplateColumns.split(' ')[0] : null;
    const cardsEl = document.querySelector('.cards');
    const agTrack = cardsEl ? getComputedStyle(cardsEl).gridTemplateColumns.split(' ')[0] : null;
    const nameB = pj ? pj.querySelector('.pjname b') : null;
    return {
      pjTrack: track, agTrack,
      pjCard: pj ? Math.round(pj.getBoundingClientRect().width) : null,
      clipped: nameB ? (nameB.scrollWidth > nameB.clientWidth + 1) : null,
      overflows: (pj && nameB)
        ? (Math.round(nameB.getBoundingClientRect().right) > Math.round(pj.getBoundingClientRect().right) + 1)
        : null,
      titleText: nameB ? nameB.textContent.slice(0, 30) : null,
    };
  });
  console.log('  measured: ' + JSON.stringify(m));

  say(m.pjTrack !== null && m.agTrack !== null, 'both grids report a track width');
  say(m.pjTrack === m.agTrack,
    'a project card is the same width as an agent card (projects ' + m.pjTrack + ', agents ' + m.agTrack + ')');
  say(m.clipped === true, 'a long project title is clipped rather than widening the card');
  say(m.overflows === false, 'the title does not spill outside its card');

  await pg.screenshot({ path: OUT + '-projects-grid.png', fullPage: false });
  console.log('  shot: ' + OUT + '-projects-grid.png');
  await b.close();

  if (CONTROL) {
    if (fails.length) { console.log('\nCONTROL BEHAVED: the assertions go RED on the old 23rem value.'); process.exit(0); }
    console.log('\nCONTROL FAILED TO FAIL: these assertions cannot detect the old value. Do not trust the green run.');
    process.exit(1);
  }
  if (fails.length) { console.log('\n' + fails.length + ' failed'); process.exit(1); }
  console.log('\nall passed');
})().catch((e) => { console.error('threw: ' + (e && e.message)); process.exit(1); });
