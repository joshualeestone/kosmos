// Browser-check-surface: tk-edit tk-editform tk-edit-title tk-edit-detail tk-edit-save tk-edit-cancel tkedit tkedit-open tkedit-acts
'use strict';
/**
 * kosmos#8664 (page half): edit a task's title or detail on its page, as `kosmos task edit` does from the terminal.
 *
 * What this pins, and why each line can fail:
 *  - the task page has an "Edit title or detail" button; it opens a form filled with the task's words, the title focused,
 *  - saving changes the title and the detail on the page, keeps the detail's lines, closes the form and gives focus
 *    back to the button, and the task's activity says "You changed the title from ... to ... and changed the detail",
 *  - an emptied title is refused on the page and nothing is sent (the title stays as it was),
 *  - emptying the detail clears it (the detail line hides), and Cancel closes the form with nothing sent,
 *  - the five-second repaint (paintTaskPage) does not wipe what is being typed, and opening another task closes the form,
 *  - light and dark, 1400 and 390 wide, with the form inside the window, no sideways scroll and no page errors.
 *
 * Not part of `npm test` -- it needs a browser. See README.md in this directory.
 *
 *   node docs/browser-checks/render-taskedit-8664.js            # headed
 *   HEADED=0 node docs/browser-checks/render-taskedit-8664.js   # headless
 */
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-taskedit-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-taskedit-workers-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-taskedit-projects-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-taskedit-launch-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-taskedit-config-'));
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';
const SANDBOXES = [SANDBOX, process.env.AGENT_WORKFORCE_WORKERS, process.env.AGENT_WORKFORCE_PROJECTS,
  process.env.AGENT_WORKFORCE_LAUNCH, process.env.AGENT_WORKFORCE_CONFIG_ROOT];

let chromium;
try { ({ chromium } = require('playwright')); }
catch {
  console.log('render-taskedit-8664: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}
const fleet = require('../../test-support/fleet');
const srv = require('../../server.js');
const projects = require('../../engine/projects');
const tasks = require('../../engine/tasks');

const SHOTS = process.argv[2] || null;
const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

(async () => {
  fleet.install([fleet.agent('ada', { state: 'idle', displayName: 'Ada', role: 'a builder' })]);
  const proj = projects.create({ name: 'Release notes' });
  projects.addAgent(proj.id, 'ada', null);
  const made = { via: 'process', by: 'ada' };
  require('../../engine/store').writeSettings({ tasksTabShown: true });

  const server = await srv.start(0);
  const URL = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  const clearFirstRun = async (page) => { if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); } };
  const openTask = async (page, n) => {
    await page.evaluate(async ([id, num]) => { await loadProjects(); showTab('projects'); openProject(id); openTaskPage(num); }, [proj.id, n]);
    await page.waitForFunction((num) => TK_OPEN === num, n, { timeout: 8000 });
  };
  const stored = (n) => tasks.byNumber(projects.readAll().find((p) => p.id === proj.id), n);
  try {
    for (const [theme, width] of [['light', 1400], ['dark', 1400], ['light', 390]]) {
      const tag = `[${theme} ${width}]`;
      // Fresh tasks for each pass, so every pass edits the same starting words.
      const a = tasks.create(proj.id, { sentence: 'Write the notes', detail: 'For the 0.8.10 release.', who: 'ada', made }).number;
      const b = tasks.create(proj.id, { sentence: 'Another task', who: 'ada', made }).number;
      const page = await browser.newPage({ viewport: { width, height: 1000 }, colorScheme: theme });
      const errs = [];
      page.on('pageerror', (e) => errs.push(e.message));
      const posts = [];
      page.on('request', (r) => { if (r.method() === 'POST' && /\/task\/\d+\/text$/.test(r.url())) posts.push(r.postData()); });
      await page.goto(URL, { waitUntil: 'networkidle' });
      await clearFirstRun(page);
      await openTask(page, a);

      /* Opening the form. */
      const btn = await page.evaluate(() => { const e = document.getElementById('tk-edit'); const r = e.getBoundingClientRect(); return { hidden: e.hidden, text: e.textContent, h: r.height }; });
      chk(!btn.hidden && btn.h > 0 && btn.text === 'Edit title or detail', `${tag} the task page has an Edit title or detail button`, JSON.stringify(btn));
      await page.click('#tk-edit');
      const opened = await page.evaluate(() => ({ form: document.getElementById('tk-editform').hidden, btn: document.getElementById('tk-edit').hidden,
        title: document.getElementById('tk-edit-title').value, detail: document.getElementById('tk-edit-detail').value,
        focus: document.activeElement && document.activeElement.id }));
      chk(opened.form === false && opened.btn === true && opened.title === 'Write the notes' && opened.detail === 'For the 0.8.10 release.' && opened.focus === 'tk-edit-title',
        `${tag} the form opens with the task's words, the title focused`, JSON.stringify(opened));
      const inside = await page.evaluate(() => { const r = document.getElementById('tk-editform').getBoundingClientRect(); return r.right <= window.innerWidth + 1 && r.left >= -1; });
      chk(inside, `${tag} the form is inside the window`);
      const head = await page.evaluate(() => ({ title: document.getElementById('tk-title').getClientRects().length > 0, detail: document.getElementById('tk-detail').getClientRects().length > 0 }));
      chk(!head.title && !head.detail, `${tag} while the form is open the head's title and detail are hidden (the words show once)`, JSON.stringify(head));
      const pair = await page.evaluate(() => { const s = document.getElementById('tk-edit-save').getBoundingClientRect(); const c = document.getElementById('tk-edit-cancel').getBoundingClientRect();
        const done = document.getElementById('tk-done').getBoundingClientRect(); return { s: Math.round(s.height), c: Math.round(c.height), done: Math.round(done.height) }; });
      chk(Math.abs(pair.s - pair.c) <= 1 && pair.s < pair.done, `${tag} Save and Cancel are one matched pair, smaller than Mark as done`, JSON.stringify(pair));
      const between = await page.evaluate(() => getComputedStyle(document.querySelectorAll('#tk-editform .field')[1]).borderTopWidth);
      chk(between === '0px', `${tag} no line between the two fields`, between);
      if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `taskedit-form-${theme}-${width}.png`), fullPage: true }); }

      /* The five-second repaint does not wipe what is being typed. */
      await page.fill('#tk-edit-title', 'Typed, not saved yet');
      await page.evaluate(() => paintTaskPage());
      chk(await page.inputValue('#tk-edit-title') === 'Typed, not saved yet' && !(await page.evaluate(() => document.getElementById('tk-editform').hidden)),
        `${tag} a repaint keeps the form and what is typed in it`);

      /* An emptied title (truly empty, and only spaces) is refused by the page's own words, with nothing sent. */
      for (const empty of ['', '   ']) {
        await page.fill('#tk-edit-title', empty);
        const before = posts.length;
        await page.click('#tk-edit-save');
        await page.waitForTimeout(300);
        chk(posts.length === before && /A task needs a title/.test(await page.textContent('#tk-msg')) && stored(a).sentence === 'Write the notes'
          && await page.evaluate(() => document.activeElement.id) === 'tk-edit-title',
          `${tag} a title of ${JSON.stringify(empty)} is refused on the page, nothing is sent, focus is on the title`, JSON.stringify([posts.length - before, await page.textContent('#tk-msg')]));
      }

      /* Saving a new title and a two-line detail. */
      await page.fill('#tk-edit-title', 'Write the 0.8.10 notes');
      await page.fill('#tk-edit-detail', 'For the 0.8.10 release.\nList the Windows fixes first.');
      await page.click('#tk-edit-save');
      await page.waitForFunction(() => document.getElementById('tk-editform').hidden, null, { timeout: 8000 }).catch(() => {});
      await page.waitForFunction(() => document.getElementById('tk-title').textContent === 'Write the 0.8.10 notes', null, { timeout: 8000 }).catch(() => {});
      chk(JSON.stringify(JSON.parse(posts[posts.length - 1] || '{}')) === JSON.stringify({ sentence: 'Write the 0.8.10 notes', detail: 'For the 0.8.10 release.\nList the Windows fixes first.' }),
        `${tag} Save sent the new title and the two-line detail`, posts[posts.length - 1]);
      const saved = await page.evaluate(() => ({ title: document.getElementById('tk-title').textContent, detail: document.getElementById('tk-detail').innerText,
        form: document.getElementById('tk-editform').hidden, focus: document.activeElement && document.activeElement.id, msg: document.getElementById('tk-msg').textContent }));
      const back = await page.evaluate(() => document.getElementById('tk-title').getClientRects().length > 0);
      chk(back, `${tag} after Save the head's title shows again`);
      chk(saved.title === 'Write the 0.8.10 notes' && saved.form === true && saved.focus === 'tk-edit' && saved.msg === '',
        `${tag} Save changes the title, closes the form and gives focus back to the button`, JSON.stringify(saved));
      chk(/For the 0\.8\.10 release\.\s*\n\s*List the Windows fixes first\./.test(saved.detail) && stored(a).detail === 'For the 0.8.10 release.\nList the Windows fixes first.',
        `${tag} the detail keeps its two lines, on the page and as stored`, JSON.stringify([saved.detail, stored(a).detail]));
      await page.waitForFunction(() => /changed the title from/.test(document.getElementById('tk-activity').textContent), null, { timeout: 8000 }).catch(() => {});
      const act = await page.textContent('#tk-activity');
      chk(/You changed the title from Write the notes to Write the 0\.8\.10 notes and changed the detail/.test(act),
        `${tag} the activity says what changed, as the person`, act.slice(-160));
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `taskedit-saved-${theme}-${width}.png`), fullPage: true });

      /* A change made elsewhere while the form is open (an agent's, through the engine) is not sent back over: changing only
         the title sends only the title. */
      await page.click('#tk-edit');
      tasks.setText(proj.id, a, { detail: 'An agent added this while the form was open.' }, { by: 'ada' });
      await page.evaluate(async () => { await pjReload(); });   // the poll brings the agent's detail into PROJECTS
      await page.fill('#tk-edit-title', 'Write the 0.8.10 notes, please');
      await page.click('#tk-edit-save');
      await page.waitForFunction(() => document.getElementById('tk-editform').hidden, null, { timeout: 8000 }).catch(() => {});
      chk(JSON.stringify(JSON.parse(posts[posts.length - 1] || '{}')) === JSON.stringify({ sentence: 'Write the 0.8.10 notes, please' })
        && stored(a).detail === 'An agent added this while the form was open.',
        `${tag} a title-only save sends only the title, and an agent's detail written meanwhile survives`, JSON.stringify([posts[posts.length - 1], stored(a).detail]));

      /* Emptying the detail clears it (sent as null); Cancel sends nothing. */
      await page.click('#tk-edit');
      await page.fill('#tk-edit-detail', '');
      await page.click('#tk-edit-save');
      await page.waitForFunction(() => document.getElementById('tk-detail').hidden, null, { timeout: 8000 }).catch(() => {});
      chk(await page.evaluate(() => document.getElementById('tk-detail').hidden) && !stored(a).detail
        && JSON.stringify(JSON.parse(posts[posts.length - 1] || '{}')) === JSON.stringify({ detail: null }),
        `${tag} emptying the detail sends null and clears it`, JSON.stringify([posts[posts.length - 1], stored(a).detail]));
      await page.click('#tk-edit');
      await page.fill('#tk-edit-title', 'Not this');
      const before2 = posts.length;
      await page.click('#tk-edit-cancel');
      await page.waitForTimeout(300);
      chk(posts.length === before2 && stored(a).sentence === 'Write the 0.8.10 notes, please' && await page.evaluate(() => document.getElementById('tk-editform').hidden && document.activeElement.id === 'tk-edit'),
        `${tag} Cancel closes the form, sends nothing, and gives focus back`);

      /* Escape closes the form too, with nothing sent. */
      await page.click('#tk-edit');
      const before3 = posts.length;
      await page.keyboard.press('Escape');
      chk(await page.evaluate(() => document.getElementById('tk-editform').hidden && document.activeElement.id === 'tk-edit') && posts.length === before3,
        `${tag} Escape closes the form, sends nothing, gives focus back`);

      /* Opening another task closes an open form. */
      await page.click('#tk-edit');
      await openTask(page, b);
      chk(await page.evaluate(() => document.getElementById('tk-editform').hidden && !document.getElementById('tk-edit').hidden),
        `${tag} opening another task closes the form`);

      const bad = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      chk(!bad, `${tag} no sideways scroll`);
      chk(errs.length === 0, `${tag} no page errors`, errs.join(' | '));
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
    for (const d of SANDBOXES) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
  }
  console.log(fail.length ? `\nFAIL: ${fail.length}` : '\nAll checks passed');
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
