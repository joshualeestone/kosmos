'use strict';
// Browser-check-surface: alist-grouphdr alist-newagent openAddMemberModal setAgentsGrouped AGENTS_GROUPED alist-emptymembers
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

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED === '0', ignoreDefaultArgs: ['--hide-scrollbars'] });
  for (const theme of ['light', 'dark']) {
    // 1280px clears the 960px consolidated floor, so layoutConsolidated() is true.
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: theme });
    page.on('pageerror', (e) => problems.push(`[${theme}] pageerror: ${e.message}`));
    // The shared grouped fixture is defined here (runs on every navigation) rather than eval'd from a
    // stringified function: a consolidated board with project 'k' holding mem-1/mem-2 and a board of
    // two members + two outsiders. running:false rows render from record fields only. setInterval is
    // stubbed so no background poll repaints under an assertion.
    await page.addInitScript(() => {
      window.setInterval = () => 0;
      window.__setup3387 = function () {
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
    });
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      const x = m.text();
      if (/ERR_FILE_NOT_FOUND|URL scheme "file"|Failed to (fetch|load)/.test(x)) return;
      problems.push(`[${theme}] console: ${x}`);
    });
    const t = `[${theme}]`;

    // 1) GROUPED: the head renames, the sub-header appears, and the top + is repurposed.
    await page.goto(PAGE);
    const grouped = await page.evaluate(() => {
      window.__setup3387();
      const kids = [...document.getElementById('alist').children];
      const hdr = kids.find((k) => k.classList && k.classList.contains('alist-grouphdr')) || null;
      const plus = document.getElementById('rail-agents-new');
      return {
        railName: (document.querySelector('#rail-agents .railname') || {}).textContent,
        plusLabel: plus ? plus.getAttribute('aria-label') : null,
        plusTitle: plus ? plus.title : null,
        hdrAt: kids.findIndex((k) => k.classList && k.classList.contains('alist-grouphdr')),
        total: kids.length,
        hdrLabel: hdr ? (hdr.querySelector('.railname') || {}).textContent : null,
        hdrHasNewAgent: !!(hdr && hdr.querySelector('.alist-newagent')),
      };
    });
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
    const addExisting = await page.evaluate(() => {
      window.__setup3387();
      document.getElementById('rail-agents-new').click();
      const modal = document.getElementById('am-modal');
      const sel = document.getElementById('pj-one-add');
      const opts = sel ? [...sel.options].map((o) => o.value).filter(Boolean) : [];
      return {
        modalOpen: modal ? modal.hidden === false : null,
        toProject: (document.getElementById('am-project') || {}).textContent,
        freeOptions: opts,
      };
    });
    ok(t + ' #3387 the top + opens the add-member modal for the open project',
      addExisting.modalOpen === true && addExisting.toProject === 'Kosmos', JSON.stringify(addExisting));
    ok(t + ' #3387 the modal picker offers the free agents (not the members)',
      addExisting.freeOptions.length === 2 && addExisting.freeOptions.includes('out-a') && addExisting.freeOptions.includes('out-b')
        && !addExisting.freeOptions.includes('mem-1'), JSON.stringify(addExisting));

    // 3) The "Other Agents" + does the DIFFERENT thing: it opens the create-new-agent flow, and
    //    does NOT open the add-member modal. (Proves the two +s are distinct actions.)
    await page.goto(PAGE);
    const otherPlus = await page.evaluate(() => {
      window.__setup3387();
      document.querySelector('.alist-newagent').click();
      return {
        createShown: document.getElementById('panel-create').hidden === false,
        modalStillHidden: document.getElementById('am-modal').hidden === true,
      };
    });
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

    // 5) TRANSITION grouped -> empty board: if the whole board empties while a project is still
    //    open, paintAgentList's empty-board early return must still revert the head to "Agents" and
    //    drop the sub-header. Guards the setAgentsGrouped(false) call in that early-return branch
    //    specifically, entered straight from the grouped state (the one path no other assertion hits).
    await page.goto(PAGE);
    const groupedThenEmpty = await page.evaluate(() => {
      window.__setup3387();                            // establishes the grouped "Project Members" state
      const wasGrouped = (document.querySelector('#rail-agents .railname') || {}).textContent === 'Project Members';
      BOARD_SEEN = true;                               // the board was seen, then emptied (not a cold start)
      LAST = [];                                       // whole board goes empty, project still open
      paintAgentList();
      return {
        wasGrouped,
        railName: (document.querySelector('#rail-agents .railname') || {}).textContent,
        plusLabel: document.getElementById('rail-agents-new').getAttribute('aria-label'),
        hdrs: [...document.getElementById('alist').children].filter((k) => k.classList && k.classList.contains('alist-grouphdr')).length,
        hasEmpty: !!document.getElementById('alist').querySelector('.pj-empty'),
      };
    });
    ok(t + ' #3387 grouped -> empty board reverts the head to "Agents", drops the sub-header, and draws the empty state',
      groupedThenEmpty.wasGrouped === true && groupedThenEmpty.railName === 'Agents'
        && groupedThenEmpty.plusLabel === 'New agent' && groupedThenEmpty.hdrs === 0
        && groupedThenEmpty.hasEmpty === true, JSON.stringify(groupedThenEmpty));

    // 6) TRANSITION grouped -> failed poll: tick()'s catch writes the "could not refresh" state into
    //    #alist, which shows no rows, so the head must revert to "Agents" there too. Guards the
    //    setAgentsGrouped(false) added to the failure branch (the genuine empty-board path already
    //    had it, and the two same-looking empty lists must not disagree on the head/+ state).
    await page.goto(PAGE);
    const groupedThenFail = await page.evaluate(async () => {
      window.__setup3387();                            // grouped "Project Members"
      const wasGrouped = (document.querySelector('#rail-agents .railname') || {}).textContent === 'Project Members';
      window.fetch = () => Promise.reject(new Error('simulated poll failure'));   // the next poll fails
      await tick();                                    // its catch writes boardEmpty() into #alist
      return {
        wasGrouped,
        railName: (document.querySelector('#rail-agents .railname') || {}).textContent,
        plusLabel: document.getElementById('rail-agents-new').getAttribute('aria-label'),
        hdrs: [...document.getElementById('alist').children].filter((k) => k.classList && k.classList.contains('alist-grouphdr')).length,
      };
    });
    ok(t + ' #3387 a failed poll while grouped reverts the head to "Agents" and drops the sub-header',
      groupedThenFail.wasGrouped === true && groupedThenFail.railName === 'Agents'
        && groupedThenFail.plusLabel === 'New agent' && groupedThenFail.hdrs === 0, JSON.stringify(groupedThenFail));

    // 7) GROUPED with NO other agents: every visible board agent is already a member. The "Other
    //    Agents" sub-header and its create-new + must STILL render (drawn even when the rest list is
    //    empty), so creating a new agent stays reachable from the grouped state (plan design note).
    await page.goto(PAGE);
    const allMembers = await page.evaluate(() => {
      const mk = (id, name) => ({ id, name, parent: null, parentName: null, parentArchived: false, archived: false, summary: {}, agents: [], description: '', unread: 0 });
      PROJECTS = [mk('k', 'Kosmos')]; PJ_SORT = 'az';
      const fr = document.getElementById('firstrun'); if (fr) fr.hidden = true;
      document.documentElement.setAttribute('data-layout', 'consolidated');
      PJ_CURRENT = 'k'; showTab('projects');
      const proj = pjById('k');
      proj.agents = [{ sessionName: 'mem-1' }, { sessionName: 'mem-2' }];
      const a = (s) => ({ sessionName: s, name: s, role: '', running: false, state: 'stopped', context: null });
      LAST = [a('mem-1'), a('mem-2')];                 // every visible agent is a member; the rest is empty
      paintAgentList();
      const kids = [...document.getElementById('alist').children];
      const hdr = kids.find((k) => k.classList && k.classList.contains('alist-grouphdr')) || null;
      return {
        railName: (document.querySelector('#rail-agents .railname') || {}).textContent,
        total: kids.length,                            // 2 member rows + 1 sub-header = 3, nothing below it
        hdrLabel: hdr ? (hdr.querySelector('.railname') || {}).textContent : null,
        hdrHasNewAgent: !!(hdr && hdr.querySelector('.alist-newagent')),
        hdrIsLast: kids.length ? kids[kids.length - 1] === hdr : false,
      };
    });
    ok(t + ' #3387 grouped with no other agents still renders the "Other Agents" sub-header + its create + (create stays reachable)',
      allMembers.railName === 'Project Members' && allMembers.total === 3 && allMembers.hdrLabel === 'Other Agents'
        && allMembers.hdrHasNewAgent === true && allMembers.hdrIsLast === true, JSON.stringify(allMembers));

    // 8) FOCUS-RETURN for the new rail path: opening the add-member modal from the rail + and then
    //    closing it (amClose) returns focus to that +, so a keyboard user is left where they were.
    //    This is the new behaviour AM_OPENER adds. (The cross-opener staleness case a rail-open
    //    dismissed by pjView's direct hide, then a tab-view open+close is prevented STRUCTURALLY:
    //    both openers record themselves in AM_OPENER, so every amClose sees the opener it pairs with.
    //    It is not asserted here because the tab-view "Add member" button only lays out under the full
    //    project-detail paint this hermetic fixture does not run offsetParent would be null and the
    //    assertion inconclusive, which is worse than leaving it to the code + the reasoning above.)
    await page.goto(PAGE);
    const focusReturn = await page.evaluate(() => {
      window.__setup3387();                            // consolidated + project 'k' grouped
      const railVisible = document.getElementById('rail-agents-new').offsetParent !== null;
      document.getElementById('rail-agents-new').click();        // openAddMemberModal: AM_OPENER = rail +
      amClose();
      const afterRail = document.activeElement ? document.activeElement.id : null;
      return { railVisible, afterRail };
    });
    ok(t + ' #3387 fixture sanity: the rail + is on screen (else the focus assertion below is inconclusive)',
      focusReturn.railVisible === true, JSON.stringify(focusReturn));
    ok(t + ' #3387 focus returns to the rail + when the modal was opened from it and closed',
      focusReturn.afterRail === 'rail-agents-new', JSON.stringify(focusReturn));

    // 9) THE MISMATCH STATE (#3387b, Josh 2026-09-22): a project is open but NONE of its members are
    //    among the agents currently on the board. Before the fix this fell back to the flat "Agents"
    //    list and the top + reverted to New agent, so there was NO way to add an EXISTING agent to
    //    such a project (the dead + Josh reported). It must now STILL group on the open project: head
    //    "Project Members", the top + opens the add-member modal, and an empty-members hint stands in
    //    for the (empty) member rows so the section is guidance rather than a silent gap.
    await page.goto(PAGE);
    const mismatch = await page.evaluate(() => {
      const mk = (id, name) => ({ id, name, parent: null, parentName: null, parentArchived: false, archived: false, summary: {}, agents: [], description: '', unread: 0 });
      PROJECTS = [mk('k', 'Kosmos Growth')]; PJ_SORT = 'az';
      const fr = document.getElementById('firstrun'); if (fr) fr.hidden = true;
      document.documentElement.setAttribute('data-layout', 'consolidated');
      PJ_CURRENT = 'k'; showTab('projects');
      const proj = pjById('k');
      proj.agents = [{ sessionName: 'off-board-1' }, { sessionName: 'off-board-2' }];  // members NOT on the board
      const a = (s) => ({ sessionName: s, name: s, role: '', running: false, state: 'stopped', context: null });
      LAST = [a('on-board-a'), a('on-board-b')];         // board agents, none of them members of the project
      paintAgentList();
      const emptyHint = document.getElementById('alist').querySelector('.alist-emptymembers');
      document.getElementById('rail-agents-new').click();
      return {
        railName: (document.querySelector('#rail-agents .railname') || {}).textContent,
        emptyHintShown: !!emptyHint,
        modalOpen: document.getElementById('am-modal').hidden === false,
        addProject: (document.getElementById('am-project') || {}).textContent,
      };
    });
    ok(t + ' #3387b a project whose members are not on the board still groups as "Project Members"',
      mismatch.railName === 'Project Members', JSON.stringify(mismatch));
    ok(t + ' #3387b the top + opens the add-member modal for that project (the dead + Josh hit)',
      mismatch.modalOpen === true && mismatch.addProject === 'Kosmos Growth', JSON.stringify(mismatch));
    ok(t + ' #3387b an empty-members list shows the guidance hint, not a silent gap',
      mismatch.emptyHintShown === true, JSON.stringify(mismatch));

    await page.close();
  }
  await browser.close();

  if (problems.length) {
    // Each problem on its own `FAIL`-prefixed line so tools/browser-checks.sh's run_one can grep
    // the reason out of the captured log and name the failing assertion, instead of the unquotable
    // `problems:\n  ...` blob that surfaces only "(no FAIL or error line)".
    for (const p of problems) console.error('  FAIL  ' + p);
    console.log('\n' + pass + ' passed, ' + problems.length + ' FAILED');
    process.exit(1);
  }
  console.log(pass + ' passed, problems: none');
})().catch((e) => { console.error(e); process.exit(1); });
