// Browser-check-surface: acard
'use strict';
/**
 * The "haunted" board (#1930, found by Ben, the external tester): an agent whose pane
 * still shows an OLD Claude sign-in rejection must not read as failing once the account
 * sign-in works again.
 *
 * The board reads the pane, and a pane keeps its history, so a real 401 line sits in
 * the screen after the person has signed in again. The engine asks the account itself
 * (engine/authprobe.js, a live `claude auth status` check) and suppresses a scraped
 * sign-in failure while that check says the sign-in is valid.
 *
 * What this pins, on a real board in a real browser:
 *  - HEALTHY: the pane holds the real 401 envelope in its history and the account check
 *    reads connected. The agent's card does NOT say "Sign-in isn't working", and
 *    /api/status does not report auth_failed for it.
 *    What the card shows instead is the engine's own reading with the sign-in signal set aside
 *    (its re-entry in status.js). In this sandbox that is "Can't tell"; the check does not claim
 *    more than that the stale failure is gone.
 *  - CONTROL (the dangerous answer): the same pane with the account check reading
 *    signed out. The card DOES say "Sign-in isn't working" and /api/status reports
 *    auth_failed. Without this arm a board that never showed the failure at all would
 *    pass the first one.
 *
 * Sub-case 2 (a live 401 loop under a cached healthy check) is pinned by
 * engine/status.authfresh-1930.test.js; it needs the pane to grow between ticks, which
 * the unit test drives directly.
 *
 * Not part of `npm test` -- it needs a browser. See README.md in this directory.
 *
 *   node docs/browser-checks/render-stale-auth-1930.js            # headed
 *   HEADED=0 node docs/browser-checks/render-stale-auth-1930.js   # headless
 */
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-staleauth-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-staleauth-workers-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-staleauth-projects-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-staleauth-launch-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-staleauth-config-'));
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';
const SANDBOXES = [SANDBOX, process.env.AGENT_WORKFORCE_WORKERS, process.env.AGENT_WORKFORCE_PROJECTS,
  process.env.AGENT_WORKFORCE_LAUNCH, process.env.AGENT_WORKFORCE_CONFIG_ROOT];

const { chromium } = require('playwright');
const fleet = require('../../test-support/fleet');
const srv = require('../../server.js');
const authprobe = require('../../engine/authprobe');
const subscription = require('../../engine/subscription');
const create = require('../../engine/create');

const SHOTS = process.argv[2] || null;
const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

/* The real envelope Claude prints on an expired sign-in, then the prompt the agent sat at
   after the person fixed it: an old failure in the history, an idle agent now. */
const OLD_401 = '401 {"type":"error","error":{"type":"authentication_error","message":"OAuth access token has expired."},"request_id":null}';
const SCREEN = 'Working on the report\n' + OLD_401 + '\n\nWorked for 1m 02s\n> \n';

(async () => {
  /* 'auth_failed' is what the SCREEN says (the scrape); whether the board shows it is the engine's
     reconcile with the account check, which is what this check is about. */
  fleet.install([fleet.agent('testy', { state: 'auth_failed', displayName: 'Testy', role: 'a tester', screen: SCREEN })]);
  /* The account check is asked only for an agent whose launch job Kosmos can read (it names the
     agent's account); with no job the engine leaves a scraped auth_failed standing. A real agent
     always has one, so write it, as render-chip-filters-3423 does. */
  fs.writeFileSync(create.plistPath('testy'), create.plistFor('testy', '/bin/echo', '/opt/homebrew/bin/tmux', 'claude-sonnet-5'), 'utf8');
  const server = await srv.start(0);
  const URL = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  const clearFirstRun = async (page) => { if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); } };
  const look = async (page) => page.evaluate(async () => {
    /* LAST is the board's own copy of what the status poll returned (the card's source). */
    // eslint-disable-next-line no-undef
    const list = typeof LAST !== 'undefined' && Array.isArray(LAST) ? LAST : [];
    const a = list.find((x) => x && x.sessionName === 'testy') || null;
    const card = document.querySelector('#grid .acard[data-agent="testy"]');
    return { apiState: a ? a.state : null, card: !!card, cardText: card ? card.innerText.replace(/\s+/g, ' ').trim() : '' };
  });
  const arm = async (label, live, want) => {
    authprobe.resetForTest();
    authprobe.setChecker(async () => ({ state: live }));
    /* Settle the account check BEFORE the page reads: an empty cache answers UNCHECKED, which
       leaves auth_failed standing whatever the account says, so without this the control arm
       would pass on the first poll before the signed-out answer was ever read. verdict() kicks
       the check; wait until it returns this arm's answer. */
    const expect = live === subscription.STATE.CONNECTED ? authprobe.HEALTHY : authprobe.EXPIRED;
    let v = null;
    for (let i = 0; i < 40 && v !== expect; i += 1) { v = authprobe.verdict(null); if (v !== expect) await new Promise((r) => setTimeout(r, 100)); }
    chk(v === expect, `[${label}] the account check has settled on ${expect} before the board is read`, String(v));
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await page.goto(URL, { waitUntil: 'networkidle' });
    await clearFirstRun(page);
    await page.waitForSelector('#grid .acard[data-agent="testy"]', { timeout: 10000 }).catch(() => {});
    /* The account check runs off the tick and is cached; wait for a tick that has read it,
       i.e. for the answer this arm expects, and fail with what we saw if it never comes. */
    let seen = null;
    for (let i = 0; i < 20; i += 1) {
      seen = await look(page);
      const failing = seen.apiState === 'auth_failed';
      if (typeof seen.apiState === 'string' && failing === want) break;   // a real reading, not a missing row
      await page.waitForTimeout(700);
    }
    const shows = /Sign-in isn.t working/.test(seen.cardText);
    chk(seen.card, `[${label}] the agent's card is on the board`, JSON.stringify(seen));
    chk((seen.apiState === 'auth_failed') === want, `[${label}] the board's status ${want ? 'reports' : 'does not report'} auth_failed`, String(seen.apiState));
    chk(shows === want, `[${label}] the card ${want ? 'says' : 'does not say'} "Sign-in isn't working"`, seen.cardText.slice(0, 160));
    if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `stale-auth-${label}.png`), fullPage: false }); }
    chk(errs.length === 0, `[${label}] no page errors`, errs.join(' | '));
    await page.close();
  };
  try {
    chk(/"type":"authentication_error"/.test(SCREEN), '[fixture] the pane really holds the 401 envelope the engine scrapes');
    await arm('healthy', subscription.STATE.CONNECTED, false);
    await arm('control-signed-out', subscription.STATE.NONE, true);
  } finally {
    await browser.close();
    server.close();
    for (const d of SANDBOXES) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
  }
  console.log(fail.length ? `\nFAIL: ${fail.length}` : '\nAll checks passed');
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
