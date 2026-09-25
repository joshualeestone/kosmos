// Browser-check-surface: create-kind create-swarm create-swarm-max create-swarm-cap create-swarm-warn d-swarm d-swarm-panel d-swarm-stop d-swarm-max d-swarm-why swmini swc
'use strict';

/**
 * Agent Swarms, the UI (#3564; the engine is Renet's). Built as the approved mock (chaoskosmos-site
 * design/agent-swarms.html, c8284df) against the contract on #3564.
 *
 * The board is real; the ENGINE's side is answered here exactly as the contract says (the /api/status
 * `swarms` flag and each row's `swarm` field; the swarm routes), because the engine is not on main when
 * this lands. Every "shows only when" arm has a control that shows it from the same state.
 *
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-swarm-ui-3564.js [shots-dir]
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts

const ROOTS = [];
const mkroot = (tag) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-swui-' + tag)); ROOTS.push(d); return d; };
const SANDBOX = mkroot('');
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = mkroot('workers-');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = mkroot('config-');
process.env.AGENT_WORKFORCE_LAUNCH = mkroot('launch-');
process.env.AGENT_WORKFORCE_PROJECTS = mkroot('projects-');
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';

const { chromium } = require('playwright');
const fleet = require('../../test-support/fleet');
const srv = require('../../server.js');
const tipsStore = require('../../engine/tips');

const SHOTS = process.argv[2] || null;
const fail = [];
let pass = 0;
function chk(ok, label, extra) {
  if (ok) { pass++; console.log('PASS  ' + label + (extra ? '  ' + extra : '')); }
  else { fail.push(label); console.log('FAIL  ' + label + (extra ? '  --  ' + extra : '')); }
}
const waitFor = (page, fn, arg, ms = 6000) => page.waitForFunction(fn, arg, { timeout: ms }).then(() => true, () => false);

(async () => {
  fleet.install([
    fleet.agent('rex', { state: 'working', displayName: 'Rex', role: 'Writer' }),
    fleet.agent('crew', { state: 'working', displayName: 'Research crew' }),
    fleet.agent('crew2', { state: 'idle', displayName: 'Second crew' }),
  ]);
  fs.writeFileSync(tipsStore.FILE(), JSON.stringify({ seen: [], off: true }));
  const server = await srv.start(0);
  const BASE = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));

    /* The engine, as the contract says. `engineOn` flips the flag; `crewSwarm` is the crew's card field. */
    let engineOn = false;
    let holdStatus = false;   // S11: no poll may land while it checks the merge
    let crewSwarm = { maxHelpers: 5, activeHelpers: 3, tokensToday: 2461380, dailyTokenLimit: 6000000, active: true, pausedBecause: null, helperTokenRatio: null };
    await page.route('**/api/status', async (route) => {
      while (holdStatus) await new Promise((res) => setTimeout(res, 100));
      const r = await route.fetch();
      const j = await r.json();
      if (engineOn) {
        j.swarms = true;
        for (const a of j.agents || []) a.swarm = a.sessionName === 'crew' ? { ...crewSwarm }
          : a.sessionName === 'crew2' ? { maxHelpers: 4, activeHelpers: 1, tokensToday: 1000, dailyTokenLimit: 2000000, active: true, pausedBecause: null, helperTokenRatio: null } : null;
      } else {
        /* The engine is on main now and always answers; "without the engine" is a board from before it, which
           sends neither the flag nor the field. */
        delete j.swarms;
        for (const a of j.agents || []) delete a.swarm;
      }
      route.fulfill({ response: r, json: j });
    });
    const sent = [];
    let stopAnswer = null;
    let slowPut = 0;
    let putTold = null;   // S18: the engine's `told` on a PUT (null = omitted)   // ms: an answer that arrives after the person has moved to another swarm (S16)   // null = the engine stops it; an object = the engine's answer as given
    /* The engine's REAL answer shapes (origin/swarm-engine-3564): PUT and stop return { ok, swarm: settings }
       where settings carry maxHelpers / dailyTokenLimit / active / pausedBecause but NOT activeHelpers,
       tokensToday or helperTokenRatio; stop adds { stopped, because }. */
    const settingsOf = (x) => ({ maxHelpers: x.maxHelpers, dailyTokenLimit: x.dailyTokenLimit, active: x.active, pausedBecause: x.pausedBecause });
    await page.route('**/api/agent/crew/swarm**', async (route) => {
      const q = route.request();
      const body = JSON.parse(q.postData() || '{}');
      sent.push({ method: q.method(), url: new URL(q.url()).pathname, body });
      if (slowPut) await new Promise((res) => setTimeout(res, slowPut));
      if (q.method() === 'PUT') crewSwarm = { ...crewSwarm, ...body };
      if (q.url().endsWith('/stop')) {
        if (stopAnswer) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stopAnswer) });
        crewSwarm = { ...crewSwarm, active: false, pausedBecause: 'stopped' };
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, stopped: true, because: null, swarm: settingsOf(crewSwarm) }) });
      }
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, swarm: settingsOf(crewSwarm), ...(putTold ? { told: putTold } : {}) }) });
    });
    let createBody = null;
    await page.route('**/api/agents', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      createBody = JSON.parse(route.request().postData() || '{}');
      route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'check stops here' }) });
    });
    const boot = async () => {
      await page.goto(BASE, { waitUntil: 'networkidle' });
      if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(200); }
      await page.evaluate(() => { applyLayout('tabs', true); showTab('agents'); });
    };
    const openForm = async () => page.evaluate(() => {
      openCreate(); PICKED = 'own';
      document.getElementById('cstep-role').hidden = true; document.getElementById('cstep-name').hidden = false;
      document.getElementById('create-name').value = 'Research crew';
      document.getElementById('create-label').value = 'Researcher';   // 'own' needs a role before it sends
      swarmCreatePaint();
    });

    // S1: no engine. New agent offers no Swarm choice and no card is a cluster (control: S2).
    await boot();
    chk(await waitFor(page, () => LAST_AT > 0, null, 8000), 'S1 precondition: the board has answered at least once');
    await openForm();
    const s1 = await page.evaluate(() => ({ kind: document.getElementById('create-kind').hidden, clusters: document.querySelectorAll('.swc').length, flag: SWARMS_ON }));
    chk(s1.kind === true && s1.flag === false, 'S1 without the engine, New agent offers no Swarm choice', JSON.stringify(s1));
    await page.evaluate(() => showTab('agents'));
    await page.waitForTimeout(300);
    chk(await page.evaluate(() => !document.querySelector('#grid .agauge clipPath[id^="swc-"]')), 'S1 and no card is drawn as a cluster');

    // S2: the engine is in. The choice shows; choosing Swarm shows its settings, holds the provider on Claude,
    // and the button says Make this swarm.
    engineOn = true;
    await boot();
    chk(await waitFor(page, () => SWARMS_ON === true, null, 8000), 'S2 precondition: the board says the engine can run a swarm');
    await openForm();
    chk(await page.evaluate(() => !document.getElementById('create-kind').hidden && document.getElementById('create-swarm').hidden), 'S2 the Agent / Swarm choice shows, Agent first and chosen');
    await page.click('label.ctype-opt:has(input[value="swarm"])');
    const s2 = await page.evaluate(() => ({ settings: !document.getElementById('create-swarm').hidden, modelField: document.getElementById('create-model-field').hidden,
      go: document.getElementById('create-go').textContent, circles: document.querySelectorAll('#create-kind-swarm-face .swd').length }));
    chk(s2.settings && s2.modelField === true && s2.go === 'Make this swarm' && s2.circles === 3, 'S2 Swarm shows its settings, Runs on Claude in place of the model picker, and reads Make this swarm', JSON.stringify(s2));
    if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await (await page.$('#cstep-name')).screenshot({ path: path.join(SHOTS, 'create.png') }); }

    // S3: the slider moves the value and the warning (helpers plus the lead); the limit shows unrounded.
    await page.fill('#create-swarm-max', '7');
    await page.dispatchEvent('#create-swarm-max', 'input');
    await page.fill('#create-swarm-cap', '9');
    await page.dispatchEvent('#create-swarm-cap', 'input');
    const s3 = await page.evaluate(() => ({ v: document.getElementById('create-swarm-max-v').textContent, warn: document.getElementById('create-swarm-warn').textContent,
      cap: document.getElementById('create-swarm-cap-v').textContent, circles: document.querySelectorAll('#create-kind-swarm-face .swd').length }));
    chk(s3.v === '7' && /about 8 times/.test(s3.warn) && /7 helpers plus the lead/.test(s3.warn) && s3.cap === '9,000,000' && s3.circles === 7, 'S3 the slider moves the value, the warning and the cluster; the limit shows in full', JSON.stringify(s3));

    // S4: the create request carries the contract's fields (and no provider).
    await page.evaluate(() => document.getElementById('create-go').click());
    chk(await waitFor(page, () => true, null, 100) && await (async () => { for (let i = 0; i < 20 && !createBody; i++) await page.waitForTimeout(150); return !!createBody; })()
      && createBody.kind === 'swarm' && createBody.maxHelpers === 7 && createBody.dailyTokenLimit === 9000000 && !('provider' in createBody) && !('model' in createBody) && !('account' in createBody),
      'S4 Make this swarm sends kind, maxHelpers and dailyTokenLimit', JSON.stringify(createBody));
    // S4b CONTROL: back to Agent, the request carries none of them.
    createBody = null;
    await openForm();
    await page.evaluate(() => document.getElementById('create-go').click());
    for (let i = 0; i < 20 && !createBody; i++) await page.waitForTimeout(150);
    chk(!!createBody && !('kind' in createBody) && !('maxHelpers' in createBody) && await page.evaluate(() => document.getElementById('create-model-field').hidden === false),
      'S4b a plain Agent sends no swarm fields and shows the model picker', JSON.stringify(createBody));

    // S5: the board card. The crew is its cluster (min(max, 7) circles, the badge working/most, the Swarm line);
    // Rex stays a plain face (the control).
    await page.evaluate(() => showTab('agents'));
    chk(await waitFor(page, () => !!document.querySelector('#grid [data-agent="crew"] clipPath[id^="swc-"]'), null, 8000), 'S5 precondition: the crew card is drawn as a cluster');
    const s5 = await page.evaluate(() => {
      const c = document.querySelector('#grid [data-agent="crew"]'), r = document.querySelector('#grid [data-agent="rex"]');
      return { circles: c.querySelectorAll('clipPath[id^="swc-"]').length, badge: [...c.querySelectorAll('.agauge text')].map((t) => t.textContent).join(' '),
        meta: c.querySelector('.ameta') && c.querySelector('.ameta').textContent, rexCluster: !!r.querySelector('clipPath[id^="swc-"]') };
    });
    chk(s5.circles === 5 && /3\/5/.test(s5.badge) && s5.meta === 'Swarm · 3 of 5 helpers working' && !s5.rexCluster, 'S5 the swarm card: five circles, 3/5, and its Swarm line; Rex stays a plain face', JSON.stringify(s5));
    if (SHOTS) await (await page.$('#grid')).screenshot({ path: path.join(SHOTS, 'board.png') });

    // S6: the swarm's page shows its panel; Rex's page does not (the control).
    await page.evaluate(() => document.querySelector('#grid [data-agent="rex"]').click());
    await page.waitForTimeout(600);
    chk(await page.evaluate(() => document.getElementById('d-swarm-panel').hidden === true && document.getElementById('d-swarm').hidden === true), 'S6 CONTROL: an ordinary agent\'s page has no swarm panel');
    chk(await page.evaluate(() => !document.getElementById('d-provider').closest('.frow').hidden), 'S19 CONTROL: an ordinary agent\'s page offers the provider switch');
    await page.evaluate(() => showTab('agents'));
    await page.waitForTimeout(300);
    await page.evaluate(() => document.querySelector('#grid [data-agent="crew"]').click());
    chk(await waitFor(page, () => !document.getElementById('d-swarm-panel').hidden), 'S6 the swarm\'s page shows its controls');
    chk(await page.evaluate(() => document.getElementById('d-provider').closest('.frow').hidden), 'S19 a swarm\'s page offers no provider switch (it runs on Claude only)');
    const s6 = await page.evaluate(() => ({ active: document.querySelector('input[name="d-swarm-active"][value="on"]').checked, today: document.getElementById('d-swarm-today').textContent,
      limit: document.getElementById('d-swarm-limit').textContent, bar: document.getElementById('d-swarm-bar').style.width, max: document.getElementById('d-swarm-max').value,
      stop: !document.getElementById('d-swarm-stop').disabled, head: document.querySelectorAll('#d-swarm .swd').length }));
    chk(s6.active && s6.today === '2,461,380 tokens' && s6.limit === 'of 6,000,000 limit' && /^41(\.0)?%$/.test(s6.bar) && s6.max === '5' && s6.stop && s6.head === 5,
      'S6 Active, Today in full with its bar, Most helpers at 5, Stop now ready, the header cluster', JSON.stringify(s6));
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'page.png') });

    // S7: the controls send the contract's requests.
    sent.length = 0;
    await page.click('label.pj-mode-opt:has(input[name="d-swarm-active"][value="off"])');
    await waitFor(page, () => true, null, 50);
    for (let i = 0; i < 20 && !sent.length; i++) await page.waitForTimeout(100);
    chk(sent[0] && sent[0].method === 'PUT' && sent[0].url === '/api/agent/crew/swarm' && sent[0].body.active === false, 'S7 Paused sends PUT /api/agent/crew/swarm { active: false }', JSON.stringify(sent[0]));
    await page.click('label.pj-mode-opt:has(input[name="d-swarm-active"][value="on"])');
    for (let i = 0; i < 20 && sent.length < 2; i++) await page.waitForTimeout(100);
    /* fill() fires its own change, so the requests are found by what they are, not by position. */
    const find = (pred) => sent.find(pred);
    await page.fill('#d-swarm-max', '8');
    for (let i = 0; i < 20 && !find((q) => q.method === 'PUT' && q.body.maxHelpers === 8); i++) await page.waitForTimeout(100);
    chk(!!find((q) => q.method === 'PUT' && q.url === '/api/agent/crew/swarm' && q.body.maxHelpers === 8), 'S7 Most helpers sends PUT { maxHelpers: 8 }', JSON.stringify(sent));
    // S11: the engine answers a change with its SETTINGS only; Today and the lit circles must not blank.
    // Polls are held, so only the merge can keep today's numbers on screen.
    holdStatus = true;
    await page.fill('#d-swarm-max', '6');
    for (let i = 0; i < 20 && !find((q) => q.body.maxHelpers === 6); i++) await page.waitForTimeout(100);
    await page.waitForTimeout(300);
    const s11 = await page.evaluate(() => ({ today: document.getElementById('d-swarm-today').textContent, lit: document.querySelectorAll('#d-swarm .swd.on').length }));
    holdStatus = false;
    chk(s11.today === '2,461,380 tokens' && s11.lit === 3, 'S11 after a change, Today and the working circles keep today\'s numbers', JSON.stringify(s11));
    // S13: the daily limit can be raised on the page (the create form's hint promises it).
    await page.fill('#d-swarm-cap', '12');
    for (let i = 0; i < 20 && !find((q) => q.body.dailyTokenLimit === 12000000); i++) await page.waitForTimeout(100);
    chk(!!find((q) => q.method === 'PUT' && q.body.dailyTokenLimit === 12000000), 'S13 the page raises the daily limit: PUT { dailyTokenLimit: 12000000 }', JSON.stringify(sent.slice(-2)));
    // S13b: a limit that is not a whole million shows exactly, and the slider says its value in words.
    crewSwarm = { ...crewSwarm, dailyTokenLimit: 2500000 };
    await page.evaluate(() => document.getElementById('d-swarm-cap').blur());
    chk(await waitFor(page, () => document.getElementById('d-swarm-cap-v').textContent === '2,500,000', null, 8000)
      && await page.evaluate(() => document.getElementById('d-swarm-cap').getAttribute('aria-valuetext') === '2,500,000 tokens a day'),
      'S13b a 2,500,000 limit shows as 2,500,000, and the slider is spoken in tokens', await page.evaluate(() => document.getElementById('d-swarm-cap-v').textContent));
    crewSwarm = { ...crewSwarm, dailyTokenLimit: 6000000 };
    // S17: today's tokens could not be read in full (metered false): the page says so, with no bar, rather than a
    // low number that reads as plenty left. CONTROL: metered true shows the number again.
    crewSwarm = { ...crewSwarm, metered: false, tokensToday: 1200, helperTokenRatio: 2.3 };
    chk(await waitFor(page, () => /Could not measure/.test(document.getElementById('d-swarm-today').textContent) && document.getElementById('d-swarm-bar').parentElement.hidden, null, 8000),
      'S17 tokens not read in full: it says it could not measure, and hides the bar', await page.evaluate(() => document.getElementById('d-swarm-today').textContent));
    chk(await page.evaluate(() => !/Today it has used/.test(document.getElementById('d-swarm-warn').textContent)),
      'S17 and the warning claims no measured ratio from the same partial read', await page.evaluate(() => document.getElementById('d-swarm-warn').textContent));
    const s17 = await page.evaluate(() => ({ limit: document.getElementById('d-swarm-limit').textContent, hint: document.getElementById('d-swarm-hint').hidden }));
    chk(s17.limit === 'Limit 6,000,000 a day' && s17.hint, 'S17 the limit stands alone and the page does not promise to pause at it', JSON.stringify(s17));
    await page.evaluate(() => { const r = document.getElementById('d-swarm-max'); r.value = '6'; r.dispatchEvent(new Event('input', { bubbles: true })); });
    chk(await page.evaluate(() => !/Today it has used/.test(document.getElementById('d-swarm-warn').textContent)), 'S17 moving the slider (its own path) claims no measured ratio either',
      await page.evaluate(() => document.getElementById('d-swarm-warn').textContent));
    crewSwarm = { ...crewSwarm, active: false, pausedBecause: 'person', activeHelpers: 0 };
    chk(await waitFor(page, () => !document.getElementById('d-swarm-stop').disabled, null, 8000), 'S17 paused with no helper counted, Stop now stays (the count was not read in full)');
    crewSwarm = { ...crewSwarm, active: true, pausedBecause: null, activeHelpers: 3 };
    crewSwarm = { ...crewSwarm, metered: true, tokensToday: 2461380 };
    chk(await waitFor(page, () => document.getElementById('d-swarm-today').textContent === '2,461,380 tokens' && !document.getElementById('d-swarm-bar').parentElement.hidden, null, 8000),
      'S17 CONTROL: measured again, the number and the bar are back', await page.evaluate(() => document.getElementById('d-swarm-today').textContent));
    chk(await waitFor(page, () => /Today it has used about <b>2\.3 times/.test(document.getElementById('d-swarm-warn').innerHTML), null, 8000),
      'S17 CONTROL: and measured, the warning gives the ratio', await page.evaluate(() => document.getElementById('d-swarm-warn').textContent));
    chk(await page.evaluate(() => document.getElementById('d-swarm-limit').textContent === 'of 6,000,000 limit' && !document.getElementById('d-swarm-hint').hidden), 'S17 CONTROL: measured, the limit line and the promise are back');
    // S18: the new number is saved but the lead could not be told: the page says so rather than show it as running.
    putTold = { state: 'could_not', because: 'its instructions could not be updated' };
    await page.fill('#d-swarm-max', '7');
    chk(await waitFor(page, () => /Saved, but we could not tell it yet: its instructions could not be updated/.test(document.getElementById('d-swarm-msg').textContent), null, 6000),
      'S18 saved but not told: it says so', await page.evaluate(() => document.getElementById('d-swarm-msg').textContent));
    putTold = { state: 'told' };
    await page.fill('#d-swarm-max', '5');
    chk(await waitFor(page, () => document.getElementById('d-swarm-msg').textContent === '', null, 6000), 'S18 CONTROL: told, no message', await page.evaluate(() => document.getElementById('d-swarm-msg').textContent));
    putTold = null;
    crewSwarm = { ...crewSwarm, helperTokenRatio: null };
    await page.click('#d-swarm-stop');
    for (let i = 0; i < 20 && !find((q) => q.method === 'POST'); i++) await page.waitForTimeout(100);
    chk(!!find((q) => q.method === 'POST' && q.url === '/api/agent/crew/swarm/stop'), 'S7 Stop now sends POST /api/agent/crew/swarm/stop', JSON.stringify(sent));
    // S12: Paused stops NEW helpers only, so Stop now stays usable while one is still working.
    crewSwarm = { ...crewSwarm, active: false, pausedBecause: 'person', activeHelpers: 2 };
    chk(await waitFor(page, () => document.querySelector('input[name="d-swarm-active"][value="off"]').checked && !document.getElementById('d-swarm-stop').disabled, null, 8000),
      'S12 paused with helpers still working, Stop now is still there to press');
    // S14: a stop that did not take says the engine's reason, not "Stopped".
    stopAnswer = { ok: true, stopped: false, because: 'we could not reach the lead just now' };
    await page.click('#d-swarm-stop');
    chk(await waitFor(page, () => /could not reach the lead/i.test(document.getElementById('d-swarm-msg').textContent)), 'S14 a stop that did not take says why, never Stopped', await page.evaluate(() => document.getElementById('d-swarm-msg').textContent));
    stopAnswer = null;
    crewSwarm = { ...crewSwarm, active: true, pausedBecause: null, activeHelpers: 3 };
    await waitFor(page, () => document.querySelector('input[name="d-swarm-active"][value="on"]').checked, null, 8000);

    // S16: a change still in flight when the person opens ANOTHER swarm: when its answer lands, the second
    // swarm's page keeps its own settings and no message from the first appears on it.
    slowPut = 2000;
    await page.click('#d-swarm-stop');   // its answer writes a message ("Stopped..."), which must not land on crew2
    await page.evaluate(() => { showTab('agents'); });
    await page.waitForTimeout(200);
    await page.evaluate(() => document.querySelector('#grid [data-agent="crew2"]').click());
    await page.waitForTimeout(3000);   // past the slow answer
    const s16 = await page.evaluate(() => ({ who: CURRENT && CURRENT.sessionName, on: document.querySelector('input[name="d-swarm-active"][value="on"]').checked,
      max: document.getElementById('d-swarm-max').value, msg: document.getElementById('d-swarm-msg').textContent, today: document.getElementById('d-swarm-today').textContent }));
    chk(s16.who === 'crew2' && s16.on && s16.max === '4' && s16.msg === '' && s16.today === '1,000 tokens',
      'S16 an answer for one swarm that lands on another\'s page changes nothing there', JSON.stringify(s16));
    slowPut = 0;
    crewSwarm = { ...crewSwarm, active: true, pausedBecause: null };
    await page.evaluate(() => { showTab('agents'); });
    await page.waitForTimeout(300);
    await page.evaluate(() => document.querySelector('#grid [data-agent="crew"]').click());
    await waitFor(page, () => !document.getElementById('d-swarm-panel').hidden && CURRENT.sessionName === 'crew');

    // S8: a swarm paused at its limit says why and cannot be stopped again (from the board's own answer).
    crewSwarm = { ...crewSwarm, active: false, pausedBecause: 'limit', activeHelpers: 0 };   // the engine interrupts the lead at the limit, ending its helpers
    chk(await waitFor(page, () => /today's limit/.test(document.getElementById('d-swarm-why').textContent) && document.getElementById('d-swarm-stop').disabled
      && document.querySelector('input[name="d-swarm-active"][value="off"]').checked, null, 8000), 'S8 paused at the limit: says so, shows Paused, Stop now is off');
    crewSwarm = { ...crewSwarm, active: true, pausedBecause: null, activeHelpers: 3 };

    // S9: a project's Members: the swarm has its cluster and an On / Off; Off sends the contract's PUT.
    await page.route('**/api/project/pj1/swarm/crew', async (route) => { sent.push({ method: route.request().method(), url: new URL(route.request().url()).pathname, body: JSON.parse(route.request().postData() || '{}') }); route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); });
    await page.evaluate(() => showTab('projects'));
    await page.evaluate(() => {
      const p = { id: 'pj1', name: 'Newsletter', swarmOff: [], agents: [
        { name: 'Research crew', sessionName: 'crew', present: true, state: 'working' },
        { name: 'Rex', sessionName: 'rex', present: true, state: 'working', role: 'Writer' }] };
      PROJECTS = [p]; PJ_CURRENT = 'pj1';
      document.getElementById('pj-one-agents').innerHTML = p.agents.map((m) => pjMember(m, true, true, true)).join('');
    });
    const s9 = await page.evaluate(() => ({ crew: !!document.querySelector('#pj-one-agents [data-agent="crew"] .swmini'), crewCluster: !!document.querySelector('#pj-one-agents [data-agent="crew"] .swc'),
      rex: !!document.querySelector('#pj-one-agents [data-agent="rex"] .swmini'), onPressed: document.querySelector('#pj-one-agents [data-agent="crew"] .swmini [data-swarm-on="1"]') && document.querySelector('#pj-one-agents [data-agent="crew"] .swmini [data-swarm-on="1"]').getAttribute('aria-pressed') }));
    chk(s9.crew && s9.crewCluster && !s9.rex && s9.onPressed === 'true', 'S9 in Members the swarm has its cluster and On / Off (On); Rex has neither', JSON.stringify(s9));
    const before9 = sent.length;
    /* The Projects view repaints from the server's own list (which has no pj1) and clears PJ_CURRENT, so the
       fixture project is re-established in the same turn as the press. */
    await page.evaluate(() => { PJ_CURRENT = 'pj1'; document.querySelector('#pj-one-agents [data-agent="crew"] .swmini [data-swarm-on="0"]').click(); });
    for (let i = 0; i < 20 && sent.length === before9; i++) await page.waitForTimeout(100);
    const last = sent[sent.length - 1];
    chk(last && last.method === 'PUT' && last.url === '/api/project/pj1/swarm/crew' && last.body.on === false
      && await page.evaluate(() => document.querySelector('#pj-one-agents [data-agent="crew"] .swmini [data-swarm-on="0"]').getAttribute('aria-pressed') === 'true'),
      'S9 Off sends PUT /api/project/pj1/swarm/crew { on: false } and shows Off', JSON.stringify(last));
    chk(await page.evaluate(() => URL_TAB === 'projects' && !(CURRENT && CURRENT.sessionName === 'crew' && URL_TAB === 'detail')), 'S9 and pressing Off stays on the project (it does not open the swarm\'s page)', await page.evaluate(() => URL_TAB));

    // S15: dark. The cluster, the badge and the panel draw in the dark theme too.
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.evaluate(() => { showTab('agents'); });
    await page.waitForTimeout(1700);
    const s15 = await page.evaluate(() => ({ dark: matchMedia('(prefers-color-scheme: dark)').matches, clusters: document.querySelectorAll('#grid clipPath[id^="swc-"]').length,
      badge: getComputedStyle(document.querySelector('#grid [data-agent="crew"] .agauge rect')).fill }));
    chk(s15.dark && s15.clusters >= 5 && s15.badge && s15.badge !== 'none', 'S15 in dark the swarm card still draws its cluster and badge', JSON.stringify(s15));
    if (SHOTS) await (await page.$('#grid')).screenshot({ path: path.join(SHOTS, 'board-dark.png') });
    await page.emulateMedia({ colorScheme: 'light' });

    chk(errs.length === 0, 'S10 no page errors', errs.join(' | '));
  } finally {
    await browser.close();
    server.close();
    for (const d of ROOTS) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
  }
  if (fail.length) { console.log('\n' + fail.length + ' FAILED'); for (const f of fail) console.error('  FAIL  ' + f); process.exit(1); }
  console.log('\nall swarm-ui checks passed (' + pass + ')');
})().catch((e) => { console.error(e); process.exit(1); });
