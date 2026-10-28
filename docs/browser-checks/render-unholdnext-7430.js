// Browser-check-surface: tk-hold tk-hold-msg tk-hold-choose tk-who tkHoldSayNext
'use strict';
/**
 * After a task comes off hold on its page, the page says who gets it next (kosmos#7430, the screen half of #7407).
 *
 * What this pins, and why each line can fail:
 *  - taking off hold a task nobody is on shows the route's own `next` sentence (srv.unholdNext, read after the click,
 *    so the screen and the CLIs say the same words), with the route's last ask turned into a Choose who button on its
 *    own line (a bordered button, at least 44 px tall on a touch screen: the design review),
 *  - Choose who opens the picker on that task's part nobody is on (the Who is on it control), and choosing Ada stores her,
 *  - the control: a task Ada is on says "It stays with Ada." (her name, as Who is on it says it) and shows no Choose who,
 *  - putting a task ON hold says nothing about who is next (the route sends no `next` then),
 *  - the line survives the five-second repaint,
 *  - light 1400 and dark 390, with no sideways scroll and no page errors.
 *
 * Not part of `npm test` -- it needs a browser. See README.md in this directory.
 *
 *   node docs/browser-checks/render-unholdnext-7430.js            # headed
 *   HEADED=0 node docs/browser-checks/render-unholdnext-7430.js   # headless
 */
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-unholdnext-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-unholdnext-workers-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-unholdnext-projects-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-unholdnext-launch-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-unholdnext-config-'));
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';
const SANDBOXES = [SANDBOX, process.env.AGENT_WORKFORCE_WORKERS, process.env.AGENT_WORKFORCE_PROJECTS,
  process.env.AGENT_WORKFORCE_LAUNCH, process.env.AGENT_WORKFORCE_CONFIG_ROOT];

const { chromium } = require('playwright');
const fleet = require('../../test-support/fleet');
const srv = require('../../server.js');
const projects = require('../../engine/projects');
const tasks = require('../../engine/tasks');

const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

(async () => {
  fleet.install([fleet.agent('ada', { state: 'idle', displayName: 'Ada', role: 'a planner' })]);
  require('../../engine/store').writeSettings({ tasksTabShown: true });
  const server = await srv.start(0);
  const URL = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  const clearFirstRun = async (page) => { if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); } };
  const text = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); return e ? e.textContent.trim() : null; }, sel);
  const proj = (id) => projects.readAll().find((x) => x.id === id);
  const stored = (id, n) => tasks.byNumber(proj(id), n) || {};
  // The route's own sentence for this task now (the Assigner setting and roster as the route reads them).
  const routeSays = (id, n) => srv.unholdNext(id, stored(id, n), () => null);
  const openTask = async (page, id, n) => {
    await page.evaluate(async ([pid, num]) => { if (await tskGoToProject(pid)) openTaskPage(num); }, [id, n]);
    await page.waitForSelector('#tk-hold', { state: 'visible', timeout: 5000 });
  };
  const settle = (page) => page.waitForFunction(() => !document.getElementById('tk-hold').disabled, null, { timeout: 6000 }).catch(() => {});
  try {
    for (const [theme, width] of [['light', 1400], ['dark', 390]]) {
      const tag = `[${theme} ${width}]`;
      const p = projects.create({ name: 'Supplier order ' + theme });
      projects.addAgent(p.id, 'ada', null);
      tasks.create(p.id, { sentence: 'Order the parts' });                  // 1: nobody on it, held
      tasks.create(p.id, { sentence: 'Book the courier', who: 'ada' });     // 2: Ada on it, held (the control)
      tasks.create(p.id, { sentence: 'Pack the boxes', who: 'ada' });      // 3: open, put on hold here
      tasks.create(p.id, { sentence: 'Label the crates' });                 // 4: nobody on it, held, Choose who on a stale page
      tasks.create(p.id, { sentence: 'Weigh the crates' });                 // 5: nobody on it, held, then given to Ada elsewhere
      tasks.create(p.id, { sentence: 'Seal the crates' });                  // 6: nobody on it, held, closed while the line shows
      tasks.create(p.id, { sentence: 'Ship the crates' });                  // 7: nobody on it, held, given out before the page reloads
      tasks.create(p.id, { sentence: 'Load the van', who: 'ada' });        // 8: two parts, Ada on one, nobody on the other, held
      tasks.addPart(p.id, 8, { sentence: 'the second trip' });
      tasks.create(p.id, { sentence: 'Book the forklift' });               // 9: nobody on it, held, the project paused under it
      tasks.create(p.id, { sentence: 'Return the pallets' });              // 10: nobody on it, held, the page left and reopened
      tasks.setOnHold(p.id, 1, true, { viaScreen: true });
      tasks.setOnHold(p.id, 2, true, { viaScreen: true });
      tasks.setOnHold(p.id, 4, true, { viaScreen: true });
      tasks.setOnHold(p.id, 5, true, { viaScreen: true });
      tasks.setOnHold(p.id, 6, true, { viaScreen: true });
      tasks.setOnHold(p.id, 7, true, { viaScreen: true });
      tasks.setOnHold(p.id, 8, true, { viaScreen: true });
      tasks.setOnHold(p.id, 9, true, { viaScreen: true });
      tasks.setOnHold(p.id, 10, true, { viaScreen: true });
      const phone = width < 600;   // the phone pass is a touch screen, where the page's tap targets grow to 44 px
      const page = await browser.newPage({ viewport: { width, height: 1000 }, colorScheme: theme, hasTouch: phone, isMobile: phone });
      const errs = [];
      page.on('pageerror', (e) => errs.push(e.message));
      await page.goto(URL, { waitUntil: 'networkidle' });
      await clearFirstRun(page);

      // Nobody on it: the route's sentence, its ask as a button.
      await openTask(page, p.id, 1);
      await page.click('#tk-hold');
      await settle(page);
      await page.waitForSelector('#tk-hold-choose-row:not([hidden])', { timeout: 6000 }).catch(() => {});
      const want = routeSays(p.id, 1);
      const ask = ' To choose who, assign it now.';
      chk(stored(p.id, 1).onHold !== true, `${tag} Take off hold took task 1 off hold`);
      chk(want.endsWith(ask) && want.startsWith('Nobody is on it'), `${tag} the route says nobody is on task 1 and asks for a choice (the premise)`, want);
      const said = await text(page, '#tk-hold-msg');
      const rowShown = () => page.evaluate(() => !document.getElementById('tk-hold-choose-row').hidden);
      chk(said === want.slice(0, -ask.length) && await rowShown() && await text(page, '#tk-hold-choose') === 'Choose who',
        `${tag} the page shows the route's sentence, its ask as Choose who`, JSON.stringify([said, await rowShown()]));
      // Review 1: the button is outside the live region, so a screen reader reads the sentence, not a button in it.
      chk(await page.evaluate(() => !document.getElementById('tk-hold-msg').contains(document.getElementById('tk-hold-choose'))),
        `${tag} Choose who is outside the hold line's live region`);
      // Design review (Mona Lisa): a bordered button on its own line, a full tap target on a phone.
      const box = await page.evaluate(() => { const b = document.getElementById('tk-hold-choose').getBoundingClientRect(); const m = document.getElementById('tk-hold-msg').getBoundingClientRect(); return { h: b.height, cls: document.getElementById('tk-hold-choose').className, below: b.top >= m.bottom }; });
      chk(box.cls === 'btn' && box.below && (!phone || box.h >= 44), `${tag} Choose who is a bordered button on its own line` + (phone ? ', at least 44 px tall on a touch screen' : ''), JSON.stringify(box));
      await page.waitForTimeout(5600);   // one five-second repaint
      chk(await text(page, '#tk-hold-msg') === said && await rowShown(), `${tag} the line survives the repaint`, await text(page, '#tk-hold-msg'));

      // Choose who opens the part's picker; choosing Ada stores her.
      await page.click('#tk-hold-choose');
      const sel = await page.waitForSelector('#tk-who .tkwho-sel', { timeout: 4000 }).catch(() => null);
      chk(!!sel, `${tag} Choose who opens the picker on the part nobody is on`);
      if (sel) {
        // The Assigner may give it out on its own: the arm below means something only if nobody is on it yet.
        chk(tasks.whoOf(stored(p.id, 1)).length === 0, `${tag} nobody is on task 1 before the choice (the premise)`, JSON.stringify(tasks.whoOf(stored(p.id, 1))));
        await page.selectOption('#tk-who .tkwho-sel', 'ada');
        await page.waitForFunction(() => /Ada/.test(document.getElementById('tk-who').textContent), null, { timeout: 5000 }).catch(() => {});
        chk(tasks.whoOf(stored(p.id, 1)).includes('ada'), `${tag} choosing Ada puts her on task 1`, JSON.stringify(tasks.whoOf(stored(p.id, 1))));
        // Review 1: the line was about nobody being on it; once Ada is, it goes (with Choose who) within a repaint.
        await page.waitForFunction(() => document.getElementById('tk-hold-msg').textContent === '' && document.getElementById('tk-hold-choose-row').hidden, null, { timeout: 7000 }).catch(() => {});
        chk(await text(page, '#tk-hold-msg') === '' && !(await rowShown()), `${tag} after the choice the stale line and Choose who are gone`, JSON.stringify([await text(page, '#tk-hold-msg'), await rowShown()]));
      }

      // Review 1: someone else (the Assigner) puts Ada on a task whose unhold line is showing: the line goes too.
      await openTask(page, p.id, 4);
      await page.click('#tk-hold');
      await settle(page);
      await page.waitForSelector('#tk-hold-choose-row:not([hidden])', { timeout: 6000 }).catch(() => {});
      chk(await rowShown(), `${tag} task 4 shows Choose who after its unhold (the premise)`, await text(page, '#tk-hold-msg'));
      // Review 2: Choose who pressed when no open part is free. The page cannot be caught between a hand-out and its
      // repaint on demand, so this removes the free-part marker by hand to reach the branch; the row must go.
      await page.evaluate(() => { for (const b of document.querySelectorAll('#tk-who [data-pick-nobody]')) b.removeAttribute('data-pick-nobody'); });
      await page.click('#tk-hold-choose');
      chk(!(await rowShown()) && await text(page, '#tk-hold-msg') === '' && !(await page.$('#tk-who .tkwho-sel')),
        `${tag} Choose who with no free part takes the stale line down and opens no picker`, JSON.stringify([await rowShown(), await text(page, '#tk-hold-msg')]));
      // Show it again for the Assigner arm below.
      await openTask(page, p.id, 5);
      await page.click('#tk-hold');
      await settle(page);
      await page.waitForSelector('#tk-hold-choose-row:not([hidden])', { timeout: 6000 }).catch(() => {});
      chk(await rowShown(), `${tag} task 5 shows Choose who after its unhold (the premise)`, await text(page, '#tk-hold-msg'));
      tasks.assignPart(p.id, 5, 1, 'ada');
      await page.waitForFunction(() => document.getElementById('tk-hold-msg').textContent === '' && document.getElementById('tk-hold-choose-row').hidden, null, { timeout: 7000 }).catch(() => {});
      chk(await text(page, '#tk-hold-msg') === '' && !(await rowShown()), `${tag} once the task is given out elsewhere, the line and Choose who go within a repaint`, JSON.stringify([await text(page, '#tk-hold-msg'), await rowShown()]));

      // Review 3: the task is closed while its unhold line shows: the line and Choose who go within a repaint.
      await openTask(page, p.id, 6);
      await page.click('#tk-hold');
      await settle(page);
      await page.waitForSelector('#tk-hold-choose-row:not([hidden])', { timeout: 6000 }).catch(() => {});
      chk(await rowShown(), `${tag} task 6 shows Choose who after its unhold (the premise)`, await text(page, '#tk-hold-msg'));
      const closedSt = await fetch(URL + '/api/project/' + encodeURIComponent(p.id) + '/task/6/close', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then((r) => r.status);
      await page.waitForFunction(() => document.getElementById('tk-hold-msg').textContent === '' && document.getElementById('tk-hold-choose-row').hidden, null, { timeout: 7000 }).catch(() => {});
      chk(closedSt === 200 && await text(page, '#tk-hold-msg') === '' && !(await rowShown()), `${tag} once the task is closed, the line and Choose who go within a repaint`, JSON.stringify([closedSt, await text(page, '#tk-hold-msg'), await rowShown()]));

      // Review 3: a hand-out that lands after the route answered but before the page reloads: the line still goes.
      await openTask(page, p.id, 7);
      await page.route('**/task/7/hold', async (route) => {   // #6022: inside a try, so teardown cannot crash the check
        try { const r = await route.fetch(); tasks.assignPart(p.id, 7, 1, 'ada'); await route.fulfill({ response: r }); } catch { await route.abort().catch(() => {}); }
      });
      await page.click('#tk-hold');
      await settle(page);
      await page.unroute('**/task/7/hold');
      chk(tasks.whoOf(stored(p.id, 7)).includes('ada'), `${tag} Ada was put on task 7 between the answer and the reload (the premise)`);
      // Review 5: read at once, before any repaint: the stale sentence is never shown, not shown then taken down.
      chk(await text(page, '#tk-hold-msg') === '' && !(await rowShown()), `${tag} a hand-out before the reload: the stale line is never shown`, JSON.stringify([await text(page, '#tk-hold-msg'), await rowShown()]));

      // Review 4: a two-part task (Ada on one part, nobody on the other): the route's raw task and the board's copy of it
      // must read the same, so the line survives a repaint when nothing changed.
      await openTask(page, p.id, 8);
      await page.click('#tk-hold');
      await settle(page);
      await page.waitForFunction(() => document.getElementById('tk-hold-msg').textContent !== '', null, { timeout: 6000 }).catch(() => {});
      const want8 = routeSays(p.id, 8);
      chk(/^It stays with Ada\. Its part nobody is on waits for a person to assign it\.$/.test(want8) && await text(page, '#tk-hold-msg') === want8,
        `${tag} a two-part task says the route's sentence (the premise)`, JSON.stringify([want8, await text(page, '#tk-hold-msg')]));
      await page.waitForTimeout(5600);   // one five-second repaint
      chk(await text(page, '#tk-hold-msg') === want8, `${tag} the two-part task's line survives the repaint`, await text(page, '#tk-hold-msg'));
      // Review 7: that sentence asks a person to assign the free part, so it offers Choose who too, on that part.
      chk(await rowShown(), `${tag} a free part beside a held one offers Choose who`, await text(page, '#tk-hold-msg'));
      await page.click('#tk-hold-choose');
      const sel8 = await page.waitForSelector('#tk-who .tkwho-sel', { timeout: 4000 }).catch(() => null);
      const onFree = sel8 && await page.evaluate(() => { const row = document.querySelector('#tk-who .tkwho-sel').closest('.tkpart'); return row && row.dataset.part; });
      chk(!!sel8 && onFree === String(tasks.partsOf(stored(p.id, 8)).find((x) => !x.who).id), `${tag} Choose who opens the picker on the free part, not Ada's`, JSON.stringify(onFree));
      await page.keyboard.press('Escape');

      // Review 7: the project is paused under a line that promises a hand-out: the line goes within a repaint.
      await openTask(page, p.id, 9);
      await page.click('#tk-hold');
      await settle(page);
      await page.waitForSelector('#tk-hold-choose-row:not([hidden])', { timeout: 6000 }).catch(() => {});
      chk(/^Nobody is on it, so Kosmos will give it to Ada/.test(await text(page, '#tk-hold-msg')), `${tag} task 9 promises a hand-out (the premise)`, await text(page, '#tk-hold-msg'));
      projects.mutate(p.id, (q) => ({ ...q, paused: true }));
      await page.waitForFunction(() => document.getElementById('tk-hold-msg').textContent === '' && document.getElementById('tk-hold-choose-row').hidden, null, { timeout: 7000 }).catch(() => {});
      chk(await text(page, '#tk-hold-msg') === '' && !(await rowShown()), `${tag} pausing the project takes the promise down within a repaint`, JSON.stringify([await text(page, '#tk-hold-msg'), await rowShown()]));
      projects.mutate(p.id, (q) => { const r = { ...q }; delete r.paused; return r; });

      // Review 7: leaving the task page ends the line; coming back shows no line.
      await openTask(page, p.id, 10);
      await page.click('#tk-hold');
      await settle(page);
      await page.waitForSelector('#tk-hold-choose-row:not([hidden])', { timeout: 6000 }).catch(() => {});
      chk(await rowShown(), `${tag} task 10 shows its unhold line (the premise)`, await text(page, '#tk-hold-msg'));
      await page.evaluate(() => leaveTaskPage());
      await openTask(page, p.id, 10);
      chk(await text(page, '#tk-hold-msg') === '' && !(await rowShown()), `${tag} after leaving the task page, coming back shows no unhold line`, JSON.stringify([await text(page, '#tk-hold-msg'), await rowShown()]));

      // The control: Ada is on task 2, so it stays with her and nothing asks for a choice.
      await openTask(page, p.id, 2);
      await page.click('#tk-hold');
      await settle(page);
      await page.waitForFunction(() => document.getElementById('tk-hold-msg').textContent !== '', null, { timeout: 6000 }).catch(() => {});
      const want2 = routeSays(p.id, 2);
      chk(want2 === 'It stays with Ada.' && await text(page, '#tk-hold-msg') === want2 && !(await rowShown()),
        `${tag} a task Ada is on: "It stays with Ada." (her name, as Who is on it says it), no Choose who`, JSON.stringify([want2, await text(page, '#tk-hold-msg')]));

      // Putting a task ON hold says nothing about who is next.
      await openTask(page, p.id, 3);
      await page.click('#tk-hold');
      await settle(page);
      await page.waitForTimeout(500);
      chk(stored(p.id, 3).onHold === true && await text(page, '#tk-hold-msg') === '',
        `${tag} Put on hold says nothing about who is next`, JSON.stringify(await text(page, '#tk-hold-msg')));

      // Review 6: a project with nobody on it: Choose who says where people come from, in the hold line.
      const empty = projects.create({ name: 'Empty shelf ' + theme });
      tasks.create(empty.id, { sentence: 'Count the stock' });
      tasks.setOnHold(empty.id, 1, true, { viaScreen: true });
      await openTask(page, empty.id, 1);
      await page.click('#tk-hold');
      await settle(page);
      await page.waitForSelector('#tk-hold-choose-row:not([hidden])', { timeout: 6000 }).catch(() => {});
      chk(await rowShown(), `${tag} a project with nobody on it still asks for a choice (the premise)`, await text(page, '#tk-hold-msg'));
      await page.click('#tk-hold-choose');
      chk(await text(page, '#tk-hold-msg') === 'Add an agent to this project first, then you can put them on it.' && !(await rowShown()),
        `${tag} Choose who on a project with nobody on it says so in the hold line`, JSON.stringify([await text(page, '#tk-hold-msg'), await rowShown()]));

      const sideways = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
      chk(!sideways, `${tag} no sideways scroll`);
      chk(errs.length === 0, `${tag} no page errors`, errs.join(' | '));
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
    for (const d of SANDBOXES) fs.rmSync(d, { recursive: true, force: true });
  }
  console.log(fail.length ? `\n${fail.length} FAILED` : '\nALL PASS');
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); for (const d of SANDBOXES) fs.rmSync(d, { recursive: true, force: true }); process.exit(1); });
