// Browser-check-surface: cstep-team tc-title tc-purpose tc-list tc-project tc-note tc-go tc-back tc-msg
'use strict';
/**
 * A whole prebuilt team in one go (#4557, umbrella #4554, Josh 2026-09-29 09:06), on a real board.
 *
 * What this pins, and why each line can fail:
 *  - openTeamCreate(key) lands on the team step: the team's name and purpose, one row per member with
 *    the suggested name editable, the lead FIRST, ONE button that says how many agents it makes, and a
 *    note that each one works on the person's AI plan, followed by the team's caution (#4555);
 *  - the project defaults to a new one named from the seed, and pressing the button makes it (for real,
 *    in this sandbox) before any agent;
 *  - every member is made through POST /api/agents in order, lead first, each report carrying the
 *    lead's MACHINE name as reportsTo (a renamed lead included) and the project;
 *  - a member that fails says why on its own row and offers Try again; the others still get made; Try
 *    again after renaming makes only that one, with the new name;
 *  - a lead that fails holds the others ("Waiting for the lead", nothing posted for them) until Try
 *    again on the lead releases them;
 *  - two seats with one name, or a name already taken on this computer (an agent's folder exists), are
 *    refused BEFORE anything is made, project included;
 *  - round 1: Try again during a run is made by the one run (nobody posted twice), focus stays on the
 *    person's row through repaints, progress is a polite live region, a member reads "Made, starting"
 *    until the board sees it running (then Running), "ready" only when all are, and a member renamed on
 *    Try again says its made teammates still know the old name;
 *  - 390 wide with no sideways scroll, chromium and webkit, no page errors.
 *
 * POST /api/agents is INTERCEPTED with a scripted outcome per name, so nothing here makes a real agent or
 * a launchd job. The seeded-team routes are the REAL ones, reading a fixture catalogue (the shape agreed
 * with #4555) injected into this same process through engine/teamseed.setCatalogue.
 *
 *   node docs/browser-checks/render-teamcreate-4557.js            # headed
 *   HEADED=0 node docs/browser-checks/render-teamcreate-4557.js   # headless
 */
require('./lib-sandbox-home.js'); // #3675: never read the host computer's real accounts
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-teamcreate-bc-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-teamcreate-bc-workers-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-teamcreate-bc-projects-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-teamcreate-bc-launch-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-teamcreate-bc-config-'));
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';
const SANDBOXES = [SANDBOX, process.env.AGENT_WORKFORCE_WORKERS, process.env.AGENT_WORKFORCE_PROJECTS,
  process.env.AGENT_WORKFORCE_LAUNCH, process.env.AGENT_WORKFORCE_CONFIG_ROOT];

const playwright = require('playwright');
const fleet = require('../../test-support/fleet');
const srv = require('../../server.js');
const projects = require('../../engine/projects');
const teamseed = require('../../engine/teamseed');
const create = require('../../engine/create');

const TEAM = {
  key: 'marketing', kind: 'business', rank: 1, label: 'Marketing Team', blurb: 'One line',
  purpose: 'Plans and runs your marketing.', caution: 'The lead briefs the rest of the team and checks their work on its own.', project: { name: 'Marketing', goal: 'Grow the business' },
  members: [
    { slot: 'content', role: 'copy', title: 'Content Writer', name: 'Leo', reportsTo: 'lead', avatar: { image: null } },
    { slot: 'lead', role: 'marketing', title: 'Chief Marketing Officer', name: 'Maya', reportsTo: null, avatar: { image: null } },
    { slot: 'social', role: 'social', title: 'Social Media Manager', name: 'Ana', reportsTo: 'lead', avatar: { image: null } },
  ],
};
teamseed.setCatalogue({
  teams: () => [TEAM],
  team: (k) => (k === TEAM.key ? TEAM : null),
  memberInstructions: (k, slot, names) => 'You are **' + names[slot] + '**, the ' + slot + '.\n\nYou report to ' + names.lead + '.\n',
});

const slug = (n) => String(n).trim().toLowerCase().replace(/[\s.]+/g, '-');
const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

(async () => {
  fleet.install([fleet.agent('ada', { state: 'idle', displayName: 'Ada', role: 'a planner' })]);
  // Ada is already an agent on this board: her folder is what makes the name taken.
  fs.mkdirSync(create.workerDir('ada'), { recursive: true });
  const server = await srv.start(0);
  const URL = 'http://127.0.0.1:' + server.address().port;
  const clearFirstRun = async (page) => { if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); } };

  try {
    for (const engineName of ['chromium', 'webkit']) {
      const browser = await playwright[engineName].launch({ headless: process.env.HEADED === '0' });
      const E = `[${engineName}]`;
      try {
        /* The create intercept: `script[name]` is the answer for the NEXT create of that name (then it
           reverts to created). Every body is recorded, in order. */
        const newPage = async (width) => {
          /* 🛑 serviceWorkers: 'block' is load-bearing. The board's service worker answers fetches in webkit
             BEFORE page.route sees them, so without it webkit's creates reached the REAL /api/agents
             (measured: every intercept arm red on webkit, the lead "Not made" by the real server). */
          const ctx = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: 'block' });
          const page = await ctx.newPage();
          const errs = [];
          page.on('pageerror', (e) => errs.push(e.message));
          const posted = [];
          const script = {};
          const slow = {};        // name -> ms to hold its create answer (to have one in flight)
          const hidden = new Set();   // machine names the board must NOT see running (the unseen arm)
          const made = [];
          await page.route('**/api/agents', async (r) => {
            if (r.request().method() !== 'POST') return r.continue();
            const b = JSON.parse(r.request().postData() || '{}');
            posted.push(b);
            if (slow[b.name]) await new Promise((res) => setTimeout(res, slow[b.name]));
            const s = script[b.name];
            if (s) { delete script[b.name]; return r.fulfill({ status: 400, json: { outcome: 'refused', because: s } }); }
            made.push(slug(b.name));
            return r.fulfill({ status: 200, json: { outcome: 'created', name: slug(b.name), shownAs: b.name, steps: [], projects: (b.projects || []).map((id) => ({ id, added: true })) } });
          });
          /* Round 1: the step now waits for the BOARD to see each member before it says Running (and before
             the portrait and project tell). The real /api/status passes through, with each intercepted member
             appended as a running card of ours, unless the arm hides it. */
          await page.route('**/api/status*', async (r) => {
            const resp = await r.fetch();
            const j = await resp.json().catch(() => null);
            if (!j || !Array.isArray(j.agents)) return r.fulfill({ response: resp });
            for (const n of made) if (!hidden.has(n)) j.agents.push({ sessionName: n, name: n, displayName: n, isAgentSession: true, isNamedOurs: true, state: 'idle' });
            return r.fulfill({ response: resp, json: j });
          });
          await page.goto(URL, { waitUntil: 'networkidle' });
          await clearFirstRun(page);
          return { page, errs, posted, script, slow, hidden };
        };
        const rows = (page) => page.evaluate(() => [...document.querySelectorAll('#tc-list li')].map((li) => ({
          slot: li.dataset.slot,
          seat: li.querySelector('.tc-seat').textContent,
          name: li.querySelector('.tc-name').value,
          editable: !li.querySelector('.tc-name').disabled,
          state: li.querySelector('.tc-state').textContent,
          why: (li.querySelector('.tc-why') || {}).textContent || '',
          retry: !!li.querySelector('.tc-retry'),
        })));
        const settle = (page, pred) => page.waitForFunction(pred, null, { timeout: 8000 }).catch(() => null);

        /* --- the step, the happy path with one failure and its retry --------------------------- */
        {
          const { page, errs, posted, script } = await newPage(1280);
          await page.evaluate(() => openTeamCreate('marketing'));
          await settle(page, () => document.querySelectorAll('#tc-list li').length === 3);
          const view = await page.evaluate(() => ({
            shown: !document.getElementById('cstep-team').hidden && document.getElementById('cstep-role').hidden,
            title: document.getElementById('tc-title').textContent,
            purpose: document.getElementById('tc-purpose').textContent,
            go: document.getElementById('tc-go').textContent,
            note: document.getElementById('tc-note').textContent,
            project: document.getElementById('tc-project').value,
            projectText: document.getElementById('tc-project').selectedOptions[0].textContent,
          }));
          const r0 = await rows(page);
          chk(view.shown && view.title === 'Marketing Team' && view.purpose === 'Plans and runs your marketing.', `${E} openTeamCreate lands on the team step with the team's name and purpose`, JSON.stringify(view));
          chk(r0.map((r) => r.slot).join() === 'lead,content,social' && /leads the team/.test(r0[0].seat), `${E} one row per member, the lead first`, JSON.stringify(r0.map((r) => r.slot)));
          chk(r0.map((r) => r.name).join() === 'Maya,Leo,Ana' && r0.every((r) => r.editable), `${E} the suggested names are there and editable`, JSON.stringify(r0.map((r) => r.name)));
          chk(view.go === 'Create 3 agents' && /works on your AI plan/.test(view.note), `${E} ONE button says how many agents, and the note says they work on the person's AI plan`, view.go + ' | ' + view.note);
          chk(/works on your AI plan[^]*The lead briefs the rest of the team and checks their work on its own\.$/.test(view.note), `${E} the team's caution follows the AI plan line`, view.note);
          /* The second engine runs on the same sandbox, where the first made "Marketing": the new one must
             take the next free name rather than collide (a second Marketing team, for a person). */
          const wantName = engineName === 'chromium' ? 'Marketing' : 'Marketing 2';
          chk(view.project === 'new' && view.projectText === 'A new project called ' + wantName, `${E} the project defaults to a new one named from the seed, the first free name`, view.projectText);

          await page.fill('#tc-list li[data-slot="lead"] .tc-name', 'Maya Okafor');
          script.Leo = 'an agent called Leo already exists';
          const projectsBefore = projects.readAll().length;
          await page.click('#tc-go');
          await settle(page, () => [...document.querySelectorAll('#tc-list .tc-state')].every((s) => /Running|Not made/.test(s.textContent)));
          const r1 = await rows(page);
          const made = projects.readAll().filter((p) => p.name === wantName);
          chk(projects.readAll().length === projectsBefore + 1 && made.length === 1, `${E} pressing the button made the project, for real`, String(projects.readAll().length - projectsBefore));
          const pid = made[0] && made[0].id;
          chk(posted.map((b) => b.name).join() === 'Maya Okafor,Leo,Ana', `${E} every member was posted to /api/agents, lead first`, JSON.stringify(posted.map((b) => b.name)));
          chk(posted.length === 3 && !posted[0].reportsTo && posted[1].reportsTo === 'maya-okafor' && posted[2].reportsTo === 'maya-okafor',
            `${E} each report is sent the renamed lead's machine name`, JSON.stringify(posted.map((b) => b.reportsTo)));
          chk(posted.every((b) => Array.isArray(b.projects) && b.projects[0] === pid), `${E} every member carries the new project`, JSON.stringify(posted.map((b) => b.projects)));
          chk(posted.every((b) => b.instructions === undefined && typeof b.teamInstructions === 'string' && b.teamInstructions.includes('**' + b.name + '**')),
            `${E} every member carries its team brief (layered into its role's instructions, never raw instructions), with its own name in it`);
          chk(r1[0].state === 'Running' && r1[2].state === 'Running' && !r1[0].editable, `${E} the lead and the other report are made, and a made name is no longer editable`, JSON.stringify(r1.map((r) => r.state)));
          chk(r1[1].state === 'Not made' && r1[1].why === 'an agent called Leo already exists' && r1[1].retry && r1[1].editable,
            `${E} the failed one says why on its own row, keeps its name editable and offers Try again`, JSON.stringify(r1[1]));

          await page.fill('#tc-list li[data-slot="content"] .tc-name', 'Leo Two');
          await page.click('#tc-list li[data-slot="content"] .tc-retry');
          await settle(page, () => /Running/.test((document.querySelector('#tc-list li[data-slot="content"] .tc-state') || {}).textContent || ''));
          const r2 = await rows(page);
          chk(posted.length === 4 && posted[3].name === 'Leo Two' && posted[3].reportsTo === 'maya-okafor' && posted[3].projects[0] === pid,
            `${E} Try again makes only that one, with its new name, the lead and the project`, JSON.stringify(posted.slice(3)));
          chk(r2.every((r) => r.state === 'Running') && /Your team is ready/.test(await page.textContent('#tc-note')), `${E} all running, and the step says the team is ready`, JSON.stringify(r2.map((r) => r.state)));
          chk(/still know it as Leo\b/.test(r2[1].why), `${E} a member renamed on Try again says its made teammates still know the old name`, r2[1].why);
          chk(await page.evaluate(() => document.getElementById('tc-note').getAttribute('aria-live') === 'polite'), `${E} the step's progress line is a polite live region`);
          chk(errs.length === 0, `${E} no page errors`, errs.join(' | '));
          await page.close();
        }

        /* --- a lead that fails holds the others until it is made -------------------------------- */
        {
          const { page, errs, posted, script } = await newPage(1280);
          await page.evaluate(() => openTeamCreate('marketing'));
          await settle(page, () => document.querySelectorAll('#tc-list li').length === 3);
          await page.selectOption('#tc-project', 'none');
          script.Maya = 'the account this agent would use is not signed in';
          await page.click('#tc-go');
          await settle(page, () => /Not made/.test((document.querySelector('#tc-list li[data-slot="lead"] .tc-state') || {}).textContent || ''));
          const r1 = await rows(page);
          chk(posted.length === 1 && posted[0].name === 'Maya', `${E} with the lead refused, nothing is posted for the others`, JSON.stringify(posted.map((b) => b.name)));
          chk(r1[1].state === 'Waiting for the lead' && r1[2].state === 'Waiting for the lead' && !r1[1].retry, `${E} the others say they are waiting for the lead`, JSON.stringify(r1.map((r) => r.state)));
          chk(posted.every((b) => !('projects' in b)), `${E} No project sends no project`);
          await page.click('#tc-list li[data-slot="lead"] .tc-retry');
          await settle(page, () => [...document.querySelectorAll('#tc-list .tc-state')].every((s) => s.textContent === 'Running'));
          const r2 = await rows(page);
          chk(posted.map((b) => b.name).join() === 'Maya,Maya,Leo,Ana' && r2.every((r) => r.state === 'Running'), `${E} Try again on the lead makes it, then the others`, JSON.stringify(posted.map((b) => b.name)));
          chk(errs.length === 0, `${E} no page errors (lead arm)`, errs.join(' | '));
          await page.close();
        }

        /* --- round 1 BLOCKER: Try again during a run never starts a second run ----------------------- */
        {
          const { page, errs, posted, script, slow } = await newPage(1280);
          await page.evaluate(() => openTeamCreate('marketing'));
          await settle(page, () => document.querySelectorAll('#tc-list li').length === 3);
          await page.selectOption('#tc-project', 'none');
          script.Leo = 'an agent called Leo already exists';
          slow.Ana = 2500;   // Ana is still being made when Leo's Try again is pressed
          await page.click('#tc-go');
          await settle(page, () => /Not made/.test((document.querySelector('#tc-list li[data-slot="content"] .tc-state') || {}).textContent || '')
            && /Making/.test((document.querySelector('#tc-list li[data-slot="social"] .tc-state') || {}).textContent || ''));
          const during = await rows(page);
          chk(during[1].state === 'Not made' && during[2].state === 'Making…' && await page.isDisabled('#tc-back'),
            `${E} precondition: Leo failed while Ana is still being made, and Back waits for the run`, JSON.stringify(during.map((r) => r.state)));
          // Focus survives the repaints a run makes: type a new name while Ana finishes.
          await page.fill('#tc-list li[data-slot="content"] .tc-name', 'Leo Two');
          await page.focus('#tc-list li[data-slot="content"] .tc-retry');
          await page.keyboard.press('Enter');
          await settle(page, () => [...document.querySelectorAll('#tc-list .tc-state')].every((s) => s.textContent === 'Running'));
          const names = posted.map((b) => b.name);
          chk(names.join() === 'Maya,Leo,Ana,Leo Two', `${E} Try again during a run is made once, by the one run: nobody is posted twice`, JSON.stringify(names));
          chk(await page.evaluate(() => { const a = document.activeElement; return Boolean(a && a.closest && a.closest('li[data-slot="content"]')); }),
            `${E} focus stays on the row the person was using, through the repaints`, await page.evaluate(() => (document.activeElement || {}).outerHTML || 'none'));
          chk(errs.length === 0, `${E} no page errors (single-flight arm)`, errs.join(' | '));
          await page.close();
        }

        /* --- round 1: "Made" is not "running" until the board sees it -------------------------------- */
        {
          const { page, errs, hidden } = await newPage(1280);
          await page.evaluate(() => { TC_WATCH_MS = 3000; openTeamCreate('marketing'); });
          await settle(page, () => document.querySelectorAll('#tc-list li').length === 3);
          await page.selectOption('#tc-project', 'none');
          hidden.add('ana');
          await page.click('#tc-go');
          await settle(page, () => /Made, starting/.test((document.querySelector('#tc-list li[data-slot="social"] .tc-state') || {}).textContent || ''));
          const starting = await rows(page);
          chk(starting[2].state === 'Made, starting…' && !/ready/.test(await page.textContent('#tc-note')),
            `${E} a member the board cannot see yet reads "Made, starting", and the team is not called ready`, JSON.stringify(starting.map((r) => r.state)));
          await settle(page, () => /not seen running/.test((document.querySelector('#tc-list li[data-slot="social"] .tc-state') || {}).textContent || ''));
          const after = await rows(page);
          chk(after[2].state === 'Made, not seen running yet' && after[0].state === 'Running' && !/ready/.test(await page.textContent('#tc-note')),
            `${E} after the wait it says so plainly, and still does not claim the team is ready`, JSON.stringify(after.map((r) => r.state)) + ' | ' + await page.textContent('#tc-note'));
          chk(errs.length === 0, `${E} no page errors (unseen arm)`, errs.join(' | '));
          await page.close();
        }

        /* --- two seats, one name: refused before anything is made --------------------------------- */
        {
          const { page, errs, posted } = await newPage(1280);
          await page.evaluate(() => openTeamCreate('marketing'));
          await settle(page, () => document.querySelectorAll('#tc-list li').length === 3);
          await page.fill('#tc-list li[data-slot="social"] .tc-name', 'maya');
          const before = projects.readAll().length;
          await page.click('#tc-go');
          await settle(page, () => !document.getElementById('tc-msg').hidden);
          const msg = await page.textContent('#tc-msg');
          chk(/same name/.test(msg) && posted.length === 0 && projects.readAll().length === before,
            `${E} two seats with one name are refused before any project or agent is made`, msg + ' | posted ' + posted.length);
          chk(!(await page.isDisabled('#tc-go')) && !(await page.isHidden('#tc-go')), `${E} and the button is back to try again`);
          chk(errs.length === 0, `${E} no page errors (refusal arm)`, errs.join(' | '));
          await page.close();
        }

        /* --- a name already taken on this computer: refused before anything is made ----------------- */
        {
          const { page, errs, posted } = await newPage(1280);
          await page.evaluate(() => openTeamCreate('marketing'));
          await settle(page, () => document.querySelectorAll('#tc-list li').length === 3);
          await page.fill('#tc-list li[data-slot="content"] .tc-name', 'Ada');
          const before = projects.readAll().length;
          await page.click('#tc-go');
          await settle(page, () => !document.getElementById('tc-msg').hidden);
          const msg = await page.textContent('#tc-msg');
          chk(msg === 'there is already an agent called Ada on this computer; give the Content Writer another name' && posted.length === 0 && projects.readAll().length === before,
            `${E} a name already taken on this computer is refused before any project or agent is made`, msg + ' | posted ' + posted.length);
          chk(errs.length === 0, `${E} no page errors (taken arm)`, errs.join(' | '));
          await page.close();
        }

        /* --- phone width ------------------------------------------------------------------------ */
        {
          const { page, errs } = await newPage(390);
          await page.evaluate(() => openTeamCreate('marketing'));
          await settle(page, () => document.querySelectorAll('#tc-list li').length === 3);
          const fit = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, vw: innerWidth,
            inputs: [...document.querySelectorAll('#tc-list .tc-name')].every((i) => i.getBoundingClientRect().width >= 120) }));
          chk(fit.sw <= fit.vw && fit.inputs, `${E} 390 wide: no sideways scroll and every name box is usable`, JSON.stringify(fit));
          chk(errs.length === 0, `${E} no page errors (390)`, errs.join(' | '));
          await page.close();
        }
      } finally { await browser.close(); }
    }
    /* No create may reach the real route: if one slipped past the intercept, this sandboxed server
       would have counted it. */
    const real = require('../../engine/create').createdCount();
    chk(real === 0, 'no create reached the real /api/agents (the sandboxed server counted ' + real + ')');
  } finally {
    try { server.closeAllConnections(); server.close(); } catch { /* going away */ }
    teamseed.setCatalogue(null);
    for (const d of SANDBOXES) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
  }
  console.log('\n' + (fail.length ? fail.length + ' FAILED' : 'ALL PASSED'));
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error('FAIL  render-teamcreate-4557 crashed: ' + ((e && e.stack) || e)); process.exit(1); });
