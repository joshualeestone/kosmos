// Browser-check-surface: pjs-notify pj-head-notify
'use strict';
/* kosmos#7210 (Josh, 2026-10-26: "mute projects so that I can select the notifications on a project-by-project
 * basis"): the project settings' notification choice, All / Mentions only / Muted, on the shipped page against a real,
 * sandboxed board.
 *
 * ASSERTS (light and dark):
 *   N1  a new project reads All: the choice paints All and the title carries no label.
 *   N2  pressing Muted saves it on the board (GET /api/projects reads muted), says Saved., and the title shows "Muted".
 *   N3  the keyboard moves and chooses (ArrowLeft from Muted is Mentions only), and the board follows.
 *   N4  a reload keeps it (the board's record, not the browser's).
 *   N5  the title's label opens the project's settings.
 *   N6  back to All: the label goes and the board stores nothing (absent reads as all).
 *   N7  the words under the choice change with it.
 *   no page errors.
 *
 * Run: NODE_PATH=$HOME/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-projmute-7210.js
 */
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const REPO = path.resolve(__dirname, '..', '..');
const OUT = process.env.SHOT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'projmute-7210-shots-'));
const freePort = () => Number(require('node:child_process').execFileSync(process.execPath, ['-e', "const s=require('node:net').createServer();s.listen(0,'127.0.0.1',()=>{process.stdout.write(String(s.address().port));s.close();})"], { encoding: 'utf8' }));
const PORT = freePort();

let failures = 0, ran = 0;
const ok = (n) => { ran++; console.log('PASS  ' + n); };
const bad = (n, why) => { ran++; failures++; console.log('FAIL  ' + n + '  --  ' + why); };
const check = (cond, n, why) => (cond ? ok(n) : bad(n, why));

(async () => {
  const roots = {};
  for (const k of ['DATA', 'WORKERS', 'LAUNCH', 'PROJECTS']) roots[k] = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-' + k.toLowerCase() + '-'));
  const srv = spawn('node', ['server.js'], {
    cwd: REPO,
    env: { ...process.env, PORT: String(PORT), AGENT_WORKFORCE_RELEASE_BASE: 'http://127.0.0.1:9/dist',
      AGENT_WORKFORCE_DATA: roots.DATA, AGENT_WORKFORCE_WORKERS: roots.WORKERS,
      AGENT_WORKFORCE_LAUNCH: roots.LAUNCH, AGENT_WORKFORCE_PROJECTS: roots.PROJECTS,
      AGENT_WORKFORCE_TMUX_BIN: path.join(REPO, 'test-support', 'fake-tmux.sh') },
    stdio: 'ignore',
  });
  await new Promise((r) => setTimeout(r, 1200));
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    for (const scheme of ['light', 'dark']) {
      const p = await browser.newPage({ viewport: { width: 1200, height: 900 }, colorScheme: scheme });
      const errs = [];
      p.on('pageerror', (e) => errs.push(String(e)));
      const t = (n) => scheme + ' ' + n;
      await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
      if (await p.isVisible('#firstrun')) await p.keyboard.press('Escape');
      const name = 'Quiet Room ' + scheme;
      const id = await p.evaluate(async (nm) => {
        const r = await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: nm }) });
        if (!r.ok) throw new Error('fixture create failed');
        const j = await r.json();
        return (j.project && j.project.id) || null;
      }, name);
      const level = () => p.evaluate(async (pid) => {
        const j = await (await fetch('/api/projects', { cache: 'no-store' })).json();
        const row = (j.projects || []).find((x) => x.id === pid);
        return row ? row.notify : 'missing';
      }, id);
      const checked = () => p.evaluate(() => { const b = document.querySelector('#pjs-notify [aria-checked="true"]'); return b ? b.dataset.notify : null; });
      const openSettings = async () => {
        await p.click('[data-tab="projects"]');
        await p.locator('#pj-list').getByText(name).first().click();
        await p.waitForSelector('#pj-settings-link', { state: 'visible' });
        await p.click('#pj-settings-link');
        await p.waitForSelector('#pjs-notify', { state: 'visible' });
      };

      await openSettings();
      check((await checked()) === 'all' && (await level()) === 'all', t('N1: a new project reads All'), JSON.stringify({ checked: await checked(), level: await level() }));
      check(await p.locator('#pj-head-notify').isHidden(), t('N1: the title carries no label on All'), 'label shown');
      const hintAll = await p.locator('#pjs-notify-hint').innerText();
      if (scheme === 'light') await p.locator('#pjs-notify').screenshot({ path: path.join(OUT, 'choice-all-' + scheme + '.png') });

      await p.click('#pjs-notify [data-notify="muted"]');
      await p.waitForFunction(() => document.getElementById('pjs-notify-msg').textContent === 'Saved.', null, { timeout: 5000 }).catch(() => {});
      check((await level()) === 'muted', t('N2: pressing Muted saves it on the board'), String(await level()));
      check((await p.locator('#pjs-notify-msg').innerText()) === 'Saved.', t('N2: it says Saved.'), await p.locator('#pjs-notify-msg').innerText());
      const hintMuted = await p.locator('#pjs-notify-hint').innerText();
      check(hintMuted !== hintAll && /unread count still shows/.test(hintMuted), t('N7: the words under the choice change with it'), hintMuted);
      await p.screenshot({ path: path.join(OUT, 'settings-muted-' + scheme + '.png') });

      await p.focus('#pjs-notify [data-notify="muted"]');
      await p.keyboard.press('ArrowLeft');
      await p.waitForFunction(() => document.getElementById('pjs-notify-msg').textContent === 'Saved.', null, { timeout: 5000 }).catch(() => {});
      await p.waitForTimeout(300);
      const focused = await p.evaluate(() => document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.notify : null);
      check((await checked()) === 'mentions' && focused === 'mentions' && (await level()) === 'mentions', t('N3: ArrowLeft moves and chooses Mentions only, and the board follows'),
        JSON.stringify({ checked: await checked(), focused, level: await level() }));

      await p.reload({ waitUntil: 'networkidle' });
      if (await p.isVisible('#firstrun')) await p.keyboard.press('Escape');
      await p.click('[data-tab="projects"]');
      await p.locator('#pj-list').getByText(name).first().click();
      await p.waitForSelector('#pj-head-notify', { state: 'visible', timeout: 5000 }).catch(() => {});
      const label = (await p.locator('#pj-head-notify').isVisible()) ? (await p.locator('#pj-head-notify').innerText()).trim() : '';
      check(label === 'Mentions only', t('N4: a reload keeps it, and the title says so'), JSON.stringify(label));
      await p.screenshot({ path: path.join(OUT, 'title-mentions-' + scheme + '.png') });

      await p.click('#pj-head-notify');
      check(await p.locator('#pjs-notify').isVisible().catch(() => false), t('N5: the title\'s label opens the project\'s settings'), 'settings not shown');
      check((await checked()) === 'mentions', t('N4: the settings paint the saved level'), String(await checked()));

      await p.click('#pjs-notify [data-notify="all"]');
      await p.waitForFunction(() => document.getElementById('pjs-notify-msg').textContent === 'Saved.', null, { timeout: 5000 }).catch(() => {});
      check((await level()) === 'all', t('N6: back to All on the board'), String(await level()));
      await p.click('#pj-settings-back').catch(() => {});
      await p.waitForTimeout(300);
      check(await p.locator('#pj-head-notify').isHidden(), t('N6: the title\'s label goes on All'), 'label still shown');

      check(!errs.length, t('no page errors'), errs.join(' | '));
      await p.close();
    }
  } catch (e) {
    bad('the check itself', String((e && e.message) || e));
  } finally {
    await browser.close().catch(() => {});
    srv.kill();
  }
  console.log('shots: ' + OUT);
  if (ran < 22) { console.log('projmute: only ' + ran + ' checks ran, so this proved nothing'); process.exit(1); }
  if (failures) { console.log('projmute: ' + failures + ' FAILED'); process.exit(1); }
  console.log('all checks passed');
})();
