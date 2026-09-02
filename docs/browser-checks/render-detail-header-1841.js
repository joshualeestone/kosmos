'use strict';
/**
 * #1841: the view-agent-detail header redesign, on a screen (Josh, 2026-09-02).
 *
 * `node --test` cannot see any of this: the five parts are all DOM outcomes of
 * the real painters, and web/index.html has no unit coverage at all. This drives
 * the real page and the real painters and reads the real DOM.
 *
 * The five parts:
 *   1. The working-rules prompt moved OFF the header and ONTO the Instructions
 *      tab, for BOTH doctrine cases (made-before-rules -> #d-doctrine-note, and
 *      the Kosmos-made reports-to case -> #d-instr-reports), each with an
 *      "Add Instructions & Restart" button, and the Instructions tab dot lights.
 *   2. The hand-edited stale case keeps a redesigned HEADER card: short,
 *      "[name] needs to be restarted", a [Restart] button (never "Restart it"),
 *      one short idle line.
 *   3. The duplicate lower status (#d-why) is suppressed when the state is
 *      reported (the top line already carries it), and still shown otherwise.
 *   4. The role in #d-meta is bold; the model is not.
 *
 * ⚠️ WHY IT DRIVES THE PAINTERS DIRECTLY for parts 1 and 2. The stale and
 * doctrine states are produced by the engine from real instruction files and
 * timestamps, which the fixture cannot arrange without a whole doctrine/staleness
 * apparatus. `renderStale` and the doctrine DOM are the exact code that changed,
 * so the check loads the real page, sets `CURRENT` (which renderStale reads for
 * the open agent, exactly as production does), calls the real painter with the
 * state object the engine emits, and asserts the real DOM. Parts 3 and 4 run
 * through the real `openDetail` on a real fixture card.
 *
 *   node docs/browser-checks/render-detail-header-1841.js            # headed
 *   HEADED=0 node docs/browser-checks/render-detail-header-1841.js   # headless
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-detail-header-1841.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-dh-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-dh-workers-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-dh-config-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-dh-launch-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-dh-projects-'));
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';

const { chromium } = require('playwright');
const fleet = require('../../test-support/fleet');
const create = require('../../engine/create');
const srv = require('../../server.js');

const OUT = process.env.SHOT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'dh-shots-'));
const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

(async () => {
  fleet.install([
    fleet.agent('beatrix', { state: 'idle', displayName: 'Beatrix', role: 'Collections Coordinator' }),
  ]);
  // A plist so the agent has a recorded model, and #d-meta carries a model
  // segment to prove the bold is on the role ONLY.
  fs.writeFileSync(create.plistPath('beatrix'),
    create.plistFor('beatrix', '/bin/echo', '/opt/homebrew/bin/tmux', 'claude-sonnet-5'), 'utf8');

  const server = await srv.start(0);
  const URL = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await page.goto(URL, { waitUntil: 'networkidle' });
    if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
    await page.waitForSelector('[data-agent="beatrix"]', { timeout: 8000 });
    await page.click('[data-agent="beatrix"]');
    await page.waitForSelector('#panel-detail:not([hidden])');
    await page.waitForTimeout(300);

    // ── Part 1 structure: the doctrine prompt is on the Instructions tab, not
    // the header, and reads as "Add Instructions & Restart". ────────────────
    const struct = await page.evaluate(() => {
      const note = document.getElementById('d-doctrine-note');
      const reports = document.getElementById('d-instr-reports');
      const inInstr = (el) => !!(el && el.closest('#d-sec-instr'));
      const inHeader = (el) => !!(el && el.closest('.dhead'));
      return {
        noteInInstr: inInstr(note), noteInHeader: inHeader(note),
        reportsInInstr: inInstr(reports),
        addLabel: (document.getElementById('d-doctrine-add') || {}).textContent,
        reportsLabel: (document.getElementById('d-instr-reports-go') || {}).textContent,
      };
    });
    chk(struct.noteInInstr && !struct.noteInHeader, 'Part 1: the doctrine prompt lives on the Instructions tab, not the header', JSON.stringify(struct));
    chk(struct.reportsInInstr, 'Part 1: the reports-to section lives on the Instructions tab', JSON.stringify(struct));
    chk(struct.addLabel === 'Add Instructions & Restart', 'Part 1: the doctrine button reads "Add Instructions & Restart"', struct.addLabel);
    chk(struct.reportsLabel === 'Add Instructions & Restart', 'Part 1: the reports button reads "Add Instructions & Restart"', struct.reportsLabel);

    // ── Part 4: the role is bold in #d-meta; the model is not. ───────────────
    const meta = await page.evaluate(() => {
      const el = document.getElementById('d-meta');
      const b = el.querySelector('b');
      return {
        html: el.innerHTML,
        boldText: b ? b.textContent : null,
        boldCount: el.querySelectorAll('b').length,
        // the model segment is the text AFTER the bold, outside any <b>
        tail: el.innerHTML.replace(/^<b>[^<]*<\/b>/, ''),
      };
    });
    chk(meta.boldCount === 1 && meta.html.startsWith('<b>'), 'Part 4: exactly the first segment (the title) is bold', JSON.stringify(meta));
    chk(meta.boldText === 'Collections Coordinator', 'Part 4: the bold segment is the role', meta.boldText);
    chk(/·/.test(meta.tail) && /Claude Sonnet 5/i.test(meta.tail) && !/<b>/.test(meta.tail),
      'Part 4: the model follows, unbolded', meta.tail);

    // ── Part 3: the lower status (#d-why) is suppressed for a REPORTED state,
    // and shown for a non-reported one. Driven through the real openDetail on a
    // real card whose stateReported/because are flipped. ────────────────────
    const dup = await page.evaluate(() => {
      // The only fixture card; take its real sessionName rather than guessing.
      const real = LAST[0];
      const sn = real.sessionName;
      const read = () => {
        const why = document.getElementById('d-why');
        const task = document.getElementById('d-task');
        return {
          whyHidden: why.hidden, whyText: why.textContent,
          taskHidden: task.hidden, taskText: task.textContent,
        };
      };
      // Reported idle: the top line carries the quote, the lower line is hidden.
      LAST[0] = { ...real, stateReported: true, because: 'finished responding' };
      openDetail(sn);
      const reported = read();
      // Not reported: the honest "why" explanation stays.
      LAST[0] = { ...real, stateReported: false, because: 'it is sitting at its prompt' };
      openDetail(sn);
      const inferred = read();
      LAST[0] = real;
      return { sn, reported, inferred };
    });
    chk(dup.reported.whyHidden === true, 'Part 3: reported state hides the duplicate lower status', JSON.stringify(dup.reported));
    chk(!dup.reported.taskHidden && /finished responding/.test(dup.reported.taskText),
      'Part 3: the top line still carries the reported status', JSON.stringify(dup.reported));
    chk(dup.inferred.whyHidden === false && /sitting at its prompt/i.test(dup.inferred.whyText),
      'Part 3: a NON-reported state keeps the honest why-line', JSON.stringify(dup.inferred));

    // ── Part 2: the hand-edited stale case is the redesigned HEADER card. ────
    const handEdited = await page.evaluate(() => {
      CURRENT = { name: 'Beatrix', sessionName: 'beatrix-discord' };
      renderStale({ state: 'stale' });
      detailDots();
      const el = document.getElementById('d-instr-stale');
      const btn = el.querySelector('.instr-restart');
      const note = el.querySelector('.instr-restart-note');
      const dot = document.querySelector('#d-nav button[data-go="instr"]');
      return {
        staleHidden: el.hidden, staleHtml: el.innerHTML,
        reportsHidden: document.getElementById('d-instr-reports').hidden,
        btnText: btn ? btn.textContent : null,
        btnAgent: btn ? btn.getAttribute('data-restart-agent') : null,
        noteText: note ? note.textContent : null,
        dot: !!(dot && dot.hasAttribute('data-dot')),
      };
    });
    chk(!handEdited.staleHidden && /Beatrix needs to be restarted/.test(handEdited.staleHtml),
      'Part 2: the header card says "[name] needs to be restarted"', handEdited.staleHtml);
    chk(handEdited.btnText === 'Restart', 'Part 2: the button says "Restart", never "Restart it"', JSON.stringify(handEdited.btnText));
    chk(handEdited.btnAgent === 'beatrix-discord', 'Part 2: the button carries the restart target', handEdited.btnAgent);
    chk(/say ‘hello’ to Beatrix to wake them/.test(handEdited.noteText || ''), 'Part 2: the short idle line names the agent with "them"', handEdited.noteText);
    chk(!/\bit\b/i.test(handEdited.staleHtml.replace(/<[^>]*>/g, '')), 'Part 2: no "it" for the agent anywhere in the header card', handEdited.staleHtml);
    chk(handEdited.reportsHidden === true, 'Part 2: the reports section is hidden for the hand-edited case', String(handEdited.reportsHidden));
    chk(handEdited.dot === true, 'Part 2: the Instructions tab dot is lit for the header restart card', String(handEdited.dot));

    // ── Part 1b: the Kosmos-made stale case (reports-to) is the Instructions
    // tab section, and the header card clears. ──────────────────────────────
    const kosmos = await page.evaluate(() => {
      CURRENT = { name: 'Beatrix', sessionName: 'beatrix-discord' };
      renderStale({ state: 'stale', wroteBy: { who: 'kosmos', because: 'Kosmos set it to report to Ruth' } });
      detailDots();
      const reports = document.getElementById('d-instr-reports');
      const btn = document.getElementById('d-instr-reports-go');
      const dot = document.querySelector('#d-nav button[data-go="instr"]');
      return {
        reportsHidden: reports.hidden,
        reportsHtml: document.getElementById('d-instr-reports-text').innerHTML,
        staleHidden: document.getElementById('d-instr-stale').hidden,
        btnAgent: btn ? btn.getAttribute('data-restart-agent') : null,
        dot: !!(dot && dot.hasAttribute('data-dot')),
      };
    });
    chk(!kosmos.reportsHidden && /These are updated working rules to help <b>Beatrix<\/b> be more efficient\./.test(kosmos.reportsHtml),
      'Part 1b: the reports-to case reads on the Instructions tab', kosmos.reportsHtml);
    chk(kosmos.staleHidden === true, 'Part 1b: the header restart card clears for the reports-to case', String(kosmos.staleHidden));
    chk(kosmos.btnAgent === 'beatrix-discord', 'Part 1b: the reports button carries the restart target', kosmos.btnAgent);
    chk(kosmos.dot === true, 'Part 1b: the Instructions tab dot is lit for the reports-to case', String(kosmos.dot));

    // ── current: both surfaces clear. ───────────────────────────────────────
    const cleared = await page.evaluate(() => {
      CURRENT = { name: 'Beatrix', sessionName: 'beatrix-discord' };
      renderStale({ state: 'current' });
      return {
        staleHidden: document.getElementById('d-instr-stale').hidden,
        reportsHidden: document.getElementById('d-instr-reports').hidden,
      };
    });
    chk(cleared.staleHidden && cleared.reportsHidden, 'current: both the header card and the reports section are hidden', JSON.stringify(cleared));

    // ── Part 1a dot: showing the doctrine prompt lights the Instructions dot. ─
    const doctrineDot = await page.evaluate(() => {
      document.getElementById('d-instr-stale').hidden = true;
      document.getElementById('d-instr-reports').hidden = true;
      const note = document.getElementById('d-doctrine-note');
      note.hidden = false;
      detailDots();
      const dot = document.querySelector('#d-nav button[data-go="instr"]');
      const lit = !!(dot && dot.hasAttribute('data-dot'));
      note.hidden = true; detailDots();
      const off = !!(dot && dot.hasAttribute('data-dot'));
      return { lit, off };
    });
    chk(doctrineDot.lit === true, 'Part 1a: showing the doctrine prompt lights the Instructions tab dot', String(doctrineDot.lit));
    chk(doctrineDot.off === false, 'CONTROL: with nothing needing you, the Instructions dot is off', String(doctrineDot.off));

    await page.click('#d-nav button[data-go="instr"]');
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(OUT, 'detail-header-1841.png'), fullPage: false });

    chk(errs.length === 0, 'no page errors', errs.join(' | '));
    await page.close();
  } finally {
    await browser.close();
    server.close();
    fleet.restore();
  }
  console.log('shots: ' + OUT);
  if (fail.length) { console.error('FAILURES: ' + fail.length); process.exit(1); }
})();
