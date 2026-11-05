/* kosmos#7968: a project given a new name is offered a rename of its folder, in its settings. A project whose folder
 * already matches is not offered it; a name already taken is refused in the board's own sentence; the right one renames
 * the folder on disk, and the offer goes away.
 * Run: NODE_PATH=$HOME/work/pw-runtime/node_modules node docs/browser-checks/render-rename-folder-7968.js
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
  for (const k of ['DATA', 'WORKERS', 'LAUNCH', 'PROJECTS']) roots[k] = made('rnf-' + k.toLowerCase() + '-');
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
    const fixture = await p.evaluate(async () => {
      const out = {};
      for (const [name, to] of [['Starter Name', 'Launch Plan'], ['Matches Already', null]]) {
        const r = await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
        if (!r.ok) throw new Error('fixture create failed: ' + name);
        const j = await r.json();
        const made = j.project || j;
        if (to) {
          const e = await fetch('/api/project/' + encodeURIComponent(made.id), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: to }) });
          if (!e.ok) throw new Error('fixture rename failed: ' + name);
        }
        out[to || name] = made;
      }
      return out;
    });
    const moved = fixture['Launch Plan'];
    const taken = path.join(roots.PROJECTS, 'Launch Plan');
    fs.writeFileSync(path.join(moved.folder, 'work.txt'), 'mine');

    // CONTROL: a project whose folder matches its name is not offered it.
    await openSettings('Matches Already');
    await p.waitForTimeout(400);
    chk(!(await p.isVisible('#pjs-rename-folder')), 'CONTROL: a folder that already matches is not offered a rename');

    await p.reload({ waitUntil: 'networkidle' });
    if (await p.isVisible('#firstrun')) await p.keyboard.press('Escape');
    await openSettings('Launch Plan');
    await p.waitForSelector('#pjs-rename-folder', { state: 'visible', timeout: 8000 });
    const offer = (await shown(p.locator('#pjs-rename-folder-text'))).trim();
    chk(offer === 'This project\'s folder is called Starter Name. You can rename it to Launch Plan to match. Anything outside Kosmos that uses the old name, like a shortcut, a script or a terminal open in it, will stop working.',
      'the offer names both folder names and what stops working', JSON.stringify(offer));

    // A folder made under that name after the page offered it: refused in plain words, nothing moves.
    fs.mkdirSync(taken);
    await p.click('#pjs-rename-folder-btn');
    await p.waitForFunction(() => /Not changed:/.test(document.getElementById('pjs-move-msg').textContent), null, { timeout: 8000 });
    const refused = (await shown(p.locator('#pjs-move-msg'))).trim();
    chk(refused === 'Not changed: there is already something called Launch Plan in that folder.', 'a name already taken is refused in plain words', JSON.stringify(refused));
    chk(fs.existsSync(path.join(moved.folder, 'work.txt')), 'and the work stayed where it was');
    chk(await p.evaluate(() => document.activeElement === document.getElementById('pjs-rename-folder-btn')), 'and the keyboard is back on the button');

    // The way clear: the folder is renamed, the offer goes away, the page reads the new folder.
    fs.rmdirSync(taken);
    await p.click('#pjs-rename-folder-btn');
    await p.waitForFunction(() => /^Done/.test(document.getElementById('pjs-move-msg').textContent), null, { timeout: 8000 });
    const said = (await shown(p.locator('#pjs-move-msg'))).trim();
    chk(said === 'Done. The folder is now called Launch Plan.', 'the rename is confirmed', JSON.stringify(said));
    await p.waitForFunction(() => document.getElementById('pjs-rename-folder').hidden === true, null, { timeout: 8000 });
    chk(!(await p.isVisible('#pjs-rename-folder')), 'the offer is gone once the folder matches');
    chk((await shown(p.locator('#pjs-folder-name'))).trim() === 'Launch Plan', 'the settings show the new folder name');
    chk(fs.readFileSync(path.join(taken, 'work.txt'), 'utf8') === 'mine', 'the work moved with it');
    chk(!fs.existsSync(moved.folder), 'and the old folder is gone');
    const stored = await p.evaluate(async (id) => { const r = await fetch('/api/project/' + encodeURIComponent(id)); return (await r.json()).project; }, moved.id);
    chk(stored && stored.id === moved.id && stored.folder === taken, 'the same project now records the new folder', JSON.stringify(stored && { id: stored.id, folder: stored.folder }));

    // The path a person takes (#7968, found by a reviewer of What's New): rename on the page and press Save.
    await p.evaluate(async () => {
      for (const name of ['Saved Start', 'Offer Showing']) {
        const r = await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
        if (!r.ok) throw new Error('fixture create failed');
        if (name === 'Offer Showing') {
          const j = await r.json(); const made = j.project || j;
          const e = await fetch('/api/project/' + encodeURIComponent(made.id), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Offer Renamed' }) });
          if (!e.ok) throw new Error('fixture rename failed');
        }
      }
    });
    await p.reload({ waitUntil: 'networkidle' });
    if (await p.isVisible('#firstrun')) await p.keyboard.press('Escape');
    // CONTROL: the offer IS showing, and this Save changes no name, so it still returns to the project.
    await openSettings('Offer Renamed');
    await p.waitForSelector('#pjs-rename-folder', { state: 'visible', timeout: 8000 });
    await p.fill('#pjs-desc', 'a description, and nothing else');
    await p.click('#pjs-save');
    await p.waitForSelector('#pj-settings-view', { state: 'hidden', timeout: 8000 }).catch(() => {});
    chk(!(await p.isVisible('#pj-settings-view')), 'CONTROL: with an offer showing, a Save that changes no name still returns to the project');
    await p.reload({ waitUntil: 'networkidle' });
    if (await p.isVisible('#firstrun')) await p.keyboard.press('Escape');
    await openSettings('Saved Start');
    await p.setViewportSize({ width: 390, height: 700 });   // a phone: the offer is furthest from Save here
    await p.fill('#pjs-name', 'Saved Other');
    await p.focus('#pjs-save');
    await p.keyboard.press('Enter');   // by the key, so the next press is the second press of it
    await p.waitForFunction(() => !document.getElementById('pjs-rename-folder').hidden, null, { timeout: 8000 });
    const inView = () => p.evaluate(() => { const r = document.getElementById('pjs-rename-folder-btn').getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight; });
    await p.waitForFunction(() => document.activeElement === document.getElementById('pjs-rename-folder-text'), null, { timeout: 8000 });
    chk(await inView(), 'after a Save that renamed it, the offer is on screen, on a phone-sized page');
    chk((await shown(p.locator('#pjs-move-msg'))).trim() === 'Saved.', 'and it says the Save worked, since that line is out of view');
    await p.keyboard.press('Enter');
    await p.waitForTimeout(400);
    chk(fs.existsSync(path.join(roots.PROJECTS, 'Saved Start')), 'a second press of the key does not rename the folder');
    await p.waitForTimeout(1600);
    chk(await p.isVisible('#pj-settings-view') && await inView(), 'and it is still there after the time a Save would have moved away');
    await p.evaluate(() => { pjView('one'); document.getElementById('pj-settings-link').click(); });
    await p.waitForSelector('#pjs-rename-folder', { state: 'visible', timeout: 8000 });
    chk((await p.locator('#pjs-move-msg').textContent()).trim() === '', 'coming back to settings later, the old Saved. is gone and the offer is still there');
    await p.click('#pjs-rename-folder-btn');
    await p.waitForFunction(() => /^Done/.test(document.getElementById('pjs-move-msg').textContent), null, { timeout: 8000 });
    chk(fs.existsSync(path.join(roots.PROJECTS, 'Saved Other')), 'pressing it renames the folder');
    chk(errs.length === 0, 'no page errors', JSON.stringify(errs));
  } catch (e) {
    chk(false, 'the check ran to the end', String((e && e.stack) || e).slice(0, 400));
  } finally {
    await b.close();
    await stop();
  }
  console.log(fail.length ? 'render-rename-folder-7968: ' + fail.length + ' FAILED' : 'render-rename-folder-7968: OK (a renamed project\'s folder can be renamed to match)');
  process.exit(fail.length ? 1 : 0);
})();
