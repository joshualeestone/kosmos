// Browser-check-surface: cstep-kind nak-btn nak-swarm cstep-team team-seeded team-seeded-go team-orgchart-open create-path-back
'use strict';

/**
 * kosmos#4556 (Josh, #4554, 2026-09-29): New Agent opens on three large side-by-side choices with line art
 * (Single / Team / Swarm), each with its own second screen, and the step-2 Agent/Swarm selector is gone.
 *
 * Harness: a tiny static server serving web/index.html, with /api/roles (a recommended Project Manager, Project
 * Director and Operations Manager in the catalogue's order, one other role, and the define-your-own entry), /api/status (a board that can run swarms), and /api/teams/seeded
 * either absent (404, before #4555 lands) or serving two teams.
 *
 * Arms, light and dark, desktop (1280) and phone (390):
 *   K1 the first screen: three cards, one row on desktop, stacked on a phone with no sideways scroll; on a phone
 *      the art is about 40px tall with each title beside it (Mona's design review);
 *   K2 Single: Project Manager and import offered, one back link (Choose another kind), the role menu still offers
 *      Project Director, and step 2 shows no Agent / Swarm card;
 *   K3 Back returns to the three-way choice;
 *   K4 Swarm: no Project Manager and no import; "Pick a role"; the role menu leaves out the roles that direct agents
 *      (Project Manager, Project Director) and opens on the first that remains; 16px on a phone; step 2 shows the
 *      Swarm card alone and the swarm settings;
 *   K5 Team with no catalogue: no dropdown or Create, "coming soon" said once, Upload an org chart is the gold action
 *      with no repeated label or divider, and it opens its panel;
 *   K6 Team with a catalogue: the dropdown is back and the org chart is the plain second choice; the teams are
 *      listed, and Create hands the chosen key to openTeamCreate;
 *   K7 focus: a path's heading takes the keyboard, and Back returns it to the card the person came from;
 *   K8 overlapping roles loads (openCreate's, then the Swarm path's, sharing one request): the Swarm screen still
 *      opens on the role menu with no Project Manager picked, because only the newest caller paints (ROLES_GEN);
 *   K9 a board with no define-your-own role offers no org chart on the Team screen (it creates down that path).
 *   K11 Back and Team again keep the team the person had picked.
 *   K12 a slow first roles load across Team, Back, Team, Back, Single: Team ends with the org chart and no failure
 *       note, and Single ends fully built. Its failing second answer is served only if a second request is made,
 *       so this arm guards against a return to two requests (red on the code before fetchRoles).
 *   K13 an incomplete catalogue (#4632) is asked for again on the next open (with ?catalogue=1), not on a path
 *       choice; a complete one is not; an open whose refetch fails keeps the menu already held;
 *   K10 the roles cannot be read: the Team screen says the org chart cannot be offered (not only "coming soon"),
 *       and choosing Team again tries again and offers it once they load.
 *
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" HEADED=0 node docs/browser-checks/render-newagent-paths-4556.js
 */

const fs = require('node:fs');
const http = require('node:http');
const nodePath = require('node:path');

let chromium;
try { ({ chromium } = require('playwright')); }
catch {
  console.log('render-newagent-paths-4556: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}

const ROOT = nodePath.resolve(__dirname, '..', '..');
const HTML = fs.readFileSync(nodePath.join(ROOT, 'web', 'index.html'));
const SHOTS = process.env.SHOTS || '';

const problems = [];
let pass = 0;
function ok(name, cond, detail) { if (cond) pass += 1; else problems.push(name + (detail ? ' -- ' + detail : '')); }

let SEEDED = null;   // null: 404, as before #4555
let ROLES_DELAY_ONCE = 0;   // K8: hold the next /api/roles this many ms
let IMPORT_DELAY = 0;       // K3b: hold /api/agent-import this many ms
let NO_OWN = false;          // K9: serve no define-your-own role
let ROLES_FAIL = false;      // K10: /api/roles answers 500
let ROLES_SLOW_THEN_FAIL = 0; // K12: the next /api/roles answers after 900ms; any sent while it is out answers 500
const ROLES = {
  roles: [
    { key: 'pm', label: 'Project Manager', blurb: 'Runs the work.', group: 'Running the work' },
    // Mona's review: the catalogue's order, the director first after pm, so the Swarm default is tested for real.
    { key: 'director', label: 'Project Director', blurb: 'Holds the picture.', group: 'Running the work' },
    { key: 'ops', label: 'Operations Manager', blurb: 'Keeps work moving.', group: 'Running the work' },
    { key: 'writer', label: 'Writer', blurb: 'Writes.', group: 'Content' },
  ],
  own: { key: 'own', label: 'Your own', blurb: 'Describe it yourself.' },
  models: [],
  catalogue: { loaded: true },   // #4632: the downloaded catalogue is in, so a loaded menu is not asked for again
};
let CATALOGUE_LOADED = true;   // K13: false serves the built-in roles only (the download has not happened)
let ROLES_HITS = 0;            // K13: how many /api/roles requests arrived
let ROLES_LAST_URL = '';       // K13: the last /api/roles request as sent (with its query)
const json = (res, body) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const server = http.createServer((req, res) => {
  const u = req.url.split('?')[0];
  if (u === '/api/roles') {
    ROLES_HITS += 1;
    ROLES_LAST_URL = req.url;
    if (ROLES_FAIL) { res.writeHead(500, { 'content-type': 'application/json' }); return res.end('{}'); }
    if (ROLES_SLOW_THEN_FAIL === 1) { ROLES_SLOW_THEN_FAIL = 2; setTimeout(() => { ROLES_SLOW_THEN_FAIL = 0; json(res, ROLES); }, 900); return; }
    if (ROLES_SLOW_THEN_FAIL === 2) { res.writeHead(500, { 'content-type': 'application/json' }); return res.end('{}'); }
    const body = { ...ROLES, ...(NO_OWN ? { own: null } : {}), catalogue: { loaded: CATALOGUE_LOADED } };
    const wait = ROLES_DELAY_ONCE; ROLES_DELAY_ONCE = 0;
    if (wait) { setTimeout(() => json(res, body), wait); return; }
    return json(res, body);
  }
  if (u === '/api/status') return json(res, { agents: [], counts: { total: 0, working: 0, idle: 0, unreadableLines: 0 }, swarms: true, checkedAt: new Date().toISOString() });
  if (u === '/api/first-run') return json(res, { done: true });
  if (u === '/api/teams/seeded') {
    if (!SEEDED) { res.writeHead(404, { 'content-type': 'application/json' }); return res.end('{}'); }
    return json(res, SEEDED);
  }
  if (u === '/api/agent-import') {
    const answer = () => json(res, { ok: true, name: 'Imported', role: 'own', instructions: 'Do the thing.', fields: {} });
    if (IMPORT_DELAY) { setTimeout(answer, IMPORT_DELAY); return; }
    return answer();
  }
  if (u.startsWith('/api/')) { res.writeHead(404, { 'content-type': 'application/json' }); return res.end('{}'); }
  if (u === '/' || u === '/index.html') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(HTML); }
  res.writeHead(404); res.end();
});

const visible = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(); return !e.closest('[hidden]') && r.width > 0 && r.height > 0; }, sel);

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port + '/';
  let browser;
  try { browser = await chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch (err) {
    console.error('FAIL  render-newagent-paths-4556: could not start a browser'
      + (process.env.HEADED === '0' ? '.' : ' (headed; try HEADED=0).'));
    console.error('  ' + (err && err.message ? err.message.split('\n')[0] : err));
    server.close();
    process.exit(1);
  }

  for (const theme of ['light', 'dark']) {
    for (const [label, width] of [['desktop', 1280], ['phone', 390]]) {
      const t = '[' + theme + ' ' + label + ']';
      SEEDED = null;
      const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => problems.push(t + ' pageerror: ' + e.message));
      await page.goto(base + '?tab=agents', { waitUntil: 'networkidle' });
      await page.waitForFunction(() => typeof SWARMS_ON !== 'undefined' && SWARMS_ON === true, null, { timeout: 8000 }).catch(() => {});
      await page.evaluate(() => { const fr = document.getElementById('firstrun'); if (fr) fr.hidden = true; applyLayout('tabs', true); openCreate(); });
      await page.waitForTimeout(300);

      // K1: the first screen.
      const k1 = await page.evaluate(() => {
        const cards = [...document.querySelectorAll('#cstep-kind .nak-btn')].filter((b) => !b.hidden);
        const tops = cards.map((b) => Math.round(b.getBoundingClientRect().top));
        return { onKind: !document.getElementById('cstep-kind').hidden, onRole: !document.getElementById('cstep-role').hidden,
          names: cards.map((b) => b.querySelector('.nak-name').textContent), rows: new Set(tops).size,
          art: cards.every((b) => !!b.querySelector('svg.nak-art .nak-gold')),
          // Mona's review: the drawn art (its gold dots and lines) about 40px tall on a phone, not the 20px it was.
          artH: Math.round(cards[1].querySelector('svg.nak-art').getBBox ? (() => { const sv = cards[1].querySelector('svg.nak-art');
            const bb = sv.getBBox(); const k = sv.getBoundingClientRect().height / 90; return bb.height * Math.min(k, sv.getBoundingClientRect().width / 278); })() : 0),
          overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth };
      });
      ok(t + ' K1 New Agent opens on the three-way choice, not the role screen', k1.onKind && !k1.onRole, JSON.stringify(k1));
      ok(t + ' K1 the three choices, in Josh\'s order, each with line art', JSON.stringify(k1.names) === JSON.stringify(['Create a Single Agent', 'Create a Team of Agents', 'Create a Swarm of Autonomous Agents']) && k1.art, JSON.stringify(k1.names));
      if (width <= 600) ok(t + ' K1 the phone art is about 40px tall (Mona\'s review)', k1.artH >= 32, String(k1.artH));
      if (width <= 600) ok(t + ' K1 on a phone each title sits beside its art, not below it (Mona\'s review)', await page.evaluate(() =>
        [...document.querySelectorAll('#cstep-kind .nak-btn')].filter((b) => !b.hidden).every((b) => {
          const a = b.querySelector('.nak-art').getBoundingClientRect(); const n = b.querySelector('.nak-name').getBoundingClientRect();
          return n.left >= a.right - 1 && n.top < a.bottom; })));
      ok(t + (width > 600 ? ' K1 side by side in one row' : ' K1 stacked, with no sideways scroll'),
        width > 600 ? k1.rows === 1 : (k1.rows === 3 && !k1.overflow), JSON.stringify(k1));
      if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: nodePath.join(SHOTS, 'newagent-' + theme + '-' + label + '.png'), fullPage: true }); }

      // K2: Single.
      await page.click('#cstep-kind [data-path="single"]');
      await page.waitForSelector('#pick-pm:not([hidden])', { timeout: 8000 }).catch(() => {});
      const k2 = await page.evaluate(() => ({ pm: !document.getElementById('pick-pm').hidden, imp: !document.getElementById('pick-import').hidden,
        orgRadio: !!document.getElementById('pick-orgchart'), back: !document.getElementById('create-path-back').hidden,
        listName: document.querySelector('#pick-list .p2n').textContent,
        roles: [...document.querySelectorAll('#rolesel option')].map((o) => o.value),
        allAgents: !document.getElementById('create-back').hidden,
        title: document.getElementById('cstep-role-title').textContent }));
      ok(t + ' K2 Single: Project Manager and import are offered, the org chart is not, and Back shows',
        k2.pm && k2.imp && !k2.orgRadio && k2.back && k2.title === 'What should this agent do?' && k2.listName === 'Pick another role', JSON.stringify(k2));
      ok(t + ' K2 Single: one back link, Choose another kind (Mona\'s review)', !k2.allAgents, JSON.stringify(k2));
      ok(t + ' K2 Single: the role menu still offers Project Director (CONTROL for the Swarm list)', k2.roles.includes('director') && !k2.roles.includes('pm'), JSON.stringify(k2.roles));
      await page.click('#pick-pm');
      await page.click('#role-next');
      await page.waitForSelector('#cstep-name:not([hidden])', { timeout: 8000 }).catch(() => {});
      ok(t + ' K2 Single: step 2 shows no Agent / Swarm card and no swarm settings',
        await page.evaluate(() => document.getElementById('create-kind').hidden && document.getElementById('create-swarm').hidden && createKind() === 'agent'));

      // K3: Back (from a second screen) returns to the choice.
      await page.evaluate(() => openCreate());
      await page.click('#cstep-kind [data-path="single"]');
      await page.click('#create-path-back');
      // K3b (review round 5): Back while an import is still being read keeps the person on the choice.
      IMPORT_DELAY = 600;
      await page.evaluate(() => openCreate());
      await page.click('#cstep-kind [data-path="single"]');
      await page.waitForSelector('#pick-import:not([hidden])', { timeout: 5000 }).catch(() => {});
      await page.click('#pick-import');
      await page.fill('#import-text', 'name: Imported\n\nDo the thing.');
      await page.click('#import-load');
      await page.click('#create-path-back');
      await page.waitForTimeout(1000);
      IMPORT_DELAY = 0;
      ok(t + ' K3b Back during an import keeps the three-way choice (a late answer does not move the person on)',
        await page.evaluate(() => !document.getElementById('cstep-kind').hidden && document.getElementById('cstep-name').hidden));
      await page.evaluate(() => openCreate());
      await page.click('#cstep-kind [data-path="single"]');
      await page.click('#create-path-back');
      ok(t + ' K3 Back returns to the three-way choice', await page.evaluate(() => !document.getElementById('cstep-kind').hidden && document.getElementById('cstep-role').hidden && document.getElementById('create-path-back').hidden));

      // K4: Swarm.
      await page.click('#cstep-kind [data-path="swarm"]');
      await page.waitForTimeout(200);
      const k4 = await page.evaluate(() => ({ pm: !document.getElementById('pick-pm').hidden, imp: !document.getElementById('pick-import').hidden,
        list: !!document.querySelector('input[name="rmode"][value="list"]:checked'), title: document.getElementById('cstep-role-title').textContent,
        listName: document.querySelector('#pick-list .p2n').textContent, selFont: parseFloat(getComputedStyle(document.getElementById('rolesel')).fontSize),
        roles: [...document.querySelectorAll('#rolesel option')].map((o) => o.value), picked: PICKED }));
      ok(t + ' K4 Swarm: no Project Manager and no import; it opens on the role menu', !k4.pm && !k4.imp && k4.list && k4.title === 'What should this swarm do?', JSON.stringify(k4));
      // Design shots: with no Project Manager above it, "another" had nothing to follow; and a phone menu under 16px zooms on iOS.
      ok(t + ' K4 Swarm: the menu option reads "Pick a role", not "Pick another role"', k4.listName === 'Pick a role', k4.listName);
      ok(t + ' K4 Swarm: no role that directs agents is offered, and it opens on the first that remains (Mona\'s review)',
        !k4.roles.includes('director') && !k4.roles.includes('pm') && k4.roles.includes('ops') && k4.roles[0] === 'ops' && k4.picked === 'ops', JSON.stringify(k4));
      if (width <= 600) ok(t + ' K4 Swarm: the role menu is at least 16px on a phone', k4.selFont >= 16, String(k4.selFont));
      await page.click('#role-next');
      await page.waitForSelector('#cstep-name:not([hidden])', { timeout: 8000 }).catch(() => {});
      const k4b = await page.evaluate(() => { const box = document.getElementById('create-kind');
        return { box: !box.hidden, agent: !box.querySelector('input[value="agent"]').closest('label').hidden, settings: !document.getElementById('create-swarm').hidden,
          kind: createKind(), go: document.getElementById('create-go').textContent }; });
      ok(t + ' K4 Swarm: step 2 shows the Swarm card alone and the swarm settings, and makes a swarm',
        k4b.box && !k4b.agent && k4b.settings && k4b.kind === 'swarm' && k4b.go === 'Make this swarm', JSON.stringify(k4b));

      // K5: Team with no catalogue yet.
      await page.evaluate(() => openCreate());
      await page.click('#cstep-kind [data-path="team"]');
      await page.waitForTimeout(400);
      const k5 = await page.evaluate(() => ({ onTeam: !document.getElementById('cstep-team').hidden,
        pick: !document.getElementById('team-seeded-pick').closest('[hidden]'),
        msg: document.getElementById('team-seeded-msg').textContent,
        soon: (document.getElementById('cstep-team').innerText.match(/coming soon/gi) || []).length,
        gold: document.getElementById('team-orgchart-open').classList.contains('uprime'),
        labelShown: !document.getElementById('team-orgchart-label').hidden,
        divider: getComputedStyle(document.getElementById('team-orgchart-opt')).borderTopWidth,
        allAgents: !document.getElementById('create-back').hidden }));
      ok(t + ' K5 Team with no catalogue: no dropdown or Create, "coming soon" said once, Upload an org chart is the gold action (Mona\'s review)',
        k5.onTeam && !k5.pick && k5.msg === 'Ready-made teams are coming soon.' && k5.soon === 1 && k5.gold && !k5.labelShown && k5.divider === '0px' && !k5.allAgents, JSON.stringify(k5));
      await page.click('#team-orgchart-open');
      ok(t + ' K5 Upload an org chart opens its panel on the Team screen', await visible(page, '#orgchart-text'));

      // K5b (review round 4): a catalogue that answers with NO teams reads as coming soon, and is asked again next visit.
      SEEDED = [];
      await page.evaluate(() => { SEEDED_TEAMS = null; openCreate(); });
      await page.click('#cstep-kind [data-path="team"]');
      await page.waitForTimeout(300);
      const k5b = await page.evaluate(() => ({ pick: !document.getElementById('team-seeded-pick').hidden,
        msg: document.getElementById('team-seeded-msg').textContent, cached: SEEDED_TEAMS }));
      ok(t + ' K5b an empty catalogue reads as coming soon and is not kept', !k5b.pick && k5b.msg === 'Ready-made teams are coming soon.' && k5b.cached === null, JSON.stringify(k5b));
      SEEDED = [{ key: 'solo', label: 'Solo team', blurb: 'One lead.', kind: 'business', rank: 1, members: ['a'] }];
      // Round 5 CONTROL: teams exist but nothing can create one yet (#4557): still coming soon, no dropdown.
      // #4557 round 30: openTeamCreate is now a top-level function declaration, which `delete` cannot remove (a
      // non-configurable global); the binding is writable, so it is set to undefined for this arm instead.
      await page.evaluate(() => { window.openTeamCreate = undefined; SEEDED_TEAMS = null; openCreate(); });
      await page.click('#cstep-kind [data-path="team"]');
      await page.waitForTimeout(300);
      ok(t + ' K5b teams without a way to create one still read as coming soon (no Create that cannot create)',
        await page.evaluate(() => document.getElementById('team-seeded-pick').hidden && document.getElementById('team-seeded-msg').textContent === 'Ready-made teams are coming soon.'));
      await page.evaluate(() => { SEEDED_TEAMS = null; window.openTeamCreate = () => {}; openCreate(); });   // the empty answer was not kept either
      await page.click('#cstep-kind [data-path="team"]');
      await page.waitForFunction(() => !document.getElementById('team-seeded-pick').hidden, null, { timeout: 3000 }).catch(() => {});
      ok(t + ' K5b the next visit asks again and shows the teams that now exist', await page.evaluate(() => !document.getElementById('team-seeded-pick').hidden
        && [...document.getElementById('team-seeded').options].some((o) => o.value === 'solo')));
      await page.selectOption('#team-seeded', 'solo');
      ok(t + ' K5b a one-member team reads "1 agent." (round 6)', (await page.evaluate(() => document.getElementById('team-seeded-desc').textContent)) === 'One lead. 1 agent.');

      // K6: Team with a catalogue; Create hands the key to openTeamCreate.
      // #4555's shape: members, not a count (the count is derived from them).
      SEEDED = [{ key: 'marketing', label: 'Marketing team', blurb: 'A CMO and four reports', kind: 'business', rank: 1, members: ['cmo', 'a', 'b', 'c', 'd'] },
        { key: 'home', label: 'Home and personal life', blurb: 'Your household.', kind: 'personal', rank: 2, members: ['a', 'b', 'c', 'd'] }];
      await page.evaluate(() => { SEEDED_TEAMS = null; window.__opened = null; window.openTeamCreate = (k) => { window.__opened = k; }; openCreate(); });
      await page.click('#cstep-kind [data-path="team"]');
      await page.waitForFunction(() => !document.getElementById('team-seeded').disabled, null, { timeout: 5000 }).catch(() => {});
      await page.selectOption('#team-seeded', 'marketing');
      const k6 = await page.evaluate(() => ({ opts: [...document.getElementById('team-seeded').options].map((o) => o.value),
        desc: document.getElementById('team-seeded-desc').textContent, go: document.getElementById('team-seeded-go').disabled,
        pick: !document.getElementById('team-seeded-pick').hidden, gold: document.getElementById('team-orgchart-open').classList.contains('uprime'),
        divider: getComputedStyle(document.getElementById('team-orgchart-opt')).borderTopWidth,
        label: document.getElementById('team-orgchart-label').hidden ? '' : document.getElementById('team-orgchart-label').textContent }));
      ok(t + ' K6 with teams: the dropdown is back and the org chart is the second, plain choice (CONTROL for K5)',
        k6.pick && !k6.gold && k6.label === 'Or upload an org chart' && k6.divider === '1px', JSON.stringify(k6));
      ok(t + ' K6 the seeded teams are listed, and choosing one describes it and enables Create',
        JSON.stringify(k6.opts) === JSON.stringify(['', 'marketing', 'home']) && /A CMO and four reports\. 5 agents\./.test(k6.desc) && !k6.go, JSON.stringify(k6));
      await page.click('#team-seeded-go');
      ok(t + ' K6 Create hands the chosen team to openTeamCreate (#4557)', await page.evaluate(() => window.__opened === 'marketing'));
      // K11: Back and Team again keep the team they had picked (the list is not rebuilt out from under them).
      await page.selectOption('#team-seeded', 'home');
      await page.click('#create-path-back');
      await page.waitForTimeout(200);
      await page.click('#cstep-kind [data-path="team"]');
      await page.waitForFunction(() => !document.getElementById('team-seeded').disabled, null, { timeout: 5000 }).catch(() => {});
      const k11 = await page.evaluate(() => ({ v: document.getElementById('team-seeded').value, go: document.getElementById('team-seeded-go').disabled }));
      ok(t + ' K11 Back and Team again keep the team they had picked', k11.v === 'home' && !k11.go, JSON.stringify(k11));

      // K7: focus follows the step, and Back returns it to the card the person came from.
      const focusId = () => page.evaluate(() => { const a = document.activeElement; return a ? (a.id || (a.dataset && a.dataset.path) || a.tagName) : ''; });
      await page.evaluate(() => openCreate());
      await page.click('#cstep-kind [data-path="single"]');
      const f1 = await focusId();
      await page.click('#create-path-back');
      const f2 = await focusId();
      await page.click('#cstep-kind [data-path="team"]');
      const f3 = await focusId();
      await page.click('#create-path-back');
      const f4 = await focusId();
      ok(t + ' K7 a path\'s heading takes the keyboard, and Back returns it to the card chosen',
        f1 === 'cstep-role-title' && f2 === 'single' && f3 === 'cstep-team-title' && f4 === 'team', JSON.stringify([f1, f2, f3, f4]));

      // K8: openCreate's roles load ('pm') and the Swarm path's ('list') overlap; only the newest caller may paint.
      ROLES_DELAY_ONCE = 900;
      await page.evaluate(() => { ROLES = null; openCreate(); });   // loadRoles caches; a fresh load is the race
      await page.click('#cstep-kind [data-path="swarm"]');
      await page.waitForTimeout(1300);
      const k8 = await page.evaluate(() => ({ list: !!document.querySelector('input[name="rmode"][value="list"]:checked'),
        pm: !!document.querySelector('input[name="rmode"][value="pm"]:checked'), menu: !document.getElementById('rolepick').hidden }));
      ok(t + ' K8 a late first roles load does not pick the Project Manager on the Swarm path', k8.list && !k8.pm && k8.menu && ROLES_DELAY_ONCE === 0, JSON.stringify(k8));

      // K9: no define-your-own role, so no org chart on the Team screen (and the control: it shows when there is one).
      NO_OWN = true;
      await page.evaluate(() => { SEEDED_TEAMS = null; ROLES = null; OWN_ROLE = null; openCreate(); });
      await page.click('#cstep-kind [data-path="team"]');
      await page.waitForTimeout(400);
      const k9 = await page.evaluate(() => document.getElementById('team-orgchart-opt').hidden);
      NO_OWN = false;
      await page.evaluate(() => { SEEDED_TEAMS = null; ROLES = null; OWN_ROLE = null; openCreate(); });
      await page.click('#cstep-kind [data-path="team"]');
      await page.waitForTimeout(400);
      const k9c = await page.evaluate(() => document.getElementById('team-orgchart-opt').hidden);
      ok(t + ' K9 the org chart is offered only when the board serves a define-your-own role', k9 === true && k9c === false, JSON.stringify([k9, k9c]));

      // K12 (the review's race): the first roles load is slow and succeeds, and a second one sent while it is out
      // fails. Team, then Back, Team, Back, Single: every screen must end built from the list that did arrive.
      ROLES_SLOW_THEN_FAIL = 1;
      await page.evaluate(() => { SEEDED_TEAMS = null; ROLES = null; OWN_ROLE = null; openCreate(); });
      await page.click('#cstep-kind [data-path="team"]');
      await page.waitForTimeout(1300);
      await page.click('#create-path-back');
      await page.click('#cstep-kind [data-path="team"]');
      await page.waitForTimeout(500);
      const k12t = await page.evaluate(() => ({ opt: document.getElementById('team-orgchart-opt').hidden, note: document.getElementById('team-orgchart-msg').hidden }));
      await page.click('#create-path-back');
      await page.click('#cstep-kind [data-path="single"]');
      await page.waitForTimeout(500);
      const k12s = await page.evaluate(() => ({ list: !document.getElementById('pick-list').hidden, own: !document.getElementById('pick-own').hidden,
        pm: (document.querySelector('#pick-pm .p2n') || {}).textContent || '', msg: document.getElementById('roles-msg').textContent }));
      ROLES_SLOW_THEN_FAIL = 0;
      ok(t + ' K12 after a slow first roles load, Team ends with the org chart offered and no failure note', k12t.opt === false && k12t.note === true, JSON.stringify(k12t));
      ok(t + ' K12 and Single ends fully built (the menu, define-your-own, a named Project Manager, no Loading)', k12s.list && k12s.own && k12s.pm.trim() !== '' && k12s.msg === '', JSON.stringify(k12s));

      // K13 (#4632 on the shared request): a menu without the downloaded catalogue is asked for again on the next
      // OPEN, with ?catalogue=1; a path choice does not ask again; a complete menu is not asked for again.
      try {
        CATALOGUE_LOADED = false;
        await page.evaluate(() => { ROLES = null; OWN_ROLE = null; openCreate(); });
        await page.waitForTimeout(400);
        const hits0 = ROLES_HITS;
        await page.evaluate(() => { openCreate(); });
        await page.waitForTimeout(400);
        const againIncomplete = ROLES_HITS - hits0;
        const asked = ROLES_LAST_URL;
        const hitsPath = ROLES_HITS;
        await page.click('#cstep-kind [data-path="single"]');
        await page.waitForTimeout(400);
        const onPath = ROLES_HITS - hitsPath;
        const singleBuilt = await page.evaluate(() => !document.getElementById('pick-pm').hidden && document.getElementById('roles-msg').textContent === '');
        // The next open's refetch FAILS (offline): the menu already held stays usable, with no error.
        ROLES_FAIL = true;
        const hitsFail = ROLES_HITS;
        await page.evaluate(() => { openCreate(); });
        await page.waitForTimeout(400);
        const failAsked = ROLES_HITS - hitsFail;   // the open did ask (and was refused)
        // Read BEFORE the path click: the click paints by itself, so only this shows the failed open painted.
        const msgBefore = await page.evaluate(() => document.getElementById('roles-msg').textContent);
        await page.click('#cstep-kind [data-path="single"]');
        await page.waitForTimeout(300);
        const keptOnFail = await page.evaluate(() => ({ pm: !document.getElementById('pick-pm').hidden, msg: document.getElementById('roles-msg').textContent, next: !document.getElementById('role-next').disabled, held: !!(ROLES && ROLES.length) }));
        keptOnFail.failAsked = failAsked; keptOnFail.msgBefore = msgBefore;
        ROLES_FAIL = false;
        CATALOGUE_LOADED = true;
        await page.evaluate(() => { openCreate(); });   // this load brings the catalogue
        await page.waitForTimeout(400);
        const hits1 = ROLES_HITS;
        await page.evaluate(() => { openCreate(); });
        await page.waitForTimeout(400);
        const againComplete = ROLES_HITS - hits1;
        ok(t + ' K13 an incomplete catalogue is asked for again on the next open (with ?catalogue=1), not on a path choice; a complete one is not asked for again',
          againIncomplete === 1 && /[?&]catalogue=1(&|$)/.test(asked) && onPath === 0 && singleBuilt && againComplete === 0,
          JSON.stringify({ againIncomplete, asked, onPath, singleBuilt, againComplete }));
        ok(t + ' K13 an open whose refetch fails keeps the menu already held (no error, Continue still works)',
          keptOnFail.failAsked === 1 && keptOnFail.msgBefore === '' && keptOnFail.held && keptOnFail.pm && keptOnFail.msg === '' && keptOnFail.next, JSON.stringify(keptOnFail));
      } finally { CATALOGUE_LOADED = true; ROLES_FAIL = false; }

      // K10: the roles cannot be read. The Team screen says why there is no org chart, and choosing Team again retries.
      ROLES_FAIL = true;
      await page.evaluate(() => { SEEDED_TEAMS = null; ROLES = null; OWN_ROLE = null; openCreate(); });
      await page.click('#cstep-kind [data-path="team"]');
      await page.waitForTimeout(400);
      const k10 = await page.evaluate(() => ({ opt: document.getElementById('team-orgchart-opt').hidden,
        note: document.getElementById('team-orgchart-msg').hidden ? '' : document.getElementById('team-orgchart-msg').textContent }));
      ROLES_FAIL = false;
      await page.click('#create-path-back');
      await page.waitForTimeout(200);
      await page.click('#cstep-kind [data-path="team"]');
      await page.waitForTimeout(400);
      const k10r = await page.evaluate(() => ({ opt: document.getElementById('team-orgchart-opt').hidden,
        note: document.getElementById('team-orgchart-msg').hidden }));
      ok(t + ' K10 unreadable roles: the Team screen says the org chart cannot be offered', k10.opt === true && /could not load what uploading an org chart needs/.test(k10.note), JSON.stringify(k10));
      ok(t + ' K10 and choosing Team again tries again and offers it', k10r.opt === false && k10r.note === true, JSON.stringify(k10r));
      await ctx.close();
    }
  }

  await browser.close();
  server.close();
  if (problems.length) {
    console.error('FAIL  render-newagent-paths-4556: ' + problems.length + ' problem(s), ' + pass + ' passed');
    for (const p of problems) console.error('  FAIL  ' + p);
    process.exit(1);
  }
  console.log('render-newagent-paths-4556: ' + pass + ' passed (New Agent opens on Single / Team / Swarm with line art, one row on desktop and stacked on a phone; each path\'s second screen offers only its own options; no Agent / Swarm selector on step 2, the Swarm card alone on the Swarm path; Team says coming soon without a catalogue and hands a chosen team to openTeamCreate; Back returns to the choice and focus to the card; a late roles load cannot pick the Project Manager on the Swarm path; no org chart without a define-your-own role; unreadable roles are said on the Team screen and retried). problems: none');
  process.exit(0);
})().catch((e) => { console.error('FAIL  render-newagent-paths-4556: ' + (e && e.message ? e.message.split('\n')[0] : e)); server.close(); process.exit(1); });
