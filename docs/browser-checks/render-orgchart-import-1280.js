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
 * ⚠️ THE /api/team ROUTE IS INTERCEPTED, so nothing here creates a real agent,
 * and so is DELETE /api/agent/:name/removal (the Undo), so nothing is removed.
 * The parse and the surfacing are the product; the backend is mocked so the
 * check controls created / refused / over-cap and asserts each is rendered.
 *
 * ⚠️ NEEDS A SANDBOX WITH FIRST RUN ALREADY COMPLETE, or the onboarding overlay
 * sits over the board and every click times out against it:
 *
 *     mkdir -p "$SB/data/Kosmos"
 *     echo '{"completedAt":"2026-01-01T00:00:00.000Z"}' > "$SB/data/Kosmos/first-run.json"
 *
 * Run: see the README in this directory (same shape as render-found-undo.js).
 *
 * // Browser-check-surface: pick-orgchart orgchartpick orgchart-text orgchart-usenames orgchart-preview orgchart-preview-box orgchart-count orgchart-list orgchart-create orgchart-edit orgchart-msg orgchart-undo orgchart-undo-go orgchart-undo-keep
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
  /* #1280 Undo: DELETE /api/agent/:name/removal. `removal[name]` is what the engine
     "answers" for that agent; every call is recorded so a check can assert Undo
     reached exactly the created agents, one each. */
  let removal = {};
  const removeCalls = [];
  await page.route('**/api/agent/*/removal', (r) => {
    if (r.request().method() !== 'DELETE') return r.continue();
    const name = decodeURIComponent(new URL(r.request().url()).pathname.split('/')[3]);
    removeCalls.push(name);
    const ans = removal[name] || { outcome: 'removed' };
    r.fulfill({ status: ans.outcome === 'refused' ? 400 : 200, json: ans });
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

  // ---- #1280 Undo: offered after a create, NAMES and COUNTS before it acts ----
  const undoShown = await page.evaluate(() => {
    const u = document.getElementById('orgchart-undo');
    return { visible: !u.hidden, text: u.textContent };
  });
  check('after a create, Undo is offered for exactly the agents it made',
    undoShown.visible && /remove these 3 agents/.test(undoShown.text), JSON.stringify(undoShown));
  await page.click('#orgchart-undo');
  await page.waitForSelector('#orgchart-undo-go:not([hidden])', { timeout: 5000 });
  const asked = await page.evaluate(() => ({
    count: document.getElementById('orgchart-count').textContent,
    items: [...document.getElementById('orgchart-list').querySelectorAll('li')].map((li) => li.textContent),
    msg: document.getElementById('orgchart-msg').textContent,
    keep: !document.getElementById('orgchart-undo-keep').hidden,
  }));
  check('Undo first names every agent and the count, and removes nothing yet',
    /these 3 agents/.test(asked.count) && asked.items.length === 3
      && /Marketing Lead/.test(asked.items[0]) && /Head of Sales/.test(asked.items[1]) && /Engineer/.test(asked.items[2])
      && asked.keep && removeCalls.length === 0,
    JSON.stringify({ asked, removeCalls }));
  check('it says what happens to one already working: it stops, nothing is deleted, it can be started again',
    /stops where it is/.test(asked.msg) && /Nothing is deleted/.test(asked.msg) && /Show removed agents/.test(asked.msg),
    JSON.stringify(asked.msg));
  await page.click('#orgchart-undo-keep');
  await page.waitForTimeout(150);
  const kept = await page.evaluate(() => ({
    count: document.getElementById('orgchart-count').textContent,
    undo: !document.getElementById('orgchart-undo').hidden,
  }));
  check('Keep them removes nothing and offers Undo again',
    /Kept 3 agents/.test(kept.count) && kept.undo && removeCalls.length === 0, JSON.stringify({ kept, removeCalls }));

  removal = { 'head-of-sales': { outcome: 'refused', because: 'that agent is busy; try again in a moment' } };
  await page.click('#orgchart-undo');
  await page.click('#orgchart-undo-go');
  await page.waitForFunction(() => /Removed/.test(document.getElementById('orgchart-count').textContent), null, { timeout: 5000 });
  const undone = await page.evaluate(() => ({
    count: document.getElementById('orgchart-count').textContent,
    items: [...document.getElementById('orgchart-list').querySelectorAll('li')].map((li) => li.textContent),
    undo: { visible: !document.getElementById('orgchart-undo').hidden, text: document.getElementById('orgchart-undo').textContent },
  }));
  check('Remove them asks the engine to remove exactly the three created agents, once each',
    JSON.stringify(removeCalls.slice().sort()) === JSON.stringify(['engineer', 'head-of-sales', 'marketing-lead']),
    JSON.stringify(removeCalls));
  check('Undo reports each answer: two removed, one not, with the engine\'s reason',
    /Removed 2 of 3/.test(undone.count)
      && undone.items.some((t) => /Head of Sales/.test(t) && /busy/.test(t))
      && undone.items.filter((t) => /removed$/.test(t.trim())).length === 2,
    JSON.stringify(undone));
  check('Undo is offered again for the one left, and only it',
    undone.undo.visible && /remove this agent/.test(undone.undo.text), JSON.stringify(undone.undo));
  removal = {};
  removeCalls.length = 0;
  await page.click('#orgchart-undo');
  const askedAgain = await page.evaluate(() => [...document.getElementById('orgchart-list').querySelectorAll('li')].map((li) => li.textContent));
  check('the retry names only the one left before acting',
    askedAgain.length === 1 && /Head of Sales/.test(askedAgain[0]) && removeCalls.length === 0, JSON.stringify(askedAgain));
  await page.click('#orgchart-undo-go');
  await page.waitForFunction(() => /Nothing was deleted/.test(document.getElementById('orgchart-count').textContent), null, { timeout: 5000 });
  const retried = await page.evaluate(() => ({
    count: document.getElementById('orgchart-count').textContent,
    undoHidden: document.getElementById('orgchart-undo').hidden,
  }));
  check('the retry removes only the one left, then Undo goes away and says how to put them back',
    JSON.stringify(removeCalls) === JSON.stringify(['head-of-sales'])
      && /Removed 1 agent\./.test(retried.count) && /Show removed agents/.test(retried.count) && retried.undoHidden,
    JSON.stringify({ removeCalls, retried }));

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
  const freshPreviewUndo = await page.evaluate(() => document.getElementById('orgchart-undo').hidden);
  check('a fresh preview drops the last run\'s Undo (it never reaches an older batch)', freshPreviewUndo);
  await page.click('#orgchart-create');
  await page.waitForTimeout(300);
  const overcap = await page.evaluate(() => document.getElementById('orgchart-count').textContent);
  const overcapUndo = await page.evaluate(() => document.getElementById('orgchart-undo').hidden);
  check('nothing created, so no Undo is offered', overcapUndo);
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
    refused: [{ name: 'engineer', because: 'an agent named engineer already exists' }],
    because: '1 of 2 agents were created; 1 was refused (see refused[])',
  };
  await page.click('#orgchart-create');
  await page.waitForTimeout(300);
  const partial = await page.evaluate(() => ({
    count: document.getElementById('orgchart-count').textContent,
    items: [...document.getElementById('orgchart-list').querySelectorAll('li')].map((li) => li.textContent),
  }));
  const partialUndo = await page.evaluate(() => document.getElementById('orgchart-undo').textContent);
  check('after a partial create, Undo covers only the one that was created',
    /remove this agent/.test(partialUndo), JSON.stringify(partialUndo));
  // The refused row here is the shape an agent that ALREADY EXISTED takes: createAgent refuses a
  // taken name, so it lands in refused[]. Undo must never name it, even though the name matches.
  await page.click('#orgchart-undo');
  const partialAsk = await page.evaluate(() => [...document.getElementById('orgchart-list').querySelectorAll('li')].map((li) => li.textContent));
  check('an agent that already existed (refused as taken) is never in the Undo list',
    partialAsk.length === 1 && /Marketing Lead/.test(partialAsk[0]) && !partialAsk.some((t) => /engineer/i.test(t)),
    JSON.stringify(partialAsk));
  await page.click('#orgchart-undo-keep');
  check('a partial result surfaces both the created and the refused-with-reason',
    /Created 1 of 2/.test(partial.count)
      && partial.items.some((t) => /Marketing Lead/.test(t) && /created/.test(t))
      && partial.items.some((t) => /engineer/i.test(t) && /already exists/.test(t)),
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

  // ---- Duplicate titles de-dup to distinct in-length names, and do NOT hang ---
  // Two identical short titles AND two identical LONG titles (slug > 32 chars).
  // The long pair exercises uniq()'s termination fix: if the suffix were sliced
  // back off, "Preview" would spin forever and this waitForSelector would time out.
  await page.click('#orgchart-edit');
  await page.fill('#orgchart-text',
    'Engineer\nEngineer\nSenior Site Reliability Engineering Manager\nSenior Site Reliability Engineering Manager');
  await page.click('#orgchart-preview');
  await page.waitForSelector('#orgchart-preview-box:not([hidden])', { timeout: 5000 });
  const dedup = await page.evaluate(() => {
    const rows = [...document.getElementById('orgchart-list').querySelectorAll('li')];
    const names = rows.map((li) => {
      const t = li.textContent;
      const i = t.lastIndexOf('→'); // the '→' the row renders before the derived name
      return (i >= 0 ? t.slice(i + 1) : t).trim();
    });
    return { count: rows.length, names, distinct: new Set(names).size, maxLen: Math.max(...names.map((n) => n.length)) };
  });
  check('duplicate titles de-duplicate to distinct names within the length cap (no hang)',
    dedup.count === 4 && dedup.distinct === 4 && dedup.maxLen <= 32, JSON.stringify(dedup));

  check('no page errors', errors.length === 0, errors.join(' | '));

  await browser.close();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
