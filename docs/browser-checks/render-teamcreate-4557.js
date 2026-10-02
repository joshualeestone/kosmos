// Browser-check-surface: cstep-teammake tc-title tc-purpose tc-list tc-project tc-provider tc-account tc-account-row tc-note tc-tell tc-tell-say tc-go tc-hello tc-back tc-msg just-made
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
 *  - #4936: once every member runs, Kosmos says hello to each (lead first); placed rows read Started, a not-placed
 *    one is retried then offers Try again and the step stays with Go to your team; all placed, it goes to the
 *    agents view with the new members' cards marked. TC_AUTO_HELLO is off in arms that are not about it.
 *  - round 1: Try again during a run is made by the one run (nobody posted twice), focus stays on the
 *    person's row through repaints, progress is a polite live region, a member reads "Made, starting"
 *    until the board sees it running (then Running), "ready" only when all are, and a member renamed on
 *    Try again says its made teammates still know the old name;
 *  - round 3: Back mid-run steps away and reopening resumes the same rows (nothing made twice, one
 *    project); another team waits only while one is in flight, and replaces an idle unfinished one (round
 *    5: never a false "still making"); a step create reports as not done is said
 *    on its row;
 *  - #4719: a person whose only account is OpenAI (the list emptied first, so it is read fresh when the
 *    step opens, by the create form's read or the step's own) gets the team on OpenAI and that account,
 *    with no account menu for one account, and every member is made on it in one press; the choice is
 *    fixed once it starts; an account list slower than the step's 5 s wait still sets the default when
 *    it lands; the menus lock at the click and open again if the click is refused;
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
    /* #4720: as the published catalogue now is, two members name a portrait. The board serves the lead's
       (/api/catalogue/portrait answers it); the writer's cannot be had (404), so it gets the generated mark. */
    { slot: 'content', role: 'copy', title: 'Content Writer', name: 'Leo', reportsTo: 'lead', avatar: { image: 'avatars/marketing-content.webp' } },
    { slot: 'lead', role: 'marketing', title: 'Chief Marketing Officer', name: 'Maya', reportsTo: null, avatar: { image: 'avatars/marketing-lead.webp' } },
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
          /* name -> a create held until the arm releases it. A timed hold (slow) lets a race arm pass with
             no race on a loaded machine: the held create finishes before the arm's next click lands. */
          const gate = {};
          const holdCreate = (name) => { let release; const p = new Promise((res) => { release = res; }); gate[name] = { p, release }; return release; };
          const warnSteps = {};   // name -> a non-fatal step label create reports as not done
          const hidden = new Set();   // machine names the board must NOT see running (the unseen arm)
          const drop = {};        // name -> its create LANDS, then the connection drops (iteration 12's arm)
          const made = [];
          const specsFail = { n: 0 };   // how many of the RUN's spec reads fail (the names pre-check never does)
          const specsMangle = { slot: null, reads: 0 };   // a slot whose spec comes back under another name than was sent
          const checkHold = { p: null };   // the names pre-check held until the arm releases it (review 27)
          const pictures = [];             // every picture PUT: { name, type }. The members here are not real agents, so it is answered here.
          const portraitAsks = [];         // #4720: every /api/catalogue/portrait read, as "team/slot"
          const staticAsks = [];           // #4720: any read of a catalogue image path under the board (must stay empty)
          await page.route('**/api/catalogue/portrait*', async (r) => {
            const q = new globalThis.URL(r.request().url()).searchParams;
            portraitAsks.push(q.get('team') + '/' + q.get('slot'));
            if (q.get('team') === 'marketing' && q.get('slot') === 'lead') {
              // A minimal WebP container: what the board serves only after checking it (engine/catalogue.js).
              const body = Buffer.concat([Buffer.from('RIFF'), Buffer.from([16, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(8)]);
              return r.fulfill({ status: 200, contentType: 'image/webp', body });
            }
            /* Both ways a read can come to nothing: the route's own 404 in chromium, a read that never answers
               (the catch branch) in webkit. Either way the member gets the generated mark (review 1). */
            if (engineName === 'webkit') return r.abort('failed');
            return r.fulfill({ status: 404, json: { error: 'the Content Writer of the Marketing Team has no portrait yet' } });
          });
          await page.route('**/avatars/**', (r) => { staticAsks.push(r.request().url()); return r.fulfill({ status: 404, body: 'no' }); });
          await page.route('**/api/agent/*/avatar', async (r) => {
            if (r.request().method() !== 'PUT') return r.continue();
            // `URL` in this file is the board's address (a string), so the agent's name is cut from the path by hand.
            pictures.push({ name: decodeURIComponent(r.request().url().split('/api/agent/')[1].split('/')[0]), type: r.request().headers()['content-type'] || '' });
            return r.fulfill({ status: 200, json: { ok: true } });
          });
          await page.route('**/api/teams/seeded/*/specs', async (r) => {
            const b = JSON.parse(r.request().postData() || '{}');
            if (b.check && checkHold.p) { const held = checkHold.p; checkHold.p = null; await held; }
            if (!b.check && specsFail.n > 0) { specsFail.n -= 1; return r.fulfill({ status: 503, json: { error: 'Kosmos could not prepare the team' } }); }
            if (!b.check && specsMangle.slot) {
              specsMangle.reads += 1;
              const resp = await r.fetch();
              const j = await resp.json().catch(() => null);
              if (j && Array.isArray(j.specs)) for (const sp of j.specs) if (sp.slot === specsMangle.slot) sp.spec.name += ' x';
              return r.fulfill({ response: resp, json: j });
            }
            return r.continue();
          });
          const projectTaken = { n: 0 };   // how many project creates are refused as "that folder is already a project"
          const projectPosts = [];
          await page.route('**/api/projects', async (r) => {
            if (r.request().method() !== 'POST') return r.continue();
            const b = JSON.parse(r.request().postData() || '{}');
            projectPosts.push(b.name);
            if (projectTaken.n > 0) { projectTaken.n -= 1; return r.fulfill({ status: 400, json: { error: 'that folder is already the project "Growth"', code: 'folder_taken' } }); }
            return r.continue();
          });
          await page.route('**/api/agents', async (r) => {
            if (r.request().method() !== 'POST') return r.continue();
            const b = JSON.parse(r.request().postData() || '{}');
            posted.push(b);
            if (slow[b.name]) await new Promise((res) => setTimeout(res, slow[b.name]));
            if (gate[b.name]) { const g = gate[b.name]; delete gate[b.name]; await g.p; }
            const s = script[b.name];
            if (s) { delete script[b.name]; return r.fulfill({ status: 400, json: { outcome: 'refused', because: s } }); }
            if (drop[b.name]) { delete drop[b.name]; made.push(slug(b.name)); return r.abort('failed'); }
            // Like the real create: a name that is now an agent is refused on the name field.
            if (made.includes(slug(b.name))) return r.fulfill({ status: 400, json: { outcome: 'refused', field: 'name', because: 'there is already an agent called ' + b.name + '.' } });
            made.push(slug(b.name));
            const steps = warnSteps[b.name] ? [{ label: warnSteps[b.name], ok: false }] : [];
            return r.fulfill({ status: 200, json: { outcome: 'created', name: slug(b.name), shownAs: b.name, steps, projects: (b.projects || []).map((id) => ({ id, added: true })) } });
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
          /* #4936: the step says hello to every member itself. The members here are not real agents, so the hello
             is answered here: placed, or (for a name in helloFail) not placed. Every hello is recorded, in order. */
          const hellos = [];
          const helloFail = new Set();
          await page.route('**/api/agent/*/thread', async (r) => {
            if (r.request().method() !== 'POST') return r.continue();
            const who = decodeURIComponent(r.request().url().split('/api/agent/')[1].split('/')[0]);
            hellos.push({ who, text: (JSON.parse(r.request().postData() || '{}')).text });
            return r.fulfill({ status: 200, json: { ok: true, delivery: { state: helloFail.has(who) ? 'could_not' : 'placed' } } });
          });
          await page.goto(URL, { waitUntil: 'networkidle' });
          await clearFirstRun(page);
          // #4936: off unless an arm is about it (the others settle on rows reading Running); fast retries, a long mark.
          await page.evaluate(() => { TC_AUTO_HELLO = false; TC_HELLO_GAP_MS = 50; TC_JUST_MADE_MS = 60000; });
          return { page, errs, posted, script, slow, hidden, warnSteps, drop, specsFail, specsMangle, projectTaken, projectPosts, holdCreate, checkHold, pictures, portraitAsks, staticAsks, hellos, helloFail };
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

        /* --- #4719: a person whose only plan is OpenAI makes the whole team in one press ----------- */
        {
          const { page, errs, posted } = await newPage(1280);
          const OA = { provider: 'openai', dir: '/acct/openai-only', email: 'me@example.com', isDefault: true, state: 'connected' };
          await page.route('**/api/accounts*', (r) => r.fulfill({ status: 200, json: { accounts: [OA] } }));
          // The list is emptied, so it has to be read again when the step opens (by the form or the step).
          await page.evaluate(() => { CREATE_ACCOUNTS = []; CREATE_ACCOUNTS_KNOWN = false; });
          await page.evaluate(() => openTeamCreate('marketing'));
          await settle(page, () => document.querySelectorAll('#tc-list li').length === 3);
          const pick = await page.evaluate(() => ({ provider: document.getElementById('tc-provider').value, account: document.getElementById('tc-account').value,
            rowHidden: document.getElementById('tc-account-row').hidden }));
          chk(pick.provider === 'openai' && pick.account === '/acct/openai-only', `${E} #4719 with only an OpenAI account, the team step is on OpenAI and that account`, JSON.stringify(pick));
          chk(pick.rowHidden === true, `${E} #4719 one account: no account menu (#2097)`, JSON.stringify(pick));
          // No project here: a project made in this arm would take "Marketing" from the arms below, which count names.
          await page.selectOption('#tc-project', 'none');
          await page.click('#tc-go');
          await settle(page, () => [...document.querySelectorAll('#tc-list .tc-state')].every((e) => e.textContent === 'Running'));
          const r1 = await rows(page);
          chk(posted.length === 3 && posted.every((b) => b.provider === 'openai' && b.account === '/acct/openai-only'),
            `${E} #4719 every member is made on OpenAI with that account, in one press`, JSON.stringify(posted.map((b) => [b.name, b.provider, b.account])));
          chk(r1.every((r) => r.state === 'Running'), `${E} #4719 the whole team is running`, JSON.stringify(r1.map((r) => r.state)));
          chk(await page.evaluate(() => document.getElementById('tc-provider').disabled), `${E} #4719 the choice is fixed once the team starts`);
          chk(errs.length === 0, `${E} no page errors (#4719 arm)`, errs.join(' | '));
          /* The board's /api/status poll can still be inside this check's route when the page closes: its
             r.fetch() response is then disposed and route.fulfill throws an uncaught rejection that kills
             the whole check (CI, PR #4875, both attempts). Stop routing first, as render-login-expiry does. */
          await page.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {});
          await page.context().close();
        }

        /* --- #4719: an account list slower than the 5 s wait still sets the default when it lands ---- */
        {
          const { page, errs } = await newPage(1280);
          const OA = { provider: 'openai', dir: '/acct/openai-late', email: 'me@example.com', isDefault: true, state: 'connected' };
          await page.route('**/api/accounts*', async (r) => { await new Promise((res) => setTimeout(res, 8000)); return r.fulfill({ status: 200, json: { accounts: [OA] } }); });
          await page.evaluate(() => { CREATE_ACCOUNTS = []; CREATE_ACCOUNTS_KNOWN = false; });
          await page.evaluate(() => openTeamCreate('marketing'));
          await settle(page, () => document.querySelectorAll('#tc-list li').length === 3);
          const early = await page.evaluate(() => document.getElementById('tc-provider').value);
          await page.waitForFunction(() => document.getElementById('tc-provider').value === 'openai', null, { timeout: 10000 }).catch(() => null);
          const late = await page.evaluate(() => ({ p: document.getElementById('tc-provider').value, a: document.getElementById('tc-account').value }));
          chk(early === 'anthropic' && late.p === 'openai' && late.a === '/acct/openai-late',
            `${E} #4719 a slow account list moves the untouched team menu to OpenAI when it lands`, JSON.stringify({ early, late }));
          chk(errs.length === 0, `${E} no page errors (#4719 slow arm)`, errs.join(' | '));
          /* The board's /api/status poll can still be inside this check's route when the page closes: its
             r.fetch() response is then disposed and route.fulfill throws an uncaught rejection that kills
             the whole check (CI, PR #4875, both attempts). Stop routing first, as render-login-expiry does. */
          await page.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {});
          await page.context().close();
        }

        /* --- the step, the happy path with one failure and its retry --------------------------- */
        {
          const { page, errs, posted, script, checkHold, pictures, portraitAsks, staticAsks, hellos, helloFail } = await newPage(1280);
          await page.evaluate(() => { TC_AUTO_HELLO = true; });   // #4936 is this arm's subject
          await page.evaluate(() => openTeamCreate('marketing'));
          await settle(page, () => document.querySelectorAll('#tc-list li').length === 3);
          const view = await page.evaluate(() => ({
            hello: !(document.getElementById('tc-hello') || { hidden: true }).hidden,
            shown: !document.getElementById('cstep-teammake').hidden && document.getElementById('cstep-role').hidden,
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
          // chromium's run makes "Marketing" here and "Marketing 2" in the resume arm, so webkit's first is 3.
          const wantName = engineName === 'chromium' ? 'Marketing' : 'Marketing 3';
          chk(view.project === 'new' && view.projectText === 'A new project called ' + wantName, `${E} the project defaults to a new one named from the seed, the first free name`, view.projectText);

          await page.fill('#tc-list li[data-slot="lead"] .tc-name', 'Maya Okafor');
          script.Leo = 'an agent called Leo already exists';
          const projectsBefore = projects.readAll().length;
          /* Review 27: from the click until the run starts the names cannot be changed (they are being
             checked free, and a name typed after the check would be made unchecked). The pre-check is
             held so the arm looks while it is still out. */
          let releaseCheck; checkHold.p = new Promise((res) => { releaseCheck = res; });
          await page.click('#tc-go');
          await settle(page, () => [...document.querySelectorAll('#tc-list .tc-name')].every((i) => i.disabled));
          const locked = await rows(page);
          chk(locked.length === 3 && locked.every((r) => !r.editable) && posted.length === 0, `${E} from the click until the run starts, no name can be changed`, JSON.stringify(locked.map((r) => r.editable)) + ' posted=' + posted.length);
          releaseCheck();
          await settle(page, () => [...document.querySelectorAll('#tc-list .tc-state')].every((s) => /Running|Not made/.test(s.textContent)));
          const r1 = await rows(page);
          chk(!view.hello && await page.evaluate(() => { const b = document.getElementById('tc-hello'); return !b || b.hidden; }), `${E} no Say Hello before the team is made, nor while a member is not made`, String(view.hello));
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
          chk(r1[1].state === 'Not made' && r1[1].why === 'An agent called Leo already exists.' && r1[1].retry && r1[1].editable,
            `${E} the failed one says why on its own row, keeps its name editable and offers Try again`, JSON.stringify(r1[1]));

          chk(hellos.length === 0, `${E} #4936 no hello while a member is not made`, JSON.stringify(hellos));
          helloFail.add('ana');   // #4936: Ana's hello will not be placed, so the step must stay and offer a retry
          await page.fill('#tc-list li[data-slot="content"] .tc-name', 'Leo Two');
          await page.click('#tc-list li[data-slot="content"] .tc-retry');
          await settle(page, () => [...document.querySelectorAll('#tc-list .tc-state')].every((s) => /^(Started|Could not say hello)$/.test(s.textContent)));
          const r2 = await rows(page);
          chk(posted.length === 4 && posted[3].name === 'Leo Two' && posted[3].reportsTo === 'maya-okafor' && posted[3].projects[0] === pid,
            `${E} Try again makes only that one, with its new name, the lead and the project`, JSON.stringify(posted.slice(3)));
          chk(hellos.length >= 3 && hellos[0].who === 'maya-okafor' && hellos.every((h) => h.text === 'hello'),
            `${E} #4936 once all are running, Kosmos says "hello" to each itself, the lead first`, JSON.stringify(hellos));
          chk(hellos.filter((h) => h.who === 'ana').length === 3 && hellos.filter((h) => h.who === 'leo-two').length === 1,
            `${E} #4936 a hello that is not placed is tried three times; a placed one once`, JSON.stringify(hellos.map((h) => h.who)));
          chk(r2.map((r) => r.state).join() === 'Started,Started,Could not say hello' && r2[2].retry,
            `${E} #4936 each row says whether its member started; the one that did not has Try again`, JSON.stringify(r2.map((r) => [r.state, r.retry])));
          const stay = await page.evaluate(() => ({ note: document.getElementById('tc-note').textContent, step: TC !== null && !document.getElementById('panel-create').hidden,
            go: (document.getElementById('tc-hello') || { textContent: null }).textContent, shown: !(document.getElementById('tc-hello') || { hidden: true }).hidden }));
          chk(stay.step && /1 of them may not have started: look at its row\./.test(stay.note) && stay.shown && stay.go === 'Go to your team',
            `${E} #4936 with one not started, the step stays, says so, and offers Go to your team`, JSON.stringify(stay));
          chk(/still know it as Leo\b/.test(r2[1].why), `${E} a member renamed on Try again says its made teammates still know the old name`, r2[1].why);
          chk(await page.evaluate(() => document.getElementById('tc-note').getAttribute('aria-live') === 'polite'), `${E} the step's progress line is a polite live region`);
          chk(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${E} the finished step does not scroll sideways`);
          /* Every member got a picture: this team ships no portraits for two of them, so each is the generated mark, a PNG. */
          await settle(page, () => typeof TC_UPLOADING !== 'undefined' && TC_UPLOADING === 0);
          const pic = Object.fromEntries(pictures.map((x) => [x.name, x.type]));
          chk(pictures.map((x) => x.name).sort().join() === 'ana,leo-two,maya-okafor',
            `${E} every member made got a picture, once each`, JSON.stringify(pictures));
          chk(/^image\/webp/.test(pic['maya-okafor'] || ''), `${E} #4720: the lead got the catalogue's portrait, read from /api/catalogue/portrait`, JSON.stringify(pic));
          chk(/^image\/png/.test(pic['leo-two'] || '') && /^image\/png/.test(pic.ana || ''),
            `${E} #4720: a portrait that cannot be had, and a member with none, get the generated mark`, JSON.stringify(pic));
          chk(portraitAsks.includes('marketing/lead') && portraitAsks.includes('marketing/content') && !portraitAsks.includes('marketing/social'),
            `${E} #4720: the portrait is asked by team and slot, only for members the catalogue gives one`, JSON.stringify(portraitAsks));
          chk(staticAsks.length === 0, `${E} #4720: the page never reads a catalogue image path under the board`, JSON.stringify(staticAsks));
          chk(r2.every((r) => !/not set/.test(r.state)), `${E} and no row says its picture was not set`, JSON.stringify(r2.map((r) => r.state)));
          chk(errs.length === 0, `${E} no page errors`, errs.join(' | '));
          /* #4936: Try again on Ana while it still is not placed: tried three more times, and the step still stays. */
          await page.click('#tc-list li[data-slot="social"] .tc-retry');
          await settle(page, () => /Could not say hello/.test((document.querySelector('#tc-list li[data-slot="social"] .tc-state') || {}).textContent || '') && hellos.filter((h) => h.who === 'ana').length === 6);
          chk(await page.evaluate(() => TC !== null && !document.getElementById('panel-create').hidden), `${E} #4936 a Try again that fails again keeps the step`);
          /* "Go to your team": to the agents view (Josh: "take me to my agent view wherever I was and show me"), not into
             one agent's page, the new members' board cards marked, no team left to resume. */
          await page.evaluate(() => { window.openDetail = (who) => { window.__tcOpened = who; }; });
          await page.click('#tc-hello');
          await settle(page, () => document.querySelectorAll('.just-made').length >= 3);
          const went = await page.evaluate(() => ({ team: TC === null, panel: !document.getElementById('panel-create').hidden, opened: window.__tcOpened || null,
            marked: [...new Set([...document.querySelectorAll('.just-made')].map((e) => e.dataset.agent))].sort(),
            onlyCards: [...document.querySelectorAll('.just-made')].every((e) => e.matches('.acard, .lrow')) }));
          chk(went.team && !went.panel && !went.opened && went.marked.join() === 'ana,leo-two,maya-okafor' && went.onlyCards,
            `${E} #4936 Go to your team leaves the create view for the agents view, the new members' cards marked (only board cards), no team left to resume`, JSON.stringify(went));
          /* Review 28: opening a team after that must not show the finished team's Say Hello while the new
             one loads. The load is never answered here, so this is the screen as it stands mid-load. */
          await page.route('**/api/teams/seeded/marketing', () => {});
          await page.evaluate(() => { openTeamCreate('marketing'); });
          await settle(page, () => /Loading the team/.test(document.getElementById('tc-title').textContent));
          const loading = await page.evaluate(() => ({ title: document.getElementById('tc-title').textContent, hello: !(document.getElementById('tc-hello') || { hidden: true }).hidden,
            options: document.getElementById('tc-project').options.length, tell: !(document.getElementById('tc-tell') || { disabled: true }).disabled }));
          chk(/Loading the team/.test(loading.title) && !loading.hello && loading.options === 0 && !loading.tell, `${E} while another team loads, the finished team's Say Hello, project menu and choice are not on offer`, JSON.stringify(loading));
          await page.close();
        }

        /* --- #4936: every hello placed: the step takes the person to the agents view on its own ------------------- */
        {
          const { page, errs, hellos } = await newPage(1280);
          await page.evaluate(() => { TC_AUTO_HELLO = true; });
          await page.evaluate(() => openTeamCreate('marketing'));
          await settle(page, () => document.querySelectorAll('#tc-list li').length === 3);
          await page.selectOption('#tc-project', 'none');
          await page.fill('#tc-list li[data-slot="lead"] .tc-name', 'Mia');
          await page.fill('#tc-list li[data-slot="content"] .tc-name', 'Lou');
          await page.fill('#tc-list li[data-slot="social"] .tc-name', 'Ari');
          await page.click('#tc-go');
          await settle(page, () => typeof TC !== 'undefined' && TC === null && document.querySelectorAll('.just-made').length >= 3);
          const auto = await page.evaluate(() => ({ panel: !document.getElementById('panel-create').hidden,
            marked: [...new Set([...document.querySelectorAll('.just-made')].map((e) => e.dataset.agent))].sort(),
            said: (document.getElementById('tc-done-live') || { textContent: '' }).textContent }));
          chk(hellos.map((h) => h.who).join() === 'mia,lou,ari' || (hellos[0] && hellos[0].who === 'mia' && hellos.length === 3),
            `${E} #4936 the lead is said hello to first, then the others, once each`, JSON.stringify(hellos.map((h) => h.who)));
          chk(!auto.panel && auto.marked.join() === 'ari,lou,mia', `${E} #4936 all placed: the step leaves for the agents view on its own, the new members marked`, JSON.stringify(auto));
          await settle(page, () => /Your team is started\./.test((document.getElementById('tc-done-live') || { textContent: '' }).textContent));
          const said = await page.evaluate(() => { const l = document.getElementById('tc-done-live'); return l ? [l.textContent, l.getAttribute('aria-live')] : null; });
          chk(said && said[0] === 'Your team is started. The new agents are marked on your board.' && said[1] === 'polite',
            `${E} #4936 a screen reader is told the team started and where the members are`, JSON.stringify(said));
          chk(errs.length === 0, `${E} no page errors (#4936 all-placed arm)`, errs.join(' | '));
          await page.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {});
          await page.context().close();
        }

        /* --- #4557 round 30: the REAL way in (New Agent > Team > pick > Create, no page.evaluate), focus, Back idle -- */
        {
          const { page, errs } = await newPage(1280);
          await page.evaluate(() => openCreate());
          await page.click('#cstep-kind [data-path="team"]');
          await settle(page, () => [...document.getElementById('team-seeded').options].some((o) => o.value === 'marketing'));
          await page.selectOption('#team-seeded', 'marketing');
          await page.click('#team-seeded-go');
          await settle(page, () => !document.getElementById('cstep-teammake').hidden && document.querySelectorAll('#tc-list li').length === 3);
          const real = await page.evaluate(() => ({
            shown: !document.getElementById('cstep-teammake').hidden, pick: !document.getElementById('cstep-team').hidden,
            focus: (document.activeElement || {}).id || '', rows: document.querySelectorAll('#tc-list li').length,
            oneBack: document.getElementById('create-back').hidden && document.getElementById('create-path-back').hidden,
          }));
          chk(real.shown && !real.pick && real.rows === 3, `${E} Create on the Team screen opens the team step for real (not a stub)`, JSON.stringify(real));
          chk(real.focus === 'tc-title', `${E} arriving on the team step puts focus on its title, not the page`, JSON.stringify(real));
          chk(real.oneBack, `${E} the team step has one back control (its own Back), not All agents beside it`, JSON.stringify(real));
          // Back while idle (nothing started): the team is dropped and the Team screen is back, with its title focused.
          await page.click('#tc-back');
          await settle(page, () => !document.getElementById('cstep-team').hidden);
          const idle = await page.evaluate(() => ({
            pick: !document.getElementById('cstep-team').hidden, gone: document.getElementById('cstep-teammake').hidden,
            focus: (document.activeElement || {}).id || '', dropped: (typeof TC === 'undefined') || TC === null,
          }));
          chk(idle.pick && idle.gone && idle.dropped && idle.focus === 'cstep-team-title', `${E} Back while idle returns to the Team screen and drops the unstarted team`, JSON.stringify(idle));
          chk(errs.length === 0, `${E} no page errors (real-path arm)`, errs.join(' | '));
          await page.close();
        }

        /* --- a lead that fails holds the others until it is made -------------------------------- */
        {
          const { page, errs, posted, script } = await newPage(1280);
          /* #4719: this arm's accounts are its own (a Claude and an OpenAI account), so the menu starts on
             Claude and the change to OpenAI below is a change. Under the runner the board's home is shared by
             every check, and an OpenAI-only list left there by another made the default OpenAI (0.7.16 cut). */
          const CL = { provider: 'anthropic', dir: '/acct/claude', email: 'me@example.com', isDefault: true, state: 'connected' };
          const OA = { provider: 'openai', dir: '/acct/openai', email: 'me@example.com', isDefault: true, state: 'connected' };
          await page.route('**/api/accounts*', (r) => r.fulfill({ status: 200, json: { accounts: [CL, OA] } }));
          await page.evaluate(() => { CREATE_ACCOUNTS = []; CREATE_ACCOUNTS_KNOWN = false; });   // read again, from the route
          await page.evaluate(() => openTeamCreate('marketing'));
          await settle(page, () => document.querySelectorAll('#tc-list li').length === 3);
          await page.selectOption('#tc-project', 'none');
          const start = await page.evaluate(() => ({ p: document.getElementById('tc-provider').value, a: document.getElementById('tc-account').value }));
          chk(start.p === 'anthropic', `${E} #4719 with a Claude account, the team step starts on Claude`, JSON.stringify(start));
          script.Maya = 'the account this agent would use is not signed in';
          await page.click('#tc-go');
          await settle(page, () => /Not made/.test((document.querySelector('#tc-list li[data-slot="lead"] .tc-state') || {}).textContent || ''));
          const r1 = await rows(page);
          chk(posted.length === 1 && posted[0].name === 'Maya', `${E} with the lead refused, nothing is posted for the others`, JSON.stringify(posted.map((b) => b.name)));
          chk(r1[1].state === 'Waiting for the lead' && r1[2].state === 'Waiting for the lead' && !r1[1].retry, `${E} the others say they are waiting for the lead`, JSON.stringify(r1.map((r) => r.state)));
          chk(posted.every((b) => !('projects' in b)), `${E} No project sends no project`);
          // #4719: nothing is made yet, so the Model menu is open again (a refused lead may be the account).
          chk(!(await page.isDisabled('#tc-provider')), `${E} #4719 with the lead refused and nothing made, the Model menu is open again`);
          await page.selectOption('#tc-provider', 'openai');   // the person changes the choice before trying again
          await page.click('#tc-list li[data-slot="lead"] .tc-retry');
          await settle(page, () => [...document.querySelectorAll('#tc-list .tc-state')].every((s) => s.textContent === 'Running'));
          const r2 = await rows(page);
          chk(posted.map((b) => b.name).join() === 'Maya,Maya,Leo,Ana' && r2.every((r) => r.state === 'Running'), `${E} Try again on the lead makes it, then the others`, JSON.stringify(posted.map((b) => b.name)));
          chk(await page.isDisabled('#tc-provider'), `${E} #4719 once the lead is made, the Model menu is fixed`);
          chk(posted.length === 4 && !('provider' in posted[0]) && posted.slice(1).every((b) => b.provider === 'openai'),
            `${E} #4719 the choice changed after the refusal is what Try again and every later member are made on`, JSON.stringify(posted.map((b) => [b.name, b.provider || ''])));
          chk(errs.length === 0, `${E} no page errors (lead arm)`, errs.join(' | '));
          await page.close();
        }

        /* --- iterations 12-13: the lead's create LANDS, then the connection drops. The names were checked
           free before the run, so the page finds that exact agent on the board, takes it as made at once, and
           makes the held reports: no Try again, no second lead. ------------------------------------------ */
        {
          const { page, errs, posted, drop } = await newPage(1280);
          await page.evaluate(() => openTeamCreate('marketing'));
          await settle(page, () => document.querySelectorAll('#tc-list li').length === 3);
          await page.selectOption('#tc-project', 'none');
          drop.Maya = true;
          await page.click('#tc-go');
          await settle(page, () => [...document.querySelectorAll('#tc-list .tc-state')].every((x) => x.textContent === 'Running'));
          const d = await rows(page);
          chk(posted.map((b) => b.name).join() === 'Maya,Leo,Ana' && d.every((r) => r.state === 'Running'),
            `${E} a lead whose create landed before the connection dropped is taken as made, and the reports follow (no second lead)`,
            JSON.stringify({ posted: posted.map((b) => b.name), states: d.map((r) => r.state) }));
          chk(errs.length === 0, `${E} no page errors (dropped-connection arm)`, errs.join(' | '));
          await page.close();
        }

        /* --- round 1 BLOCKER: Try again during a run never starts a second run ----------------------- */
        {
          const { page, errs, posted, script, holdCreate } = await newPage(1280);
          await page.evaluate(() => openTeamCreate('marketing'));
          await settle(page, () => document.querySelectorAll('#tc-list li').length === 3);
          await page.selectOption('#tc-project', 'none');
          script.Leo = 'an agent called Leo already exists';
          const releaseAna = holdCreate('Ana');   // Ana's create is held until Leo's Try again has been pressed
          await page.click('#tc-go');
          await settle(page, () => /Not made/.test((document.querySelector('#tc-list li[data-slot="content"] .tc-state') || {}).textContent || '')
            && /Making/.test((document.querySelector('#tc-list li[data-slot="social"] .tc-state') || {}).textContent || ''));
          const during = await rows(page);
          chk(during[1].state === 'Not made' && during[2].state === 'Making…',
            `${E} precondition: Leo failed while Ana is still being made`, JSON.stringify(during.map((r) => r.state)));
          // Focus survives the repaints a run makes: type a new name while Ana finishes.
          await page.fill('#tc-list li[data-slot="content"] .tc-name', 'Leo Two');
          await page.focus('#tc-list li[data-slot="content"] .tc-retry');
          await page.keyboard.press('Enter');
          // Review 25: the race is asserted, not assumed. Ana is still being made after the press.
          const racing = await rows(page);
          chk(racing[2].state === 'Making…' && posted.length === 3, `${E} Try again was pressed while Ana was still being made`, JSON.stringify({ states: racing.map((r) => r.state), posted: posted.length }));
          releaseAna();
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

        /* --- round 3: leaving a live team keeps it; coming back resumes the same rows ------------------- */
        {
          const { page, errs, posted, script, slow } = await newPage(1280);
          await page.evaluate(() => openTeamCreate('marketing'));
          await settle(page, () => document.querySelectorAll('#tc-list li').length === 3);
          const before = projects.readAll().length;
          script.Leo = 'an agent called Leo already exists';
          slow.Ana = 1500;
          await page.click('#tc-go');
          await settle(page, () => /Making/.test((document.querySelector('#tc-list li[data-slot="social"] .tc-state') || {}).textContent || ''));
          // While a member is in flight, another team waits, and says so.
          await page.evaluate(() => openTeamCreate('household'));
          const busy = await page.evaluate(() => ({ msg: document.getElementById('tc-msg').textContent, title: document.getElementById('tc-title').textContent }));
          chk(/still making/.test(busy.msg) && busy.title === 'Marketing Team', `${E} picking another team while one is IN FLIGHT keeps this one and says why`, JSON.stringify(busy));
          // Back mid-run steps away; the run goes on.
          await page.click('#tc-back');
          // Back lands on the Team path's pick screen (#4556's cstep-team), where this step is opened from.
          const away = await page.evaluate(() => document.getElementById('cstep-teammake').hidden && !document.getElementById('cstep-team').hidden);
          await page.waitForTimeout(2200);
          await page.evaluate(() => openTeamCreate('marketing'));
          await settle(page, () => /Running/.test((document.querySelector('#tc-list li[data-slot="social"] .tc-state') || {}).textContent || ''));
          const back = await rows(page);
          chk(away && back[1].state === 'Not made' && back[1].retry && back[2].state === 'Running' && back[0].state === 'Running',
            `${E} Back mid-run returns to the Team screen, and reopening the team shows the same rows: Leo still with Try again, Ana made meanwhile`, JSON.stringify(back.map((r) => r.state)));
          chk(projects.readAll().length === before + 1 && posted.map((b) => b.name).join() === 'Maya,Leo,Ana',
            `${E} nothing was made twice: one project, each member posted once`, (projects.readAll().length - before) + ' ' + JSON.stringify(posted.map((b) => b.name)));
          // Round 5: now nothing is in flight (Leo waits on a Try again the person may never press). Another
          // team is NOT blocked by a false "still making": it replaces this idle, unfinished one.
          await page.waitForTimeout(2500);
          await page.evaluate(() => openTeamCreate('household'));
          await settle(page, () => document.getElementById('tc-title').textContent !== 'Marketing Team');
          const other = await page.evaluate(() => ({ msg: document.getElementById('tc-msg').textContent, title: document.getElementById('tc-title').textContent, note: document.getElementById('tc-note').textContent }));
          chk(!/still making/.test(other.msg) && other.title !== 'Marketing Team', `${E} an idle, unfinished team does not trap the page: another team replaces it`, JSON.stringify(other));
          chk(other.note === '', `${E} the replaced team's progress line is gone (it stayed under the next team while that one loaded, or failed to)`, JSON.stringify(other.note));
          chk(errs.length === 0, `${E} no page errors (resume arm)`, errs.join(' | '));
          await page.close();
        }

        /* --- round 3: what create reports as not done is said on the row ------------------------------ */
        {
          const { page, errs, warnSteps } = await newPage(1280);
          await page.evaluate(() => openTeamCreate('marketing'));
          await settle(page, () => document.querySelectorAll('#tc-list li').length === 3);
          await page.selectOption('#tc-project', 'none');
          warnSteps.Ana = 'could not add the reports-to section to its instructions';
          await page.click('#tc-go');
          await settle(page, () => [...document.querySelectorAll('#tc-list .tc-state')].every((s) => s.textContent === 'Running'));
          const r = await rows(page);
          const note = await page.textContent('#tc-note');
          chk(/could not add the reports-to section/.test(r[2].why) && /something to look at/.test(note),
            `${E} a step create reports as not done is said on its row, and the ready line points at it`, r[2].why + ' | ' + note);
          chk(errs.length === 0, `${E} no page errors (steps arm)`, errs.join(' | '));
          await page.close();
        }

        /* --- two seats, one name: refused before anything is made --------------------------------- */
        {
          const { page, errs, posted } = await newPage(1280);
          await page.evaluate(() => openTeamCreate('marketing'));
          await settle(page, () => document.querySelectorAll('#tc-list li').length === 3);
          await page.fill('#tc-list li[data-slot="social"] .tc-name', 'maya');
          const before = projects.readAll().length;
          /* #4719: the menus lock at the click; catch that before the refusal reopens them, so the
             "open again" assertion below says something. */
          await page.evaluate(() => { window.__tcLockSeen = false; const e = document.getElementById('tc-provider');
            new MutationObserver(() => { if (e.disabled) window.__tcLockSeen = true; }).observe(e, { attributes: true, attributeFilter: ['disabled'] }); });
          await page.click('#tc-go');
          await settle(page, () => !document.getElementById('tc-msg').hidden);
          const msg = await page.textContent('#tc-msg');
          chk(/same name/.test(msg) && posted.length === 0 && projects.readAll().length === before,
            `${E} two seats with one name are refused before any project or agent is made`, msg + ' | posted ' + posted.length);
          chk(!(await page.isDisabled('#tc-go')) && !(await page.isHidden('#tc-go')), `${E} and the button is back to try again`);
          chk(await page.evaluate(() => window.__tcLockSeen === true), `${E} #4719 the Model menu locked at the click`);
          chk(!(await page.isDisabled('#tc-provider')), `${E} #4719 and the Model menu is open again (nothing was made)`);
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
          chk(msg === 'There is already an agent called Ada on this computer; give the Content Writer another name. If you were making this team a moment ago, those agents are already on your board.' && posted.length === 0 && projects.readAll().length === before,
            `${E} a name already taken on this computer is refused before any project or agent is made`, msg + ' | posted ' + posted.length);
          chk(errs.length === 0, `${E} no page errors (taken arm)`, errs.join(' | '));
          await page.close();
        }

        /* --- review 22: a failed row LATER in the list, renamed and retried while an earlier retry is
           still being made, is made under the name on screen (the running pass read its spec before the
           rename). -------------------------------------------------------------------------------------- */
        {
          const { page, errs, posted, script, holdCreate } = await newPage(1280);
          await page.evaluate(() => openTeamCreate('marketing'));
          await settle(page, () => document.querySelectorAll('#tc-list li').length === 3);
          await page.selectOption('#tc-project', 'none');
          script.Leo = 'Leo could not be made';
          script.Ana = 'Ana could not be made';
          await page.click('#tc-go');
          const stateIs = (slot, re) => page.waitForFunction(([sl, src]) => new RegExp(src).test((document.querySelector('#tc-list li[data-slot="' + sl + '"] .tc-state') || {}).textContent || ''), [slot, re.source], { timeout: 8000 }).catch(() => null);
          await stateIs('content', /Not made/); await stateIs('social', /Not made/);
          const before = await rows(page);
          chk(before[1].state === 'Not made' && before[2].state === 'Not made', `${E} precondition: Leo and Ana both failed`, JSON.stringify(before.map((r) => r.state)));
          const releaseLeo = holdCreate('Leo');   // Leo's retry is held until Ana has been renamed and retried
          await page.click('#tc-list li[data-slot="content"] .tc-retry');
          await stateIs('content', /Making/);
          await page.fill('#tc-list li[data-slot="social"] .tc-name', 'Ana Two');
          await page.click('#tc-list li[data-slot="social"] .tc-retry');
          const racing = await rows(page);
          chk(racing[1].state === 'Making…' && posted.length === 4, `${E} Ana was renamed and retried while Leo's retry was still being made`, JSON.stringify({ states: racing.map((r) => r.state), posted: posted.length }));
          releaseLeo();
          await settle(page, () => [...document.querySelectorAll('#tc-list .tc-state')].every((x) => x.textContent === 'Running'));
          const names = posted.map((b) => b.name);
          const after = await rows(page);
          chk(names.join() === 'Maya,Leo,Ana,Leo,Ana Two' && after[2].name === 'Ana Two' && after.every((r) => r.state === 'Running'),
            `${E} a later row renamed and retried during a run is made under its new name, once`, JSON.stringify({ names, rows: after.map((r) => [r.name, r.state]) }));
          chk(errs.length === 0, `${E} no page errors (rename-during-run arm)`, errs.join(' | '));
          await page.close();
        }

        /* --- review 22: the run's one read of the specs fails. Every row says Not made, and ONE Try again
           takes them all (they failed as one), lead first. ---------------------------------------------- */
        {
          const { page, errs, posted, specsFail } = await newPage(1280);
          await page.evaluate(() => openTeamCreate('marketing'));
          await settle(page, () => document.querySelectorAll('#tc-list li').length === 3);
          await page.selectOption('#tc-project', 'none');
          specsFail.n = 1;
          await page.click('#tc-go');
          await settle(page, () => [...document.querySelectorAll('#tc-list .tc-state')].length === 3 && [...document.querySelectorAll('#tc-list .tc-state')].every((x) => x.textContent === 'Not made'));
          const failed = await rows(page);
          chk(failed.every((r) => r.state === 'Not made' && r.retry && /could not prepare/.test(r.why)) && posted.length === 0,
            `${E} a failed read of the specs fails every row with the reason, and nothing was made`, JSON.stringify(failed.map((r) => [r.state, r.why])));
          await page.click('#tc-list li[data-slot="lead"] .tc-retry');
          await settle(page, () => [...document.querySelectorAll('#tc-list .tc-state')].every((x) => x.textContent === 'Running'));
          const done = await rows(page);
          chk(posted.map((b) => b.name).join() === 'Maya,Leo,Ana' && done.every((r) => r.state === 'Running'),
            `${E} one Try again after a failed read makes the whole team`, JSON.stringify({ posted: posted.map((b) => b.name), rows: done.map((r) => r.state) }));
          chk(errs.length === 0, `${E} no page errors (failed-read arm)`, errs.join(' | '));
          await page.close();
        }

        /* --- review 23: the new project's folder is already a project (a renamed one keeps its folder, so
           the menu's name check cannot see it). The step takes the next name and says which one it made. --- */
        {
          const { page, errs, posted, projectTaken, projectPosts } = await newPage(1280);
          await page.evaluate(() => openTeamCreate('marketing'));
          await settle(page, () => document.querySelectorAll('#tc-list li').length === 3);
          const offered = await page.evaluate(() => document.querySelector('#tc-project option[value="new"]').textContent);
          projectTaken.n = 1;
          await page.click('#tc-go');
          await settle(page, () => [...document.querySelectorAll('#tc-list .tc-state')].length === 3 && [...document.querySelectorAll('#tc-list .tc-state')].every((x) => x.textContent === 'Running'));
          const shown = await page.evaluate(() => document.querySelector('#tc-project option[value="new"]').textContent);
          const last = projectPosts[projectPosts.length - 1];
          const done = await rows(page);
          chk(projectPosts.length >= 2 && offered === 'A new project called ' + projectPosts[0] && last !== projectPosts[0] && shown === 'A new project called ' + last,
            `${E} a project whose folder is taken takes the next name, and the menu says the name that was made`, JSON.stringify({ offered, projectPosts, shown }));
          chk(done.every((r) => r.state === 'Running') && posted.length === 3 && posted.every((b) => Array.isArray(b.projects) && b.projects.length === 1 && b.projects[0] === posted[0].projects[0]),
            `${E} and the whole team is made on that one project`, JSON.stringify({ rows: done.map((r) => r.state), projects: posted.map((b) => b.projects) }));
          chk(errs.length === 0, `${E} no page errors (folder-taken arm)`, errs.join(' | '));
          await page.close();
        }

        /* --- review 23: a spec that comes back under another name than the row's cannot spin the run. The
           row fails with a sentence after a few reads; the rest of the team is made. -------------------- */
        {
          const { page, errs, posted, specsMangle } = await newPage(1280);
          await page.evaluate(() => openTeamCreate('marketing'));
          await settle(page, () => document.querySelectorAll('#tc-list li').length === 3);
          await page.selectOption('#tc-project', 'none');
          specsMangle.slot = 'social';
          await page.click('#tc-go');
          await settle(page, () => /Not made/.test((document.querySelector('#tc-list li[data-slot="social"] .tc-state') || {}).textContent || ''));
          const r = await rows(page);
          chk(r[2].state === 'Not made' && /could not use that name/.test(r[2].why) && r[2].retry && posted.map((b) => b.name).join() === 'Maya,Leo',
            `${E} a member whose spec never matches its row fails with a sentence, and is never posted`, JSON.stringify({ row: r[2], posted: posted.map((b) => b.name) }));
          const reads = specsMangle.reads;
          await page.waitForTimeout(1500);
          chk(reads >= 2 && reads <= 6 && specsMangle.reads === reads, `${E} and the run stops reading the specs (no spin)`, JSON.stringify({ reads, later: specsMangle.reads }));
          chk(errs.length === 0, `${E} no page errors (mismatched-spec arm)`, errs.join(' | '));
          await page.close();
        }

        /* --- review 25: a failed row renamed to an agent that ALREADY exists, whose retry then drops: the
           row must not adopt that agent (the retry's names are not checked free, only the first run's). --- */
        {
          const { page, errs, posted, script, drop } = await newPage(1280);
          await page.evaluate(() => openTeamCreate('marketing'));
          await settle(page, () => document.querySelectorAll('#tc-list li').length === 3);
          await page.selectOption('#tc-project', 'none');
          script.Leo = 'Leo could not be made';
          await page.click('#tc-go');
          await settle(page, () => /Not made/.test((document.querySelector('#tc-list li[data-slot="content"] .tc-state') || {}).textContent || '')
            && /Running/.test((document.querySelector('#tc-list li[data-slot="social"] .tc-state') || {}).textContent || ''));
          await page.fill('#tc-list li[data-slot="content"] .tc-name', 'Ada');   // Ada is an agent on this board already
          drop.Ada = true;
          await page.click('#tc-list li[data-slot="content"] .tc-retry');
          await settle(page, () => /may have been made anyway/.test((document.querySelector('#tc-list li[data-slot="content"] .tc-why') || {}).textContent || ''));
          const r = await rows(page);
          chk(posted.map((b) => b.name).join() === 'Maya,Leo,Ana,Ada' && r[1].state === 'Not made' && /may have been made anyway/.test(r[1].why) && r[1].retry,
            `${E} a row renamed to an existing agent does not adopt it when its retry drops`, JSON.stringify({ posted: posted.map((b) => b.name), row: r[1] }));
          chk(errs.length === 0, `${E} no page errors (no-adoption arm)`, errs.join(' | '));
          await page.close();
        }

        /* --- round 28: a repaint between selecting a failed row's name and typing its replacement must keep
           the selection, or the typing lands in front of the old name ("AdaLeo" was made). Forced here, so the
           arm does not depend on a repaint happening to land in that gap. ------------------------------- */
        {
          const { page, errs, script } = await newPage(1280);
          await page.evaluate(() => openTeamCreate('marketing'));
          await settle(page, () => document.querySelectorAll('#tc-list li').length === 3);
          await page.selectOption('#tc-project', 'none');
          script.Leo = 'Leo could not be made';
          await page.click('#tc-go');
          await settle(page, () => /Not made/.test((document.querySelector('#tc-list li[data-slot="content"] .tc-state') || {}).textContent || ''));
          const sel = '#tc-list li[data-slot="content"] .tc-name';
          await page.evaluate((q) => {
            const i = document.querySelector(q); i.focus(); i.select();
            TC.paintedSig = null; tcPaint();   // the repaint lands after the select, before the typing
          }, sel);
          await page.keyboard.type('Zed');
          const after = await page.evaluate((q) => {
            const i = document.querySelector(q);
            return { value: i.value, rebuilt: i !== null, focused: document.activeElement === i };
          }, sel);
          chk(after.value === 'Zed' && after.focused,
            `${E} a repaint between selecting a name and typing keeps the selection (the typing replaces it)`, JSON.stringify(after));
          chk(errs.length === 0, `${E} no page errors (selection arm)`, errs.join(' | '));
          await page.close();
        }

        /* --- review 25: the "Let Kosmos know" box on the sheet is honoured by every member's create. ---- */
        {
          const { page, errs, posted } = await newPage(1280);
          await page.evaluate(() => openTeamCreate('marketing'));
          await settle(page, () => document.querySelectorAll('#tc-list li').length === 3);
          await page.selectOption('#tc-project', 'none');
          /* Review 27: the choice is on THIS step, where the person is (the sheet's own box is on another
             step and hidden here). Ticked to start with, named, and unticking it is what the creates obey. */
          const tell = await page.evaluate(() => { const b = document.getElementById('tc-tell'); if (!b) return { missing: true }; const r = b.getBoundingClientRect();
            return { shown: r.width > 0 && r.height > 0, checked: b.checked, says: document.getElementById('tc-tell-say').textContent, named: b.labels.length === 1 }; });
          chk(tell.shown && tell.checked && tell.named && tell.says === 'Let Kosmos know these agents were created', `${E} the team step shows the Let Kosmos know choice, ticked, with a name`, JSON.stringify(tell));
          if (!tell.missing) await page.click('#tc-tell');
          chk(await page.evaluate(() => document.getElementById('create-tell').checked === false), `${E} unticking it here unticks the sheet's one box`);
          await page.click('#tc-go');
          await settle(page, () => [...document.querySelectorAll('#tc-list .tc-state')].length === 3 && [...document.querySelectorAll('#tc-list .tc-state')].every((x) => x.textContent === 'Running'));
          chk(posted.length === 3 && posted.every((b) => b.notifyCreated === false), `${E} with the box unticked, every member is made with notifyCreated false`, JSON.stringify(posted.map((b) => b.notifyCreated)));
          chk(await page.evaluate(() => { const b = document.getElementById('tc-tell'); return !!b && b.disabled; }), `${E} the choice cannot be changed once the team is being made`);
          chk(errs.length === 0, `${E} no page errors (tell-box arm)`, errs.join(' | '));
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
