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
 *  - #3757: View All shows at the right of the "Files" header and opens the Files screen, which lists
 *    them all with Open in Finder on a computer; #4088 hides that computer-side action on a phone;
 *    #3994: View All shows with ANY file, even one (Una), not only when there are more than the list shows (10),
 *  - a plain click on a PDF row opens the full-page preview and does not reach the opener (#4997), and a
 *    Cmd-click on the same row reaches the opener with that file (the opener is stubbed, nothing opens),
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
    fleet.agent('una', { state: 'idle', displayName: 'Una', role: 'a planner' }),
  ]);
  // #3994: Una has saved exactly ONE file, Josh's case on 0.6.99: View All must still show.
  const unaFiles = dmfiles.filesDir('una');
  fs.mkdirSync(unaFiles, { recursive: true });
  fs.writeFileSync(path.join(unaFiles, 'only-one.txt'), 'u');
  // Rex has saved more than the list shows (10): his list stops at ten, and his Files screen shows all 14.
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
    // #718: Talk deliberately hides the sidebar Files block on a phone so the conversation
    // starts first. Profile keeps the Files block on screen, which is the phone surface measured
    // in Raiden's table and lets this check exercise the real View All door.
    if (page.viewportSize().width <= 640) {
      await page.click('#d-nav button[data-go="profile"]');
      await page.waitForSelector('#d-sec-profile:not([hidden])');
    }
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
    for (const [theme, width] of [['light', 1400], ['dark', 1400], ['light', 760], ['light', 412], ['dark', 412]]) {
      const tag = `[${theme} ${width}]`;
      const page = await browser.newPage({ viewport: { width, height: 950 }, colorScheme: theme });
      await openAgent(page, 'april');
      const a = await page.evaluate(read);
      chk(a.visible, `${tag} the Files block is on screen`, JSON.stringify(a));
      chk(!a.finder && a.all, `${tag} #3757/#3994: no Open in Finder in the sidebar, and View All although every file is listed`, JSON.stringify(a));
      chk(a.below && a.overlap, `${tag} the Files block sits directly under the four-pack, in its column`, JSON.stringify({ below: a.below, overlap: a.overlap }));
      /* #4570 (Josh, 2026-09-29 10:46): View All here is the project page's small link, not a second
         heading. Compared with the project page's own Files View All in this page (same DOM, same theme),
         so it follows that link rather than a pinned pixel size. */
      const va = await page.evaluate(() => {
        const cs = (id) => { const c = getComputedStyle(document.getElementById(id)); return { size: c.fontSize, weight: c.fontWeight }; };
        return { agent: cs('d-files-all'), project: cs('pj-docs-all'), label: getComputedStyle(document.querySelector('.dfiles-head .dlab')).fontSize };
      });
      chk(va.agent.size === va.project.size && va.agent.weight === va.project.weight && parseFloat(va.agent.size) < 13,
        `${tag} #4570: View All is the project page's small link (same size and weight)`, JSON.stringify(va));
      chk(JSON.stringify(a.rows.map((r) => r.name)) === JSON.stringify(['report.pdf', 'older-notes.md']), `${tag} April's files are listed newest first`, JSON.stringify(a.rows));
      chk(a.rows.length > 0 && /·/.test(a.rows[0].meta) && /\d+(\.\d+)?\s?(B|KB|MB)$/.test(a.rows[0].meta), `${tag} a row shows a date and a size`, JSON.stringify(a.rows[0]));
      /* #3994 (Josh 2026-09-26): the Files block sits in the same white container as the project page's
         Files panel (it wears that panel's class): the surface colour, a 12px radius and the panel's
         padding, and it stands out from the column behind it. The list still fits inside it. */
      const card = await page.evaluate(() => {
        const s = document.getElementById('d-files');
        const cs = getComputedStyle(s);
        const probe = document.createElement('div'); probe.style.background = 'var(--k-surface)'; document.body.appendChild(probe);
        const surface = getComputedStyle(probe).backgroundColor; probe.remove();
        let p = s.parentElement; let behind = 'rgba(0, 0, 0, 0)';
        while (p && behind === 'rgba(0, 0, 0, 0)') { behind = getComputedStyle(p).backgroundColor; p = p.parentElement; }
        const list = document.getElementById('d-files-list');
        return { cls: s.classList.contains('pjcard'), bg: cs.backgroundColor, surface, behind, radius: cs.borderTopLeftRadius, padL: cs.paddingLeft,
          fits: list.scrollWidth <= list.clientWidth + 1 && s.scrollWidth <= s.clientWidth + 1 };
      });
      chk(card.cls && card.bg === card.surface && card.bg !== card.behind && card.radius === '12px' && card.padL === '16px' && card.fits,
        `${tag} #3994 the Files block is in the project Files panel's white container, and the list fits inside it`, JSON.stringify(card));
      if (theme === 'light' && width === 1400) {
        await shot(page, '3757-2-a-few-files');
        // #3757: the nav's labels are the title line's size; the boxes are shorter; icons unchanged.
        // #4550: three visible buttons now (Direct Message, then Profile and AI Settings).
        const nav = await page.evaluate(() => {
          const px = (el) => parseFloat(getComputedStyle(el).fontSize);
          const meta = document.getElementById('d-meta');
          const dm = document.querySelector('#d-nav .dnav-dm');
          const packBtn = document.querySelector('#d-nav .dnav-pack button');
          /* The boxes a person sees: #4433's Swarm Settings box is in the nav for every agent but shown only for a swarm. */
          const labs = [...document.querySelectorAll('#d-nav button:not([hidden]) .dnav-lab')].map(px);
          const icons = [...document.querySelectorAll('#d-nav button:not([hidden]) .dnav-ico svg')].map((s) => Math.round(s.getBoundingClientRect().width));
          const pack = document.querySelector('#d-nav .dnav-pack');
          const cols = getComputedStyle(pack).gridTemplateColumns.split(' ').length;
          const wrapped = [...document.querySelectorAll('#d-nav button:not([hidden]) .dnav-lab')].some((l) => l.scrollWidth > l.clientWidth + 1);
          return { metaPx: px(meta), labs, dmH: Math.round(dm.getBoundingClientRect().height), packH: Math.round(packBtn.getBoundingClientRect().height),
            packW: Math.round(packBtn.getBoundingClientRect().width), icons, cols, wrapped };
        });
        chk(nav.labs.length === 3 && nav.labs.every((x) => x === nav.metaPx), `${tag} #3757: every nav label is the agent title's size`, JSON.stringify(nav));
        // Before #3757, measured on main: Direct Message 84px, the others 73px; labels 17px and 14px.
        chk(nav.dmH <= 66 && nav.packH <= 58, `${tag} #3757: the nav boxes are shorter (Direct Message at most 66px, the others at most 58px)`, JSON.stringify(nav));
        chk(JSON.stringify(nav.icons) === JSON.stringify([24, 20, 20]) && nav.cols === 2 && !nav.wrapped, `${tag} #3757: icons unchanged (24 and 20), the grid stays two across, no label is cut`, JSON.stringify(nav));
        // #4997: a plain click on a PDF (or a picture) opens the full-page preview, not the computer's own app.
        let before = opened.length;
        await page.click('#d-files-list .pj-doc[data-doc="report.pdf"]');
        await page.waitForTimeout(500);
        const pv = await page.evaluate(() => { const b = document.getElementById('pv-preview'); return { open: !!b, name: b ? (b.querySelector('#pv-name') || {}).textContent : null }; });
        chk(pv.open && /report\.pdf$/.test(pv.name || '') && opened.length === before, `${tag} #4997: a plain click on a PDF row opens the preview, not the opener`, JSON.stringify({ pv, opened: opened.slice(before) }));
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
        chk(!(await page.$('#pv-preview')), `${tag} #4997: Escape closes the preview`, '');
        // The opener is still a modifier-click away (the preview leaves modified clicks to the row).
        before = opened.length;
        await page.click('#d-files-list .pj-doc[data-doc="report.pdf"]', { modifiers: ['Meta'] });
        await page.waitForTimeout(500);
        chk(opened.length === before + 1 && /report\.pdf$/.test(opened[opened.length - 1] || ''), `${tag} a Cmd-click on a row reaches the opener with that file`, JSON.stringify(opened.slice(before)));
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

      // #3994 (Josh, 16:14 on 0.6.99): ONE file, and View All still shows and leads to Open in Finder.
      const page1 = await browser.newPage({ viewport: { width, height: 950 }, colorScheme: theme });
      await openAgent(page1, 'una');
      const one = await page1.evaluate(() => {
        const vis = (n) => !!(n && (n.offsetWidth || n.offsetHeight || n.getClientRects().length));
        return { rows: document.querySelectorAll('#d-files-list .pj-doc').length, all: vis(document.getElementById('d-files-all')),
          text: ((document.getElementById('d-files-all') || {}).textContent || '').trim() };
      });
      chk(one.rows === 1 && one.all && one.text === 'View All', `${tag} #3994: one file, and View All shows`, JSON.stringify(one));
      if (one.all) {
        await page1.click('#d-files-all');
        await page1.waitForFunction(() => document.querySelectorAll('#d-filesall-list .pj-doc').length === 1, null, { timeout: 5000 }).catch(() => {});
        const oneSc = await page1.evaluate(() => {
          const vis = (n) => !!(n && (n.offsetWidth || n.offsetHeight || n.getClientRects().length));
          return { screen: vis(document.getElementById('d-sec-files')), rows: document.querySelectorAll('#d-filesall-list .pj-doc').length,
            finder: vis(document.getElementById('d-files-finder')) };
        });
        const finderExpected = width > 640;
        chk(oneSc.screen && oneSc.rows === 1 && oneSc.finder === finderExpected,
          `${tag} #3994/#4088: View All with one file opens the Files screen, with the computer-side Finder action hidden only on phone`, JSON.stringify(oneSc));
        if (theme === 'light' && width === 1400) await shot(page1, '3994-one-file-files-screen');
      }
      await page1.close();

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
        const rowHeights = [...document.querySelectorAll('#d-files-list .pj-doc')].map((el) => Math.round(el.getBoundingClientRect().height));
        return { rows: rowHeights.length, rowHeights, all: vis(all), text: all.textContent.trim(),
          allBox: { width: Math.round(a.width), height: Math.round(a.height) },
          sameRow: a.top < h.bottom && a.bottom > h.top, right: a.left > h.right && sec.right - a.right < 24 };
      });
      chk(r.rows === 10 && r.all && r.text === 'View All', `${tag} #3757: more files than it lists: ten rows and View All`, JSON.stringify(r));
      chk(r.sameRow && r.right, `${tag} #3757: View All sits at the right of the Files header`, JSON.stringify(r));
      if (width === 412) {
        chk(r.rowHeights.length === 10 && r.rowHeights.every((h) => h >= 44), `${tag} #718: every agent-page file row is at least 44px tall`, JSON.stringify(r));
        chk(r.allBox.width >= 44 && r.allBox.height >= 44, `${tag} #718: View All has at least a 44px touch target`, JSON.stringify(r));
      } else if (width === 1400) {
        chk(r.rowHeights.every((h) => h === 32) && r.allBox.height === 24, `${tag} #718: desktop file row and View All geometry stay unchanged`, JSON.stringify(r));
      }
      if (width === 412) {
        await page3.evaluate(() => document.getElementById('d-files').scrollIntoView({ block: 'start' }));
        await shot(page3, `718-agent-files-${theme}-412`);
      }
      if (theme === 'light' && width === 1400) await shot(page3, '3757-3-more-files');
      await page3.click('#d-files-all');
      await page3.waitForTimeout(500);
      const sc = await page3.evaluate(() => {
        const vis = (n) => !!(n && (n.offsetWidth || n.offsetHeight || n.getClientRects().length));
        const back = document.getElementById('d-files-back').getBoundingClientRect();
        const rowHeights = [...document.querySelectorAll('#d-filesall-list .pj-doc')].map((el) => Math.round(el.getBoundingClientRect().height));
        return { screen: vis(document.getElementById('d-sec-files')), talk: vis(document.getElementById('d-sec-talk')),
          rows: document.querySelectorAll('#d-filesall-list .pj-doc').length, finder: vis(document.getElementById('d-files-finder')),
          title: (document.getElementById('d-filesall-h') || {}).textContent, focus: document.activeElement && document.activeElement.id,
          rowHeights, backBox: { width: Math.round(back.width), height: Math.round(back.height) } };
      });
      const finderExpected = width > 640;
      chk(sc.screen && !sc.talk && sc.rows === 14 && sc.finder === finderExpected && sc.title === 'Files',
        `${tag} #3757/#4088: View All opens every file, with the computer-side Finder action hidden only on phone`, JSON.stringify(sc));
      chk(sc.focus === 'd-sec-files', `${tag} #3757: focus moves to the Files screen`, JSON.stringify(sc));
      if (width === 412) {
        chk(sc.rowHeights.length === 14 && sc.rowHeights.every((h) => h >= 44), `${tag} #718: every Files-screen row is at least 44px tall`, JSON.stringify(sc));
        chk(sc.backBox.width >= 44 && sc.backBox.height >= 44, `${tag} #718: Direct Message back has at least a 44px touch target`, JSON.stringify(sc));
      } else if (width === 1400) {
        chk(sc.rowHeights.every((h) => h === 32) && sc.backBox.height === 15, `${tag} #718: desktop Files-screen rows and back geometry stay unchanged`, JSON.stringify(sc));
      }
      if (width === 412) {
        await page3.evaluate(() => document.getElementById('d-files-back').scrollIntoView({ block: 'start' }));
        await shot(page3, `718-files-screen-${theme}-412`);
      }
      if (theme === 'light' && width === 1400) {
        await shot(page3, '3757-4-files-screen');
        const before = opened.length;
        await page3.click('#d-filesall-list .pj-doc[data-doc="rex-13.txt"]');
        await page3.waitForTimeout(400);
        chk(opened.length === before + 1 && /rex-13\.txt$/.test(opened[opened.length - 1] || ''), `${tag} #3757: a row on the Files screen opens that file`, JSON.stringify(opened.slice(before)));
      }
      // Back to the conversation from the Files screen (it has its own back, as the project's does).
      await page3.click('#d-files-back');
      await page3.waitForTimeout(300);
      const back = await page3.evaluate(() => ({ talk: !document.getElementById('d-sec-talk').hidden, files: !document.getElementById('d-sec-files').hidden,
        dm: document.querySelector('#d-nav .dnav-dm').classList.contains('on') }));
      chk(back.talk && !back.files && back.dm, `${tag} #3757: the Files screen's back returns to the Direct Message`, JSON.stringify(back));
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
