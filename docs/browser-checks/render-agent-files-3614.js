// Browser-check-surface: d-files d-files-list d-files-msg d-files-finder
'use strict';
/**
 * The agent page's Files block, on a screen (#3614).
 *
 * What this pins, and why each line can fail:
 *  - the block is on screen DIRECTLY UNDER the four-pack, in the same left column (its top is below
 *    the pack's bottom and the two overlap horizontally), in both themes and at a narrow width,
 *  - an agent with files shows one row per file, newest first, with a date and a size,
 *  - an agent with no Files folder yet shows the empty sentence and no rows,
 *  - clicking a row reaches the opener with that file (the opener is stubbed, nothing opens),
 *  - "Open in Finder" makes the folder on first use and reaches the opener with it.
 *
 * Not part of `npm test` -- it needs a browser. See README.md in this directory.
 *
 *   node docs/browser-checks/render-agent-files-3614.js            # headed
 *   HEADED=0 node docs/browser-checks/render-agent-files-3614.js   # headless
 */
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-agentfiles-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-agentfiles-workers-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-agentfiles-projects-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-agentfiles-launch-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-agentfiles-config-'));
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';
const SANDBOXES = [SANDBOX, process.env.AGENT_WORKFORCE_WORKERS, process.env.AGENT_WORKFORCE_PROJECTS,
  process.env.AGENT_WORKFORCE_LAUNCH, process.env.AGENT_WORKFORCE_CONFIG_ROOT];

const { chromium } = require('playwright');
const fleet = require('../../test-support/fleet');
const srv = require('../../server.js');
const projects = require('../../engine/projects');
const dmfiles = require('../../engine/dmfiles');

const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

(async () => {
  fleet.install([
    fleet.agent('april', { state: 'idle', displayName: 'April', role: 'a researcher' }),
    fleet.agent('mikey', { state: 'idle', displayName: 'Mikey', role: 'a bookkeeper' }),
  ]);
  // April has saved two files; Mikey has saved nothing (no Files folder at all).
  const aprilFiles = dmfiles.filesDir('april');
  fs.mkdirSync(aprilFiles, { recursive: true });
  fs.writeFileSync(path.join(aprilFiles, 'older-notes.md'), 'n');
  fs.utimesSync(path.join(aprilFiles, 'older-notes.md'), new Date('2026-01-01'), new Date('2026-01-01'));
  fs.writeFileSync(path.join(aprilFiles, 'report.pdf'), 'x'.repeat(4096));
  const opened = [];
  projects.setRevealRunner((file, args) => { opened.push(args[0]); return { ok: true }; });
  projects.setRevealPlatform('darwin');

  const server = await srv.start(0);
  const URL = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  const openAgent = async (page, name) => {
    await page.goto(URL, { waitUntil: 'networkidle' });
    if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
    await page.waitForSelector('[data-agent="' + name + '"]', { timeout: 8000 });
    await page.click('[data-agent="' + name + '"]');
    await page.waitForSelector('#panel-detail:not([hidden])');
    await page.waitForFunction(() => {
      const m = document.getElementById('d-files-msg'); const l = document.getElementById('d-files-list');
      return (m && m.textContent) || (l && l.children.length);
    }, null, { timeout: 8000 }).catch(() => {});
  };
  const read = () => {
    const vis = (n) => !!(n && (n.offsetWidth || n.offsetHeight || n.getClientRects().length));
    const box = document.getElementById('d-files');
    const pack = document.querySelector('#d-nav .dnav-pack');
    const b = box ? box.getBoundingClientRect() : null;
    const p = pack ? pack.getBoundingClientRect() : null;
    return {
      visible: vis(box),
      below: !!(b && p && b.top >= p.bottom - 1),
      overlap: !!(b && p && b.left < p.right && b.right > p.left),
      rows: [...document.querySelectorAll('#d-files-list .pj-doc')].map((r) => ({ name: r.dataset.doc, meta: (r.querySelector('.pj-doc-w') || {}).textContent || '' })),
      msg: (document.getElementById('d-files-msg') || {}).textContent || '',
      finder: vis(document.getElementById('d-files-finder')),
    };
  };
  try {
    for (const [theme, width] of [['light', 1400], ['dark', 1400], ['light', 760]]) {
      const tag = `[${theme} ${width}]`;
      const page = await browser.newPage({ viewport: { width, height: 950 }, colorScheme: theme });
      await openAgent(page, 'april');
      const a = await page.evaluate(read);
      chk(a.visible && a.finder, `${tag} the Files block and its Finder button are on screen`, JSON.stringify(a));
      chk(a.below && a.overlap, `${tag} the Files block sits directly under the four-pack, in its column`, JSON.stringify({ below: a.below, overlap: a.overlap }));
      chk(JSON.stringify(a.rows.map((r) => r.name)) === JSON.stringify(['report.pdf', 'older-notes.md']), `${tag} April's files are listed newest first`, JSON.stringify(a.rows));
      chk(a.rows.length > 0 && /·/.test(a.rows[0].meta) && /\d+(\.\d+)?\s?(B|KB|MB)$/.test(a.rows[0].meta), `${tag} a row shows a date and a size`, JSON.stringify(a.rows[0]));
      if (theme === 'light' && width === 1400) {
        const before = opened.length;
        await page.click('#d-files-list .pj-doc[data-doc="report.pdf"]');
        await page.waitForTimeout(500);
        chk(opened.length === before + 1 && /report\.pdf$/.test(opened[opened.length - 1] || ''), `${tag} clicking a row reaches the opener with that file`, JSON.stringify(opened.slice(before)));
      }
      await page.close();

      const page2 = await browser.newPage({ viewport: { width, height: 950 }, colorScheme: theme });
      await openAgent(page2, 'mikey');
      const m = await page2.evaluate(read);
      chk(m.rows.length === 0 && /Nothing here yet/.test(m.msg), `${tag} an agent with no Files folder shows the empty sentence`, JSON.stringify(m));
      if (theme === 'light' && width === 1400) {
        const before = opened.length;
        await page2.click('#d-files-finder');
        await page2.waitForTimeout(600);
        const made = dmfiles.filesDir('mikey');
        chk(fs.existsSync(made) && fs.lstatSync(made).isDirectory(), `${tag} Open in Finder makes the Files folder on first use`, made);
        chk(opened.length === before + 1 && opened[opened.length - 1] === made, `${tag} Open in Finder reaches the opener with that folder`, JSON.stringify(opened.slice(before)));
        fs.rmSync(made, { recursive: true, force: true }); // the other passes start from "no folder" again
      }
      await page2.close();
    }
  } finally {
    await browser.close();
    server.close();
    projects.setRevealPlatform(null);
    projects.setRevealRunner(null);
    for (const d of SANDBOXES) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
  }
  console.log(fail.length ? `\nFAIL: ${fail.length}` : '\nAll checks passed');
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
