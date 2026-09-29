'use strict';
// Browser-check-surface: d-instr-personal paintPersonalInstr
// (#4446) the distinctive web/index.html tokens this check asserts: the sentence's element
// and the painter that fills it from the instructions read.
/**
 * #4446 (found in the #4424 dress rehearsal): a Kosmos agent's own CLI also loads the person's
 * personal instructions file from outside the agent's folder (Claude Code's user CLAUDE.md, and
 * the Codex / Gemini / Grok equivalents). The ruling on the card was to keep that and tell the
 * person, so the Instructions panel now says so in one sentence, naming the tool, never the path.
 *
 * `node --test` covers which file counts (engine/personalinstr.test.js). It cannot see whether the
 * sentence reaches the screen, sits where a person reads it, or leaves with the agent it belongs
 * to. This drives the real page against the REAL server for one agent, with nothing mocked on
 * its read, so the whole chain runs: plist -> runner -> the sandbox home's .claude/CLAUDE.md ->
 * the GET field -> the painter.
 *
 * Red-capable arms:
 *  - CONTROL first: with no personal file in the sandbox home the sentence is hidden. Without it,
 *    the "shown" arm could pass on a sentence that is always on.
 *  - shown: after the file is written, reopening the agent shows the sentence, visibly, between
 *    the lede and the box, naming Claude Code and no path.
 *  - leaves with its agent: a second agent whose read FAILS must not keep the first one's
 *    sentence. That is the reset at the top of loadInstructions; the failure path never reaches
 *    the painter, so without the reset the old sentence stays up.
 *
 *   HEADED=0 node docs/browser-checks/render-personal-instr-4446.js
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-personal-instr-4446.js
 */
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-pi-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-pi-workers-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-pi-config-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-pi-launch-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-pi-projects-'));
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';

const { chromium } = require('playwright');
const fleet = require('../../test-support/fleet');
const create = require('../../engine/create');
const srv = require('../../server.js');

const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

/* The personal file the real read looks for: a default-account Claude agent's is
   <home>/.claude/CLAUDE.md, and lib-sandbox-home put <home> in a fresh temp folder. */
const HOME = process.env.AGENT_WORKFORCE_HOME;
const PERSONAL = path.join(HOME, '.claude', 'CLAUDE.md');

async function openInstr(page, agent) {
  if (await page.$('#detail-back:visible')) {
    await page.click('#detail-back');
  }
  await page.waitForSelector('[data-agent="' + agent + '"]', { timeout: 8000 });
  await page.click('[data-agent="' + agent + '"]');
  await page.waitForSelector('#panel-detail:not([hidden])');
  await page.click('#d-nav button[data-go="profile"]');
}

function readNote(page) {
  return page.evaluate(() => {
    const el = document.getElementById('d-instr-personal');
    const lede = document.getElementById('d-instr-lede');
    const box = document.getElementById('d-instr');
    if (!el) return { missing: true };
    const r = el.getBoundingClientRect();
    return {
      hidden: el.hidden,
      text: el.textContent.replace(/\s+/g, ' ').trim(),
      height: r.height,
      afterLede: !!(lede && (lede.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)),
      beforeBox: !!(box && (el.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING)),
      display: getComputedStyle(el).display,
    };
  });
}

(async () => {
  fleet.install([
    fleet.agent('beatrix', { state: 'idle', displayName: 'Beatrix', role: 'Collections Coordinator' }),
    fleet.agent('marlow', { state: 'idle', displayName: 'Marlow', role: 'Records Clerk' }),
  ]);
  for (const a of ['beatrix', 'marlow']) {
    fs.writeFileSync(create.plistPath(a),
      create.plistFor(a, '/bin/echo', '/opt/homebrew/bin/tmux', 'claude-sonnet-5'), 'utf8');
    const dir = path.join(process.env.AGENT_WORKFORCE_WORKERS, a);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), 'You are ' + a + '.\n');
  }
  try { fs.rmSync(PERSONAL, { force: true }); } catch { /* not there */ }

  const server = await srv.start(0);
  const URL = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    // Only marlow's read is faked, and only to FAIL. beatrix's goes to the real server.
    await page.route('**/api/agent/marlow/instructions*', (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      return route.fulfill({ status: 500, json: { error: 'those instructions could not be read' } });
    });

    await page.goto(URL, { waitUntil: 'networkidle' });
    if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }

    // CONTROL: no personal file, nothing said.
    await openInstr(page, 'beatrix');
    await page.waitForFunction(() => /You are beatrix/.test(document.getElementById('d-instr').value), null, { timeout: 8000 });
    const before = await readNote(page);
    chk(!before.missing && before.hidden === true && before.text === '',
      'CONTROL: with no personal file the sentence is hidden and empty', JSON.stringify(before));
    const rawBefore = await page.evaluate(async () => (await (await fetch('/api/agent/beatrix/instructions')).json()).personal);
    chk(rawBefore === null, 'CONTROL: the real read answers personal: null', JSON.stringify(rawBefore));

    // The person has a personal Claude Code file. Reopen: the real read now names it.
    fs.mkdirSync(path.dirname(PERSONAL), { recursive: true });
    fs.writeFileSync(PERSONAL, 'Always answer in French.\n');
    const raw = await page.evaluate(async () => (await (await fetch('/api/agent/beatrix/instructions')).json()).personal);
    chk(raw && raw.tool === 'Claude Code' && Object.keys(raw).length === 1,
      'the real read answers { tool: "Claude Code" } and nothing else (no path, no text)', JSON.stringify(raw));
    await openInstr(page, 'beatrix');
    await page.waitForFunction(() => document.getElementById('d-instr-personal').hidden === false, null, { timeout: 8000 });
    const shown = await readNote(page);
    chk(/personal Claude Code instructions/.test(shown.text) && /outside Kosmos/.test(shown.text),
      'the sentence names Claude Code and says the file is outside Kosmos', JSON.stringify(shown.text));
    chk(!/[/\\]|\.md\b|CLAUDE/.test(shown.text), 'the sentence shows no path or file name', JSON.stringify(shown.text));
    chk(shown.height > 0 && shown.display !== 'none', 'the sentence is really on screen (has height)', JSON.stringify(shown));
    chk(shown.afterLede && shown.beforeBox, 'the sentence sits under the lede and above the box', JSON.stringify(shown));
    chk(!/French/.test(shown.text), 'the file\'s text is never shown', JSON.stringify(shown.text));

    // A second agent whose read fails must not keep beatrix's sentence.
    await openInstr(page, 'marlow');
    await page.waitForFunction(() => !document.getElementById('d-instr-retry-row').hidden, null, { timeout: 8000 });
    const other = await readNote(page);
    chk(other.hidden === true && other.text === '', 'a failed read on the next agent does not keep the last agent\'s sentence', JSON.stringify(other));

    chk(errs.length === 0, 'no page errors', errs.slice(0, 4).join(' | '));
    await page.close();
  } finally {
    await browser.close();
    server.close();
    fleet.restore();
    try { fs.rmSync(PERSONAL, { force: true }); } catch { /* best effort */ }
  }
  if (fail.length) { console.error('FAILURES: ' + fail.length); process.exit(1); }
  console.log('\nall passed');
})().catch((e) => {
  console.error('render-personal-instr-4446 threw: ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
