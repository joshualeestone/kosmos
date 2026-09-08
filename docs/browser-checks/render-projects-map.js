'use strict';
/**
 * kosmos#2458 (Josh, 2026-09-08 02:09, "I want to do a map view right now"): the
 * Projects tab gets a third layout, Map, beside Grid and List. The Map draws the
 * project tree top-down as an org chart -- a Kosmos root, every top-level project
 * hanging off it, sub-projects nested under their parents -- built to Mona's
 * design/subprojects.html "The Map" spec.
 *
 * WHAT SOURCE CANNOT SEE, and only a real browser can: that the Map toggle (1)
 * reveals #pj-map and HIDES the list surfaces (computed display, not just a class),
 * (2) draws the real parent/child NESTING from PROJECTS (Beta > Gamma > Delta),
 * (3) marks a needs-you project .attn with a "needs you" line while an empty one
 * reads "idle" and a staffed one reads "N agents", and (4) puts the fleet count on
 * the Kosmos root. This drives the REAL #d viewtoggle button and paintProjectsMap
 * against an injected hierarchy, so the assertions can each return the dangerous
 * answer (a flat render, a wrong count, a missing nest all FAIL).
 *
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-projects-map.js
 *   (HEADED by default; HEADED=0 on a console-less machine.)
 */
const nodePath = require('node:path');
let playwright;
try { playwright = require('playwright'); }
catch { console.log('render-projects-map: playwright is not on NODE_PATH - SKIPPED, not passed.'); process.exit(0); }

const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');
const problems = [];
function check(name, pass, detail) {
  if (!pass) problems.push(name + (detail ? '  ' + detail : ''));
  console.log((pass ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  ' + detail : ''));
}

(async () => {
  let browser;
  try { browser = await playwright.chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch (err) {
    console.error('FAIL  render-projects-map: could not start a browser'
      + (process.env.HEADED === '0' ? '.' : ' (headed; try HEADED=0).'));
    console.error('  ' + (err && err.message ? err.message.split('\n')[0] : err));
    process.exit(1);
  }
  const page = await browser.newPage({ viewport: { width: 1100, height: 820 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto('file://' + PAGE);
  if (await page.isVisible('#firstrun')) await page.keyboard.press('Escape');
  // Show the Projects tab so the list's computed display is real (a hidden tab
  // would make #pj-list display:none for the wrong reason).
  await page.click('[data-tab="projects"]').catch(() => {});

  const r = await page.evaluate(async () => {
    // Inject a known hierarchy: Alpha (2 agents, top), Beta (needs you, top) with
    // Gamma (idle) under it and Delta (3 agents) under Gamma. Mutate in place so a
    // const or a let both work.
    PROJECTS.length = 0;
    PROJECTS.push(
      { id: 'a', name: 'Alpha', parent: null, archived: false, summary: { total: 2 } },
      { id: 'b', name: 'Beta', parent: null, archived: false, summary: { total: 1, needsYou: 1 } },
      { id: 'g', name: 'Gamma', parent: 'b', archived: false, summary: { total: 0 } },
      { id: 'd', name: 'Delta', parent: 'g', archived: false, summary: { total: 3 } },
    );
    LAST.length = 0;
    LAST.push({ sessionName: 's1' }, { sessionName: 's2' }, { sessionName: 's3' });

    const btn = document.querySelector('.viewtoggle[data-scope="projects"] [data-layout="map"]');
    if (!btn) return { error: 'the Map toggle button is not on the page' };
    btn.click();   // -> layoutApply('projects','map') -> body.pj-mapmode + paintProjectsMap

    const map = document.getElementById('pj-map');
    const list = document.getElementById('pj-list');
    const nodeByName = (nm) => Array.from(map.querySelectorAll('.pjonode'))
      .find((n) => { const t = n.querySelector('.pjonm'); return t && t.textContent === nm; }) || null;
    const beta = nodeByName('Beta');
    const gamma = nodeByName('Gamma');
    // Beta's <li> should contain Gamma, and Gamma's <li> should contain Delta.
    const betaLi = beta ? beta.closest('li') : null;
    const gammaLi = gamma ? gamma.closest('li') : null;
    const ocOf = (nm) => { const n = nodeByName(nm); const o = n && n.querySelector('.pjoc'); return o ? o.textContent : null; };
    return {
      pressed: btn.getAttribute('aria-pressed') === 'true' && btn.classList.contains('on'),
      mapMode: document.body.classList.contains('pj-mapmode'),
      mapShown: map && map.hidden === false && getComputedStyle(map).display !== 'none',
      listHidden: getComputedStyle(list).display === 'none',
      hasKosmosTop: !!(map && map.querySelector('.pjorg .pjonode.top .pjonm')
        && map.querySelector('.pjorg .pjonode.top .pjonm').textContent === 'Kosmos'),
      kosmosCount: (() => { const o = map && map.querySelector('.pjonode.top .pjoc'); return o ? o.textContent : null; })(),
      // nesting: Gamma is inside Beta's li, Delta is inside Gamma's li
      gammaUnderBeta: !!(betaLi && gamma && betaLi.contains(gamma) && gamma !== beta),
      deltaUnderGamma: !!(gammaLi && gammaLi.querySelector('.pjonm')
        && Array.from(gammaLi.querySelectorAll('.pjonm')).some((t) => t.textContent === 'Delta')),
      betaAttn: !!(beta && beta.classList.contains('attn')),
      betaLine: ocOf('Beta'),
      gammaLine: ocOf('Gamma'),
      alphaLine: ocOf('Alpha'),
    };
  });

  if (r.error) { console.error('render-projects-map: ' + r.error); await browser.close(); process.exit(1); }
  if (pageErrors.length) { console.error('page error(s): ' + pageErrors.join(' | ')); await browser.close(); process.exit(1); }

  check('the Map toggle presses on (aria-pressed + .on)', r.pressed, JSON.stringify(r.pressed));
  check('map mode is active (body.pj-mapmode)', r.mapMode, JSON.stringify(r.mapMode));
  check('the map container is revealed', r.mapShown, JSON.stringify(r.mapShown));
  check('the project LIST is hidden in map mode (computed display:none)', r.listHidden, JSON.stringify(r.listHidden));
  check('a Kosmos root node is drawn at the top', r.hasKosmosTop, JSON.stringify(r.hasKosmosTop));
  check('the Kosmos root shows the fleet count (3 agents)', r.kosmosCount === '3 agents', 'kosmosCount=' + JSON.stringify(r.kosmosCount));
  check('the hierarchy NESTS: Gamma is under Beta', r.gammaUnderBeta, JSON.stringify(r.gammaUnderBeta));
  check('the hierarchy NESTS deep: Delta is under Gamma', r.deltaUnderGamma, JSON.stringify(r.deltaUnderGamma));
  check('a needs-you project is marked .attn and reads "needs you"',
    r.betaAttn && r.betaLine === 'needs you', 'attn=' + r.betaAttn + ' line=' + JSON.stringify(r.betaLine));
  check('an empty project reads "idle"', r.gammaLine === 'idle', 'gammaLine=' + JSON.stringify(r.gammaLine));
  check('a staffed project reads its agent count', r.alphaLine === '2 agents', 'alphaLine=' + JSON.stringify(r.alphaLine));

  // A stored cycle (a<->b, neither reachable from the top) must render every
  // member exactly ONCE -- the "never double, never drop" invariant. The backstop
  // that rescues cycle-trapped nodes must not also re-emit one a recursion already
  // placed.
  const cyc = await page.evaluate(() => {
    PROJECTS.length = 0;
    PROJECTS.push(
      { id: 'x', name: 'Xed', parent: 'y', archived: false, summary: { total: 1 } },
      { id: 'y', name: 'Yed', parent: 'x', archived: false, summary: { total: 1 } },
    );
    paintProjectsMap();
    const map = document.getElementById('pj-map');
    const names = Array.from(map.querySelectorAll('.pjonm')).map((n) => n.textContent);
    return { xCount: names.filter((n) => n === 'Xed').length, yCount: names.filter((n) => n === 'Yed').length };
  });
  check('a stored cycle renders each member exactly once (never double, never drop)',
    cyc.xCount === 1 && cyc.yCount === 1, JSON.stringify(cyc));

  // The boot-restore contract: layoutApply('projects','map') WITHOUT the click's
  // paint flag sets the mode but does NOT paint (at real boot the render's data
  // globals are still in their temporal dead zone, so painting there halts the
  // whole boot). A click (paint=true) paints. Guards the crash regression.
  const boot = await page.evaluate(() => {
    PROJECTS.length = 0;
    PROJECTS.push({ id: 'z', name: 'Zed', parent: null, archived: false, summary: { total: 1 } });
    const map = document.getElementById('pj-map');
    map.innerHTML = '';                       // start empty, as at boot
    layoutApply('projects', 'grid', true);    // leave map mode cleanly first
    layoutApply('projects', 'map');           // boot signature: NO paint arg
    const afterBoot = { mode: document.body.classList.contains('pj-mapmode'), painted: map.querySelectorAll('.pjonode').length };
    layoutApply('projects', 'map', true);     // a click: paints now
    const afterClick = { painted: map.querySelectorAll('.pjonode').length };
    return { afterBoot, afterClick };
  });
  check('boot-style layoutApply sets map mode but does NOT paint (no data-global read at boot)',
    boot.afterBoot.mode === true && boot.afterBoot.painted === 0, JSON.stringify(boot.afterBoot));
  check('a click (paint=true) then paints the map', boot.afterClick.painted > 0, JSON.stringify(boot.afterClick));

  // Dark mode lightens the attn red: the #b3261e whisper fails WCAG AA on the dark
  // surface, so under [data-theme="dark"] the "needs you" text must be the lighter
  // #ff8c82 = rgb(255, 140, 130), not the light-mode #b3261e = rgb(179, 38, 30).
  const dark = await page.evaluate(() => {
    document.documentElement.dataset.theme = 'dark';
    PROJECTS.length = 0;
    PROJECTS.push({ id: 'n', name: 'Ned', parent: null, archived: false, summary: { total: 1, needsYou: 1 } });
    paintProjectsMap();
    const oc = document.querySelector('#pj-map .pjonode.attn .pjoc.a');
    const c = oc ? getComputedStyle(oc).color : null;
    document.documentElement.removeAttribute('data-theme');
    return { color: c };
  });
  check('the attn "needs you" text is lightened in dark mode (WCAG AA)',
    dark.color === 'rgb(255, 140, 130)', 'color=' + JSON.stringify(dark.color));

  await browser.close();
  if (problems.length) {
    console.error('render-projects-map: ' + problems.length + ' problem(s)');
    for (const p of problems) console.error('  FAIL  ' + p);
    process.exit(1);
  }
  console.log('render-projects-map: the Map toggle draws the project tree as an org chart -- Kosmos root with the fleet count, the real parent/child nesting (Beta > Gamma > Delta), a needs-you node marked attn, an idle node, and staffed nodes with their counts -- and hides the list while it shows.');
})();
