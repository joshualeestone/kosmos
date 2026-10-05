/* kosmos#5340: a project whose folder was moved on this computer is pointed at its new place from its settings.
 * The "Move project folder" form shows only when the recorded folder is not there; a wrong path is refused with the
 * board's own sentence; the right one saves, the form goes away, and the project reads its folder again.
 * Run: NODE_PATH=$HOME/work/pw-runtime/node_modules node docs/browser-checks/render-movefolder-5340.js
 * Sandboxed roots, removed on exit; kills only what it starts. */
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const shown = async (loc) => ((await loc.boundingBox()) ? loc.innerText() : '');

const REPO = path.resolve(__dirname, '..', '..');
/* #5325: every folder this check makes is removed when it exits. */
const MADE = [];
const made = (prefix) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); MADE.push(d); return d; };
process.on('exit', () => { for (const d of MADE) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));
const freePort = () => Number(require('node:child_process').execFileSync(process.execPath, ['-e', "const s=require('node:net').createServer();s.listen(0,'127.0.0.1',()=>{process.stdout.write(String(s.address().port));s.close();})"]).toString());
const PORT = freePort();

(async () => {
  const roots = {};
  for (const k of ['DATA', 'WORKERS', 'LAUNCH', 'PROJECTS']) roots[k] = made('mvf-' + k.toLowerCase() + '-');
  const srv = spawn('node', ['server.js'], {
    cwd: REPO,
    env: { ...process.env, PORT: String(PORT), AGENT_WORKFORCE_RELEASE_BASE: 'http://127.0.0.1:9/dist',
      AGENT_WORKFORCE_DATA: roots.DATA, AGENT_WORKFORCE_WORKERS: roots.WORKERS,
      AGENT_WORKFORCE_LAUNCH: roots.LAUNCH, AGENT_WORKFORCE_PROJECTS: roots.PROJECTS,
      AGENT_WORKFORCE_TMUX_BIN: path.join(REPO, 'test-support', 'fake-tmux.sh') }, // sandboxed whole (#634)
    stdio: 'ignore',
  });
  const stop = () => new Promise((r) => { if (srv.exitCode !== null || srv.signalCode !== null) r(); else { srv.once('exit', r); srv.kill(); setTimeout(r, 5000); } });
  const fail = [];
  const chk = (ok, label, extra) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : '')); if (!ok) fail.push(label); };
  await new Promise((r) => setTimeout(r, 1200));

  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  const openSettings = async (name) => {
    await p.click('[data-tab="projects"]');
    await p.locator('#pj-list').getByText(name).first().click();
    await p.waitForSelector('#pj-settings-link', { state: 'visible' });
    await p.click('#pj-settings-link');
    await p.waitForSelector('#pj-settings-view', { state: 'visible' });
  };
  try {
    await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
    if (await p.isVisible('#firstrun')) await p.keyboard.press('Escape');
    const made2 = await p.evaluate(async () => {
      const out = {};
      for (const name of ['Moved Project', 'Still Here']) {
        const r = await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
        if (!r.ok) throw new Error('fixture create failed: ' + name);
        const j = await r.json();
        out[name] = j.project || j;
      }
      return out;
    });
    const moved = made2['Moved Project'];
    const oldFolder = moved.folder;
    const newFolder = path.join(roots.PROJECTS, 'Moved Project, new place');
    fs.renameSync(oldFolder, newFolder);   // the person moved the folder on this computer

    // CONTROL: a project whose folder is there shows no move form.
    await openSettings('Still Here');
    await p.waitForTimeout(400);
    chk(!(await p.isVisible('#pjs-move')), 'CONTROL: a project whose folder is there offers no move');

    await p.reload({ waitUntil: 'networkidle' });
    if (await p.isVisible('#firstrun')) await p.keyboard.press('Escape');
    await openSettings('Moved Project');
    await p.waitForSelector('#pjs-move', { state: 'visible', timeout: 8000 });
    const state = (await shown(p.locator('#pj-one-folder-state'))).trim();
    chk(/not there any more, or it was moved/.test(state), 'the settings say the folder is not there', JSON.stringify(state));
    const label = (await shown(p.locator('label[for="pjs-move-path"]'))).trim();
    chk(/paste where it is now/.test(label) && (await shown(p.locator('#pjs-move-btn'))).trim() === 'Move project folder',
      'the move form is offered with its label and button', JSON.stringify(label));

    // A wrong path is refused with the board's own sentence, and nothing moves.
    await p.fill('#pjs-move-path', path.join(roots.PROJECTS, 'nowhere at all'));
    await p.click('#pjs-move-btn');
    await p.waitForFunction(() => /Not moved:/.test(document.getElementById('pjs-move-msg').textContent), null, { timeout: 8000 });
    const refused = (await shown(p.locator('#pjs-move-msg'))).trim();
    chk(refused === 'Not moved: there is no folder at that path.', 'a wrong path is refused in plain words', JSON.stringify(refused));

    // The right path saves: the form goes away and the project reads its folder again.
    await p.fill('#pjs-move-path', newFolder);
    await p.click('#pjs-move-btn');
    await p.waitForFunction(() => /^Moved/.test(document.getElementById('pjs-move-msg').textContent), null, { timeout: 8000 });
    const said = (await shown(p.locator('#pjs-move-msg'))).trim();
    chk(said === 'Moved. The agents on this project were told where it is now.', 'the move is confirmed', JSON.stringify(said));
    await p.waitForFunction(() => document.getElementById('pjs-move').hidden === true, null, { timeout: 8000 });
    chk(true, 'the move form is gone once the folder is there');
    chk((await shown(p.locator('#pj-one-folder-state'))).trim() === '', 'the folder warning is gone');
    const stored = await p.evaluate(async (id) => { const r = await fetch('/api/project/' + encodeURIComponent(id)); return (await r.json()).project; }, moved.id);
    chk(stored && stored.folder === newFolder && stored.folderState && stored.folderState.state === 'readable',
      'the project now records the new folder, and reads it', JSON.stringify(stored && { folder: stored.folder, state: stored.folderState }));
    chk(errs.length === 0, 'no page errors', JSON.stringify(errs));
  } catch (e) {
    chk(false, 'the check ran to the end', String((e && e.stack) || e).slice(0, 400));
  } finally {
    await b.close();
    await stop();
  }
  console.log(fail.length ? 'render-movefolder-5340: ' + fail.length + ' FAILED' : 'render-movefolder-5340: OK (a moved project folder is pointed at its new place from settings)');
  process.exit(fail.length ? 1 : 0);
})();
