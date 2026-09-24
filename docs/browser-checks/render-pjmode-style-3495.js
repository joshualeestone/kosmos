'use strict';
// Browser-check-surface: pj-mode pj-mode-opt pj-add-view
// (#3495 restyle) the distinctive web/index.html tokens this check asserts: the Create/Join
// segmented control, its segments, and the view it lives in. A change to any of them must
// update this check at PR time.
/* #3495 (Josh, 2026-09-24 17:50 CDT, on 0.6.92 staging): the Create a project / Join an external
 * project toggle "is hideous. It looks like a wireframe... It should just match our styling". It
 * was an ink-filled pair of bold tabs squeezed beside the back link, over fields split by rules.
 * It now speaks the app's segmented-control language (.laypick / .viewtoggle): a slim bar with a
 * separator border on the elevated ground, the chosen side GOLD with #14161a ink in BOTH themes
 * (the 2026-08-17 "selected is gold" ruling: an ink fill flips to white in dark and inverts what
 * selected means), two equal halves across the form's width on their own row, and no rules
 * between the fields, as in Project settings (#750).
 *
 * HERMETIC (file://). Drives the real openAddProject and pjSetAddMode in light and dark.
 * Each assertion fails on the look it replaced: the ink fill is not gold, the old toggle sat on
 * the back link's row at its own content width, and the old fields carried a 0.5px top rule.
 *
 * Run: NODE_PATH=$HOME/work/pw-runtime/node_modules node docs/browser-checks/render-pjmode-style-3495.js
 *      (HEADED=0 on a machine with no console session)
 */
const path = require('node:path');
const { chromium } = require('playwright');
const PAGE = 'file://' + path.join(path.resolve(__dirname, '..', '..'), 'web', 'index.html');

const problems = [];
let pass = 0;
function ok(name, cond, detail) { if (cond) pass += 1; else problems.push(name + (detail ? ' -- ' + detail : '')); }

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on('pageerror', (e) => problems.push(theme + ': pageerror: ' + e.message));
    await page.addInitScript(() => { window.setInterval = () => 0; });
    await page.goto(PAGE);

    const read = () => page.evaluate(() => {
      const bg = (el) => getComputedStyle(el).backgroundColor;
      const probe = document.createElement('i');
      probe.style.background = 'var(--gold-bright)';
      document.body.appendChild(probe);
      const gold = bg(probe);
      probe.remove();
      const bar = document.querySelector('#pj-add-view .pj-mode');
      const opts = [...bar.querySelectorAll('.pj-mode-opt')];
      const r = (el) => el.getBoundingClientRect();
      const name = document.getElementById('pj-name');
      const back = document.getElementById('pj-add-back');
      const fields = [...document.querySelectorAll('#pj-add-view .field')].filter((f) => f.getClientRects().length);
      return {
        gold,
        segs: opts.map((o) => ({ checked: o.querySelector('input').checked, bg: bg(o), color: getComputedStyle(o).color, w: Math.round(r(o).width) })),
        barW: Math.round(r(bar).width), barTop: Math.round(r(bar).top), barBorder: getComputedStyle(bar).borderTopWidth,
        nameW: name && name.getClientRects().length ? Math.round(r(name).width) : null,
        backBottom: Math.round(r(back).bottom),
        firstTop: (() => { const f = fields[0]; return f ? Math.round(r(f).top) : null; })(),
        overflow: bar.scrollWidth > bar.clientWidth + 1 || opts.some((o) => o.scrollWidth > o.clientWidth + 1),
        rules: fields.map((f) => getComputedStyle(f).borderTopWidth).filter((w) => parseFloat(w) > 0).length,
        fieldCount: fields.length,
      };
    });

    await page.evaluate((t) => {
      document.documentElement.setAttribute('data-theme', t);
      document.documentElement.setAttribute('data-fed-ui', 'show');
      const mk = (id, name) => ({ id, name, parent: null, parentName: null, parentArchived: false, archived: false, summary: {}, agents: [], description: '', unread: 0 });
      PROJECTS = [mk('k', 'Kosmos'), mk('s', 'Site')];
      const fr = document.getElementById('firstrun'); if (fr) fr.hidden = true;
      document.documentElement.setAttribute('data-layout', 'tabs');
      showTab('projects');
      openAddProject();
    }, theme);
    const c = await read();
    const on = c.segs.find((s) => s.checked), off = c.segs.find((s) => !s.checked);
    ok(theme + ': two segments, Create chosen', c.segs.length === 2 && c.segs[0].checked, JSON.stringify(c.segs));
    ok(theme + ': the chosen segment is gold', !!on && on.bg === c.gold, 'bg=' + (on && on.bg) + ' gold=' + c.gold);
    ok(theme + ': the chosen segment ink is #14161a', !!on && on.color === 'rgb(20, 22, 26)', 'color=' + (on && on.color));
    ok(theme + ': the other segment is not filled', !!off && off.bg === 'rgba(0, 0, 0, 0)', 'bg=' + (off && off.bg));
    ok(theme + ': the two halves are equal', c.segs.length === 2 && Math.abs(c.segs[0].w - c.segs[1].w) <= 1, JSON.stringify(c.segs.map((s) => s.w)));
    ok(theme + ': the bar spans the form (the Name field width)', c.nameW !== null && Math.abs(c.barW - c.nameW) <= 2, 'bar=' + c.barW + ' name=' + c.nameW);
    ok(theme + ': the bar sits on its own row, below All projects', c.barTop >= c.backBottom, 'barTop=' + c.barTop + ' backBottom=' + c.backBottom);
    ok(theme + ': the bar has the hairline border', parseFloat(c.barBorder) > 0 && parseFloat(c.barBorder) <= 1, 'border=' + c.barBorder);
    ok(theme + ': no rule between the create fields', c.fieldCount >= 3 && c.rules === 0, 'fields=' + c.fieldCount + ' ruled=' + c.rules);

    await page.evaluate(() => { document.getElementById('pj-mode-join').checked = true; pjSetAddMode('join'); });
    const j = await read();
    ok(theme + ': Join starts at the same height as Create (the form does not jump)', c.firstTop !== null && j.firstTop !== null && Math.abs(c.firstTop - j.firstTop) <= 1, 'create=' + c.firstTop + ' join=' + j.firstTop);
    ok(theme + ': no rule on the join field', j.fieldCount >= 1 && j.rules === 0, 'fields=' + j.fieldCount + ' ruled=' + j.rules);
    // A narrow window: "Join an external project" wraps inside its half rather than overflowing.
    await page.setViewportSize({ width: 420, height: 900 });
    const n = await read();
    ok(theme + ': at 420px the segments do not overflow and stay equal', !n.overflow && Math.abs(n.segs[0].w - n.segs[1].w) <= 1, JSON.stringify({ overflow: n.overflow, w: n.segs.map((x) => x.w) }));
    ok(theme + ': after Join, Join is the gold segment and Create is not', j.segs.length === 2 && j.segs[1].checked && j.segs[1].bg === j.gold && j.segs[0].bg === 'rgba(0, 0, 0, 0)', JSON.stringify(j.segs));
    await page.close();
  }

  await browser.close();
  if (problems.length) {
    console.error('render-pjmode-style-3495: ' + problems.length + ' problem(s) (' + pass + ' ok)');
    for (const p of problems) console.error('  FAIL  ' + p);
    process.exit(1);
  }
  console.log('render-pjmode-style-3495: ' + pass + ' ok. Create/Join is the app\'s segmented control in light and dark: gold chosen side with #14161a ink, equal halves across the form on their own row, and no rules between the fields.');
})().catch((err) => {
  console.error('FAIL  render-pjmode-style-3495: the check itself threw: '
    + (err && err.message ? err.message.split('\n')[0] : err));
  process.exit(1);
});
