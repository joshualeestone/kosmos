'use strict';

/**
 * The lines of a rail agent, measured as TEXT rather than as boxes (#1303 A item 3).
 *
 * 🔑 Josh, 0.5.97 review: "for each agent let's tighten up the spacing between
 * lines between the agent name, its title, and its status". The rail row is a
 * multi-row grid with a 2px row gap, so the gap is not what a reader sees: at
 * .8125rem and .625rem the LINE BOXES are most of the height, and the leading
 * inside them is the spacing being complained about.
 *
 * 🛑 #3131 + #3187 (Josh 6.70) CHANGED WHAT THIS ROW SHOWS. The status is no
 * longer a third TEXT line -- it is the row's ground COLOUR now (grey/green/red),
 * and the state word is kept only in a .vh span for screen readers. So this check
 * now measures the leading of the TWO visible lines (name, title), asserts the
 * state word is present-but-visually-hidden, and asserts the row carries a colour
 * wash. This supersedes the original three-line-stack contract (which came from
 * #1191's "single text line to indicate what they're doing"); the leading claim
 * for name->title is what carries over.
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
    /* #3187: a needs-you agent so the RED wash arm is exercised, not only
       green (april) and grey (mikey). Without it the check could not tell the
       .attn wash from a fallback grey. */
    fleet.agent('raph', { state: 'needs_you', displayName: 'Raph', role: 'Fixer' }),
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
      /* #3131 + #3187 (Josh 6.70): the state WORD is no longer a visible third
         line -- status is the row's ground colour now, and the word is kept only
         in a .vh span for screen readers. So this reads the .vh word (must exist,
         a11y) AND any state text left VISIBLE outside it (must be empty), instead
         of measuring a state line's leading. */
      const lstate = row.querySelector('.lstate');
      const vh = lstate ? lstate.querySelector('.vh') : null;
      const stateWord = vh ? vh.textContent.trim() : '';
      const vhCs = vh ? getComputedStyle(vh) : null;
      const vhClipped = vhCs ? (parseInt(vhCs.width) <= 2 && vhCs.overflow === 'hidden') : false;
      const stateVisible = lstate ? lstate.textContent.replace(stateWord, '').trim() : '';
      const wash = getComputedStyle(row).backgroundImage;
      const rows = [...document.querySelectorAll('#alist .lrow')];
      /* #3187: the wash + class per agent, so the check can assert the RIGHT
         wash for each state (green=working, red=needs-you, grey=everything else)
         rather than merely "some gradient". */
      const byAgent = {};
      for (const r of rows) {
        const ls = r.querySelector('.lstate');
        const vhr = ls ? ls.querySelector('.vh') : null;
        const vhrCs = vhr ? getComputedStyle(vhr) : null;
        byAgent[r.dataset.agent || '?'] = {
          cls: r.className.trim(),
          wash: getComputedStyle(r).backgroundImage,
          /* the state word is kept in .vh AND that .vh is clipped -- checked on
             EVERY row, not just the first, so a needs-you row (whose .lstate also
             carries a visible answerBtn) is verified to still hide its WORD. */
          wordHidden: !!vhr && vhr.textContent.trim().length > 0 && !!vhrCs && parseInt(vhrCs.width) <= 2 && vhrCs.overflow === 'hidden',
        };
      }
      const cs = (sel) => {
        const e = row.querySelector(sel);
        if (!e) return null;
        const s = getComputedStyle(e);
        return { fontSize: s.fontSize, lineHeight: s.lineHeight };
      };
      return {
        name, title,
        stateWord, vhClipped, stateVisible, wash,
        byAgent,
        rowHeight: Math.round(row.getBoundingClientRect().height * 10) / 10,
        rowCount: rows.length,
        css: { name: cs('.lname b'), title: cs('.ltitle') },
      };
    });

    if (m.missing) { chk(false, 'a rail agent row is on the page'); }
    else {
      const gap = (a, b) => (a && b ? Math.round((b.top - a.bottom) * 10) / 10 : null);
      const nameTitle = gap(m.name, m.title);
      console.log('');
      console.log('  row height        : ' + m.rowHeight + 'px  (' + m.rowCount + ' rows)');
      console.log('  name              : ' + JSON.stringify(m.css.name) + '  "' + (m.name && m.name.text) + '"');
      console.log('  title             : ' + JSON.stringify(m.css.title) + '  "' + (m.title && m.title.text) + '"');
      console.log('  state word (.vh)  : "' + m.stateWord + '"  clipped=' + m.vhClipped);
      console.log('  visible state text: "' + m.stateVisible + '"');
      console.log('  row wash          : ' + m.wash);
      console.log('  GAP name -> title : ' + nameTitle + 'px');
      console.log('');

      /* 🛑 THE CONTROL. The two VISIBLE lines must actually be on screen with
         text, or the leading below is measuring absence. */
      chk(!!(m.name && m.name.text), 'the name line has text', m.name && m.name.text);
      chk(!!(m.title && m.title.text), 'the title line has text', m.title && m.title.text);

      /* #3131 (Josh 6.70): the status WORD is no longer a visible line. It is
         kept in a .vh span for screen readers (a11y, not deleted) but must NOT
         show as text -- status is the ground colour now. This is the arm that
         catches a revert of the .vh wrap in lrow(). */
      chk(!!m.stateWord, 'the state word is kept for screen readers (a11y)', m.stateWord);
      chk(m.vhClipped, 'the state word is visually hidden (.vh clipped), not a visible line', 'clipped=' + m.vhClipped);
      chk(m.stateVisible === '', 'no waiting/idle/busy TEXT is visible in the row', JSON.stringify(m.stateVisible));

      /* #3187 (Josh 6.70): status owns the GROUND, and the ground must be the
         RIGHT colour for the state, not just some gradient. Green=working,
         red=needs-you, grey=everything else, reusing the .acard rgba values.
         april=working, mikey=idle, raph=needs-you are the three fixtures. */
      const GREEN = '47, 125, 90', RED = '179, 38, 30', GREY = '120, 120, 128';
      const washOf = (a) => (m.byAgent[a] || {}).wash || '';
      console.log('  washes            : ' + JSON.stringify(m.byAgent));
      chk(washOf('april').includes(GREEN), 'a WORKING agent gets the green wash', washOf('april'));
      chk(washOf('mikey').includes(GREY), 'an IDLE agent gets the grey wash', washOf('mikey'));
      chk(washOf('raph').includes(RED), 'a NEEDS-YOU agent gets the red wash', washOf('raph'));
      /* CONTROL: the three washes are distinct, or "matches GREEN/GREY/RED" could
         pass on a single wash that happened to contain all three substrings. */
      chk(washOf('april') !== washOf('mikey') && washOf('mikey') !== washOf('raph') && washOf('april') !== washOf('raph'),
        'the three state washes are distinct', 'w/i/n differ');
      /* #3131: the WORD is hidden on EVERY row, not only the first (april). This
         catches a needs-you row -- whose .lstate also carries a visible answerBtn
         -- failing to wrap its state word in .vh. */
      chk(Object.values(m.byAgent).length > 0 && Object.values(m.byAgent).every((v) => v.wordHidden),
        'every agent row hides its state word in a .vh clip',
        JSON.stringify(Object.fromEntries(Object.entries(m.byAgent).map(([k, v]) => [k, v.wordHidden]))));

      /* The remaining #1191 claim, now for the TWO visible lines: the name/title
         leading Josh asked to tighten. Ceiling + floor so neither loose spacing
         nor an overlap passes. */
      chk(nameTitle !== null && nameTitle <= 3.5, 'name to title leading is tight', nameTitle + 'px');
      chk(nameTitle !== null && nameTitle >= 0, 'name and title do not overlap', nameTitle + 'px');
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
