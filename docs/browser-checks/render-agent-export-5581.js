'use strict';
// Browser-check-surface: d-instr-export d-instr-export-link
// (#5581) the distinctive web/index.html tokens this check asserts: the export row under the instructions box and
// its download link.
/**
 * kosmos#5581: an agent can be taken OUT of Kosmos as one file (the export half of #1652; the import half is the
 * create form's "import my existing agent"). The Instructions panel offers "Download this agent" when the agent has
 * a saved, non-empty instructions file, and the link answers that file from the real server.
 *
 *   node docs/browser-checks/render-agent-export-5581.js        (SHOT_DIR=<dir> also saves screenshots)
 */
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-ax-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-ax-workers-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-ax-config-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-ax-launch-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-ax-projects-'));
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

async function openInstr(page, agent) {
  if (await page.$('#detail-back:visible')) {
    await page.click('#detail-back');
  }
  await page.waitForSelector('[data-agent="' + agent + '"]', { timeout: 8000 });
  await page.click('[data-agent="' + agent + '"]');
  await page.waitForSelector('#panel-detail:not([hidden])');
  await page.click('#d-nav button[data-go="profile"]');
}

function readRow(page) {
  return page.evaluate(() => {
    const row = document.getElementById('d-instr-export');
    const link = document.getElementById('d-instr-export-link');
    if (!row || !link) return { missing: true };
    const r = row.getBoundingClientRect();
    return {
      hidden: row.hidden,
      text: row.textContent.replace(/\s+/g, ' ').trim(),
      href: link.getAttribute('href'),
      download: link.hasAttribute('download'),
      height: r.height,
    };
  });
}

(async () => {
  fleet.install([
    fleet.agent('ezra', { state: 'idle', displayName: 'Ezra', role: 'Archivist' }),
    fleet.agent('nell', { state: 'idle', displayName: 'Nell', role: 'Courier' }),
  ]);
  const texts = { ezra: '# You are Ezra\n\nYou keep the #5581 archive.\n', nell: '   \n' };
  for (const a of ['ezra', 'nell']) {
    fs.writeFileSync(create.plistPath(a),
      create.plistFor(a, '/bin/echo', '/opt/homebrew/bin/tmux', 'claude-sonnet-5'), 'utf8');
    const dir = path.join(process.env.AGENT_WORKFORCE_WORKERS, a);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), texts[a]);
  }

  const server = await srv.start(0);
  const URL = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  const shots = process.env.SHOT_DIR || '';
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await page.goto(URL, { waitUntil: 'networkidle' });
    if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }

    // An agent with saved instructions: the row is offered, and the link downloads its file.
    await openInstr(page, 'ezra');
    await page.waitForFunction(() => /You are Ezra/.test(document.getElementById('d-instr').value), null, { timeout: 8000 });
    await page.waitForFunction(() => document.getElementById('d-instr-export').hidden === false, null, { timeout: 8000 });
    const shown = await readRow(page);
    chk(!shown.missing && shown.hidden === false && shown.height > 0, 'the export row is on screen for an agent with instructions', JSON.stringify(shown));
    chk(shown.href === '/api/agent/ezra/export', 'the link points at this agent\'s export', JSON.stringify(shown.href));
    chk(shown.download === true, 'the link is a download', JSON.stringify(shown));
    chk(/Download this agent/.test(shown.text) && !/[\u2014]/.test(shown.text), 'the row says what it does, with no em dash', JSON.stringify(shown.text));
    if (shots) {
      fs.mkdirSync(shots, { recursive: true });
      await page.locator('#d-instr-export').scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(shots, 'export-row.png') });
    }
    const dl = await page.evaluate(async (href) => {
      const r = await fetch(href);
      return { status: r.status, cd: r.headers.get('content-disposition') || '', text: await r.text() };
    }, shown.href);
    chk(dl.status === 200 && /attachment; filename="ezra\.agent\.md"/.test(dl.cd), 'the link answers the file as a download', JSON.stringify({ status: dl.status, cd: dl.cd }));
    chk(/You keep the #5581 archive\./.test(dl.text) && /^---\n/.test(dl.text), 'the file holds the saved instructions under its header', JSON.stringify(dl.text.slice(0, 80)));

    // Review 1: an UNTIED card never loads instructions; the panel is cleared from a list instead. Ezra's link must
    // not survive onto it (it would download Ezra's file under the stranger's card). Simulated as render-detail-header
    // does: the untied card's own reset, run with an untied CURRENT.
    const untied = await page.evaluate(() => {
      CURRENT = { ...CURRENT, sessionName: 'someone-untied', isNamedOurs: false };
      setWritesOffered(CURRENT, false);
      const row = document.getElementById('d-instr-export');
      return { hidden: row.hidden, href: document.getElementById('d-instr-export-link').getAttribute('href') };
    });
    chk(untied.hidden === true && untied.href === '#', 'an untied card clears the last agent\'s export row and link', JSON.stringify(untied));

    // An agent whose instructions are empty: nothing to share, so no row (and the last agent's link is gone).
    await openInstr(page, 'nell');
    await page.waitForFunction(() => document.getElementById('d-instr').placeholder !== 'Loading instructions…', null, { timeout: 8000 });
    await page.waitForTimeout(300);
    const empty = await readRow(page);
    chk(empty.hidden === true, 'no export row for an agent with empty instructions', JSON.stringify(empty));
    chk(empty.href === '#', 'the last agent\'s link does not survive onto this one', JSON.stringify(empty.href));

    chk(errs.length === 0, 'no page errors', errs.slice(0, 4).join(' | '));
    await page.close();
  } finally {
    await browser.close();
    server.close();
    fleet.restore();
    for (const k of ['AGENT_WORKFORCE_WORKERS', 'AGENT_WORKFORCE_CONFIG_ROOT', 'AGENT_WORKFORCE_LAUNCH', 'AGENT_WORKFORCE_PROJECTS']) {
      try { fs.rmSync(process.env[k], { recursive: true, force: true }); } catch { /* best effort */ }
    }
    try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ }
  }
  if (fail.length) { console.error('FAILURES: ' + fail.length); process.exit(1); }
  console.log('\nall passed');
})().catch((e) => {
  console.error('render-agent-export-5581 threw: ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
