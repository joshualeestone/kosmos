// Browser-check-surface: d-tokenguard d-state
'use strict';
/**
 * #5668: a token-only agent's page says when its last guard run was not whole (with the reason), or when its denied
 * paths are past what the sandbox is known to take (its commands may stop running). A guarded agent shows nothing.
 *
 * Boots a real sandboxed board with three token-only agents, whose guard record (the file every guard run writes)
 * says: not whole, past the size, and guarded. Opens each agent's page through the real card click, on chromium
 * and webkit, and reads #d-tokenguard. Then rewrites the not-whole agent's record as guarded and waits one poll:
 * the notice goes (it follows the poll).
 * Then not whole AND past the size: both sentences, the size one as "Also".
 * Control: the guarded agent's page shows no notice, so a shown notice is not the page's default.
 *
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-tokenguard-5668.js
 */
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOTS = [];
const mkroot = (tag) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-tokenguard-' + tag)); ROOTS.push(d); return d; };
const SANDBOX = mkroot('');
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = mkroot('workers-');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = mkroot('config-');
process.env.AGENT_WORKFORCE_LAUNCH = mkroot('launch-');
process.env.AGENT_WORKFORCE_PROJECTS = mkroot('projects-');
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';

const { chromium, webkit } = require('playwright');
const fleet = require('../../test-support/fleet');
const srv = require('../../server.js');
const store = require('../../engine/store');
const sendertoken = require('../../engine/sendertoken');
const setup = require('../../engine/setup-assistant');

const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

const BECAUSE = 'the PATH this agent starts with has an entry Kosmos could not cover (/opt/odd)';
function record(agents) {
  const d = path.join(store.ROOT, setup.GUARD_STATE_DIR);
  fs.rmSync(d, { recursive: true, force: true });
  fs.mkdirSync(d, { recursive: true });
  for (const [name, line] of Object.entries(agents)) fs.writeFileSync(path.join(d, encodeURIComponent(name) + '.json'), JSON.stringify(line));
}
const AT = new Date().toISOString();

async function notice(page, shown) {
  await page.locator('.acard .namego', { hasText: shown }).first().click();
  await page.waitForSelector('#d-state', { timeout: 20000 });
  await page.waitForTimeout(300);
  return page.evaluate(() => {
    const el = document.getElementById('d-tokenguard');
    return { exists: !!el, hidden: el ? el.hidden : null, text: el ? el.textContent : '' };
  });
}

(async () => {
  fleet.install([
    fleet.agent('tokwhole', { state: 'idle', displayName: 'Tamsin' }),
    fleet.agent('tokwarn', { state: 'idle', displayName: 'Wilf' }),
    fleet.agent('tokgood', { state: 'idle', displayName: 'Gus' }),
  ]);
  fs.writeFileSync(sendertoken.tokenOnlyFile(), JSON.stringify({ agents: ['tokwhole', 'tokwarn', 'tokgood'] }));
  record({
    tokwhole: { ok: false, because: BECAUSE, at: AT },
    tokwarn: { ok: true, warning: 'its 4000 denied path entries are past what Kosmos can say the sandbox will take', at: AT },
    tokgood: { ok: true, at: AT },
  });
  const server = await srv.start(0);
  const URL = 'http://127.0.0.1:' + server.address().port;
  await fetch(URL + '/api/first-run/complete', { method: 'POST' });
  try {
    for (const [engineName, engine] of [['chromium', chromium], ['webkit', webkit]]) {
      record({
        tokwhole: { ok: false, because: BECAUSE, at: AT },
        tokwarn: { ok: true, warning: 'past', at: AT },
        tokgood: { ok: true, at: AT },
      });
      const browser = await engine.launch({ headless: process.env.HEADED === '0' });
      try {
        const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
        const errs = [];
        page.on('pageerror', (e) => errs.push(e.message));
        await page.goto(URL);
        await page.waitForSelector('.acard .namego', { timeout: 20000 });

        const good = await notice(page, 'Gus');
        chk(good.exists && good.hidden === true, `${engineName}: control: a guarded token-only agent's page shows no notice`, JSON.stringify(good));
        await page.goto(URL);
        await page.waitForSelector('.acard .namego', { timeout: 20000 });
        const whole = await notice(page, 'Tamsin');
        chk(whole.hidden === false && whole.text.includes('Tamsin') && whole.text.includes('not complete') && whole.text.includes(BECAUSE),
          `${engineName}: a not-whole agent's page names it, says its protection is not complete, and gives the reason`, JSON.stringify(whole));
        chk(!/\u2014|this Mac/.test(whole.text), `${engineName}: the notice has no em dash and no "this Mac"`, whole.text);
        // It follows the poll: the record turns guarded, and within a poll the notice goes.
        record({ tokwhole: { ok: true, at: AT }, tokwarn: { ok: true, warning: 'past', at: AT }, tokgood: { ok: true, at: AT } });
        await page.waitForTimeout(6500);
        const after = await page.evaluate(() => document.getElementById('d-tokenguard').hidden);
        chk(after === true, `${engineName}: once the record says guarded, the notice is gone within a poll`, `hidden=${after}`);
        await page.goto(URL);
        await page.waitForSelector('.acard .namego', { timeout: 20000 });
        const warned = await notice(page, 'Wilf');
        chk(warned.hidden === false && warned.text.includes('Wilf') && /commands may stop running/.test(warned.text) && !/not complete/.test(warned.text),
          `${engineName}: a guarded agent past the sandbox size is told its commands may stop running (not that it is unprotected)`, JSON.stringify(warned));
        // Not whole AND past the size (review 1): both sentences, the size one as "Also".
        record({ tokwhole: { ok: false, because: BECAUSE, warning: 'past', at: AT }, tokwarn: { ok: true, warning: 'past', at: AT }, tokgood: { ok: true, at: AT } });
        await page.goto(URL);
        await page.waitForSelector('.acard .namego', { timeout: 20000 });
        const both = await notice(page, 'Tamsin');
        chk(both.hidden === false && both.text.includes('not complete') && both.text.includes(BECAUSE) && /Also, its list of blocked paths/.test(both.text),
          `${engineName}: not whole and past the size says both, the size as "Also"`, JSON.stringify(both));
        // A reason that already ends in a full stop (an error message) gets no second one (review 3).
        record({ tokwhole: { ok: false, because: 'the guard could not be written.', at: AT }, tokwarn: { ok: true, warning: 'past', at: AT }, tokgood: { ok: true, at: AT } });
        await page.goto(URL);
        await page.waitForSelector('.acard .namego', { timeout: 20000 });
        const dot = await notice(page, 'Tamsin');
        chk(dot.hidden === false && dot.text.includes('could not be written.') && !dot.text.includes('..'), `${engineName}: a reason ending in a full stop is not given a second one`, JSON.stringify(dot));
        chk(errs.length === 0, `${engineName}: no page errors`, errs.join(' | '));
      } finally { await browser.close(); }
    }
  } finally {
    try { server.closeAllConnections(); server.close(); } catch { /* closed */ }
    for (const d of ROOTS) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* gone */ } }
  }
  console.log(fail.length ? `FAILED ${fail.length}: ${fail.join('; ')}` : 'ALL PASS');
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
