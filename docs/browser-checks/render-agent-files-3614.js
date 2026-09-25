// Browser-check-surface: d-files d-files-list d-files-msg d-files-finder d-files-all d-sec-files d-filesall-list dnav-lab dnav-pack dnav-dm
'use strict';
/**
 * The agent page's Files block, on a screen (#3614), as #3757 reshaped it (Josh, 0.6.94).
 *
 * What this pins, and why each line can fail:
 *  - the block is on screen DIRECTLY UNDER the four-pack, in the same left column (its top is below
 *    the pack's bottom and the two overlap horizontally), in both themes and at a narrow width,
 *  - an agent with files shows one row per file, newest first, with a date and a size, and NO
 *    "Open in Finder" there (#3757: it moved to the Files screen),
 *  - #3757: an agent with no files shows no Files section at all (no empty sentence),
 *  - #3757: View All shows, at the right of the "Files" header, only when there are more files
 *    than the list shows (10); it opens the Files screen, which lists them all with Open in Finder,
 *  - clicking a row reaches the opener with that file (the opener is stubbed, nothing opens),
 *  - "Open in Finder" makes the folder on first use and reaches the opener with it,
 *  - #3757: the nav's labels are the agent title's size (#d-meta), and its boxes are shorter,
 *    with the icons and the two-across grid unchanged.
 * Screenshots to argv[2] when given.
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
    fleet.agent('rex', { state: 'idle', displayName: 'Rex', role: 'an archivist' }),
  ]);
  // Rex has saved more than the list shows (10), so his list gets View All.
  const rexFiles = dmfiles.filesDir('rex');
  fs.mkdirSync(rexFiles, { recursive: true });
  for (let i = 0; i < 14; i += 1) {
    const f = path.join(rexFiles, 'rex-' + String(i).padStart(2, '0') + '.txt');
    fs.writeFileSync(f, 'r');
    fs.utimesSync(f, new Date(Date.UTC(2026, 0, 1 + i)), new Date(Date.UTC(2026, 0, 1 + i)));
  }
  const SHOTS = process.argv[2] || null;
  const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png') }); };
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
    // The list has painted (rows), or the painter has decided there is nothing to show (hidden).
    await page.waitForTimeout(600);
    await page.waitForFunction(() => {
      const m = document.getElementById('d-files-msg'); const l = document.getElementById('d-files-list');
      return (m && m.textContent) || (l && l.children.length) || document.getElementById('d-files').hidden;
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
      all: vis(document.getElementById('d-files-all')),
    };
  };
  try {
    for (const [theme, width] of [['light', 1400], ['dark', 1400], ['light', 760]]) {
      const tag = `[${theme} ${width}]`;
      const page = await browser.newPage({ viewport: { width, height: 950 }, colorScheme: theme });
      await openAgent(page, 'april');
      const a = await page.evaluate(read);
      chk(a.visible, `${tag} the Files block is on screen`, JSON.stringify(a));
      chk(!a.finder && !a.all, `${tag} #3757: no Open in Finder in the sidebar, and no View All when every file is listed`, JSON.stringify(a));
      chk(a.below && a.overlap, `${tag} the Files block sits directly under the four-pack, in its column`, JSON.stringify({ below: a.below, overlap: a.overlap }));
      chk(JSON.stringify(a.rows.map((r) => r.name)) === JSON.stringify(['report.pdf', 'older-notes.md']), `${tag} April's files are listed newest first`, JSON.stringify(a.rows));
      chk(a.rows.length > 0 && /·/.test(a.rows[0].meta) && /\d+(\.\d+)?\s?(B|KB|MB)$/.test(a.rows[0].meta), `${tag} a row shows a date and a size`, JSON.stringify(a.rows[0]));
      if (theme === 'light' && width === 1400) {
        await shot(page, '3757-2-a-few-files');
        // #3757: the nav's labels are the title line's size; the boxes are shorter; icons unchanged.
        const nav = await page.evaluate(() => {
          const px = (el) => parseFloat(getComputedStyle(el).fontSize);
          const meta = document.getElementById('d-meta');
          const dm = document.querySelector('#d-nav .dnav-dm');
          const packBtn = document.querySelector('#d-nav .dnav-pack button');
          const labs = [...document.querySelectorAll('#d-nav .dnav-lab')].map(px);
          const icons = [...document.querySelectorAll('#d-nav .dnav-ico svg')].map((s) => Math.round(s.getBoundingClientRect().width));
          const pack = document.querySelector('#d-nav .dnav-pack');
          const cols = getComputedStyle(pack).gridTemplateColumns.split(' ').length;
          const wrapped = [...document.querySelectorAll('#d-nav .dnav-lab')].some((l) => l.scrollWidth > l.clientWidth + 1);
          return { metaPx: px(meta), labs, dmH: Math.round(dm.getBoundingClientRect().height), packH: Math.round(packBtn.getBoundingClientRect().height),
            packW: Math.round(packBtn.getBoundingClientRect().width), icons, cols, wrapped };
        });
        chk(nav.labs.length === 5 && nav.labs.every((x) => x === nav.metaPx), `${tag} #3757: every nav label is the agent title's size`, JSON.stringify(nav));
        // Before #3757, measured on main: Direct Message 84px, the others 73px; labels 17px and 14px.
        chk(nav.dmH <= 66 && nav.packH <= 58, `${tag} #3757: the nav boxes are shorter (Direct Message at most 66px, the others at most 58px)`, JSON.stringify(nav));
        chk(JSON.stringify(nav.icons) === JSON.stringify([24, 20, 20, 20, 20]) && nav.cols === 2 && !nav.wrapped, `${tag} #3757: icons unchanged (24 and 20), the grid stays two across, no label is cut`, JSON.stringify(nav));
        const before = opened.length;
        await page.click('#d-files-list .pj-doc[data-doc="report.pdf"]');
        await page.waitForTimeout(500);
        chk(opened.length === before + 1 && /report\.pdf$/.test(opened[opened.length - 1] || ''), `${tag} clicking a row reaches the opener with that file`, JSON.stringify(opened.slice(before)));
      }
      await page.close();

      const page2 = await browser.newPage({ viewport: { width, height: 950 }, colorScheme: theme });
      await openAgent(page2, 'mikey');
      const m = await page2.evaluate(read);
      chk(m.rows.length === 0 && !m.visible && m.msg === '', `${tag} #3757: an agent with no files shows no Files section at all`, JSON.stringify(m));
      if (theme === 'light' && width === 1400) {
        await shot(page2, '3757-1-no-files');
        const before = opened.length;
        // Open in Finder lives on the Files screen now; with no files there is no View All, so the
        // screen is reached as its section.
        await page2.evaluate(() => detailGo('files'));
        await page2.waitForTimeout(300);
        await page2.click('#d-files-finder');
        await page2.waitForTimeout(600);
        const made = dmfiles.filesDir('mikey');
        chk(fs.existsSync(made) && fs.lstatSync(made).isDirectory(), `${tag} Open in Finder makes the Files folder on first use`, made);
        chk(opened.length === before + 1 && opened[opened.length - 1] === made, `${tag} Open in Finder reaches the opener with that folder`, JSON.stringify(opened.slice(before)));
        fs.rmSync(made, { recursive: true, force: true }); // the other passes start from "no folder" again
      }
      await page2.close();

      // #3757: more files than the list shows: ten rows, View All at the right of the header, and
      // View All opens the Files screen with every file and Open in Finder.
      const page3 = await browser.newPage({ viewport: { width, height: 950 }, colorScheme: theme });
      await openAgent(page3, 'rex');
      const r = await page3.evaluate(() => {
        const vis = (n) => !!(n && (n.offsetWidth || n.offsetHeight || n.getClientRects().length));
        const all = document.getElementById('d-files-all');
        const h = document.getElementById('d-files-h').getBoundingClientRect();
        const a = all.getBoundingClientRect();
        const sec = document.getElementById('d-files').getBoundingClientRect();
        return { rows: document.querySelectorAll('#d-files-list .pj-doc').length, all: vis(all), text: all.textContent.trim(),
          sameRow: a.top < h.bottom && a.bottom > h.top, right: a.left > h.right && sec.right - a.right < 24 };
      });
      chk(r.rows === 10 && r.all && r.text === 'View All', `${tag} #3757: more files than it lists: ten rows and View All`, JSON.stringify(r));
      chk(r.sameRow && r.right, `${tag} #3757: View All sits at the right of the Files header`, JSON.stringify(r));
      if (theme === 'light' && width === 1400) await shot(page3, '3757-3-more-files');
      await page3.click('#d-files-all');
      await page3.waitForTimeout(500);
      const sc = await page3.evaluate(() => {
        const vis = (n) => !!(n && (n.offsetWidth || n.offsetHeight || n.getClientRects().length));
        return { screen: vis(document.getElementById('d-sec-files')), talk: vis(document.getElementById('d-sec-talk')),
          rows: document.querySelectorAll('#d-filesall-list .pj-doc').length, finder: vis(document.getElementById('d-files-finder')),
          title: (document.getElementById('d-filesall-h') || {}).textContent, focus: document.activeElement && document.activeElement.id };
      });
      chk(sc.screen && !sc.talk && sc.rows === 14 && sc.finder && sc.title === 'Files', `${tag} #3757: View All opens the Files screen: every file, and Open in Finder`, JSON.stringify(sc));
      chk(sc.focus === 'd-sec-files', `${tag} #3757: focus moves to the Files screen`, JSON.stringify(sc));
      if (theme === 'light' && width === 1400) {
        await shot(page3, '3757-4-files-screen');
        const before = opened.length;
        await page3.click('#d-filesall-list .pj-doc[data-doc="rex-13.txt"]');
        await page3.waitForTimeout(400);
        chk(opened.length === before + 1 && /rex-13\.txt$/.test(opened[opened.length - 1] || ''), `${tag} #3757: a row on the Files screen opens that file`, JSON.stringify(opened.slice(before)));
      }
      await page3.close();
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
