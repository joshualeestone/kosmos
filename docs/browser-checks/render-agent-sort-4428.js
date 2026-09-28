'use strict';
// Browser-check-surface: agent-sort sortAgents agentSortVisibility
/* #4428: the Agents sort is one persisted native select shared by grid and list.
 * It sits beside each Agents view switch, disappears for the org chart, and fits
 * at phone width. This drives the real controls and renderers in both themes.
 *
 * Run: NODE_PATH=$HOME/work/pw-runtime/node_modules node docs/browser-checks/render-agent-sort-4428.js
 */
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright');
const PAGE = 'file://' + path.join(path.resolve(__dirname, '..', '..'), 'web', 'index.html');
const SHOTS = process.env.SHOTS || '';

const problems = [];
let pass = 0;
function ok(name, cond, detail) { if (cond) pass += 1; else problems.push(name + (detail ? ' -- ' + detail : '')); }

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED === '0', ignoreDefaultArgs: ['--hide-scrollbars'] });
  for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: theme });
    page.on('pageerror', (e) => problems.push(`[${theme}] pageerror: ${e.message}`));
    await page.addInitScript(() => { window.setInterval = () => 0; });
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      const x = m.text();
      if (/ERR_FILE_NOT_FOUND|URL scheme "file"|Failed to (fetch|load)|Access to fetch at 'file:\/\/\/api\//.test(x)) return;
      problems.push(`[${theme}] console: ${x}`);
    });
    await page.goto(PAGE);
    const t = `[${theme}]`;
    const result = await page.evaluate(() => {
      const mk = (name, over) => ({
        name, sessionName: name.toLowerCase(), running: false, state: 'stopped', role: null,
        profile: {}, dmUnread: 0, isGuide: false, ...over,
      });
      LAST = [
        mk('Dee', { lastTalkedAt: '2026-09-28T09:00:00Z', lastActiveAt: null, createdAt: null }),
        mk('Cam', { lastTalkedAt: null, lastActiveAt: '2026-09-28T09:00:00Z', createdAt: '2026-09-23T00:00:00Z', runner: 'codex', modelName: 'GPT', state: 'working', role: 'Engineer' }),
        mk('Bea', { lastTalkedAt: '2026-09-28T11:00:00Z', lastActiveAt: '2026-09-28T12:00:00Z', createdAt: '2026-09-22T00:00:00Z', runner: 'claude', modelName: 'Sonnet', state: 'blocked', role: 'Designer' }),
        mk('Ada', { lastTalkedAt: '2026-09-28T10:00:00Z', lastActiveAt: '2026-09-28T08:00:00Z', createdAt: '2026-09-21T00:00:00Z', runner: 'claude', modelName: 'Opus', state: 'needs_you', role: 'Engineer' }),
      ];
      PROJECTS = [
        { id: 'z', name: 'Zebra', agents: [{ sessionName: 'bea' }] },
        { id: 'a', name: 'Alpha', agents: [{ sessionName: 'ada' }, { sessionName: 'bea' }] },
      ];
      PJ_CURRENT = null;
      const fr = document.getElementById('firstrun'); if (fr) fr.hidden = true;
      document.documentElement.setAttribute('data-layout', 'tabs');
      showTab('agents');
      BOARD_SEEN = true;
      BOARD_LAYOUT = 'grid';
      boardApplyVisibility(true);
      const select = document.getElementById('agent-sort');
      const order = (root) => [...document.querySelectorAll(root + ' [data-agent]')].map((x) => x.dataset.agent);
      const got = {};
      for (const mode of AGENT_SORTS) {
        select.value = mode;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        got[mode] = { grid: order('#grid'), list: order('#alist') };
      }
      let saved = null; try { saved = localStorage.getItem('kosmos.sort.agents'); } catch { saved = 'unreadable'; }
      layoutApply('agents', 'org');
      const beforeOrg = document.getElementById('orgview').innerHTML;
      const sortHiddenInOrg = document.querySelector('#boardbar .agent-sortctl').hidden === true;
      select.value = 'talked'; select.dispatchEvent(new Event('change', { bubbles: true }));
      const orgUnchanged = document.getElementById('orgview').innerHTML === beforeOrg;
      layoutApply('agents', 'grid');
      document.documentElement.setAttribute('data-layout', 'consolidated');
      showTab('projects');
      openConsolidatedAgents();
      const cons = document.querySelector('#panel-cons-agents .agent-sortctl select');
      const consShared = !!cons && cons.value === AGENT_SORT && cons.getClientRects().length > 0;
      document.querySelector('#panel-cons-agents [data-conslay="org"]').click();
      const consHiddenInOrg = cons.closest('.agent-sortctl').hidden === true;
      return { got, saved, sortHiddenInOrg, orgUnchanged, consShared, consHiddenInOrg };
    });
    const expected = {
      talked: ['bea', 'ada', 'dee', 'cam'], model: ['ada', 'bea', 'cam', 'dee'],
      name: ['ada', 'bea', 'cam', 'dee'], needs: ['ada', 'bea', 'cam', 'dee'],
      active: ['bea', 'cam', 'ada', 'dee'], newest: ['cam', 'bea', 'ada', 'dee'],
      project: ['ada', 'bea', 'cam', 'dee'], role: ['bea', 'ada', 'cam', 'dee'],
    };
    for (const [mode, want] of Object.entries(expected)) {
      const row = result.got[mode];
      ok(`${t} ${mode} orders the grid`, JSON.stringify(row.grid) === JSON.stringify(want), JSON.stringify(row));
      ok(`${t} ${mode} orders the list the same way`, JSON.stringify(row.list) === JSON.stringify(want), JSON.stringify(row));
    }
    ok(`${t} the choice persists`, result.saved === 'role', JSON.stringify(result));
    ok(`${t} the tab Org chart hides Sort and is not repainted by a sort change`, result.sortHiddenInOrg && result.orgUnchanged, JSON.stringify(result));
    ok(`${t} the consolidated control shares the choice and hides for Org chart`, result.consShared && result.consHiddenInOrg, JSON.stringify(result));
    if (SHOTS) {
      fs.mkdirSync(SHOTS, { recursive: true });
      await page.evaluate(() => {
        document.documentElement.setAttribute('data-layout', 'tabs');
        showTab('agents');
        layoutApply('agents', 'grid');
        document.getElementById('uoffline-slot').hidden = true;
        document.getElementById('removed-msg').hidden = true;
      });
      await page.screenshot({ path: path.join(SHOTS, `agent-sort-${theme}.png`), fullPage: false });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    const phone = await page.evaluate(() => {
      document.documentElement.setAttribute('data-layout', 'tabs');
      showTab('agents'); layoutApply('agents', 'grid');
      const control = document.querySelector('#boardbar .viewctl');
      const select = document.getElementById('agent-sort');
      const r = control.getBoundingClientRect(); const s = select.getBoundingClientRect();
      return { shown: s.width > 0 && s.height >= 32, inside: r.left >= 0 && r.right <= innerWidth, sideScroll: document.documentElement.scrollWidth > innerWidth };
    });
    ok(`${t} the native Sort and view switch fit at phone width`, phone.shown && phone.inside && !phone.sideScroll, JSON.stringify(phone));
    await page.close();
  }
  await browser.close();
  if (problems.length) {
    console.log('problems:\n  ' + problems.join('\n  '));
    console.log(`\n${pass} passed, ${problems.length} FAILED`);
    process.exit(1);
  }
  console.log(`${pass} passed, problems: none`);
})().catch((e) => { console.error(e); process.exit(1); });
