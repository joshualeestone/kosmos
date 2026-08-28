'use strict';

/**
 * The three lines of a rail agent, measured as TEXT rather than as boxes (#1303 A item 3).
 *
 * 🔑 Josh, 0.5.97 review: "for each agent let's tighten up the spacing between
 * lines between the agent name, its title, and its status". The rail row is a
 * three-row grid with a 2px row gap, so the gap is not what a reader sees: at
 * .8125rem and .625rem the LINE BOXES are most of the height, and the leading
 * inside them is the spacing being complained about.
 *
 * 🛑 MEASURED WITH A RANGE, NOT `getBoundingClientRect` ON THE ELEMENT. An
 * element's box includes its leading, so reading element boxes reports the
 * spacing as unchanged when the leading is exactly what moved. This is the same
 * error that made group A's first pass call the row aligned when only two of its
 * three columns had been measured: a box is not a baseline.
 *
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-agent-lines.js
 *
 * ⚠️ HEADED by default. `HEADED=0` on a machine with no console session.
 * Runs the server in-process against a fixture fleet, every state root a temp
 * dir, so it never reads or writes a real board.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-lines-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-lines-workers-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-lines-projects-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-lines-launch-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-lines-config-'));
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';

const { chromium } = require('playwright');
const fleet = require('../../test-support/fleet');
const srv = require('../../server.js');

const fail = [];
const chk = (ok, label, extra) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
};

(async () => {
  fleet.install([
    fleet.agent('april', { state: 'working', displayName: 'April', role: 'Research Assistant' }),
    fleet.agent('mikey', { state: 'idle', displayName: 'Mikey', role: 'Bookkeeper' }),
  ]);
  const server = await srv.start(0);
  const URL = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 950 }, colorScheme: 'light' });
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await page.goto(URL, { waitUntil: 'networkidle' });
    if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
    await page.evaluate(() => fetch('/api/style', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ layout: 'consolidated' }),
    }).then((r) => r.text()));
    await page.reload({ waitUntil: 'networkidle' });
    if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
    await page.waitForSelector('#alist .lrow', { timeout: 10000 });
    await page.waitForTimeout(600);

    const m = await page.evaluate(() => {
      /* The GLYPH box, via a Range over the text node. An element rect carries
         the leading with it, which is the quantity under test, so an element
         rect cannot see this change at all. */
      const textRect = (el) => {
        if (!el) return null;
        const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let node = null;
        while ((node = walk.nextNode())) if (node.textContent.trim()) break;
        if (!node) return null;
        const r = document.createRange();
        r.selectNodeContents(node);
        const box = r.getBoundingClientRect();
        return { top: box.top, bottom: box.bottom, text: node.textContent.trim() };
      };
      const row = document.querySelector('#alist .lrow');
      if (!row) return { missing: true };
      const name = textRect(row.querySelector('.lname b')) || textRect(row.querySelector('.lname'));
      const title = textRect(row.querySelector('.ltitle'));
      const state = textRect(row.querySelector('.lstate'));
      const rows = [...document.querySelectorAll('#alist .lrow')];
      const cs = (sel) => {
        const e = row.querySelector(sel);
        if (!e) return null;
        const s = getComputedStyle(e);
        return { fontSize: s.fontSize, lineHeight: s.lineHeight };
      };
      return {
        name, title, state,
        rowHeight: Math.round(row.getBoundingClientRect().height * 10) / 10,
        rowCount: rows.length,
        css: { name: cs('.lname b'), title: cs('.ltitle'), state: cs('.lstate') },
      };
    });

    if (m.missing) { chk(false, 'a rail agent row is on the page'); }
    else {
      const gap = (a, b) => (a && b ? Math.round((b.top - a.bottom) * 10) / 10 : null);
      const nameTitle = gap(m.name, m.title);
      const titleState = gap(m.title, m.state);
      console.log('');
      console.log('  row height        : ' + m.rowHeight + 'px  (' + m.rowCount + ' rows)');
      console.log('  name              : ' + JSON.stringify(m.css.name) + '  "' + (m.name && m.name.text) + '"');
      console.log('  title             : ' + JSON.stringify(m.css.title) + '  "' + (m.title && m.title.text) + '"');
      console.log('  state             : ' + JSON.stringify(m.css.state) + '  "' + (m.state && m.state.text) + '"');
      console.log('  GAP name -> title : ' + nameTitle + 'px');
      console.log('  GAP title -> state: ' + titleState + 'px');
      console.log('');

      /* 🛑 THE CONTROL. Every line must actually be on screen with text in it,
         or the gaps below are measuring absence. A hidden .lstate would make the
         stack look beautifully tight and mean nothing. */
      chk(!!(m.name && m.name.text), 'the name line has text', m.name && m.name.text);
      chk(!!(m.title && m.title.text), 'the title line has text', m.title && m.title.text);
      chk(!!(m.state && m.state.text), 'the status line has text', m.state && m.state.text);

      /* The claim. Leading between the three lines is what Josh asked to
         tighten; these are the numbers the change has to move and keep. */
      chk(nameTitle !== null && nameTitle <= 3.5, 'name to title leading is tight', nameTitle + 'px');
      chk(titleState !== null && titleState <= 3.5, 'title to status leading is tight', titleState + 'px');
      /* 🔑 THE STRONGEST OF THESE, and the one that names the actual defect.
         The two gaps were 4px and 6px: a stack whose lines are spaced unevenly
         reads as three things rather than one agent, and no single-gap ceiling
         can see that. Both ceilings above would have passed at 3 and 6. */
      chk(nameTitle !== null && titleState !== null && Math.abs(nameTitle - titleState) <= 1,
        'the two gaps are even, so the stack reads as one agent',
        nameTitle + 'px vs ' + titleState + 'px');
      /* ⚠️ A FLOOR AS WELL AS A CEILING. Collapsing the lines onto each other
         would pass a ceiling-only check and be worse than what it replaced. */
      chk(nameTitle !== null && nameTitle >= 0, 'name and title do not overlap', nameTitle + 'px');
      chk(titleState !== null && titleState >= 0, 'title and status do not overlap', titleState + 'px');
    }
    chk(errs.length === 0, 'no page errors', errs.join(' | '));
    await page.close();
  } finally {
    await browser.close();
    server.close();
    fleet.restore();
  }
  if (fail.length) { console.log('\n' + fail.length + ' FAILED'); process.exit(1); }
  console.log('\nall passed');
})().catch((e) => { console.error(e); process.exit(2); });
