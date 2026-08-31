'use strict';
/**
 * #540: an OpenAI account, added from the Accounts page with a pasted key
 * and offered on the create form. Driven in a real browser against a board
 * booted with AGENT_WORKFORCE_CODEX_BIN pointed at a stand-in codex that
 * writes auth.json from stdin (tools/browser-checks.sh writes it), so no
 * real key is ever involved and nothing reaches the operator's ~/.codex-*.
 *
 * What it asserts, each a thing a person would see: the form reveals on
 * its button; the key field is a password field; the answer names the
 * key's tail and never the key; the field is emptied once stored; the row
 * lists by provider; no OpenAI row carries the Claude history arm (no
 * ruling for codex yet); on the create form, choosing OpenAI leaves the
 * account menu live and offers the new account while the model menu still
 * parks; choosing Anthropic back shows no OpenAI account; and removal ASKS
 * FIRST (#1683, #1702), so the first press only arms and leaves the account
 * on the list, and the second press is what removes it.
 *
 * Computed-state only, so headless is sound. First run is completed
 * through the product's own route first: on a fresh board the first-run
 * pane sits ON TOP of Settings, which is how this check found itself
 * clicking a paragraph.
 */
const pw = require('playwright');
/* #1156: this check POSTs /api/first-run/complete to whatever BASE it is
   given, so it declines rather than mutating a board that is not a fixture. */
require('./lib-sandbox-guard.js').requireSandbox('render-accounts-openai.js');
const BASE = process.argv[2] || 'http://127.0.0.1:4399';
let failed = 0;
(async () => {
  const r = await fetch(BASE + '/api/first-run/complete', { method: 'POST' });
  if (!r.ok) { console.log('FAIL  could not complete first run on the board'); process.exit(1); }
  const b = await pw.chromium.launch({ headless: true }); const p = await b.newPage();
  const say = (k, v, d) => { if (!v) failed += 1; console.log((v ? 'PASS' : 'FAIL') + '  ' + k + (d ? '  ' + d : '')); };
  await p.goto(BASE + '/?tab=settings', { waitUntil: 'networkidle' });
  await p.waitForTimeout(500);
  if (await p.evaluate(() => document.getElementById('panel-settings').hidden)) {
    await p.goto(BASE + '/#settings', { waitUntil: 'networkidle' });
    await p.waitForTimeout(500);
  }
  if (await p.evaluate(() => document.getElementById('panel-settings').hidden)) {
    // Last resort so the ACCOUNTS flow can still be exercised: open the panel the way the tab code does.
    await p.evaluate(() => { document.getElementById('panel-settings').hidden = false; });
    console.log('NOTE  settings panel opened by hand; the URL route did not open it');
  }
  // Settings > Accounts
  await p.evaluate(() => { try { settingsGo('accounts'); } catch (e) { try { showTab('settings'); } catch (e2) {} const b = document.querySelector('[data-go="accounts"]'); if (b) b.click(); } });
  await p.waitForTimeout(800);
  const sec = await p.evaluate(() => { const s = document.getElementById('s-sec-accounts'); return s ? !s.hidden : null; });
  say('accounts section opens', sec === true, String(sec));
  // #770: the picker moved into its own "Add a provider" dialog, reached
  // through a door in the section; it opens on a dropdown (Josh's word,
  // not the old data-pick button pair #730 shipped, which is gone) and the
  // OpenAI key form is revealed by picking OpenAI in it.
  say('the door into Add a provider is visible', await p.isVisible('#acct-add-open'));
  say('before opening, the dialog is hidden', await p.isHidden('#acct-add-modal'));
  await p.click('#acct-add-open');
  await p.waitForTimeout(300);
  say('the dialog opens', await p.isVisible('#acct-add-modal'));
  const vis = await p.evaluate(() => { let el = document.getElementById('acct-provider-pick'); const hid = []; if (!el) return ['(no #acct-provider-pick)']; while (el) { const cs = getComputedStyle(el); if (el.hidden || cs.display === 'none' || cs.visibility === 'hidden') hid.push(el.tagName + '#' + el.id + '.' + String(el.className).split(' ')[0]); el = el.parentElement; } return hid; });
  say('nothing above the provider dropdown is hidden', vis.length === 0, JSON.stringify(vis));
  const geo = await p.evaluate(() => { const b = document.getElementById('acct-provider-pick'); if (!b) return { rect: [0, 0, 0, 0] }; const r = b.getBoundingClientRect(); return { rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] }; });
  say('the provider dropdown has a size', geo.rect[2] > 0 && geo.rect[3] > 0, JSON.stringify(geo));
  // Before the pick: neither form is showing. Without this, "reveals on the
  // pick" cannot be told from "always shown", the regression #730 exists to
  // prevent.
  say('before the pick, the OpenAI form is hidden', await p.isHidden('#acct-openai-flow'));
  // #770: every provider named in the dropdown, live ones enabled, coming
  // ones disabled -- the same claim #730's two-button check made, restated
  // for a select's options.
  const opts770 = await p.evaluate(() => [...document.querySelectorAll('#acct-provider-pick option')].map((o) => ({ value: o.value, text: o.textContent, disabled: o.disabled })));
  say('Anthropic Claude and OpenAI are live options', opts770.some((o) => o.value === 'claude' && !o.disabled && /Claude/.test(o.text)) && opts770.some((o) => o.value === 'openai' && !o.disabled && /OpenAI/.test(o.text)), JSON.stringify(opts770));
  say('at least one other provider is listed and disabled', opts770.some((o) => o.disabled && /coming/i.test(o.text)), JSON.stringify(opts770));
  await p.selectOption('#acct-provider-pick', 'openai');
  await p.waitForTimeout(300);
  say('add-by-key form reveals on picking OpenAI', await p.isVisible('#acct-openai-flow'));
  say('and the Claude flow is closed (one provider at a time, #730)', await p.isHidden('#acct-claude-flow'));
  say('the key field is a password field', (await p.getAttribute('#acct-openai-key', 'type')) === 'password');
  await p.fill('#acct-openai-key', 'sk-proj-walkwalkwalkwalkwalkWALK');
  /* 🛑 A UNIQUE LABEL PER ATTEMPT, BECAUSE THE RETRY COULD NEVER PASS AND
     REPLACED THE REAL ERROR. This check creates an OpenAI account and has no
     cleanup: the runner's flaky-retry re-runs it against the SAME still-live
     board, so attempt 2 hit "there is already an OpenAI account by that name"
     and that became the reported failure. On 0.5.88 the true cause (the
     Connected rename above) was visible only in attempt 1.
     ⚠️ THE GUARD MEANT TO ABSORB A FLAKE GUARANTEED A SECOND FAILURE, and a
     different one, which is worse than not retrying: it overwrites the
     diagnosis with a consequence of the first attempt.
     ⇒ Disconnect has no engine route yet (#770), so the account cannot be
     removed from the page. A per-attempt label is the fix available here.
     Nothing asserts on this string; it is checked as "API key ending WALK". */
  await p.fill('#acct-openai-label', 'Walk Test ' + process.pid + '-' + Date.now().toString(36).slice(-4));
  await p.click('#acct-openai-go');
  await p.waitForTimeout(1200);
  const msg = await p.innerText('#acct-openai-msg');
  say('adding answers with the tail, never the key', /API key ending WALK/.test(msg) && !/walkwalk/.test(msg), msg);
  say('the key field is emptied after the add', (await p.inputValue('#acct-openai-key')) === '');
  // #770: each account is its own box now (.acct-row retired), a green
  // Connected mark and a Disconnect door on every one.
  /* 🛑 THE PROVIDER IS NO LONGER IN THE ROW. kosmos#1393 grouped the accounts by
     provider, so the name now sits once in the group head (.acct-prov-name) and
     the row carries only what differs: the account and its state. This check
     asserted /OpenAI/ against the ROW's own text and went red on a correct page,
     failing the 0.6.05 cut at step 3b. The evidence was the row text itself:
       "API key ending WALK Signed in Disconnect"
     the key tail present, the provider gone.
     ✅ SO IT READS THE PAIR: each group's NAME with the rows inside THAT group.
     That asserts more than the old line did, not less, because it now also
     requires the row to be in the RIGHT box rather than merely to exist. */
  const groups = await p.evaluate(() => [...document.querySelectorAll('#set-accounts .acct-prov')].map((g) => ({
    provider: (g.querySelector('.acct-prov-name') || {}).innerText || '',
    rows: [...g.querySelectorAll('.acct-box')]
      .filter((r) => r.getBoundingClientRect().height > 0)
      .map((r) => r.innerText.replace(/\s+/g, ' ').trim()),
  })));
  /* Kept flat as well, because two assertions below are about rows regardless of
     which box they are in. */
  const rows = groups.flatMap((g) => g.rows);
  /* 🔑 A CONTROL ON THE FIXTURE ITSELF. If the grouping ever stops rendering, the
     `groups` array is empty, `.some(...)` is false, and every assertion below
     would fail for the wrong reason. This says so in its own line instead. */
  say('the accounts render grouped by provider', groups.length > 0 && rows.length > 0,
    JSON.stringify(groups.map((g) => g.provider + ':' + g.rows.length)));
  /* 🛑 SURVIVING MUTATION, found by Baron Draxum on review: `some()` CANNOT SEE A
     DUPLICATE. Render TWO OpenAI groups and every assertion in this block still
     passes, because one matching group is all `some` ever asks for.
     ⇒ That is not a corner case. Naming each provider ONCE is the entire promise
     of #1393, so the single defect this check most needed to catch was the one
     shape it was structurally blind to. */
  const provNames = groups.map((g) => g.provider.trim()).filter(Boolean);
  say('each provider is named exactly once', new Set(provNames).size === provNames.length,
    JSON.stringify(provNames));
  say('the OpenAI group holds the key-tail row', groups.some((g) => /OpenAI/.test(g.provider)
      && !/Codex/.test(g.provider)
      && g.rows.some((r) => /API key ending WALK/.test(r))), JSON.stringify(groups));
  /* Same move: the OpenAI-ness of a row is now a property of its GROUP. */
  say('no row in the OpenAI group carries the history arm',
    !groups.some((g) => /OpenAI/.test(g.provider) && g.rows.some((r) => /history/.test(r))));
  // #962: the badge is a LIVE answer. The harness points the check at a stub
  // that accepts exactly the walk key (tools/browser-checks.sh), so this line
  // proves the live path renders it on an accepted key, not that a badge is
  // hardcoded.
  /* 🛑 THE WORD IS "Signed in", NOT "Connected" (#874, merged 16:42 on
     2026-08-27 as 7fddbacc). This assertion still said Connected and it took
     down cut 0.5.88, which was the FIRST cut to carry #874.
     ⚠️ IT IS NOT A FLAKE AND IT WAS NOT CONTENTION. It reproduces on the
     first run against the runner's own sandbox-4 fixture, every time. The
     retry made it look intermittent, for a separate reason recorded below.
     📌 The page is right and this was wrong: the badge says what it knows,
     and "Connected" claimed more than a signed-in account establishes. The
     rename is the product decision; this line was left behind by it. */
  say('every box says Signed in (live check against the harness stub accepted the walk key)', rows.length > 0 && rows.every((r) => /Signed in/.test(r)), JSON.stringify(rows));
  /* 🛑 THIS ASSERTED "Disconnect is disabled everywhere" AND #1372 MADE IT
     FALSE. The OpenAI arm has an engine route now, so its button is live and says
     Remove; Claude's still has none (#1184) and keeps the honest dead Disconnect.
     ⚠️ THIS WOULD HAVE BEEN THE THIRD CUT THIS ONE FILE TOOK DOWN by an assertion
     that was correct when written: "Connected"->"Signed in" failed 0.5.88, the
     provider leaving the row failed 0.6.05. Each was green right up to the change
     it contradicted, which is why a passing check is not evidence of coverage.
     ✅ SO IT ASSERTS THE SPLIT, PER PROVIDER, instead of one blanket state:
     tightened on the axis this change promises, kept on the axis it leaves alone
     -- and kept NON-VACUOUSLY, because under a blanket every() "the Claude button
     is dead" and "no Claude row rendered at all" are the same pass. */
  const doors = await p.evaluate(() => [...document.querySelectorAll('#set-accounts .acct-prov')].map((g) => ({
    provider: ((g.querySelector('.acct-prov-name') || {}).innerText || '').trim(),
    buttons: [...g.querySelectorAll('.acct-disconnect')].map((b) => ({
      label: (b.innerText || '').trim(), disabled: !!b.disabled, forgets: !!b.dataset.forget,
    })),
  })));
  const openaiDoors = doors.filter((g) => /OpenAI/.test(g.provider) && !/Codex/.test(g.provider)).flatMap((g) => g.buttons);
  const otherDoors = doors.filter((g) => !/OpenAI/.test(g.provider)).flatMap((g) => g.buttons);
  say('the OpenAI account offers a live Remove (#1372)',
    openaiDoors.length > 0 && openaiDoors.every((b) => !b.disabled && b.forgets && /^Remove$/.test(b.label)),
    JSON.stringify(doors));
  /* Reported, not asserted: this fixture adds no Claude account, so the #1184 arm
     has nothing to say here and a silent pass would claim that it did. */
  if (otherDoors.length === 0) {
    console.log('NOTE  no non-OpenAI account in this fixture; the #1184 dead-Disconnect arm was not exercised');
  } else {
    say('a non-OpenAI account keeps the dead Disconnect (#1184 unchanged)',
      otherDoors.every((b) => b.disabled && !b.forgets && /^Disconnect$/.test(b.label)), JSON.stringify(otherDoors));
  }
  // Create form: OpenAI provider -> account menu offers the new account
  await p.goto(BASE + '/?tab=create', { waitUntil: 'load' });
  await p.waitForSelector('#pick-pm:not([hidden])', { timeout: 8000 });
  await p.evaluate(() => { document.getElementById('pick-pm').click(); document.getElementById('role-next').click(); });
  await p.waitForTimeout(700);
  const hasProv = await p.evaluate(() => !!document.getElementById('create-provider'));
  say('create form present', hasProv);
  await p.selectOption('#create-provider', 'openai');
  await p.waitForTimeout(300);
  const opts = await p.evaluate(() => { const s = document.getElementById('create-account'); return { disabled: s.disabled, opts: [...s.options].map((o) => o.textContent), val: s.value }; });
  say('account menu is enabled for OpenAI and offers the new account', !opts.disabled && opts.opts.some((o) => /API key ending WALK/.test(o)), JSON.stringify(opts));
  const model = await p.evaluate(() => document.getElementById('create-model').disabled);
  say('model menu still parks for OpenAI', model === true);
  await p.selectOption('#create-provider', 'anthropic');
  await p.waitForTimeout(300);
  const back = await p.evaluate(() => { const s = document.getElementById('create-account'); return [...s.options].map((o) => o.textContent); });
  say('switching back to Anthropic shows no OpenAI account', !back.some((o) => /API key/.test(o)), JSON.stringify(back));
  /* #1372: the account can be removed, and the credential survives it.
     This is the CONTROL half of that card. The engine and the route are measured
     end to end (engine/openaiaccounts.test.js, server.forget-openai-1372.test.js)
     but neither of them can press a button, and nothing on this card merged until
     a real browser had. Computed state only -- which rows exist, what the sentence
     says -- so headless is sound.
     📌 It runs LAST on purpose: it removes the account the create-form
     assertions above need. */
  await p.goto(BASE + '/?tab=settings', { waitUntil: 'networkidle' });
  await p.waitForTimeout(400);
  if (await p.evaluate(() => document.getElementById('panel-settings').hidden)) {
    await p.evaluate(() => { document.getElementById('panel-settings').hidden = false; });
  }
  await p.evaluate(() => { try { settingsGo('accounts'); } catch (e) { const b = document.querySelector('[data-go="accounts"]'); if (b) b.click(); } });
  await p.waitForTimeout(800);
  /* 🔑 THE SECTION-OPEN CONTROL, mirroring the first open at :49-50. The re-open
     above navigates away and back, force-unhides #panel-settings and calls
     settingsGo with a SILENT catch and a [data-go] fallback, and until now nothing
     checked it worked. That mattered the moment the assertions below started
     depending on RENDERED GEOMETRY: a section that failed to reopen makes every
     row zero-height, and the arm assertion would red as "the FIRST press only
     ARMS" while the real cause is a closed panel. A false red on a release gate
     that points at the wrong component is worse than no assertion. Fail as
     itself. */
  const secAgain = await p.evaluate(() => { const s = document.getElementById('s-sec-accounts'); return s ? !s.hidden : null; });
  say('the accounts section is open again', secAgain === true, String(secAgain));
  const rowsBefore = await p.evaluate(() => [...document.querySelectorAll('#set-accounts .acct-box')].map((r) => r.innerText.replace(/\s+/g, ' ').trim()));
  /* 🔑 THE ARM THAT MAKES THE ABSENCE BELOW MEAN ANYTHING. Without it,
     "the row went away" and "the row was never rendered" are the same pass. */
  say('before the click, the account is on the list',
    rowsBefore.some((r) => /API key ending WALK/.test(r)), JSON.stringify(rowsBefore));
  /* 🛑 #1702 MADE REMOVAL A TWO-PRESS CONFIRM AND THIS CHECK STILL PRESSED ONCE,
     so it red every cut from the moment #1702 landed: the single press only ARMED,
     the row stayed, and both assertions below failed with the label reading
     "Remove it?". It killed release 0.6.20 at step 3b.
     ⭐ THE CLASS: when you change a rendered behaviour, the check you are THINKING
     about is the one you are writing. The one that already exists is invisible
     because it is passing, right up until it is not.
     ✅ ASSERT THE ARM RATHER THAN TOLERATING IT. Pressing twice blindly would go
     green whether or not the confirm exists, leaving #1683's whole promise (ask
     first) unguarded at the page layer.
     🔑 ONE `walkStep`, AND IT IS ONE COPY RATHER THAN A COMMENT SAYING SO. An
     earlier version of this block claimed "one row predicate used by the press and
     by both reads" while physically duplicating the four-line selection in two
     evaluate bodies. Nothing bound them, the drift it warned about was one edit
     away, and a reader would have trusted the comment instead of re-checking. It
     now takes a boolean: read, or read-and-click, same selection either way.
     Visible-only, matching the `groups` reader above and 1c5e2614 ("browser checks
     assert rendered text, not DOM text"): a DOM count reads a merely HIDDEN row as
     present, failing in the reassuring direction.
     ⚠️ A REPAINT BETWEEN THE PRESSES WOULD DISARM THIS. The arm lives in a
     per-button closure, so a repaint of #set-accounts rebuilds the buttons, resets
     `armed`, and the second press only re-arms: the gate then reds as "the account
     leaves the list" with the row still there, pointing at the wrong cause.
     📌 The guards that make it unreachable, named precisely because an earlier
     version of this comment said "every paintAccounts() caller is event-driven"
     and THAT IS FALSE: acctFlowPaint() runs off a 1-second setInterval. It cannot
     fire here for three narrower reasons a reader trusting that sentence would
     never re-check: acctFlowWatch is started only by acctAddStart, the Claude
     connect flow, which this check never reaches; acctFlowPaint early-returns on
     the ACCT_FLOW_LAST dedup; and the connected arm calls acctFlowStop() before
     repainting. That is materially more fragile than "event-driven", so an
     accounts poll added later would make a RELEASE GATE intermittently red. */
  const walkStep = (doClick) => p.evaluate((click) => {
    const shown = [...document.querySelectorAll('#set-accounts .acct-box')]
      .filter((r) => r.getBoundingClientRect().height > 0);
    const row = shown.find((r) => /API key ending WALK/.test(r.innerText));
    const b = row ? row.querySelector('[data-forget]') : null;
    const seen = {
      /* textContent, not innerText: an EXACT-MATCH assertion on a label the page
         sets itself, and innerText would move under a text-transform. Stated
         because docs/browser-checks/README.md (#687) asks every textContent read in
         a wired check to say which it is, and because the `offers a live Remove`
         assertion above reads this same element with innerText. */
      label: b ? b.textContent.replace(/\s+/g, ' ').trim() : '(no button)',
      listed: shown.some((r) => /API key ending WALK/.test(r.innerText)),
      shownRows: shown.length,
      /* 🔑 THE TIMING-INDEPENDENT ARM SIGNAL. The acting branch sets
         `btn.disabled = true` SYNCHRONOUSLY, before its first await; the arming
         branch returns before reaching it. So `disabled === false` after the first
         press proves the handler did NOT act, whatever the network did. Without
         this, the hybrid regression (arms AND fires the DELETE) is caught only if
         the round trip plus repaint happens to land inside the 300ms window, and
         goes GREEN on a slower machine. */
      disabled: b ? !!b.disabled : null,
      found: !!b,
    };
    if (click && b) { b.click(); return Object.assign({}, seen, { clicked: true }); }
    return Object.assign({}, seen, { clicked: false });
  }, doClick);
  /* 🔑 THE BEFORE ARM. Without it this asserts a STATE, not a TRANSITION: a
     regression rendering the button as "Remove it?" AT REST would pass for the
     wrong reason. The `offers a live Remove` assertion is two full navigations
     earlier against a destroyed page, so it is not an arm for this one. */
  const beforePress = await walkStep(false);
  say('before the press, the button rests on "Remove"',
    beforePress.label === 'Remove' && beforePress.listed === true, JSON.stringify(beforePress));
  const pressOne = await walkStep(true);
  say('the Remove button is there to press', pressOne.clicked === true, JSON.stringify(pressOne));
  await p.waitForTimeout(300);
  const firstPress = await walkStep(false);
  say('the FIRST press only ARMS, it does not remove (#1683, #1702)',
    firstPress.label === 'Remove it?' && firstPress.listed === true && firstPress.disabled === false,
    JSON.stringify({ before: beforePress, after: firstPress }));
  /* Guarded like the first press, and it reports the PAGE rather than repeating
     the boolean being asserted. A bare `if (b) b.click()` no-ops silently, and
     then "the account leaves the list" fails without distinguishing "we pressed
     and it did not remove" from "we never pressed at all". */
  const pressTwo = await walkStep(true);
  say('the second press lands on the armed button', pressTwo.clicked === true,
    JSON.stringify({ afterFirst: firstPress, atSecondPress: pressTwo }));
  await p.waitForTimeout(1500);
  const after = await p.evaluate(() => ({
    rows: [...document.querySelectorAll('#set-accounts .acct-box')].map((r) => r.innerText.replace(/\s+/g, ' ').trim()),
    msg: (document.getElementById('set-accounts-msg') || {}).innerText || '',
  }));
  say('the account leaves the list', !after.rows.some((r) => /API key ending WALK/.test(r)), JSON.stringify(after.rows));
  /* The promise the whole card turns on: it FORGETS, it does not delete, and the
     sentence has to say so. "Removed" and "deleted" are different promises. */
  say('the answer says the sign-in file is still on the computer',
    /still on this computer/.test(after.msg) && /nothing was deleted/.test(after.msg), after.msg);
  await b.close();
  console.log(failed ? failed + ' check(s) failed' : 'all checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.log('FAIL  check threw  ' + e.message); process.exit(1); });
