'use strict';
/**
 * kosmos#6717: text Kosmos took out of an agent's input box shows in the agent's conversation, and nothing sends it.
 *
 * A real board with an idle agent holding one saved draft (engine/unsentdrafts.js, as chat.recoverStuckInput leaves
 * it). For that agent it checks:
 *   - its Direct Message thread shows one Kosmos line, in Kosmos's band (no avatar, no name), that says the text was
 *     not sent and quotes the words, escaped;
 *   - "Put in the message box" fills the conversation's own box with the words and sends nothing;
 *   - Dismiss takes the line away, and it stays away after a repaint.
 * Control: an agent with no draft has no such line.
 *
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-unsent-draft-6717.js
 *   SHOT_DIR=<dir> keeps the screenshots.
 */
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-draft6717-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-draft6717-workers-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-draft6717-projects-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-draft6717-launch-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-draft6717-config-'));
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';

const { chromium } = require('playwright');
const fleet = require('../../test-support/fleet');
const drafts = require('../../engine/unsentdrafts');
const srv = require('../../server.js');

const OUT = process.env.SHOT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'draft6717-shots-'));
const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}
const WORDS = 'can you also check the <second> invoice & the supplier "credit" before lunch';

(async () => {
  fleet.install([
    fleet.agent('ada', { state: 'idle', displayName: 'Ada', role: 'Bookkeeper' }),
    fleet.agent('ida', { state: 'idle', displayName: 'Ida', role: 'Researcher' }),
  ]);
  const added = drafts.add('ada', WORDS, { since: new Date(Date.now() - 12 * 60e3).toISOString() });
  chk(added.ok === true, 'PRECONDITION: the draft is kept', JSON.stringify(added));
  const server = await srv.start(0);
  const URL = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 950 }, colorScheme: 'light' });
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    const sends = [];
    page.on('request', (r) => { if (r.method() === 'POST' && /\/thread$/.test(r.url())) sends.push(r.url()); });
    await page.goto(URL, { waitUntil: 'networkidle' });
    if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(300); }
    await page.waitForSelector('#grid .acard', { timeout: 10000 });
    const read = () => page.evaluate(() => {
      const rows = [...document.querySelectorAll('#d-dmthread .dm-draft')];
      const r = rows[0];
      const q = r && r.querySelector('.dm-draft-text');
      return {
        count: rows.length,
        text: r ? r.textContent.replace(/\s+/g, ' ').trim() : '',
        quote: q ? q.textContent : '',
        band: !!(r && r.classList.contains('msg-valve')),
        noAvatar: !!(r && !r.querySelector('.msg-av')),
        noName: !!(r && !r.querySelector('.msg-nm')),
        use: !!(r && r.querySelector('button.dm-draft-use')),
        dismiss: !!(r && r.querySelector('button.dm-draft-dismiss')),
      };
    });
    const open = async (who) => {
      await page.evaluate((s) => openDetail(s), who);
      await page.waitForSelector('#d-dmthread', { state: 'attached', timeout: 10000 });
      await page.waitForTimeout(1200);
    };
    await open('ada');
    const d = await read();
    chk(d.count === 1, 'the agent\'s conversation shows exactly one saved-draft line', String(d.count));
    chk(/It was not sent\./.test(d.text), 'it says the text was not sent', d.text.slice(0, 160));
    chk(d.quote === WORDS, 'it quotes the words exactly (escaped, not markup)', JSON.stringify(d.quote));
    chk(d.band && d.noAvatar && d.noName, 'it is drawn as Kosmos\'s band, not as the agent or the person', JSON.stringify(d));
    chk(d.use && d.dismiss, 'it offers Put in the message box and Dismiss');
    await page.screenshot({ path: path.join(OUT, 'draft-dm.png') });

    await page.click('#d-dmthread .dm-draft-use');
    await page.waitForTimeout(300);
    const box = await page.evaluate(() => { const i = document.getElementById('d-say'); return { value: i ? i.value : null, focused: document.activeElement === i }; });
    chk(box.value === WORDS, 'Put in the message box fills the conversation\'s box with the words', JSON.stringify(box.value));
    chk(box.focused, 'and puts the cursor there');
    chk(sends.length === 0, 'nothing was sent', sends.join(' '));
    await page.evaluate(() => { const i = document.getElementById('d-say'); if (i) { i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); } });

    await page.click('#d-dmthread .dm-draft-dismiss');
    await page.waitForTimeout(1500);
    chk((await read()).count === 0, 'Dismiss takes the line away');
    await open('ida');
    await open('ada');
    chk((await read()).count === 0, 'and it stays away after the conversation is drawn again');
    chk(drafts.list('ada').length === 0, 'the draft is gone from the board too');
    await open('ida');
    chk((await read()).count === 0, 'CONTROL: an agent with no draft has no such line');
    chk(sends.length === 0, 'nothing was sent at any point', sends.join(' '));
    chk(errs.length === 0, 'no page errors', errs.join(' | '));
  } finally {
    await browser.close();
    server.close();
  }
  console.log(`screenshots: ${OUT}`);
  if (fail.length) { for (const f of fail) console.error('  FAIL  ' + f); }
  console.log(fail.length ? `\n${fail.length} FAILED` : '\nall passed');
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error('FAIL  render-unsent-draft-6717: ' + (e && e.stack || e)); process.exit(2); });
