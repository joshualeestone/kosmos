'use strict';
// Browser-check-surface: pjpill pj-stripe pj-who
// (#4730) the web/index.html tokens this check asserts: the project status pill, the list view's
// alternating-row class and the removed "we cannot see" line; a rename must update this check.
/* #4730 (Josh, 2026-09-30 09:06): on the Projects views, a badge only when something is running
 * (no "Can't tell", no "Nothing running"), no "N we cannot see" line, and in the list view every
 * second row shaded "really really light" so the eye can follow it across.
 * Drives the SHIPPED paintProjects / projectCard / pjPillOf / applyConsFold against a fixture
 * PROJECTS list in the real page, in the grid and the list (roadmap) view, light and dark.
 * Controls that can return the dangerous answer:
 *   - Working and Issue projects still show their badge (removing every badge would pass the rest);
 *   - the fixture really has an unseen member and a project with nothing running (so "no badge"
 *     and "no line" are not vacuous);
 *   - the shaded row really paints a different background from the unshaded one;
 *   - folding a parent really hides its children, and the stripes then follow the VISIBLE rows;
 *   - the grid paints no stripe.
 * Run: NODE_PATH=$HOME/work/pw-runtime/node_modules node docs/browser-checks/render-projects-badges-4730.js
 *      (HEADED=0 on a machine with no console session)
 */
const path = require('node:path');
const { chromium } = require('playwright');
const PAGE = 'file://' + path.join(path.resolve(__dirname, '..', '..'), 'web', 'index.html');

const problems = [];
let pass = 0;
function ok(name, cond, detail) {
  if (cond) { pass += 1; console.log('PASS  ' + name); } else { problems.push(name + (detail ? ' -- ' + detail : '')); console.log('FAIL  ' + name + (detail ? '  ' + detail : '')); }
}

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED === '0', ignoreDefaultArgs: ['--hide-scrollbars'] });
  const grounds = {};
  for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, colorScheme: theme });
    page.on('pageerror', (e) => problems.push(`[${theme}] pageerror: ${e.message}`));
    // Stop the 5s poll (it fetches at file:// and cannot load); ignore only that fetch noise.
    await page.addInitScript(() => { window.setInterval = () => 0; });
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      const x = m.text();
      if (/ERR_FILE_NOT_FOUND|URL scheme "file"|Failed to (fetch|load)/.test(x)) return;
      problems.push(`[${theme}] console: ${x}`);
    });
    await page.goto(PAGE);
    const t = `[${theme}]`;

    // The fixture, and one read of every row in the current view.
    const paint = (view, folded, blind) => page.evaluate(({ view, folded, blind }) => {
      const mk = (id, name, summary, parent) => ({ id, name, parent: parent || null, parentName: parent ? 'Research' : null,
        parentArchived: false, archived: false, summary, agents: [], description: '', unread: 0 });
      PROJECTS = [
        mk('a-idle', 'A idle', { total: 3 }),
        mk('b-unseen', 'B unseen', { total: 5, unseen: 1 }),
        mk('c-work', 'C working', { total: 2, working: 1 }),
        mk('d-issue', 'D issue', { total: 2, needsYou: 1 }),
        mk('e-research', 'E research', { total: 0 }),
        mk('f-child1', 'F child one', { total: 1 }, 'e-research'),
        mk('g-child2', 'G child two', { total: 1, unseen: 1 }, 'e-research'),
        mk('h-last', 'H last', { total: 1 }),
      ];
      PJ_SORT = 'az';
      PJ_AGENTS_UNREADABLE = !!blind;
      PJ_TREE_FOLDED.clear();
      if (folded) PJ_TREE_FOLDED.add('e-research');
      const fr = document.getElementById('firstrun'); if (fr) fr.hidden = true;
      document.getElementById('panel-projects').hidden = false;
      document.documentElement.removeAttribute('data-layout');
      document.body.classList.remove('consolidated');
      const list = document.getElementById('pj-list');
      list.classList.toggle('asgrid', view === 'grid');
      document.body.classList.toggle('pj-roadmap', view === 'list');
      paintProjects();
      document.activeElement && document.activeElement.blur && document.activeElement.blur();
      window.__pjSummary = (document.getElementById('pj-rm-summary') || {}).textContent || '';
      return [...list.querySelectorAll('.pj-row[data-project]')].map((r) => {
        const pill = r.querySelector('.pjpill');
        const cs = getComputedStyle(r);
        return { id: r.dataset.project, shown: cs.display !== 'none' && r.getBoundingClientRect().height > 0,
          pill: pill ? pill.textContent.trim() : null, text: r.textContent,
          stripe: r.classList.contains('pj-stripe'), bg: cs.backgroundColor };
      });
    }, { view, folded, blind });

    for (const view of ['grid', 'list']) {
      const rows = await paint(view, false);
      const by = Object.fromEntries(rows.map((r) => [r.id, r]));
      ok(`${t} ${view}: the fixture drew all 8 projects`, rows.length === 8, JSON.stringify(rows.map((r) => r.id)));
      // Controls first: a running project keeps its badge.
      ok(`${t} ${view}: CONTROL a working project still says Working`, by['c-work'] && /Working/.test(by['c-work'].pill || ''), by['c-work'] && by['c-work'].pill);
      ok(`${t} ${view}: CONTROL a project that needs you still says Issue`, by['d-issue'] && /Issue/.test(by['d-issue'].pill || ''), by['d-issue'] && by['d-issue'].pill);
      ok(`${t} ${view}: nothing running shows no badge`, by['a-idle'] && by['a-idle'].pill === null, by['a-idle'] && by['a-idle'].pill);
      ok(`${t} ${view}: an unseen member shows no badge (was "Can't tell")`, by['b-unseen'] && by['b-unseen'].pill === null, by['b-unseen'] && by['b-unseen'].pill);
      ok(`${t} ${view}: no "Nothing running" or "Can't tell" anywhere`, !rows.some((r) => /Nothing running|Can.t tell/.test(r.text)),
        JSON.stringify(rows.filter((r) => /Nothing running|Can.t tell/.test(r.text)).map((r) => r.id)));
      ok(`${t} ${view}: no "we cannot see" line (the fixture has 2 projects with an unseen member)`, !rows.some((r) => /we cannot see/i.test(r.text)),
        JSON.stringify(rows.filter((r) => /we cannot see/i.test(r.text)).map((r) => r.id)));
      ok(`${t} ${view}: the agent count stays`, !!by['b-unseen'] && /5 agents/.test(by['b-unseen'].text), by['b-unseen'] && by['b-unseen'].text.slice(0, 80));
      if (view === 'grid') {
        const bgs = new Set(rows.map((r) => r.bg));
        ok(`${t} grid: no stripe is painted (every card has one background)`, bgs.size === 1, JSON.stringify([...bgs]));
      } else {
        const vis = rows.filter((r) => r.shown);
        ok(`${t} list: every second visible row is shaded, starting with the second`,
          vis.length === 8 && vis.every((r, i) => r.stripe === (i % 2 === 1)), JSON.stringify(vis.map((r) => r.id + ':' + r.stripe)));
        /* The shade measured as a COLOUR ON SCREEN: each row's background composited over the list's
           ground, then compared. A string compare would pass an rgba that paints nothing visible. */
        const lum = await page.evaluate(() => {
          const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const v = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return { r: v[0], g: v[1], b: v[2], a: v.length > 3 ? v[3] : 1 }; };
          const ground = (el) => { for (let e = el.parentElement; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0) return c; } return { r: 255, g: 255, b: 255, a: 1 }; };
          const over = (top, g) => ({ r: top.r * top.a + g.r * (1 - top.a), g: top.g * top.a + g.g * (1 - top.a), b: top.b * top.a + g.b * (1 - top.a) });
          const L = (c) => { const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
          const rows = [...document.querySelectorAll('#pj-list .pj-row[data-project]')].filter((r) => getComputedStyle(r).display !== 'none');
          const g = ground(rows[0]);
          const shown = (r) => L(over(parse(getComputedStyle(r).backgroundColor) || { r: 0, g: 0, b: 0, a: 0 }, g));
          const plain = shown(rows[0]); const striped = shown(rows[1]);
          return { plain, striped, groundL: L(g), ratio: (Math.max(plain, striped) + 0.05) / (Math.min(plain, striped) + 0.05) };
        });
        ok(`${t} list: the shade is visible but light (ratio 1.02 to 1.25 against an unshaded row)`, lum.ratio >= 1.02 && lum.ratio <= 1.25, JSON.stringify(lum));
        /* Hover still stands out on a shaded row: hovering it must change what it paints. */
        const rowsVis = vis.map((r) => r.id);
        const before = await page.evaluate((id) => getComputedStyle(document.querySelector(`#pj-list .pj-row[data-project="${id}"]`)).backgroundColor, rowsVis[1]);
        await page.hover(`#pj-list .pj-row[data-project="${rowsVis[1]}"]`);
        const after = await page.evaluate((id) => getComputedStyle(document.querySelector(`#pj-list .pj-row[data-project="${id}"]`)).backgroundColor, rowsVis[1]);
        await page.mouse.move(1, 1);
        ok(`${t} list: hovering a shaded row still changes it`, before !== after, `${before} -> ${after}`);
        ok(`${t} list: every shaded row paints the same shade`, new Set(vis.filter((r) => r.stripe).map((r) => r.bg)).size === 1,
          JSON.stringify([...new Set(vis.filter((r) => r.stripe).map((r) => r.bg))]));
      }
    }

    // Fold the parent: its two children leave, and the stripes follow what is still on screen.
    const folded = await paint('list', true);
    const vis = folded.filter((r) => r.shown);
    ok(`${t} list: CONTROL folding the parent hides its two children`, vis.length === 6 && !vis.some((r) => /child/.test(r.id)),
      JSON.stringify(vis.map((r) => r.id)));
    ok(`${t} list: after the fold, the stripes still alternate over the visible rows`, vis.every((r, i) => r.stripe === (i % 2 === 1)),
      JSON.stringify(vis.map((r) => r.id + ':' + r.stripe)));
    ok(`${t} list: a hidden row carries no stripe`, folded.filter((r) => !r.shown).every((r) => !r.stripe),
      JSON.stringify(folded.filter((r) => !r.shown).map((r) => r.id + ':' + r.stripe)));
    // A blind roster: no project shows a badge, not even Working (it could not read it), and the list
    // strip says once that it cannot see what is running. CONTROL: the same fixture read normally
    // above showed Working.
    const blindRows = await paint('list', false, true);
    ok(`${t} list, blind roster: no badge at all, Working included`, blindRows.every((r) => r.pill === null), JSON.stringify(blindRows.map((r) => r.id + ':' + r.pill)));
    const strip = await page.evaluate(() => window.__pjSummary);
    ok(`${t} list, blind roster: the strip says it cannot see what is running`, /cannot see what is running/.test(strip), strip);
    await paint('list', false, false);
    const stripOk = await page.evaluate(() => window.__pjSummary);
    ok(`${t} list: CONTROL the strip says nothing about seeing when the roster is read`, !/cannot see/.test(stripOk), stripOk);
    // The theme really applied: dark and light must resolve different page grounds.
    grounds[theme] = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--k-bg').trim());
    await page.close();
  }
  ok('CONTROL the light and dark passes ran on different themes (--k-bg differs)', grounds.light && grounds.dark && grounds.light !== grounds.dark, JSON.stringify(grounds));
  await browser.close();
  console.log(`${pass} passed, ${problems.length} failed`);
  if (problems.length) { console.log('FAILED'); for (const p of problems) console.log('  ' + p); process.exit(1); }
  console.log('all passed');
})().catch((e) => { console.error(e); process.exit(2); });
