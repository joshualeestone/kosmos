/* #5091 (Josh, 2026-10-02 22:10, on Mortals): switching an agent TO Claude offers his Claude accounts.
 * He picked Anthropic / Claude for Liu Kang (on Gemini) and the panel kept Gemini's "no account to move it to" and
 * offered no list of Claude emails. Now, with Claude chosen in the provider menu:
 *   1. the sign-in picker shows the Claude accounts a switch can land on (sharing the agents' history, not signed out),
 *      preselected on the main one; one with its own history is not offered;
 *   2. the CURRENT provider's rows (its account line and model row) are hidden, since they are false for the switch;
 *   3. Switch & Restart sends the picked account (the request is intercepted: the engine half is
 *      engine/create.switch-claude-5091.test.js);
 *   4. back on the agent's own provider, the picker goes and the current rows come back.
 * The agent is a Codex fixture, so choosing Claude ARMS a switch (on a Claude fixture it would not).
 * /api/accounts is answered from a fixture in the server's own row shape, so no live sign-in check runs.
 *
 * Run: NODE_PATH=$HOME/work/pw-runtime/node_modules node docs/browser-checks/render-switch-claude-5091.js
 */
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
/* Every root sandboxed, as render-model-change does: the server refuses to start half-sandboxed. */
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-5091-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-5091-workers-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-5091-projects-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-5091-launch-'));
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-5091-config-'));
process.env.AGENT_WORKFORCE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-5091-home-'));
delete process.env.AGENT_WORKFORCE_CODEX_HOME;
delete process.env.CODEX_HOME;
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
const ROOT = path.join(__dirname, '..', '..');
const { chromium } = require('playwright');
const fleet = require(path.join(ROOT, 'test-support', 'fleet'));
const firstrun = require(path.join(ROOT, 'engine', 'firstrun'));
const srv = require(path.join(ROOT, 'server.js'));
const fail = [];
const chk = (ok, label, extra) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : '')); if (!ok) fail.push(label); };

const HOMEDIR = process.env.AGENT_WORKFORCE_HOME;
const row = (o) => ({ provider: 'anthropic', authMode: 'subscription', offerable: true, connection: { state: 'connected' }, ...o });
const ACCOUNTS = [
  row({ dir: path.join(HOMEDIR, '.claude'), isDefault: true, email: 'main@example.com', memoryShared: true }),
  row({ dir: path.join(HOMEDIR, '.claude-b'), label: 'account-b', email: 'b@example.com', memoryShared: true }),
  row({ dir: path.join(HOMEDIR, '.claude-solo'), label: 'solo', email: 'solo@example.com', memoryShared: false }),
  row({ dir: path.join(HOMEDIR, '.claude-e'), label: 'account-e', email: 'e@example.com', memoryShared: true, connection: { state: 'none' } }),
  { provider: 'openai', authMode: 'apikey', dir: path.join(HOMEDIR, '.codex'), isDefault: true, keyTail: 'ABCD', offerable: true, connection: { state: 'connected' } },
];

/* From render-account-problem-3723.js (Codex's out-of-credits screen, captured). */
const CODEX_OUT_OF_CREDITS = [
  "\u2022 You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits",
  '  or try again at 4:10 PM.',
  '',
  '\u203a Ask Codex to do anything',
  '  gpt-5.6-sol default \u00b7 ~/Kosmos/agents/ada',
].join('\n');

(async () => {
  /* Out of usage, like Liu Kang: a Codex agent the engine can classify (the fixture refuses an 'idle' Codex pane it
     reads as unknown). The screen is render-account-problem-3723's captured one. */
  fleet.install([fleet.agent('liu', { state: 'rate_limited', runner: 'codex', command: 'node', screen: CODEX_OUT_OF_CREDITS, displayName: 'Liu Kang' })]);
  const create = require(path.join(ROOT, 'engine', 'create'));
  fs.mkdirSync(create.AGENTS_DIR, { recursive: true });
  fs.writeFileSync(create.plistPath('liu'), create.plistFor('liu', '/bin/echo', process.env.AGENT_WORKFORCE_TMUX_BIN, null, null, 'codex'));
  try { firstrun.complete(); } catch { /* fine */ }
  const server = await srv.start(0);
  const URL = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  let served = ACCOUNTS;   // round 3: swapped for a no-target world below
  await page.route('**/api/accounts', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ accounts: served }) }));
  let posted = null;
  await page.route('**/api/agent/*/provider', (r) => { posted = JSON.parse(r.request().postData() || '{}'); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ outcome: 'changed', provider: 'anthropic', because: 'Claude it is.' }) }); });
  try {
    await page.goto(URL + '/?tab=detail&agent=liu', { waitUntil: 'load' }); await page.waitForTimeout(1500);
    if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(300); }
    await page.waitForSelector('#panel-detail:not([hidden])', { timeout: 8000 });
    await page.click('#d-nav [data-go="model"]'); await page.waitForTimeout(500);
    const cur0 = await page.evaluate(() => { const c = document.getElementById('d-current-rows'); return { cur: !!c && !c.hidden, has: !!c, prov: document.getElementById('d-provider').value }; });
    chk(cur0.prov === 'openai' && cur0.cur, 'fixture: the agent is on OpenAI and its own rows show', JSON.stringify(cur0));

    await page.selectOption('#d-provider', 'anthropic');
    await page.waitForFunction(() => { const s = document.getElementById('d-provider-account'); return s && !s.hidden; }, null, { timeout: 8000 }).catch(() => {});
    const pick = await page.evaluate(() => {
      const s = document.getElementById('d-provider-account');
      return { hidden: s.hidden, label: s.getAttribute('aria-label'), opts: [...s.options].map((o) => ({ v: o.value, t: o.textContent, sel: o.selected })),
        current: !!document.getElementById('d-current-rows') && !document.getElementById('d-current-rows').hidden };
    });
    const vals = pick.opts.map((o) => o.v);
    chk(!pick.hidden && pick.label === 'Claude account to run on', '#5091: choosing Claude shows a Claude account picker', JSON.stringify(pick));
    chk(vals.length === 2 && vals.some((v) => v.endsWith('/.claude')) && vals.some((v) => v.endsWith('/.claude-b')),
      '#5091: it offers the Claude accounts a switch can land on (main and account-b), not one with its own history or one signed out', JSON.stringify(vals));
    chk((pick.opts.find((o) => o.sel) || {}).v === (ACCOUNTS[0].dir), '#5091: it opens on the main account', JSON.stringify(pick.opts));
    chk(pick.current === false, "#5091: the current provider's rows (its account line, its model row) are hidden while a switch is set up");
    // Round 1 (the blocker): the line under the Claude list speaks for Claude, never OpenAI.
    const hint = await page.$eval('#d-provider-msg', (e) => e.textContent);
    chk(!/OpenAI/.test(hint) && /Claude account/.test(hint), '#5091: the line under the Claude list speaks for Claude (and is there), not OpenAI', JSON.stringify(hint));
    const hints = await page.evaluate(() => [...document.querySelectorAll('.d-current-hint')].map((h) => h.hidden));
    chk(hints.length === 2 && hints.every(Boolean), "#5091: the current rows' two help lines go with them", JSON.stringify(hints));
    // Round 1: a repaint of the agent's own provider (the path an Antigravity or Muse agent takes, whose account picker
    // returns early) brings the current rows back.
    const repainted = await page.evaluate(() => { paintProviderPicker(CURRENT); const c = document.getElementById('d-current-rows'); return !!c && !c.hidden; });
    chk(repainted, "#5091: repainting the agent's own provider brings its rows back (no stale hidden block)");
    await page.selectOption('#d-provider', 'anthropic'); await page.waitForTimeout(300);
    const curBox = await page.$('#d-current-rows') ? await page.locator('#d-current-rows').boundingBox() : 'no such element';
    chk(curBox === null, '#5091: and they take no space on screen', JSON.stringify(curBox));

    await page.selectOption('#d-provider-account', ACCOUNTS[1].dir);
    // Round 4: the open agent carries its OLD model's name, as a real Codex agent does; the switch must not keep it.
    await page.evaluate(() => { CURRENT.modelName = 'GPT 5.6 Sol'; CURRENT.plannedModelName = 'GPT 5.6 Sol'; });
    await page.click('#d-provider-go');
    await page.waitForFunction(() => { const m = document.getElementById('chg-modal'); return m && !m.hidden; }, null, { timeout: 8000 });
    const said = await page.$eval('#chg-small', (e) => e.textContent);
    chk(/b@example\.com/.test(said) && !/your main Claude account/.test(said),
      '#5091: the confirm dialog names the picked Claude account, not "your main Claude account"', said.slice(-160));
    await page.click('#chg-go');
    for (let i = 0; i < 40 && !posted; i++) await page.waitForTimeout(150);
    chk(!!posted && posted.provider === 'anthropic' && posted.account === ACCOUNTS[1].dir && posted.picked === true,
      '#5091: Switch & Restart sends the Claude account the person picked, as a pick', JSON.stringify(posted));
    // Round 1: after the switch, the menu is reset ('') and the rows must come back, not stay hidden.
    await page.waitForTimeout(1500);
    const after = await page.evaluate(() => { const c = document.getElementById('d-current-rows'); return { current: !!c && !c.hidden, menu: document.getElementById('d-provider').value }; });
    chk(after.current === true, "#5091: after the switch the agent's rows are back (a reset menu does not count as a switch being set up)", JSON.stringify(after));
    const modelRow = await page.evaluate(() => { const m = document.getElementById('d-model'); return m ? [...m.options].map((o) => o.textContent).join(' | ') : 'no #d-model'; });
    chk(!/GPT|Sol/.test(modelRow) && /^Claude \(its default model\)/.test(modelRow), "#5091: after the switch the model row says Claude's default model, not the old provider's model or Unknown Model", modelRow.slice(0, 200));
    const runsOn = await page.$eval('#d-runson', (e) => e.textContent);
    chk(/Claude/.test(runsOn) && /b@example\.com/.test(runsOn), '#5091: Right now names Claude and the picked account', runsOn);
    // Round 3: and they speak for the NEW provider: the Move row lists the Claude accounts, on the one picked.
    // The Move menu's first option ("") names the account it is ON; the rest are the Claude accounts it could move to.
    const rows = await page.evaluate(() => { const s = document.getElementById('d-account'); return { here: (s.options[0] || {}).textContent || '', opts: [...s.options].slice(1).map((o) => o.value), msg: document.getElementById('d-account-msg').textContent }; });
    chk(/b@example\.com|account-b/.test(rows.here) && !rows.opts.includes(ACCOUNTS[1].dir) && rows.opts.includes(ACCOUNTS[0].dir)
        && !/OpenAI|Codex|Antigravity|Gemini/.test(rows.msg + rows.here),
      "#5091: after the switch the account row speaks for Claude: on the picked account, the other Claude accounts to move to", JSON.stringify(rows));

    await page.goto(URL + '/?tab=detail&agent=liu', { waitUntil: 'load' }); await page.waitForTimeout(800);
    await page.click('#d-nav [data-go="model"]'); await page.waitForTimeout(400);
    await page.selectOption('#d-provider', 'anthropic'); await page.waitForTimeout(300);
    await page.selectOption('#d-provider', 'openai'); await page.waitForTimeout(300);
    const back = await page.evaluate(() => { const c = document.getElementById('d-current-rows'); return { picker: document.getElementById('d-provider-account').hidden, current: !!c && !c.hidden }; });
    chk(back.current === true, "#5091: back on the agent's own provider, its rows come back", JSON.stringify(back));
    // Round 3: no Claude account can take it (the main signed out, nothing else shares history): the switch refuses,
    // says where to fix it, and sends nothing.
    served = ACCOUNTS.map((a) => (a.provider === 'anthropic' ? { ...a, connection: a.isDefault ? { state: 'none' } : a.connection, memoryShared: a.isDefault ? a.memoryShared : false } : a));
    posted = null;
    await page.goto(URL + '/?tab=detail&agent=liu', { waitUntil: 'load' }); await page.waitForTimeout(1200);
    await page.click('#d-nav [data-go="model"]'); await page.waitForTimeout(400);
    await page.selectOption('#d-provider', 'anthropic'); await page.waitForTimeout(300);
    await page.click('#d-provider-go');
    await page.waitForFunction(() => { const m = document.getElementById('chg-modal'); return m && !m.hidden; }, null, { timeout: 8000 }).catch(() => {});
    if (await page.$('#chg-modal:not([hidden])')) await page.click('#chg-go');
    await page.waitForTimeout(800);
    const none = await page.evaluate(() => document.getElementById('d-provider-msg').textContent + ' | ' + ((document.getElementById('chg-msg') || {}).textContent || ''));
    chk(posted === null && /no Claude account on this computer that can take it/.test(none),
      '#5091: with no Claude account that can take it, the switch refuses with the remedy and sends nothing', JSON.stringify({ posted, none }));
    chk(errs.length === 0, 'no page errors', errs.join(' | '));
  } finally {
    await browser.close();
    server.close();
  }
  console.log(fail.length ? 'FAILED: ' + fail.length : 'all #5091 checks passed');
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.log('FAIL  render-switch-claude-5091 threw: ' + (e && e.message ? e.message : e)); process.exit(1); });
