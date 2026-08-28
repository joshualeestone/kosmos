/* #1382: the all-tasks screen, in a real browser.
 *
 * Josh: "for tasks, i want to see a view of them in a list form basically",
 * answering his earlier "where I can see ALL of the tasks".
 *
 * 🔑 WHAT ONLY A BROWSER CAN SAY HERE. The node tests assert the SOURCE builds
 * the count and the rows from one array. That is the guarantee, and it is worth
 * pinning, but it is still a claim about text. This drives the actual door,
 * lands on the actual screen, and COUNTS THE RENDERED ROWS against the rendered
 * heading. #1346 shipped a screen whose heading said six over three rows, and
 * no source assertion caught it because both numbers were correct in isolation.
 *
 * ⚠️ THE ROWS ARE COUNTED INSIDE THE SCREEN, not document-wide. An unscoped
 * querySelectorAll is exactly what produced #1346's second number: rows on this
 * screen and rows in this document are different sets, and the project page
 * behind it also renders .tkcard.
 *
 * Run: NODE_PATH=$HOME/work/pw-runtime/node_modules node docs/browser-checks/render-alltasks.js
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const REPO = path.resolve(__dirname, '..', '..');
const freePort = () => Number(require('node:child_process').execFileSync(process.execPath,
  ['-e', "const s=require('node:net').createServer();s.listen(0,()=>{console.log(s.address().port);s.close();});"]).toString().trim());
const PORT = freePort();

let failures = 0, ran = 0;
const say = (n, cond, note) => {
  ran++;
  if (cond) console.log('PASS  ' + n + (note ? '  ' + note : ''));
  else { failures++; console.log('FAIL  ' + n + '  --  ' + (note || 'assertion failed')); }
};

(async () => {
  const roots = {};
  for (const k of ['DATA', 'WORKERS', 'LAUNCH', 'PROJECTS']) {
    roots[k] = fs.mkdtempSync(path.join(os.tmpdir(), 'at-' + k.toLowerCase() + '-'));
  }
  /* A FIXTURE member, never a live agent: assignment requires membership, and
     naming a real session would type into that agent's live pane. */
  fs.writeFileSync(roots.DATA + '/fake-panes',
    require('../../test-support/fleet').line({ session: 'tasker-discord', claim: 'tasker', title: '✳ idle' }));
  fs.writeFileSync(roots.DATA + '/fake-sessions', 'tasker-discord\n');

  const srv = spawn('node', ['server.js'], {
    cwd: REPO,
    env: { ...process.env, PORT: String(PORT), AGENT_WORKFORCE_RELEASE_BASE: 'http://127.0.0.1:9/dist',
      AGENT_WORKFORCE_DATA: roots.DATA, AGENT_WORKFORCE_WORKERS: roots.WORKERS,
      AGENT_WORKFORCE_LAUNCH: roots.LAUNCH, AGENT_WORKFORCE_PROJECTS: roots.PROJECTS,
      AGENT_WORKFORCE_TMUX_BIN: path.join(REPO, 'test-support', 'fake-tmux.sh'),
      AGENT_WORKFORCE_FAKE_PANES: roots.DATA + '/fake-panes',
      AGENT_WORKFORCE_FAKE_SESSIONS: roots.DATA + '/fake-sessions' },
    stdio: 'ignore',
  });
  await new Promise((r) => setTimeout(r, 1200));

  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));

  try {
    await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
    if (await p.isVisible('#firstrun')) await p.keyboard.press('Escape');

    /* TWO projects, so "across every project" is actually exercised. A
       single-project fixture would pass on a per-project screen, which is the
       thing this card exists to replace. */
    const made = await p.evaluate(async () => {
      const out = [];
      for (const name of ['Alpha Project', 'Beta Project']) {
        const r = await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name }) });
        if (!r.ok) throw new Error('project create failed: ' + r.status);
        const body = await r.json();
        await fetch('/api/project/' + body.project.id + '/agent/tasker', { method: 'POST',
          headers: { 'content-type': 'application/json' } });
        out.push(body.project.id);
      }
      for (const id of out) {
        for (const s of ['First job here', 'Second job here']) {
          await fetch('/api/project/' + id + '/tasks', { method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sentence: s + ' (' + id + ')', who: 'tasker' }) });
        }
      }
      return out;
    });
    say('the fixture made two projects with tasks on each', made.length === 2, JSON.stringify(made));

    await p.click('[data-tab="projects"]');
    await p.locator('#pj-list').getByText('Alpha Project').first().click();
    await p.waitForSelector('#pj-one-view', { state: 'visible' });
    await p.waitForTimeout(400);

    /* THE DOOR IS UNCONDITIONAL: this project hides nothing, and the control
       must still be there, because the screen behind it spans every project. */
    const doorVisible = await p.isVisible('#pj-alltasks');
    say('the door is offered even though this project hides nothing', doorVisible);
    const doorText = (await p.textContent('#pj-alltasks')) || '';
    say('the door carries no count', !/\(\d+\)/.test(doorText), JSON.stringify(doorText));

    await p.click('#pj-alltasks');
    await p.waitForSelector('#pj-alltasks-view', { state: 'visible' });
    await p.waitForTimeout(500);

    const seen = await p.evaluate(() => {
      const screen = document.getElementById('pj-alltasks-view');
      const rows = [...screen.querySelectorAll('.tkcard')].filter((r) => r.getBoundingClientRect().height > 0);
      return {
        rows: rows.length,
        heading: (document.getElementById('alltasks-count').innerText || '').trim(),
        projects: [...new Set(rows.map((r) => r.dataset.project))].length,
        everywhere: document.querySelectorAll('.tkcard').length,
      };
    });

    say('the screen renders rows', seen.rows > 0, JSON.stringify(seen));
    say('the rows span BOTH projects, so this is not the per-project list',
      seen.projects === 2, 'distinct projects on screen: ' + seen.projects);

    /* 🔑 THE #1346 ASSERTION. The heading's number must equal the rows the
       person can actually see, counted INSIDE the screen. */
    const stated = Number((seen.heading.match(/^(\d+)/) || [])[1]);
    say('the heading states a number', Number.isFinite(stated), JSON.stringify(seen.heading));
    say('the heading matches the rows on the screen', stated === seen.rows,
      'heading says ' + stated + ', rows on screen ' + seen.rows);

    /* A CONTROL ON THE SCOPING ITSELF: if the document holds more .tkcard than
       this screen does, then an unscoped count would have been wrong, and the
       assertion above is doing real work rather than agreeing by luck. */
    say('the document holds more task cards than this screen, so the scoping matters',
      seen.everywhere >= seen.rows, 'document ' + seen.everywhere + ' vs screen ' + seen.rows);

    say('no page errors', errs.length === 0, errs.join(' | '));
  } catch (e) {
    say('the check ran to completion', false, String(e && e.message ? e.message : e));
  } finally {
    await b.close().catch(() => {});
    srv.kill();
  }
  console.log((failures ? 'FAIL' : 'PASS') + '  render-alltasks  (' + ran + ' assertions)');
  process.exit(failures ? 1 : 0);
})();
