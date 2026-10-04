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
 * // Browser-check-surface: team-orgchart-open cstep-team orgchartpick orgchart-text orgchart-usenames orgchart-preview orgchart-preview-box orgchart-count orgchart-list orgchart-create orgchart-edit orgchart-msg orgchart-undo orgchart-undo-go orgchart-undo-keep
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

  /* Three intercepts: /api/team (the create), /api/agent/:name/removal (Undo's plan GET and its
     DELETE) and /api/removed (what Undo re-reads after removing). Each is mutable so an arm sets
     what the backend "returns" and asserts the UI surfaces it. Nothing real is created or removed. */
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
  let plans = {};
  const removeCalls = [];
  const removedNow = new Set();
  const PLAN = { ok: true, reassurance: 'Removing is not deleting. Its files will not be deleted.',
    loses: ['Its place on the board', 'Starting again on its own, until you put it back'],
    keeps: ['Its folder, on this computer', 'Its instructions', 'Everything it has written'] };
  let removalDelayMs = 0;
  await page.route('**/api/agent/*/removal', async (r) => {
    const name = decodeURIComponent(new URL(r.request().url()).pathname.split('/')[3]);
    if (r.request().method() === 'GET') {
      const p = plans[name];
      if (p && p.status) return r.fulfill({ status: p.status, json: p.json });
      return r.fulfill({ status: 200, json: p || { ...PLAN, name, label: name } });
    }
    if (r.request().method() !== 'DELETE') return r.continue();
    removeCalls.push(name);
    if (removalDelayMs) await new Promise((ok) => setTimeout(ok, removalDelayMs));
    // The engine's real clean answer carries a `because` (engine/remove.js), so the mock does too.
    const ans = removal[name] || { outcome: 'removed',
      because: name + ' has been removed from Kosmos. Its folder and everything in it is still on your computer.' };
    if (ans.outcome === 'removed' || ans.recorded) removedNow.add(name);
    r.fulfill({ status: ans.outcome === 'refused' ? 400 : 200, json: ans });
  });
  // The removed list the page re-reads after Undo: exactly what the mocked removals recorded.
  await page.route('**/api/removed', (r) => r.fulfill({ status: 200,
    json: { agents: [...removedNow].map((name) => ({ name, shownAs: name, removedAt: '2026-09-27T00:00:00Z', stopped: true })) } }));

  /* /?tab=create is the deep link that opens the create panel. #4556: New Agent opens on the three-way choice,
     and the org chart lives on the Team screen, behind its own "Upload an org chart" button. */
  await page.goto(BASE + '/?tab=create', { waitUntil: 'networkidle' });
  await page.click('#cstep-kind [data-path="team"]');
  await page.waitForSelector('#team-orgchart-open', { state: 'visible', timeout: 10000 });

  check('the Team screen offers Upload an org chart',
    await page.isVisible('#team-orgchart-open'));

  await page.click('#team-orgchart-open');
  await page.waitForSelector('#orgchartpick', { state: 'visible', timeout: 8000 });
  const opened = await page.evaluate(() => ({
    panel: !document.getElementById('orgchartpick').hidden,
    onTeam: !document.getElementById('cstep-team').hidden,
    expanded: document.getElementById('team-orgchart-open').getAttribute('aria-expanded'),
  }));
  check('choosing it reveals the paste panel on the Team screen',
    opened.panel && opened.onTeam && opened.expanded === 'true', JSON.stringify(opened));

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

  // ---- #1280 Undo: offered after a create, NAMES and COUNTS before it acts ----
  const undoShown = await page.evaluate(() => {
    const u = document.getElementById('orgchart-undo');
    return { visible: !u.hidden, text: u.textContent };
  });
  check('after a create, Undo is offered for exactly the agents it made',
    undoShown.visible && /remove these 3 agents/.test(undoShown.text), JSON.stringify(undoShown));
  // Engineer is an agent Kosmos cannot start again, so its losses differ from the other two.
  plans = { engineer: { ...PLAN, loses: ['Its place on the board', 'Running, and Kosmos cannot start it again for you'] } };
  await page.click('#orgchart-undo');
  await page.waitForSelector('#orgchart-undo-go:not([hidden])', { timeout: 5000 });
  plans = {};
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
  check('an agent whose losses differ from the rest says so on its own row, and only it',
    /this one loses: .*cannot start it again/.test(asked.items[2])
      && !/this one loses/.test(asked.items[0]) && !/this one loses/.test(asked.items[1]),
    JSON.stringify(asked.items));
  check('it says what happens to one already working, in the engine\'s words: it stops, keeps its work, loses its place',
    /working now stops/.test(asked.msg) && /Removing is not deleting/.test(asked.msg)
      && /keeps: .*everything it has written/i.test(asked.msg) && /loses: its place on the board/i.test(asked.msg),
    JSON.stringify(asked.msg));
  const askFocus = await page.evaluate(() => ({ focus: document.activeElement && document.activeElement.id,
    backHidden: document.getElementById('orgchart-edit').hidden,
    previewDisabled: document.getElementById('orgchart-preview').disabled }));
  check('asking puts the keyboard on Keep them and moves Back to the list and Preview aside',
    askFocus.focus === 'orgchart-undo-keep' && askFocus.backHidden && askFocus.previewDisabled, JSON.stringify(askFocus));
  await page.click('#orgchart-undo-keep');
  await page.waitForFunction(() => /Created 3 agents/.test(document.getElementById('orgchart-count').textContent), null, { timeout: 5000 });
  const kept = await page.evaluate(() => ({
    count: document.getElementById('orgchart-count').textContent,
    undo: !document.getElementById('orgchart-undo').hidden,
    focus: document.activeElement && document.activeElement.id,
    back: !document.getElementById('orgchart-edit').hidden,
  }));
  check('Keep them removes nothing, puts the create result back, and returns the keyboard to Undo',
    /Created 3 agents/.test(kept.count) && kept.undo && kept.back && kept.focus === 'orgchart-undo' && removeCalls.length === 0,
    JSON.stringify({ kept, removeCalls }));

  // Head of Sales is refused by its PLAN (asked first), so Remove them must not send it a DELETE.
  plans = { 'head-of-sales': { ok: false, because: 'that agent is busy; try again in a moment' } };
  removal = {
    engineer: { outcome: 'partial', recorded: true, because: 'Engineer has been stopped, but something called engineer is still running.' },
  };
  await page.click('#orgchart-undo');
  await page.waitForSelector('#orgchart-undo-go:not([hidden])', { timeout: 5000 });
  const goLabel = await page.evaluate(() => document.getElementById('orgchart-undo-go').textContent);
  check('Remove them counts only the ones the engine will remove', /Remove these 2 agents/.test(goLabel), JSON.stringify(goLabel));
  await page.click('#orgchart-undo-go');
  plans = {};
  await page.waitForFunction(() => /Removed/.test(document.getElementById('orgchart-count').textContent), null, { timeout: 5000 });
  const undone = await page.evaluate(() => ({
    count: document.getElementById('orgchart-count').textContent,
    items: [...document.getElementById('orgchart-list').querySelectorAll('li')].map((li) => li.textContent),
    undo: { visible: !document.getElementById('orgchart-undo').hidden, text: document.getElementById('orgchart-undo').textContent },
  }));
  check('Remove them asks the engine to remove the two it can, once each, and never the one its plan refused',
    JSON.stringify(removeCalls.slice().sort()) === JSON.stringify(['engineer', 'marketing-lead']),
    JSON.stringify(removeCalls));
  check('Undo reports each answer: a partial the engine recorded counts as removed with its sentence, a refusal stays',
    /Removed 2 of 3/.test(undone.count)
      && undone.items.some((t) => /Head of Sales/.test(t) && /not removed: .*busy/.test(t))
      && undone.items.some((t) => /Engineer/.test(t) && /removed, but .*still running/.test(t))
      && undone.items.some((t) => /Marketing Lead removed$/.test(t.trim())),
    JSON.stringify(undone));
  const afterFocus = await page.evaluate(() => document.activeElement && document.activeElement.id);
  check('after removing, the keyboard lands on the Undo still on offer', afterFocus === 'orgchart-undo', JSON.stringify(afterFocus));
  check('Undo is offered again for the one left, and only it',
    undone.undo.visible && /remove this agent/.test(undone.undo.text), JSON.stringify(undone.undo));
  removal = {};
  removeCalls.length = 0;
  await page.click('#orgchart-undo');
  await page.waitForSelector('#orgchart-undo-go:not([hidden])', { timeout: 5000 });
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
  plans = { 'marketing-lead': { status: 500, json: { error: 'we could not work out whether this agent can be removed' } } };
  await page.click('#orgchart-undo');
  await page.waitForSelector('#orgchart-undo-go:not([hidden])', { timeout: 5000 });
  const unreadable = await page.evaluate(() => [...document.getElementById('orgchart-list').querySelectorAll('li')].map((li) => li.textContent));
  check('a plan the engine could not work out is said as "could not check", never shown as fine',
    unreadable.some((t) => /Marketing Lead/.test(t) && /could not check this one first: we could not work out/.test(t)), JSON.stringify(unreadable));
  await page.click('#orgchart-undo-keep');
  plans = { 'marketing-lead': { ok: false, because: 'Marketing Lead has already been removed from Kosmos.' } };
  await page.click('#orgchart-undo');
  await page.waitForSelector('#orgchart-undo-go:not([hidden])', { timeout: 5000 });
  const partialAsk = await page.evaluate(() => [...document.getElementById('orgchart-list').querySelectorAll('li')].map((li) => li.textContent));
  check('a removal the engine would refuse shows its reason while asking, before anything is pressed',
    partialAsk.some((t) => /Marketing Lead/.test(t) && /cannot be removed: .*already been removed/.test(t)), JSON.stringify(partialAsk));
  const allRefused = await page.evaluate(() => ({ go: document.getElementById('orgchart-undo-go').disabled,
    msg: document.getElementById('orgchart-msg').textContent }));
  check('when every agent\'s plan refuses, Remove is not offered and nothing promises it stops',
    allRefused.go && /None of these can be removed/.test(allRefused.msg) && !/stops/.test(allRefused.msg), JSON.stringify(allRefused));
  plans = {};
  check('Undo never reads refused[]: a row refused as taken is not in the Undo list',
    partialAsk.length === 1 && /Marketing Lead/.test(partialAsk[0]) && !partialAsk.some((t) => /engineer/i.test(t)),
    JSON.stringify(partialAsk));
  await page.click('#orgchart-undo-keep');
  check('a partial result surfaces both the created and the refused-with-reason',
    /Created 1 of 2/.test(partial.count)
      && partial.items.some((t) => /Marketing Lead/.test(t) && /created/.test(t))
      && partial.items.some((t) => /engineer/i.test(t) && /already exists/.test(t)),
    JSON.stringify(partial));

  // ---- A transport/auth error (no `outcome`) surfaces its error, not a no-op --
  const undoBeforePreview = await page.evaluate(() => !document.getElementById('orgchart-undo').hidden);
  await page.click('#orgchart-edit');
  await page.fill('#orgchart-text', 'Marketing Lead\nEngineer');
  await page.click('#orgchart-preview');
  await page.waitForSelector('#orgchart-preview-box:not([hidden])', { timeout: 5000 });
  const undoAfterPreview = await page.evaluate(() => document.getElementById('orgchart-undo').hidden);
  check('a fresh preview drops the Undo that was on offer (it never reaches an older batch)',
    undoBeforePreview && undoAfterPreview, JSON.stringify({ undoBeforePreview, undoAfterPreview }));
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

  // ---- Leaving the panel while Undo is removing: the old run's progress is not painted on return. #4688: the
  // reopened panel shows what it removed before the person left, and offers Undo for the one still on the board ----
  await page.fill('#orgchart-text', 'Marketing Lead\nEngineer');
  await page.click('#orgchart-preview');
  await page.waitForSelector('#orgchart-preview-box:not([hidden])', { timeout: 5000 });
  teamStatus = 200;
  teamResponse = { outcome: 'created', created: [{ name: 'marketing-lead', shownAs: 'Marketing Lead', id: 'a1' },
    { name: 'engineer', shownAs: 'Engineer', id: 'a3' }], refused: [], because: null };
  removeCalls.length = 0;
  await page.click('#orgchart-create');
  await page.waitForSelector('#orgchart-undo:not([hidden])', { timeout: 5000 });
  await page.click('#orgchart-undo');
  await page.waitForSelector('#orgchart-undo-go:not([hidden])', { timeout: 5000 });
  removalDelayMs = 800;
  await page.click('#orgchart-undo-go');
  // Leave the Team screen and come back (#4556: Back, then Team, then Upload an org chart).
  await page.click('#create-path-back');
  await page.click('#cstep-kind [data-path="team"]');
  await page.click('#team-orgchart-open');
  // A swallowed timeout still fails: the check asserts the same state.
  await page.waitForFunction(() => /before you left/.test(document.getElementById('orgchart-count').textContent), null, { timeout: 5000 }).catch(() => {});
  removalDelayMs = 0;
  const superseded = await page.evaluate(() => ({
    count: document.getElementById('orgchart-count').textContent,
    boxHidden: document.getElementById('orgchart-preview-box').hidden,
    previewDisabled: document.getElementById('orgchart-preview').disabled,
    undo: document.getElementById('orgchart-undo').hidden ? null : document.getElementById('orgchart-undo').textContent,
    asking: !document.getElementById('orgchart-undo-go').hidden,
  }));
  check('an Undo left mid-run: the reopened panel shows what it removed, offers Undo for the rest, and Preview works (#4688)',
    !/Removing/.test(superseded.count) && /Removed 1 of 2 before you left\. 1 is still on your board/.test(superseded.count)
    && !superseded.boxHidden && !superseded.asking && /remove this agent/.test(superseded.undo || '') && !superseded.previewDisabled, JSON.stringify(superseded));
  check('and it stops sending removals once left: one of two was asked, never the second',
    removeCalls.length === 1, JSON.stringify(removeCalls));

  check('no page errors', errors.length === 0, errors.join(' | '));

  await browser.close();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
