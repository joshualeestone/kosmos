'use strict';
// Browser-check-surface: alist-grouphdr alist-newagent openAddMemberModal setAgentsGrouped AGENTS_GROUPED
// (#2518) the distinctive web/index.html tokens this check asserts: the grouped consolidated
// agents list's "Other Agents" sub-header + its New-agent +, and the functions that switch the
// top rail head to "Project Members" and open the add-member modal from the rail. A change to any
// of them must update this check at PR time.
/* #3387 (Josh, feedback 2026-09-21): in the CONSOLIDATED view with a project open, the agents
 * column head reads "Project Members" (was "Agents") and its top + adds an EXISTING agent to that
 * project (opens the shared add-member modal); a new "Other Agents" sub-header (in place of the old
 * plain rule) carries its OWN + that CREATES a new agent. Everywhere else the head stays "Agents"
 * and the top + is New agent. This drives the SHIPPED paintAgentList grouping + the #rail-agents-new
 * handler + openAddMemberModal against a real fixture in the real page.
 *
 * Run: NODE_PATH=$HOME/work/pw-runtime/node_modules node docs/browser-checks/render-project-members-3387.js
 *      (HEADED=0 on a machine with no console session)
 */
const path = require('node:path');
const { chromium } = require('playwright');
const PAGE = 'file://' + path.join(path.resolve(__dirname, '..', '..'), 'web', 'index.html');

const problems = [];
let pass = 0;
function ok(name, cond, detail) { if (cond) pass += 1; else problems.push(name + (detail ? ' -- ' + detail : '')); }

// The shared grouped-fixture: a consolidated board with project 'k' holding mem-1/mem-2, and a
// board sample of two members + two outsiders. running:false rows render from record fields only.
const SETUP = () => {
  const mk = (id, name) => ({ id, name, parent: null, parentName: null, parentArchived: false, archived: false, summary: {}, agents: [], description: '', unread: 0 });
  PROJECTS = [mk('k', 'Kosmos')];
  PJ_SORT = 'az';
  const fr = document.getElementById('firstrun'); if (fr) fr.hidden = true;
  document.documentElement.setAttribute('data-layout', 'consolidated');
  PJ_CURRENT = 'k';
  showTab('projects');
  const proj = pjById('k');
  proj.agents = [{ sessionName: 'mem-1' }, { sessionName: 'mem-2' }];
  const a = (s) => ({ sessionName: s, name: s, role: '', running: false, state: 'stopped', context: null });
  LAST = [a('out-a'), a('mem-1'), a('out-b'), a('mem-2')];
  paintAgentList();
};

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED === '0', ignoreDefaultArgs: ['--hide-scrollbars'] });
  for (const theme of ['light', 'dark']) {
    // 1280px clears the 960px consolidated floor, so layoutConsolidated() is true.
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: theme });
    page.on('pageerror', (e) => problems.push(`[${theme}] pageerror: ${e.message}`));
    await page.addInitScript(() => { window.setInterval = () => 0; });
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      const x = m.text();
      if (/ERR_FILE_NOT_FOUND|URL scheme "file"|Failed to (fetch|load)/.test(x)) return;
      problems.push(`[${theme}] console: ${x}`);
    });
    const t = `[${theme}]`;

    // 1) GROUPED: the head renames, the sub-header appears, and the top + is repurposed.
    await page.goto(PAGE);
    const grouped = await page.evaluate((setup) => {
      // eslint-disable-next-line no-eval
      (0, eval)('(' + setup + ')')();
      const kids = [...document.getElementById('alist').children];
      const hdr = kids.find((k) => k.classList && k.classList.contains('alist-grouphdr')) || null;
      const plus = document.getElementById('rail-agents-new');
      const res = {
        railName: (document.querySelector('#rail-agents .railname') || {}).textContent,
        plusLabel: plus ? plus.getAttribute('aria-label') : null,
        plusTitle: plus ? plus.title : null,
        hdrAt: kids.findIndex((k) => k.classList && k.classList.contains('alist-grouphdr')),
        total: kids.length,
        hdrLabel: hdr ? (hdr.querySelector('.railname') || {}).textContent : null,
        hdrHasNewAgent: !!(hdr && hdr.querySelector('.alist-newagent')),
      };
      return res;
    }, SETUP.toString());
    // A throw inside evaluate rejects the promise and fails the run via the outer .catch, so
    // these assert the observed values directly rather than carrying a vestigial err flag.
    ok(t + ' #3387 the head reads "Project Members" while a project is grouped',
      grouped.railName === 'Project Members', JSON.stringify(grouped));
    ok(t + ' #3387 the top + is repurposed to add an existing agent (aria-label + title)',
      grouped.plusLabel === 'Add an agent to this project' && grouped.plusTitle === 'Add an agent to this project', JSON.stringify(grouped));
    ok(t + ' #3387 an "Other Agents" sub-header with its own + sits between members and the rest (index 2 of 5)',
      grouped.hdrAt === 2 && grouped.total === 5 && grouped.hdrLabel === 'Other Agents' && grouped.hdrHasNewAgent === true, JSON.stringify(grouped));

    // 2) The top + opens the shared add-member modal, scoped to this project, picker populated
    //    with the FREE agents (out-a, out-b), not the members.
    await page.goto(PAGE);
    const addExisting = await page.evaluate((setup) => {
      // eslint-disable-next-line no-eval
      (0, eval)('(' + setup + ')')();
      document.getElementById('rail-agents-new').click();
      const modal = document.getElementById('am-modal');
      const sel = document.getElementById('pj-one-add');
      const opts = sel ? [...sel.options].map((o) => o.value).filter(Boolean) : [];
      return {
        modalOpen: modal ? modal.hidden === false : null,
        toProject: (document.getElementById('am-project') || {}).textContent,
        freeOptions: opts,
      };
    }, SETUP.toString());
    ok(t + ' #3387 the top + opens the add-member modal for the open project',
      addExisting.modalOpen === true && addExisting.toProject === 'Kosmos', JSON.stringify(addExisting));
    ok(t + ' #3387 the modal picker offers the free agents (not the members)',
      addExisting.freeOptions.length === 2 && addExisting.freeOptions.includes('out-a') && addExisting.freeOptions.includes('out-b')
        && !addExisting.freeOptions.includes('mem-1'), JSON.stringify(addExisting));

    // 3) The "Other Agents" + does the DIFFERENT thing: it opens the create-new-agent flow, and
    //    does NOT open the add-member modal. (Proves the two +s are distinct actions.)
    await page.goto(PAGE);
    const otherPlus = await page.evaluate((setup) => {
      // eslint-disable-next-line no-eval
      (0, eval)('(' + setup + ')')();
      document.querySelector('.alist-newagent').click();
      return {
        createShown: document.getElementById('panel-create').hidden === false,
        modalStillHidden: document.getElementById('am-modal').hidden === true,
      };
    }, SETUP.toString());
    ok(t + ' #3387 the "Other Agents" + opens the create-new-agent flow (not the add-member modal)',
      otherPlus.createShown === true && otherPlus.modalStillHidden === true, JSON.stringify(otherPlus));

    // 4) CONTROL: no project open -> the head is back to "Agents", no sub-header, and the top +
    //    opens create (never the add-member modal).
    await page.goto(PAGE);
    const control = await page.evaluate(() => {
      const mk = (id, name) => ({ id, name, parent: null, parentName: null, parentArchived: false, archived: false, summary: {}, agents: [], description: '', unread: 0 });
      PROJECTS = [mk('k', 'Kosmos')]; PJ_SORT = 'az';
      const fr = document.getElementById('firstrun'); if (fr) fr.hidden = true;
      document.documentElement.setAttribute('data-layout', 'consolidated');
      PJ_CURRENT = null;
      showTab('agents');
      const a = (s) => ({ sessionName: s, name: s, role: '', running: false, state: 'stopped', context: null });
      LAST = [a('x'), a('y')];
      paintAgentList();
      const railName = (document.querySelector('#rail-agents .railname') || {}).textContent;
      const plusLabel = document.getElementById('rail-agents-new').getAttribute('aria-label');
      const hdrs = [...document.getElementById('alist').children].filter((k) => k.classList && k.classList.contains('alist-grouphdr')).length;
      document.getElementById('rail-agents-new').click();
      return {
        railName, plusLabel, hdrs,
        createShown: document.getElementById('panel-create').hidden === false,
        modalHidden: document.getElementById('am-modal').hidden === true,
      };
    });
    ok(t + ' #3387 CONTROL: with no project open the head reads "Agents" and there is no sub-header',
      control.railName === 'Agents' && control.plusLabel === 'New agent' && control.hdrs === 0, JSON.stringify(control));
    ok(t + ' #3387 CONTROL: with no project open the top + opens create, never the add-member modal',
      control.createShown === true && control.modalHidden === true, JSON.stringify(control));

    await page.close();
  }
  await browser.close();

  if (problems.length) {
    console.log('problems:\n  ' + problems.join('\n  '));
    console.log('\n' + pass + ' passed, ' + problems.length + ' FAILED');
    process.exit(1);
  }
  console.log(pass + ' passed, problems: none');
})().catch((e) => { console.error(e); process.exit(1); });
