'use strict';

/**
 * A project row is two lines, with its status on the agents line (#1303 E).
 *
 * 🔑 Josh, 0.5.97 review: "the title / right below it, three agents / on the same
 * line as the three agents, in the same font size, the status... That way we can
 * tighten up these projects and get a whole lot more of them displayed."
 *
 * 🛑 THE CLAIM IS "SAME LINE", WHICH IS A COMPARISON OF TWO ELEMENTS' VERTICAL
 * POSITIONS, NOT A PROPERTY OF EITHER. A check that read only the status pill
 * would pass on any layout. This asserts the status and the agent count share a
 * baseline, and that the row is SHORTER than it was, which is the density he
 * asked for and the reason the change exists.
 *
 * ⚠️ AND IT ASSERTS THE FONT SIZES MATCH, because "in the same font size" is half
 * his sentence and is the half a purely geometric check cannot see.
 *
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-project-rows.js
 *
 * ⚠️ HEADED by default. `HEADED=0` on a machine with no console session. Runs the
 * server in-process against a fixture fleet, every state root a temp dir.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-pjr-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-pjr-workers-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-pjr-projects-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-pjr-launch-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-pjr-config-'));
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';

const { chromium } = require('playwright');
const fleet = require('../../test-support/fleet');
const projects = require('../../engine/projects');
const srv = require('../../server.js');

const fail = [];
const chk = (ok, label, extra) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
};

(async () => {
  fleet.install([
    fleet.agent('april', { state: 'idle', displayName: 'April', role: 'Research Assistant' }),
    fleet.agent('mikey', { state: 'idle', displayName: 'Mikey', role: 'Bookkeeper' }),
  ]);
  const a = projects.create({ name: 'Henderson Lease', description: 'A short description that should not change the shape.' });
  const b = projects.create({ name: 'Reed Handover' });
  projects.writeAll(projects.readAll().map((x) => (x.id === a.id ? { ...x, agents: ['april', 'mikey'] } : x)));

  const server = await srv.start(0);
  const BASE = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 950 }, colorScheme: 'light' });
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await page.goto(BASE, { waitUntil: 'networkidle' });
    if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
    await page.evaluate(() => fetch('/api/style', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ layout: 'consolidated' }),
    }).then((r) => r.text()));
    await page.reload({ waitUntil: 'networkidle' });
    if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
    await page.waitForSelector('.pj-row', { state: 'visible', timeout: 10000 });
    await page.waitForTimeout(600);

    const m = await page.evaluate((id) => {
      const row = document.querySelector('[data-project="' + id + '"]');
      if (!row) return { missing: true };
      /* 🛑 THE TEXT'S BOX, VIA A RANGE, NOT THE ELEMENT'S. The status pill carries
         a glyph and is therefore TALLER than the count beside it, so comparing
         element mids reports two baseline-aligned lines as misaligned. "Same
         line" is a claim about where the TEXT sits. */
      const rect = (sel) => {
        const e = row.querySelector(sel);
        if (!e) return null;
        const s = getComputedStyle(e);
        if (s.display === 'none' || s.visibility === 'hidden') return null;
        const walk = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
        let node = null;
        while ((node = walk.nextNode())) if (node.textContent.trim()) break;
        if (!node) return null;
        const rg = document.createRange();
        rg.selectNodeContents(node);
        const r = rg.getBoundingClientRect();
        return {
          bottom: Math.round(r.bottom * 10) / 10,
          mid: Math.round((r.top + r.height / 2) * 10) / 10,
          fontSize: s.fontSize,
          text: node.textContent.trim().slice(0, 24),
        };
      };
      const parts = [...row.children].flatMap((c) => [c, ...c.children]).map((c) => {
        const st = getComputedStyle(c);
        if (st.display === 'none') return null;
        const r = c.getBoundingClientRect();
        return (c.className || c.tagName) + ':' + Math.round(r.height);
      }).filter(Boolean);
      return {
        rowHeight: Math.round(row.getBoundingClientRect().height * 10) / 10,
        title: rect('.pjcard-h b'),
        pill: rect('.pjpill'),
        count: rect('.pjcount'),
        parts,
      };
    }, a.id);

    if (m.missing) { chk(false, 'a project row is on the page'); }
    else {
      console.log('');
      console.log('  row height : ' + m.rowHeight + 'px');
      console.log('  title      : ' + JSON.stringify(m.title));
      console.log('  status     : ' + JSON.stringify(m.pill));
      console.log('  agents     : ' + JSON.stringify(m.count));
      console.log('  visible parts: ' + (m.parts || []).join('  '));
      console.log('');

      /* 🛑 CONTROLS FIRST. Every element the comparisons below rest on must
         actually be painted with text. A hidden pill would make "same line"
         unfalsifiable and a missing count would make it vacuous. */
      chk(!!(m.title && m.title.text), 'the title is on screen', m.title && m.title.text);
      chk(!!(m.pill && m.pill.text), 'the status is on screen', m.pill && m.pill.text);
      chk(!!(m.count && m.count.text), 'the agent count is on screen', m.count && m.count.text);

      if (m.pill && m.count && m.title) {
        /* His sentence, both halves. */
        chk(Math.abs(m.pill.mid - m.count.mid) <= 2,
          'the status sits on the SAME LINE as the agents',
          m.pill.mid + ' vs ' + m.count.mid);
        chk(m.pill.fontSize === m.count.fontSize,
          'the status is the SAME FONT SIZE as the agents',
          m.pill.fontSize + ' vs ' + m.count.fontSize);
        /* And it must be BELOW the title, not beside it: "right below it". */
        chk(m.count.mid > m.title.mid + 4,
          'the agents line sits below the title',
          m.count.mid + ' vs ' + m.title.mid);
      }

      /* ⚠️ THE POINT OF THE CHANGE, and the assertion most likely to be left
         out: he asked for DENSITY. A row that satisfies every line above and
         got taller has not done what he asked for. Three lines at this size
         measured 71px; two lines must come in under that. */
      chk(m.rowHeight < 60, 'the row is shorter than the three-line shape it replaces',
        m.rowHeight + 'px  (was 90.2)');
    }
    /* 🛑 THE ASSERTION THAT PROTECTS THE SURFACE I DID NOT TOUCH. The grid tile
       is the SAME MARKUP laid out differently, and #747/#748 put its status at
       the TOP RIGHT on purpose. A rule scoped to the consolidated layout must
       leave that alone, and the only way to know is to go and look. Without
       this, a later "simplification" that moved the pill in the markup would
       still pass every line above while silently redesigning the tab view. */
    await page.evaluate(() => fetch('/api/style', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ layout: 'tabs' }),
    }).then((r) => r.text()));
    await page.goto(BASE + '/?tab=projects', { waitUntil: 'networkidle' });
    if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
    await page.waitForSelector('.pj-row', { state: 'visible', timeout: 10000 });
    await page.waitForTimeout(500);
    const tab = await page.evaluate((id) => {
      const row = document.querySelector('[data-project="' + id + '"]');
      if (!row) return null;
      const t = row.querySelector('.pjcard-h b');
      const pill = row.querySelector('.pjpill');
      if (!t || !pill) return { missing: true };
      const tr = t.getBoundingClientRect();
      const pr = pill.getBoundingClientRect();
      return {
        sameLineAsTitle: Math.abs((tr.top + tr.height / 2) - (pr.top + pr.height / 2)) <= 6,
        headerDisplay: getComputedStyle(row.querySelector('.pjcard-h')).display,
        /* 🛑 THE FIXTURE'S OWN CONTROL. If the layout did not actually switch,
           every line below is measuring the consolidated view and reporting it
           as a tab-view regression. */
        layoutAttr: document.documentElement.getAttribute('data-layout'),
        bodyIsConsolidated: document.body.classList.contains('consolidated'),
        pillMarginTop: getComputedStyle(pill).marginTop,
        pillWhiteSpace: getComputedStyle(pill).whiteSpace,
      };
    }, a.id);
    chk(!!tab && !tab.missing, 'the tab view still renders a project row with a status');
    if (tab && !tab.missing) {
      chk(tab.layoutAttr !== 'consolidated' && !tab.bodyIsConsolidated,
        'the fixture actually switched to the tab layout',
        'data-layout=' + tab.layoutAttr + ' body.consolidated=' + tab.bodyIsConsolidated);
      /* 🛑 KEYED TO MY OWN RULES LEAKING, NOT TO AN ASSUMED DESIGN. My first
         version of this arm asserted the tab view keeps its status beside the
         TITLE, taken from the #747/#748 comment about the grid TILE. Run against
         unmodified main it failed there too: the comment describes a different
         sub-surface than the list row I was measuring, so the arm was wrong
         rather than the page. A parent-commit control is what caught it.
         These two properties are ones MY rules set (margin-top: 0 and nowrap on
         the pill). If the consolidated scope ever leaks, they change here. */
      chk(tab.pillMarginTop !== '0px',
        'my consolidated pill rules do NOT leak into the tab view',
        'margin-top=' + tab.pillMarginTop);
      chk(tab.pillWhiteSpace !== 'nowrap',
        'my consolidated wrap rule does NOT leak into the tab view',
        'white-space=' + tab.pillWhiteSpace);
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
