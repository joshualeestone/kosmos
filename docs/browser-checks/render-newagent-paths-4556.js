// Browser-check-surface: cstep-kind nak-btn nak-swarm cstep-team team-seeded team-seeded-go team-orgchart-open create-path-back
'use strict';

/**
 * kosmos#4556 (Josh, #4554, 2026-09-29): New Agent opens on three large side-by-side choices with line art
 * (Single / Team / Swarm), each with its own second screen, and the step-2 Agent/Swarm selector is gone.
 *
 * Harness: a tiny static server serving web/index.html, with /api/roles (a recommended Project Manager and one
 * other role, plus the define-your-own entry), /api/status (a board that can run swarms), and /api/teams/seeded
 * either absent (404, before #4555 lands) or serving two teams.
 *
 * Arms, light and dark, desktop (1280) and phone (390):
 *   K1 the first screen: three cards, one row on desktop, stacked on a phone with no sideways scroll;
 *   K2 Single: Project Manager and import offered, and step 2 shows no Agent / Swarm card;
 *   K3 Back returns to the three-way choice;
 *   K4 Swarm: no Project Manager and no import; step 2 shows the Swarm card alone and the swarm settings;
 *   K5 Team with no catalogue: says coming soon, the dropdown is off, and Upload an org chart opens its panel;
 *   K6 Team with a catalogue: the teams are listed, and Create hands the chosen key to openTeamCreate;
 *   K7 focus: a path's heading takes the keyboard, and Back returns it to the card the person came from;
 *   K8 the race: openCreate's roles load answers AFTER the Swarm path's, and the Swarm screen still opens on the
 *      role menu with no Project Manager picked (ROLES_GEN);
 *   K9 a board with no define-your-own role offers no org chart on the Team screen (it creates down that path).
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
let NO_OWN = false;          // K9: serve no define-your-own role
const ROLES = {
  roles: [
    { key: 'pm', label: 'Project Manager', blurb: 'Runs the work.', group: 'Running the work' },
    { key: 'writer', label: 'Writer', blurb: 'Writes.', group: 'Content' },
  ],
  own: { key: 'own', label: 'Your own', blurb: 'Describe it yourself.' },
  models: [],
};
const json = (res, body) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const server = http.createServer((req, res) => {
  const u = req.url.split('?')[0];
  if (u === '/api/roles') {
    const body = NO_OWN ? { ...ROLES, own: null } : ROLES;
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
          overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth };
      });
      ok(t + ' K1 New Agent opens on the three-way choice, not the role screen', k1.onKind && !k1.onRole, JSON.stringify(k1));
      ok(t + ' K1 the three choices, in Josh\'s order, each with line art', JSON.stringify(k1.names) === JSON.stringify(['Create a Single Agent', 'Create a Team of Agents', 'Create a Swarm of Autonomous Agents']) && k1.art, JSON.stringify(k1.names));
      ok(t + (width > 600 ? ' K1 side by side in one row' : ' K1 stacked, with no sideways scroll'),
        width > 600 ? k1.rows === 1 : (k1.rows === 3 && !k1.overflow), JSON.stringify(k1));
      if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: nodePath.join(SHOTS, 'newagent-' + theme + '-' + label + '.png'), fullPage: true }); }

      // K2: Single.
      await page.click('#cstep-kind [data-path="single"]');
      await page.waitForSelector('#pick-pm:not([hidden])', { timeout: 8000 }).catch(() => {});
      const k2 = await page.evaluate(() => ({ pm: !document.getElementById('pick-pm').hidden, imp: !document.getElementById('pick-import').hidden,
        orgRadio: !!document.getElementById('pick-orgchart'), back: !document.getElementById('create-path-back').hidden,
        title: document.getElementById('cstep-role-title').textContent }));
      ok(t + ' K2 Single: Project Manager and import are offered, the org chart is not, and Back shows',
        k2.pm && k2.imp && !k2.orgRadio && k2.back && k2.title === 'What should this agent do?', JSON.stringify(k2));
      await page.click('#pick-pm');
      await page.click('#role-next');
      await page.waitForSelector('#cstep-name:not([hidden])', { timeout: 8000 }).catch(() => {});
      ok(t + ' K2 Single: step 2 shows no Agent / Swarm card and no swarm settings',
        await page.evaluate(() => document.getElementById('create-kind').hidden && document.getElementById('create-swarm').hidden && createKind() === 'agent'));

      // K3: Back (from a second screen) returns to the choice.
      await page.evaluate(() => openCreate());
      await page.click('#cstep-kind [data-path="single"]');
      await page.click('#create-path-back');
      ok(t + ' K3 Back returns to the three-way choice', await page.evaluate(() => !document.getElementById('cstep-kind').hidden && document.getElementById('cstep-role').hidden && document.getElementById('create-path-back').hidden));

      // K4: Swarm.
      await page.click('#cstep-kind [data-path="swarm"]');
      await page.waitForTimeout(200);
      const k4 = await page.evaluate(() => ({ pm: !document.getElementById('pick-pm').hidden, imp: !document.getElementById('pick-import').hidden,
        list: !!document.querySelector('input[name="rmode"][value="list"]:checked'), title: document.getElementById('cstep-role-title').textContent }));
      ok(t + ' K4 Swarm: no Project Manager and no import; it opens on the role menu', !k4.pm && !k4.imp && k4.list && k4.title === 'What should this swarm do?', JSON.stringify(k4));
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
      const k5 = await page.evaluate(() => ({ onTeam: !document.getElementById('cstep-team').hidden, sel: document.getElementById('team-seeded').disabled,
        msg: document.getElementById('team-seeded-msg').textContent, go: document.getElementById('team-seeded-go').disabled }));
      ok(t + ' K5 Team with no catalogue: says coming soon, the dropdown and Create are off', k5.onTeam && k5.sel && k5.go && /coming soon/.test(k5.msg), JSON.stringify(k5));
      await page.click('#team-orgchart-open');
      ok(t + ' K5 Upload an org chart opens its panel on the Team screen', await visible(page, '#orgchart-text'));

      // K6: Team with a catalogue; Create hands the key to openTeamCreate.
      // #4555's shape: members, not a count (the count is derived from them).
      SEEDED = [{ key: 'marketing', label: 'Marketing team', blurb: 'A CMO and four reports.', kind: 'business', rank: 1, members: ['cmo', 'a', 'b', 'c', 'd'] },
        { key: 'home', label: 'Home and personal life', blurb: 'Your household.', kind: 'personal', rank: 2, members: ['a', 'b', 'c', 'd'] }];
      await page.evaluate(() => { SEEDED_TEAMS = null; window.__opened = null; window.openTeamCreate = (k) => { window.__opened = k; }; openCreate(); });
      await page.click('#cstep-kind [data-path="team"]');
      await page.waitForFunction(() => !document.getElementById('team-seeded').disabled, null, { timeout: 5000 }).catch(() => {});
      await page.selectOption('#team-seeded', 'marketing');
      const k6 = await page.evaluate(() => ({ opts: [...document.getElementById('team-seeded').options].map((o) => o.value),
        desc: document.getElementById('team-seeded-desc').textContent, go: document.getElementById('team-seeded-go').disabled }));
      ok(t + ' K6 the seeded teams are listed, and choosing one describes it and enables Create',
        JSON.stringify(k6.opts) === JSON.stringify(['', 'marketing', 'home']) && /A CMO and four reports\. 5 agents\./.test(k6.desc) && !k6.go, JSON.stringify(k6));
      await page.click('#team-seeded-go');
      ok(t + ' K6 Create hands the chosen team to openTeamCreate (#4557)', await page.evaluate(() => window.__opened === 'marketing'));

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

      // K8: the race. openCreate's roles load ('pm') is held until after the Swarm path's ('list') has answered.
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
  console.log('render-newagent-paths-4556: ' + pass + ' passed (New Agent opens on Single / Team / Swarm with line art, one row on desktop and stacked on a phone; each path\'s second screen offers only its own options; no Agent / Swarm selector on step 2, the Swarm card alone on the Swarm path; Team says coming soon without a catalogue and hands a chosen team to openTeamCreate; Back returns to the choice and focus to the card; a late roles load cannot pick the Project Manager on the Swarm path; no org chart without a define-your-own role). problems: none');
  process.exit(0);
})().catch((e) => { console.error('FAIL  render-newagent-paths-4556: ' + (e && e.message ? e.message.split('\n')[0] : e)); server.close(); process.exit(1); });
