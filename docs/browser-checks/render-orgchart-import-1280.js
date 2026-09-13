/**
 * The org-chart import (#1280): a fifth option in the create-agent flow that
 * pastes a roster of names and titles and creates a whole team at once, via
 * POST /api/team.
 *
 * 🔑 WHAT NO SOURCE TEST CAN SEE: whether the fifth option actually renders and
 * reveals its own panel (not the single-agent role form), whether the paste
 * PARSES to the right count and derives a machine name per row, whether the
 * names-opt-in toggle changes what the preview shows, and whether the create
 * button SURFACES the /api/team response -- created, refused, and the over-cap
 * because -- through the real handlers.
 *
 * ⚠️ THE /api/team ROUTE IS INTERCEPTED, so nothing here creates a real agent.
 * The parse and the surfacing are the product; the backend is mocked so the
 * check controls created / refused / over-cap and asserts each is rendered.
 *
 * ⚠️ NEEDS A SANDBOX WITH FIRST RUN ALREADY COMPLETE, or the onboarding overlay
 * sits over the board and every click times out against it:
 *
 *     mkdir -p "$SB/data/Kosmos"
 *     echo '{"completedAt":"2026-01-01T00:00:00.000Z"}' > "$SB/data/Kosmos/first-run.json"
 *
 * Run: see the README in this directory (same shape as render-scan-board.js).
 *
 * // Browser-check-surface: pick-orgchart orgchartpick orgchart-text orgchart-usenames orgchart-preview orgchart-preview-box orgchart-count orgchart-list orgchart-create orgchart-edit orgchart-msg
 */
'use strict';

const playwright = require('playwright');

const BASE = process.argv[2] || 'http://127.0.0.1:4399';
const HEADED = process.env.HEADED !== '0';

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
}

(async () => {
  const browser = await playwright.chromium.launch({ headless: !HEADED });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message)));

  /* The one intercept: /api/team. A mutable response so each arm sets what the
     backend "returns" and asserts the UI surfaces it. Nothing real is created. */
  let teamResponse = { outcome: 'created', created: [], refused: [], because: null };
  let teamStatus = 200;
  let lastTeamBody = null;
  await page.route('**/api/team', (r) => {
    lastTeamBody = JSON.parse(r.request().postData() || '{}');
    r.fulfill({ status: teamStatus, json: teamResponse });
  });

  /* /?tab=create is the deep link that opens the create panel and loads the
     role menu (web/index.html: BOOT_TAB === 'create' -> loadRoles()). The fifth
     option is gated on OWN_ROLE, which the real /api/roles serves. */
  await page.goto(BASE + '/?tab=create', { waitUntil: 'networkidle' });
  await page.waitForSelector('#pick-orgchart', { state: 'visible', timeout: 10000 });

  check('the fifth option (Upload an org chart) is offered',
    await page.isVisible('#pick-orgchart'));

  // Choose it by clicking the LABEL, the way a person does: the native radio is
  // opacity:0 / pointer-events:none (.pick2 > input[type=radio]), so a direct
  // input click is intercepted by the fieldset. Clicking the label checks the
  // radio and fires the change that pickMode('orgchart') listens for -- which
  // reveals the panel and hides the shared Continue (the panel has its own button).
  await page.click('#pick-orgchart');
  await page.waitForSelector('#orgchartpick', { state: 'visible', timeout: 8000 });
  const opened = await page.evaluate(() => ({
    panel: !document.getElementById('orgchartpick').hidden,
    nextHidden: document.getElementById('role-next').hidden,
  }));
  check('choosing it reveals the paste panel and hides the shared Continue',
    opened.panel && opened.nextHidden, JSON.stringify(opened));

  // ---- Empty paste: Preview on a blank box explains, and does not open --------
  await page.click('#orgchart-preview');
  await page.waitForTimeout(150);
  const empty = await page.evaluate(() => ({
    msg: document.getElementById('orgchart-msg').textContent,
    msgShown: !document.getElementById('orgchart-msg').hidden,
    boxHidden: document.getElementById('orgchart-preview-box').hidden,
  }));
  check('an empty paste is refused with a message, not an empty preview',
    empty.msgShown && /paste at least one/i.test(empty.msg) && empty.boxHidden,
    JSON.stringify(empty));

  // ---- Parse: three rows, mixed shapes, names OFF (the default) --------------
  await page.fill('#orgchart-text', 'Marketing Lead\nSarah Chen, Head of Sales\nEngineer');
  await page.click('#orgchart-preview');
  await page.waitForSelector('#orgchart-preview-box:not([hidden])', { timeout: 5000 });
  const parsed = await page.evaluate(() => ({
    count: document.getElementById('orgchart-count').textContent,
    items: [...document.getElementById('orgchart-list').querySelectorAll('li')].map((li) => li.textContent),
  }));
  check('the preview counts every row', /\b3 agents\b/.test(parsed.count), JSON.stringify(parsed.count));
  check('each row derives a machine name from its title, names off by default',
    parsed.items.length === 3
      && /marketing-lead/.test(parsed.items[0])
      && /head-of-sales/.test(parsed.items[1])
      && /engineer/.test(parsed.items[2])
      && !parsed.items.some((t) => /named/.test(t)),
    JSON.stringify(parsed.items));

  // ---- Names ON (opt-in): the person's name becomes the machine name ---------
  await page.check('#orgchart-usenames');
  await page.click('#orgchart-preview');
  await page.waitForTimeout(150);
  const named = await page.evaluate(() => (
    [...document.getElementById('orgchart-list').querySelectorAll('li')].map((li) => li.textContent)
  ));
  check('opting into names uses the person for the row that has one',
    named.some((t) => /named Sarah Chen/.test(t) && /sarah-chen/.test(t)),
    JSON.stringify(named));
  // Turn it back off for the create arm, so the request is the safe default.
  await page.uncheck('#orgchart-usenames');
  await page.click('#orgchart-preview');
  await page.waitForTimeout(150);

  // ---- Create (success): the UI surfaces created[] and posts the parse -------
  teamResponse = {
    outcome: 'created',
    created: [
      { name: 'marketing-lead', shownAs: 'Marketing Lead', id: 'a1' },
      { name: 'head-of-sales', shownAs: 'Head of Sales', id: 'a2' },
      { name: 'engineer', shownAs: 'Engineer', id: 'a3' },
    ],
    refused: [],
    because: null,
  };
  await page.click('#orgchart-create');
  await page.waitForTimeout(400);
  const created = await page.evaluate(() => document.getElementById('orgchart-count').textContent);
  check('a successful create surfaces the created count', /Created 3 agents/.test(created), JSON.stringify(created));
  check('the request carried the parsed, title-derived members',
    Boolean(lastTeamBody) && lastTeamBody.creator === 'operator'
      && Array.isArray(lastTeamBody.members) && lastTeamBody.members.length === 3
      && lastTeamBody.members[0].role === 'own'
      && lastTeamBody.members[0].label === 'Marketing Lead'
      && lastTeamBody.members[0].name === 'marketing-lead',
    JSON.stringify(lastTeamBody && lastTeamBody.members));

  // ---- Over-cap and a per-member refusal both surface ------------------------
  await page.click('#orgchart-edit');
  await page.fill('#orgchart-text', 'Marketing Lead\nEngineer');
  await page.click('#orgchart-preview');
  await page.waitForSelector('#orgchart-preview-box:not([hidden])', { timeout: 5000 });
  // A wholesale refusal (over cap, all-dead) is HTTP 400 with a full team body
  // (server.js: outcome 'refused' -> 400). The body carries `outcome`, so the UI's
  // error-envelope guard passes it through and renders the `because`.
  teamStatus = 400;
  teamResponse = {
    outcome: 'refused',
    created: [],
    refused: [],
    because: 'that is 20 agents in one request and the cap is 12. Kosmos holds this bound rather than the prompt. Have the OPERATOR raise the cap (up to 50).',
  };
  await page.click('#orgchart-create');
  await page.waitForTimeout(300);
  const overcap = await page.evaluate(() => document.getElementById('orgchart-count').textContent);
  check('an over-cap refusal (HTTP 400 with a team body) surfaces the message verbatim',
    /the cap is 12/.test(overcap) && /up to 50/.test(overcap), JSON.stringify(overcap));

  await page.click('#orgchart-edit');
  await page.fill('#orgchart-text', 'Marketing Lead\nEngineer');
  await page.click('#orgchart-preview');
  await page.waitForSelector('#orgchart-preview-box:not([hidden])', { timeout: 5000 });
  teamStatus = 200;
  teamResponse = {
    outcome: 'partial',
    created: [{ name: 'marketing-lead', shownAs: 'Marketing Lead', id: 'a1' }],
    refused: [{ name: 'engineer', because: 'that account cannot sign in; reconnect it and try again' }],
    because: '1 of 2 agents were created; 1 was refused (see refused[])',
  };
  await page.click('#orgchart-create');
  await page.waitForTimeout(300);
  const partial = await page.evaluate(() => ({
    count: document.getElementById('orgchart-count').textContent,
    items: [...document.getElementById('orgchart-list').querySelectorAll('li')].map((li) => li.textContent),
  }));
  check('a partial result surfaces both the created and the refused-with-reason',
    /Created 1 of 2/.test(partial.count)
      && partial.items.some((t) => /Marketing Lead/.test(t) && /created/.test(t))
      && partial.items.some((t) => /engineer/i.test(t) && /cannot sign in/.test(t)),
    JSON.stringify(partial));

  // ---- A transport/auth error (no `outcome`) surfaces its error, not a no-op --
  await page.click('#orgchart-edit');
  await page.fill('#orgchart-text', 'Marketing Lead\nEngineer');
  await page.click('#orgchart-preview');
  await page.waitForSelector('#orgchart-preview-box:not([hidden])', { timeout: 5000 });
  // An error envelope: HTTP 403 with `error` and NO `outcome` (e.g. the board-token
  // refusal). Must surface the error text, never fall through to "No agents were created".
  teamStatus = 403;
  teamResponse = { error: 'this board belongs to the account that started it; open it with `kosmos open`' };
  await page.click('#orgchart-create');
  await page.waitForTimeout(300);
  const errored = await page.evaluate(() => ({
    msg: document.getElementById('orgchart-msg').textContent,
    msgShown: !document.getElementById('orgchart-msg').hidden,
  }));
  check('a transport/auth error surfaces its message, not a bare no-op',
    errored.msgShown && /board belongs to the account/.test(errored.msg), JSON.stringify(errored));

  check('no page errors', errors.length === 0, errors.join(' | '));

  await browser.close();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
