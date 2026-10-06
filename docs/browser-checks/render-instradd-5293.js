'use strict';
// Browser-check-surface: d-instr-add instrAddPaint instrAddAct
/**
 * kosmos#5293: an addition another agent PROPOSED for these instructions waits for the person on the agent's
 * Instructions panel ("Waiting for you", the community held row reused; design Mona Lisa). Apply appends it under a
 * line saying who asked and when; Undo puts the earlier text back; Dismiss drops it. An unsaved edit in the box is
 * never replaced by an Apply. A real board, in process, on sandboxed roots; the proposal is held through the engine,
 * the presses go through the page and its person-only routes.
 *
 *   node docs/browser-checks/render-instradd-5293.js
 */
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-ia-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-ia-workers-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-ia-config-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-ia-launch-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-ia-projects-'));
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';

const { chromium } = require('playwright');
const fleet = require('../../test-support/fleet');
const create = require('../../engine/create');
const adds = require('../../engine/instructionadds');
const srv = require('../../server.js');

const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

const BASE = 'You are Mara, the sales agent. Answer leads from the shared inbox, politely.\n';
const ADD = [
  'When a lead goes quiet for two days, write to them once from the shared inbox.',
  'Do not chase twice; tell me instead.',
  'Keep every note under 120 words.',
  'Sign as the team, not as yourself.',
  'Never promise a price; say I will confirm it.',
  'Copy me on anything over a thousand dollars.',
].join('\n');
const fileOf = (a) => path.join(process.env.AGENT_WORKFORCE_WORKERS, a, 'CLAUDE.md');

async function openInstr(page, agent) {
  if (await page.$('#detail-back:visible')) await page.click('#detail-back');
  await page.waitForSelector('[data-agent="' + agent + '"]', { timeout: 8000 });
  await page.click('[data-agent="' + agent + '"]');
  await page.waitForSelector('#panel-detail:not([hidden])');
  await page.click('#d-nav button[data-go="profile"]');
  await page.waitForFunction((a) => new RegExp('You are ' + a, 'i').test(document.getElementById('d-instr').value), agent, { timeout: 8000 });
}
function readAdd(page) {
  return page.evaluate(() => {
    const wrap = document.getElementById('d-instr-add');
    const row = wrap && wrap.querySelector('li');
    const btn = (t) => [...(row ? row.querySelectorAll('button') : [])].find((b) => b.textContent.trim() === t) || null;
    const body = row && row.querySelector('.community-held-body');
    const r = wrap ? wrap.getBoundingClientRect() : { height: 0 };
    return {
      hidden: !wrap || wrap.hidden, height: r.height,
      head: (document.getElementById('d-instr-add-head') || {}).textContent,
      title: row && row.querySelector('b') ? row.querySelector('b').textContent : null,
      body: body ? body.textContent : null,
      text: row ? row.textContent.replace(/\s+/g, ' ').trim() : '',
      apply: btn('Apply') && btn('Apply').getAttribute('aria-label'),
      dismiss: btn('Dismiss') && { label: btn('Dismiss').getAttribute('aria-label'), danger: btn('Dismiss').classList.contains('danger-btn') },
      readAll: Boolean(btn('Read all')), undo: Boolean(btn('Undo this addition')),
      afterSave: (() => { const s = document.getElementById('d-instr-save'); return Boolean(s && wrap && (s.compareDocumentPosition(wrap) & Node.DOCUMENT_POSITION_FOLLOWING)); })(),
    };
  });
}

(async () => {
  fleet.install([
    fleet.agent('mara', { state: 'idle', displayName: 'Mara', role: 'Sales' }),
    fleet.agent('leo', { state: 'idle', displayName: 'Leo', role: 'Ops lead' }),
  ]);
  for (const a of ['mara', 'leo']) {
    fs.writeFileSync(create.plistPath(a), create.plistFor(a, '/bin/echo', '/opt/homebrew/bin/tmux', 'claude-sonnet-5'), 'utf8');
    fs.mkdirSync(path.dirname(fileOf(a)), { recursive: true });
    fs.writeFileSync(fileOf(a), a === 'mara' ? BASE : 'You are Leo.\n');
  }
  adds.propose('mara', ADD, 'Leo');

  const server = await srv.start(0);
  const URL = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await page.goto(URL, { waitUntil: 'networkidle' });
    if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }

    // CONTROL: an agent with nothing waiting shows no block at all.
    await openInstr(page, 'leo');
    await page.waitForTimeout(500);
    const none = await readAdd(page);
    chk(none.hidden === true, 'CONTROL: nothing waiting, nothing shown', JSON.stringify(none));

    await openInstr(page, 'mara');
    await page.waitForFunction(() => document.getElementById('d-instr-add').hidden === false, null, { timeout: 8000 });
    const shown = await readAdd(page);
    chk(shown.height > 0 && shown.head === 'Waiting for you', 'the waiting addition is on screen under "Waiting for you"', JSON.stringify(shown));
    chk(shown.afterSave, 'it sits below the Instructions box\'s Save', JSON.stringify(shown));
    chk(shown.title === 'An addition to these instructions', 'the row\'s title is Mona\'s', JSON.stringify(shown.title));
    chk(shown.body === ADD, 'the exact text that will be added is shown, as text', JSON.stringify(shown.body));
    chk(/Asked by Leo · .+\. Apply adds it at the end of these instructions, under a line saying who asked and when\./.test(shown.text),
      'the meta line says who asked, when, and what Apply does', JSON.stringify(shown.text));
    chk(shown.apply === 'Apply the addition Leo asked for' && shown.dismiss && shown.dismiss.label === 'Dismiss the addition Leo asked for' && shown.dismiss.danger,
      'Apply and Dismiss carry their names, and Dismiss is the danger button', JSON.stringify(shown));
    chk(shown.readAll, 'six lines are cut at four, so Read all is offered', JSON.stringify(shown));
    chk(fs.readFileSync(fileOf('mara'), 'utf8') === BASE, 'nothing is applied before the person presses Apply');

    // Apply: the file gets the addition at the end under who asked; the row becomes one quiet line with Undo.
    await page.click('#d-instr-add button:has-text("Apply")');
    await page.waitForFunction(() => /## Added on .*asked by Leo/.test(document.getElementById('d-instr').value), null, { timeout: 8000 });
    const file = fs.readFileSync(fileOf('mara'), 'utf8');
    chk(file.startsWith(BASE.trimEnd()) && /## Added on \d{4}-\d{2}-\d{2}, asked by Leo\n<!-- kosmos addition [0-9a-f]{12} -->\n\nWhen a lead goes quiet/.test(file) && file.trimEnd().endsWith('thousand dollars.'),
      'Apply appended the addition at the end of the file, under who asked and when', JSON.stringify(file.slice(-160)));
    await page.waitForFunction(() => /Added on .*, asked by Leo\./.test(document.getElementById('d-instr-add').textContent), null, { timeout: 8000 });
    const applied = await readAdd(page);
    chk(applied.undo && !applied.apply, 'after Apply: one line, with Undo this addition', JSON.stringify(applied));

    // Undo: the text from just before the apply, exactly.
    await page.click('#d-instr-add button:has-text("Undo this addition")');
    await page.waitForFunction(() => /The addition was taken out/.test(document.getElementById('d-instr-add').textContent), null, { timeout: 8000 });
    chk(fs.readFileSync(fileOf('mara'), 'utf8') === BASE, 'Undo restored exactly the earlier text');
    const undone = await readAdd(page);
    chk(!undone.undo && /These instructions are back to how they were before it\./.test(undone.text), 'after Undo: the sentence, and no button', JSON.stringify(undone.text));

    // Dismiss: gone, and the file untouched.
    adds.propose('mara', 'A short addition.', 'Leo');
    await openInstr(page, 'leo'); await openInstr(page, 'mara');
    await page.waitForFunction(() => /An addition to these instructions/.test(document.getElementById('d-instr-add').textContent), null, { timeout: 8000 });
    const short = await readAdd(page);
    chk(!short.readAll, 'CONTROL: a one-line addition gets no Read all', JSON.stringify(short));
    await page.click('#d-instr-add button:has-text("Dismiss")');
    await page.waitForFunction(() => document.getElementById('d-instr-add').hidden === true, null, { timeout: 8000 });
    chk(adds.pending('mara') === null && fs.readFileSync(fileOf('mara'), 'utf8') === BASE, 'Dismiss dropped it and left the file alone');

    // An unsaved edit in the box survives an Apply: the "file has changed" note is offered instead.
    adds.propose('mara', 'Another short addition.', 'Leo');
    await openInstr(page, 'leo'); await openInstr(page, 'mara');
    await page.waitForFunction(() => /An addition to these instructions/.test(document.getElementById('d-instr-add').textContent), null, { timeout: 8000 });
    await page.fill('#d-instr', BASE + 'An edit the person has not saved yet.\n');
    await page.click('#d-instr-add button:has-text("Apply")');
    await page.waitForFunction(() => document.getElementById('d-instr-outdated').hidden === false, null, { timeout: 8000 });
    const kept = await page.evaluate(() => document.getElementById('d-instr').value);
    chk(/An edit the person has not saved yet\./.test(kept), 'an unsaved edit in the box was not replaced by the Apply', JSON.stringify(kept.slice(-80)));
    chk(/Another short addition\./.test(fs.readFileSync(fileOf('mara'), 'utf8')), 'the Apply itself still went through');

    chk(errs.length === 0, 'no page errors', JSON.stringify(errs));
  } catch (e) {
    chk(false, 'the check ran to the end', String(e && e.stack || e).slice(0, 400));
  } finally {
    await browser.close();
    try { server.close(); } catch { /* best effort */ }
  }
  console.log(fail.length ? 'render-instradd-5293: ' + fail.length + ' FAILED' : 'render-instradd-5293: OK (a proposed addition waits for the person, who applies, undoes or dismisses it on the page)');
  process.exit(fail.length ? 1 : 0);
})();
