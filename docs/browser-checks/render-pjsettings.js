/* Drive-through of the project settings screen (pack section 3099): the
 * door from the project page, the pack's fields painting from the record,
 * the immediate-parent location sentence, a save round trip, and the
 * relocated archive/remove blocks present with their original ids.
 * Run: NODE_PATH=$HOME/work/pw-runtime/node_modules node docs/browser-checks/render-pjsettings.js
 * Sandboxed roots; kills only what it starts; Reveal is NOT clicked (it
 * opens a real Finder window; its route is wire-tested instead). */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
/* Rendered text, not DOM text (#687): `innerText` honours CSS display and
   visibility, and an element with no box has no rendered text at all, so a
   sentence nobody can see reads as '' here and the assertion fails. */
const shown = async (loc) => ((await loc.boundingBox()) ? loc.innerText() : '');

const REPO = path.resolve(__dirname, '..', '..');
/* Screenshots go to SHOT_DIR or a fresh temp dir, never into the repo (#630):
   they differ byte for byte run to run and dirtied the shared checkout under
   every cut. The path is printed at the end so a person can find them. */
const OUT = process.env.SHOT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'pjsettings-shots-'));
/* A free port, asked of the kernel, never a number (#708): the gate got this
   in #633 and the self-booting checks still carried fixed ports, so two agents
   running the same check collided exactly as before. */
const freePort = () => Number(require('node:child_process').execFileSync(process.execPath, ['-e', "const s=require('node:net').createServer();s.listen(0,'127.0.0.1',()=>{process.stdout.write(String(s.address().port));s.close()})"], { encoding: 'utf8' }));
const PORT = freePort();

(async () => {
  const roots = {};
  for (const k of ['DATA', 'WORKERS', 'LAUNCH', 'PROJECTS']) {
    roots[k] = fs.mkdtempSync(path.join(os.tmpdir(), 'pjs-' + k.toLowerCase() + '-'));
  }
  const srv = spawn('node', ['server.js'], {
    cwd: REPO,
    env: { ...process.env, PORT: String(PORT), AGENT_WORKFORCE_RELEASE_BASE: 'http://127.0.0.1:9/dist',
      AGENT_WORKFORCE_DATA: roots.DATA, AGENT_WORKFORCE_WORKERS: roots.WORKERS,
      AGENT_WORKFORCE_LAUNCH: roots.LAUNCH, AGENT_WORKFORCE_PROJECTS: roots.PROJECTS,
      AGENT_WORKFORCE_TMUX_BIN: path.join(REPO, 'test-support', 'fake-tmux.sh') }, // sandboxed whole (#634)
    stdio: 'ignore',
  });
  const die = (msg) => { srv.kill(); console.error('FAIL', msg); process.exit(1); };
  await new Promise((r) => setTimeout(r, 1200));

  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  try {
    await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
    if (await p.isVisible('#firstrun')) await p.keyboard.press('Escape');
    await p.evaluate(async () => {
      const r = await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Settings Drive' }) });
      if (!r.ok) throw new Error('fixture create failed');
    });
    await p.click('[data-tab="projects"]');
    await p.locator('#pj-list').getByText('Settings Drive').first().click();

    // The project page no longer shows the path; the door is there.
    await p.waitForSelector('#pj-settings-link', { state: 'visible' });
    const pageText = await p.locator('#pj-one-view').innerText();
    if (/\/var\/folders|\/Users\//.test(pageText)) die('a filesystem path is still on the project page');

    await p.click('#pj-settings-link');
    await p.waitForSelector('#pj-settings-view', { state: 'visible' });
    if ((await p.inputValue('#pjs-name')) !== 'Settings Drive') die('name did not paint');
    const folderName = (await shown(p.locator('#pjs-folder-name'))).trim();
    if (folderName !== 'Settings Drive') die('folder name line: ' + folderName);
    const where = (await shown(p.locator('#pjs-folder-where'))).trim();
    // Sandboxed root is a temp dir, not the Kosmos folder: the parent rule
    // must produce "In your <tempdirname> folder." — assert the SHAPE.
    if (!/^In (your .+ folder\.|a folder you chose\.)$/.test(where)) die('location sentence shape: ' + where);
    for (const id of ['pjs-reveal', 'pj-one-archive', 'pj-one-remove', 'pjs-save']) {
      if (!(await p.locator('#' + id).isVisible())) die(id + ' is missing from settings');
    }
    await p.screenshot({ path: path.join(OUT, 'project-settings.png') });

    // Save round trip: rename, verify it lands everywhere.
    await p.fill('#pjs-name', 'Settings Drive Renamed');
    await p.click('#pjs-save');
    await p.waitForFunction(() => { const m = document.getElementById('pjs-msg'); return m.getBoundingClientRect().height > 0 && m.innerText.trim() === 'Saved.'; }, { timeout: 10000 });
    const back = (await shown(p.locator('#pj-settings-backname'))).trim();
    if (back !== 'Settings Drive Renamed') die('the back link did not pick up the rename');
    await p.click('#pj-settings-back');
    await p.waitForSelector('#pj-one-view', { state: 'visible' });
    if ((await shown(p.locator('#pj-one-name'))).trim() !== 'Settings Drive Renamed') die('the project page missed the rename');

    // And a no-change save says so instead of lying "Saved."
    await p.click('#pj-settings-link');
    await p.click('#pjs-save');
    await p.waitForFunction(() => { const m = document.getElementById('pjs-msg'); return m.getBoundingClientRect().height > 0 && m.innerText.trim() === 'Nothing has changed.'; }, { timeout: 5000 });

    if (errs.length) die('page errors: ' + errs.join(' | '));
    console.log('PJSETTINGS DRIVE OK: door, paint, parent sentence, save round trip, honest no-op, relocated blocks present, no path on the project page, 0 page errors; shots in ' + OUT);
  } finally {
    await b.close();
    srv.kill();
  }
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
