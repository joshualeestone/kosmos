'use strict';
/**
 * #3723: an agent stopped by its account is told where the person looks.
 *
 * A real board with a Codex agent whose screen shows Codex's own out-of-credits message (the
 * sentence read from Codex's program text, engine/status.js CODEX_LIMIT_MARKERS) under its empty
 * prompt, which on today's main reads as Idle. For that agent it checks:
 *   - the card no longer says Idle: it says it is limited, not working;
 *   - its Direct Message thread shows one Kosmos line, in Kosmos's band (no avatar, no name), that
 *     names OpenAI and quotes Codex's own sentence with its link.
 * Control: an idle agent's card stays Idle and its thread has no Kosmos line. And a screen line
 * pointing at some other address gets the line but no link (only known vendor hosts are linked).
 *
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-account-problem-3723.js
 *   SHOT_DIR=<dir> keeps the screenshots (the board, and the agent's DM).
 */
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-acct3723-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-acct3723-workers-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-acct3723-projects-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-acct3723-launch-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-acct3723-config-'));
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';

const { chromium } = require('playwright');
const fleet = require('../../test-support/fleet');
const srv = require('../../server.js');

const OUT = process.env.SHOT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'acct3723-shots-'));
const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

const CODEX_OUT_OF_CREDITS = [
  "• You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits",
  '  or try again at 4:10 PM.',
  '',
  '› Ask Codex to do anything',
  '  gpt-5.6-sol default · ~/Kosmos/agents/ada',
].join('\n');

(async () => {
  fleet.install([
    fleet.agent('ada', { state: 'rate_limited', runner: 'codex', command: 'node', screen: CODEX_OUT_OF_CREDITS, displayName: 'Ada', role: 'Researcher' }),
    fleet.agent('ida', { state: 'idle', displayName: 'Ida', role: 'Bookkeeper' }),
    // A user:password prefix that makes a vendor-looking address open another site: never a link.
    fleet.agent('mal', { state: 'rate_limited', runner: 'codex', command: 'node', displayName: 'Mal', role: 'Researcher',
      screen: "• You've hit your usage limit. Visit https://chatgpt.com:x@evil.example/steal to purchase more credits\n\n› Ask Codex to do anything" }),
    // Screen text that LOOKS like a limit message but points somewhere else: never a link.
    fleet.agent('eve', { state: 'rate_limited', runner: 'codex', command: 'node', displayName: 'Eve', role: 'Researcher',
      screen: "• You've hit your usage limit. Visit https://pay-here.example/credits to purchase more credits\n\n› Ask Codex to do anything" }),
  ]);
  const server = await srv.start(0);
  const URL = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 950 }, colorScheme: 'light' });
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await page.goto(URL, { waitUntil: 'networkidle' });
    if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(300); }
    await page.waitForSelector('#grid .acard', { timeout: 10000 });
    const cards = await page.evaluate(() => {
      const one = (needle) => {
        const c = [...document.querySelectorAll('#grid .acard')].find((x) => x.textContent.includes(needle));
        if (!c) return null;
        const pill = c.querySelector('.astate');
        return { text: c.textContent.replace(/\s+/g, ' ').trim(), pill: pill ? pill.textContent.replace(/\s+/g, ' ').trim() : '' };
      };
      return { ada: one('Ada'), ida: one('Ida') };
    });
    chk(cards.ada && !/\bIdle\b/.test(cards.ada.pill), 'the out-of-credits Codex agent is not shown as Idle', cards.ada && cards.ada.pill);
    chk(cards.ida && /\bIdle\b/.test(cards.ida.pill), 'CONTROL: the idle agent is shown as Idle', cards.ida && cards.ida.pill);
    await page.screenshot({ path: path.join(OUT, 'acct-board.png') });

    const dm = async (who) => {
      await page.evaluate((s) => openDetail(s), who);
      await page.waitForSelector('#d-dmthread', { state: 'attached', timeout: 10000 });
      await page.waitForTimeout(1200);
      return page.evaluate(() => {
        const rows = [...document.querySelectorAll('#d-dmthread .dm-kosmos')];
        const r = rows[0];
        return {
          count: rows.length,
          text: r ? r.textContent.replace(/\s+/g, ' ').trim() : '',
          band: !!(r && r.classList.contains('msg-valve')),
          noAvatar: !!(r && !r.querySelector('.msg-av')),
          noName: !!(r && !r.querySelector('.msg-nm')),
          link: (() => { const a = r && r.querySelector('a[href]'); return a ? { href: a.getAttribute('href'), target: a.getAttribute('target'), rel: a.getAttribute('rel') } : null; })(),
        };
      });
    };
    const adaDm = await dm('ada');
    chk(adaDm.count === 1, 'the agent\'s DM shows exactly one Kosmos line', String(adaDm.count));
    chk(/has run out of OpenAI usage or credits, so it has stopped/.test(adaDm.text), 'it says what happened, naming OpenAI', adaDm.text.slice(0, 160));
    chk(/chatgpt\.com\/codex\/settings\/usage/.test(adaDm.text), 'it carries Codex\'s own link', adaDm.text.slice(0, 240));
    chk(adaDm.link && adaDm.link.href === 'https://chatgpt.com/codex/settings/usage' && adaDm.link.target === '_blank' && /noopener/.test(adaDm.link.rel || ''),
      'the link to add credits is clickable, opens in a new tab, and stops at the address', JSON.stringify(adaDm.link));
    chk(adaDm.band && adaDm.noAvatar && adaDm.noName, 'it is drawn as Kosmos\'s band, not as the agent or the person', JSON.stringify(adaDm));
    await page.screenshot({ path: path.join(OUT, 'acct-dm.png') });
    const eveDm = await dm('eve');
    chk(eveDm.count === 1 && /pay-here\.example/.test(eveDm.text) && eveDm.link === null,
      'an address that is not a known vendor host stays plain text in Kosmos\'s line', JSON.stringify({ text: eveDm.text.slice(0, 120), link: eveDm.link }));
    const malDm = await dm('mal');
    chk(malDm.count === 1 && malDm.link === null, 'a user:password address that opens another site is not a link', JSON.stringify(malDm.link));
    const idaDm = await dm('ida');
    chk(idaDm.count === 0, 'CONTROL: the idle agent\'s DM has no Kosmos line', String(idaDm.count));
    chk(errs.length === 0, 'no page errors', errs.join(' | '));
  } finally {
    await browser.close();
    server.close();
  }
  console.log(`screenshots: ${OUT}`);
  if (fail.length) { for (const f of fail) console.error('  FAIL  ' + f); }
  console.log(fail.length ? `\n${fail.length} FAILED` : '\nall passed');
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error('FAIL  render-account-problem-3723: ' + (e && e.stack || e)); process.exit(2); });
