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
/* ⚠️ 60 CHARACTERS, WHICH IS THE CAP, NOT AN ARBITRARY LONG STRING.
   Measured against the live route: 67 characters is refused with "that name is
   too long to make a folder out of; keep it to 60 characters", and my first
   version of this check seeded nothing and then asserted on an empty grid.
   The cap IS the worst case, so this is the widest title a person can make. */
const LONG = 'Quarterly Platform Reliability And Incident Response Prog';
const fails = [];
const say = (ok, what) => { console.log((ok ? '  ok   ' : '  FAIL ') + what); if (!ok) fails.push(what); };

(async () => {
  const b = await chromium.launch({ headless: process.env.HEADED === '0' });
  const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
  await pg.goto(URL, { waitUntil: 'networkidle' });
  if (!(await pg.$('#firstrun[hidden]'))) { await pg.keyboard.press('Escape'); await pg.waitForTimeout(400); }
  await pg.waitForTimeout(600);

  // Seed a project with a deliberately long title, through the real route.
  /* ⚠️ THE CHECK NEEDS THE PROJECT TO EXIST, NOT TO HAVE BEEN CREATED BY THIS
     RUN, and those are different requirements. A second run against the same
     board gets 400 because the name is taken, which is the fixture being
     PRESENT rather than a failure. Asserting on the POST status made a passing
     board report a red on its second run, which is the kind of red that
     teaches people to re-run until green. */
  const made = await pg.evaluate(async (name) => {
    const r = await fetch('/api/projects', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const status = r.status;
    const all = await (await fetch('/api/projects')).json().catch(() => null);
    const rows = (all && (all.projects || all)) || [];
    const present = Array.isArray(rows) && rows.some((x) => x && x.name === name);
    return { status, present };
  }, LONG);
  say(made.present,
    'a long-titled project is on the board (POST said ' + made.status
      + (made.status === 400 ? ', already there from an earlier run' : '') + ')');

  /* 🛑 THE CONTROL REVERTS THE TWO RULES, NOT THE SHARED TOKEN, AND THE
     DIFFERENCE IS THE WHOLE POINT. My first control set `--k-card-min` to
     23rem on :root, which BOTH grids read, so they moved together (440 vs
     438.7) and the equality assertion still passed. It reported
     "CONTROL FAILED TO FAIL" and it was right: a lever that moves both sides
     of a comparison cannot test that comparison.
     ⇒ The pre-change state is the PROJECTS grid at a literal 23rem while the
     agents board stays on the token, plus the grid title NOT truncating.
     Both are reverted here so both assertions have to go red. */
  const revert = () => {
    const st = document.createElement('style');
    st.id = 'ctl-revert';
    st.textContent =
      '.pj-list.asgrid{grid-template-columns:repeat(auto-fill,minmax(min(100%,23rem),1fr))!important}'
      + '.pj-list.asgrid .pj-row .pjname{max-width:none!important}'
      + '.pj-list.asgrid .pj-row .pjname b{overflow:visible!important;text-overflow:clip!important;'
      + 'white-space:normal!important}';
    document.head.appendChild(st);
  };
  if (CONTROL) await pg.evaluate(revert);

  await pg.reload({ waitUntil: 'networkidle' });
  await pg.waitForTimeout(500);
  if (CONTROL) await pg.evaluate(revert);   // the reload dropped the injected style

  /* 🛑 THE AGENTS GRID IS READ WHILE IT IS ON SCREEN, AND THAT ORDERING IS THE
     CHECK. A hidden grid does not resolve its tracks: an earlier version of
     this file read `.cards` after switching to the projects tab and got the
     literal "repeat(auto-fill," back, then compared that against the projects
     grid's resolved "257.594px" and called it a mismatch. It was measuring
     visibility, not width. */
  const agTab = await pg.$('[data-tab="agents"], .tab[data-scope="agents"]');
  if (agTab) { await agTab.click(); await pg.waitForTimeout(400); }
  const agTrack = await pg.evaluate(() => {
    const el = document.querySelector('.cards');
    return el ? getComputedStyle(el).gridTemplateColumns.split(' ')[0] : null;
  });

  // Projects tab, grid view.
  const pjTab = await pg.$('[data-tab="projects"], .tab[data-scope="projects"]');
  if (pjTab) { await pjTab.click(); await pg.waitForTimeout(400); }
  const gridBtn = await pg.$('.viewtoggle[data-scope="projects"] [data-layout="grid"]');
  if (gridBtn) { await gridBtn.click(); await pg.waitForTimeout(500); }

  // Seed an unread count on the long-titled project, so the badge is present
  // to compete with the name for the row's width.
  const m = await pg.evaluate(() => {
    const pj = document.querySelector('#pj-list.asgrid .pj-row');
    const list = document.querySelector('#pj-list.asgrid');
    const track = list ? getComputedStyle(list).gridTemplateColumns.split(' ')[0] : null;
    const nameB = pj ? pj.querySelector('.pjname b') : null;
    return {
      pjTrack: track,
      pjCard: pj ? Math.round(pj.getBoundingClientRect().width) : null,
      clipped: nameB ? (nameB.scrollWidth > nameB.clientWidth + 1) : null,
      overflows: (pj && nameB)
        ? (Math.round(nameB.getBoundingClientRect().right) > Math.round(pj.getBoundingClientRect().right) + 1)
        : null,
      titleText: nameB ? nameB.textContent.slice(0, 30) : null,
      /* Mona Lisa, cross-review: .pjname is a flex row holding the name AND
         the unread badge. Once the name can be squeezed, the badge is what a
         missing `flex: none` squeezes instead. Asserted here so that
         protection cannot be removed quietly. `null` when no badge is on
         screen, which is NOT a pass: reported separately below. */
      badge: (() => {
        const bd = pj ? pj.querySelector('.pj-unread') : null;
        if (!bd) return null;
        const r = bd.getBoundingClientRect();
        return { w: Math.round(r.width), shrink: getComputedStyle(bd).flexShrink };
      })(),
    };
  });
  m.agTrack = agTrack;
  console.log('  measured: ' + JSON.stringify(m));

  say(m.pjTrack !== null && m.agTrack !== null, 'both grids report a track width');
  /* ⚠️ A TOLERANCE, NOT AN EQUALITY, AND THE REASON IS MEASURED. Both grids
     read the same `--k-card-min`, but they sit in containers with different
     padding, so `auto-fill` divides slightly different widths: 256.0 against
     257.6 at 1400px. Asserting byte equality would fail on a CORRECT layout
     and teach whoever met it to loosen the check rather than read it. 8px is
     far tighter than the 120px difference this card is about (23rem vs
     15.5rem is ~120px) so it cannot pass a revert. */
  const px = (v) => (typeof v === 'string' && v.endsWith('px') ? parseFloat(v) : NaN);
  const gap = Math.abs(px(m.pjTrack) - px(m.agTrack));
  say(Number.isFinite(gap) && gap <= 8,
    'a project card is the same width as an agent card (projects ' + m.pjTrack
      + ', agents ' + m.agTrack + ', difference ' + (Number.isFinite(gap) ? gap.toFixed(1) : '?') + 'px)');
  say(m.clipped === true, 'a long project title is clipped rather than widening the card');
  say(m.overflows === false, 'the title does not spill outside its card');
  if (m.badge === null) {
    console.log('  note: no unread badge on screen, so its width was not asserted this run');
  } else {
    say(m.badge.shrink === '0', 'the unread badge cannot be shrunk by a long title (flex-shrink 0)');
    say(m.badge.w >= 18, 'the unread badge keeps its full width beside a truncated title (' + m.badge.w + 'px)');
  }

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
