/**
 * #3216: red unread-count badges on the Agents and Projects nav tabs.
 *
 * Josh (6.74, from an investor meeting): a red notification-count badge next to the Agents and
 * Projects nav items. The counts already exist in app state, so this is a render on existing data:
 *   - Agents tab  = dmTotal, the fleet sum of a.dmUnread computed in tick() (same total the
 *                   #st-dm summary tile shows), so the tab and the tile cannot disagree.
 *   - Projects tab = the sum of p.unread across PROJECTS (the same p.unread the per-project list
 *                    badges use), excluding the open project, mirroring the list badge + the Agents
 *                    tab's open-thread exclusion.
 * Both hide at zero and cap at 99+, via setNavBadge().
 *
 * HERMETIC (file://): asserts (a) the badge elements exist on both tabs, (b) the setNavBadge render
 * contract (shows the count / hidden at zero / 99+ cap / null hidden / the shared red), and (c) the
 * two data wirings by source, because seeding real per-agent dmUnread and per-project unread
 * end-to-end (they are engine-derived from the DM and room message stores) is not reproducible in a
 * hermetic render. The source arms catch a regression that unwires either badge from its count.
 *   HEADED=0 NODE_PATH=$HOME/work/pw-runtime/node_modules node docs/browser-checks/render-nav-badges-3216.js
 */
const nodePath = require('path');
const fs = require('fs');
const ROOT = nodePath.resolve(__dirname, '..', '..');
const PAGE = 'file://' + nodePath.join(ROOT, 'web', 'index.html');

let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) { console.error('playwright not found; NODE_PATH=$HOME/work/pw-runtime/node_modules'); process.exit(2); }

const fail = [];
const chk = (ok, label, extra) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra !== undefined ? '  ' + extra : ''));
  if (!ok) fail.push(label);
};

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 800 }, colorScheme: 'light' });
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await page.addInitScript(() => { window.fetch = async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }); });
    await page.goto(PAGE);

    const out = await page.evaluate(() => {
      if (typeof setNavBadge !== 'function') return { error: 'setNavBadge is not a function (renamed? re-anchor)' };
      const a = document.getElementById('nav-badge-agents');
      const p = document.getElementById('nav-badge-projects');
      const r = { onAgentsTab: !!(a && a.closest('.tab') && a.closest('.tab').dataset.tab === 'agents'),
                  onProjectsTab: !!(p && p.closest('.tab') && p.closest('.tab').dataset.tab === 'projects') };
      setNavBadge('nav-badge-agents', 0); r.zeroHidden = a.hidden === true && getComputedStyle(a).display === 'none';
      setNavBadge('nav-badge-agents', 7); const cs = getComputedStyle(a);
      r.showsCount = a.textContent === '7' && a.hidden === false && cs.display !== 'none';
      r.red = cs.backgroundColor; r.ink = cs.color;
      setNavBadge('nav-badge-agents', 150); r.cap = a.textContent;
      setNavBadge('nav-badge-agents', null); r.nullHidden = a.hidden === true;
      setNavBadge('nav-badge-projects', 3); r.projShows = p.textContent === '3' && p.hidden === false;
      return r;
    });

    const parse = (s) => (String(s).match(/\d+/g) || []).map(Number);
    if (out.error) { chk(false, out.error); }
    else {
      chk(out.onAgentsTab, 'the Agents tab carries a nav badge span', String(out.onAgentsTab));
      chk(out.onProjectsTab, 'the Projects tab carries a nav badge span', String(out.onProjectsTab));
      chk(out.zeroHidden, 'a zero count hides the badge (display:none)', String(out.zeroHidden));
      chk(out.showsCount, 'a positive count shows the badge with the number', String(out.showsCount));
      chk(out.projShows, 'the Projects badge shows its count too', String(out.projShows));
      const rgb = parse(out.red);
      chk(rgb[0] === 179 && rgb[1] === 38 && rgb[2] === 30, 'the badge is the shared unread red (#b3261e)', out.red);
      chk(out.ink === 'rgb(255, 255, 255)', 'the count is white', out.ink);
      chk(out.cap === '99+', 'a count over 99 caps at 99+', out.cap);
      chk(out.nullHidden, 'a null/unknown count hides the badge (never a guessed zero)', String(out.nullHidden));
    }

    /* (c) data wiring, by source: seeding real dmUnread/p.unread hermetically is not feasible. */
    const src = fs.readFileSync(nodePath.join(ROOT, 'web', 'index.html'), 'utf8');
    chk(/setNavBadge\('nav-badge-agents',\s*dmTotal\)/.test(src), 'the Agents badge is wired to the fleet dmTotal (tick), the same total as the #st-dm tile');
    chk(/setNavBadge\('nav-badge-projects',\s*Math\.max\(0,\s*\(Number\(c\.projectsUnread\)/.test(src), 'the Projects badge is set in tick() from the always-polled counts.projectsUnread (live cross-tab), minus the open room');
    chk(/const openProj = PJ_CURRENT \? pjById\(PJ_CURRENT\) : null;/.test(src) && /const openUnread = openProj \?/.test(src), 'the open room is subtracted from the server total (exact pjDmTotal parity, option i)');
    chk(!/setNavBadge\('nav-badge-projects', pjDmTotal\)/.test(src), 'the stale paintProjects-based Projects badge is removed (no visibility-gated freeze)');

    chk(errs.length === 0, 'no page errors', errs.join(' | '));
    await page.close();
  } finally {
    await browser.close();
  }
  if (fail.length) { console.log('\n' + fail.length + ' FAILED'); process.exit(1); }
  console.log('\nall passed');
})().catch((e) => { console.error(e); process.exit(2); });
