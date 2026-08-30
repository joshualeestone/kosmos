'use strict';
/**
 * The Model section (#386): three chained menus like the create form, and a
 * change that is confirmed with its cost and reports its outcome in the dialog.
 *   NODE_PATH=~/work/pw-runtime/node_modules node docs/browser-checks/render-model-change.js
 */
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-model-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-model-workers-'));
// Sandboxed whole or the board refuses to start (#634): the four dirs and an inert tmux.
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-model-projects-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-model-launch-'));
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-model-config-'));
/* 🛑 HOME WAS THE ONE ROOT THIS CHECK DID NOT SEAL, AND IT IS THE ONE THE
   ACCOUNTS LIST READS. `engine/openaiaccounts.js` resolves
   `homeDir() = AGENT_WORKFORCE_HOME || os.homedir()`, so with it unset a
   "sandboxed" check enumerates the OPERATOR'S REAL `~/.codex-*` sign-ins.
   ⇒ Its account rendering then depends on machine state outside the sandbox,
   which changes as agents are added or moved between config dirs. That does not
   look like a sealing bug, it looks like FLAKINESS, and it is not flaky.
   ⚠️ Sealing it is also the only way #1373 can be checked at all: the card is
   about choosing between accounts, and there was nowhere to put a second one. */
process.env.AGENT_WORKFORCE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-model-home-'));
/* 🛑 TWO ROOTS WERE UNSEALED AND THE COMMENT ABOVE ONLY NAMED ONE. `defaultHome()`
   reads `AGENT_WORKFORCE_CODEX_HOME || CODEX_HOME || AGENT_WORKFORCE_HOME/.codex`,
   so either of those walks past the HOME seal, adds a third account, and reds the
   two-sign-ins assertion below on an otherwise-correct build. */
delete process.env.AGENT_WORKFORCE_CODEX_HOME;
delete process.env.CODEX_HOME;
/* Two real OpenAI sign-ins, so "which one" has two answers. A one-account
   fixture would pass a picker check while proving nothing about picking. */
/* 📌 ONE SOURCE FOR THE FIXTURE ACCOUNTS. The stub's accept-list used to restate these
   key literals, so renaming a label or a tail here left the stub silently rejecting the
   very keys this file writes. It fails loud (every positive arm reds) rather than quietly,
   but a set derived from the same source cannot drift at all. */
const FIXTURES = [['alpha', 'ALFA'], ['beta', 'BETA']];
const KEY_FOR = (tail) => 'sk-proj-testtesttesttest' + tail;
for (const [label, tail] of FIXTURES) {
  const d = path.join(process.env.AGENT_WORKFORCE_HOME, '.codex-' + label);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'auth.json'),
    JSON.stringify({ auth_mode: 'apikey', OPENAI_API_KEY: KEY_FOR(tail) }), 'utf8');
}
// The model change rewrites the launch job and restarts it; under dry run
// the runner is inert, so the check never touches launchctl (#619).
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
const ROOT = path.join(__dirname, '..', '..');
const { chromium } = require('playwright');
const fleet = require(path.join(ROOT, 'test-support', 'fleet'));
const firstrun = require(path.join(ROOT, 'engine', 'firstrun'));
const srv = require(path.join(ROOT, 'server.js'));
const fail = [];
const chk = (ok, label, extra) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : '')); if (!ok) fail.push(label); };
/* 🛑 THE FIXTURE KEYS MUST NOT REACH api.openai.com, AND WITHOUT THIS THEY DO.
   GET /api/accounts runs openaiaccounts.listLive() -> checkLive() -> askModels(),
   which posts the key to `AGENT_WORKFORCE_OPENAI_MODELS_URL || the real endpoint`.
   engine/openaiaccounts.js:337 documents this seam and the incident it exists for:
   "the page gate sent a fake key to api.openai.com on every cut and, since #962
   made the badge honest, read 'did not accept this key' (0.5.59a)".
   ⚠️ AND IT IS NOT ONLY HYGIENE, IT DECIDES THE VERDICT. OpenAI answers a bogus
   key with 401 invalid_api_key -> state NONE -> fillSwitchAccounts filters NONE
   out -> the list is empty -> the select stays hidden -> all three positive
   assertions below go red. Worse, the negative arm ("it goes away again") would
   still PASS, because a permanently hidden control satisfies it.
   ⇒ And the failure flips with the network: offline, askModels returns
   unreachable -> UNKNOWN -> kept -> the check passes. Same code, opposite verdict
   by reachability, which is the exact flakiness class the HOME seal above removes.
   📌 Same shape as tools/browser-checks.sh:519 does for render-accounts-openai,
   done in-process here because this check boots its own server. The URL is read
   per call, so setting it before the page loads is enough. */
const ACCEPTED_KEYS = new Set(FIXTURES.map(([, tail]) => KEY_FOR(tail)));
const oaiStub = require('node:http').createServer((q, r) => {
  const auth = String(q.headers.authorization || '');
  const good = q.url === '/v1/models' && ACCEPTED_KEYS.has(auth.replace(/^Bearer /, ''));
  r.writeHead(good ? 200 : 401, { 'content-type': 'application/json' });
  r.end(JSON.stringify(good
    ? { data: [{ id: 'gpt-4o' }] }
    : { error: { code: 'invalid_api_key', message: 'Incorrect API key provided' } }));
});

(async () => {
  await new Promise((done) => oaiStub.listen(0, '127.0.0.1', done));
  process.env.AGENT_WORKFORCE_OPENAI_MODELS_URL =
    'http://127.0.0.1:' + oaiStub.address().port + '/v1/models';
  /* The stub's own control: it must REFUSE a key it was not given, or a stub that
     answers 200 to anything would hide exactly the bug it is here to prevent. */
  const ctlBad = await fetch(process.env.AGENT_WORKFORCE_OPENAI_MODELS_URL,
    { headers: { authorization: 'Bearer sk-proj-not-a-real-fixture-key' } });
  const ctlGood = await fetch(process.env.AGENT_WORKFORCE_OPENAI_MODELS_URL,
    { headers: { authorization: 'Bearer ' + KEY_FOR(FIXTURES[0][1]) } });
  chk(ctlBad.status === 401 && ctlGood.status === 200,
    'the OpenAI stub accepts the fixture keys and refuses others',
    ctlBad.status + '/' + ctlGood.status);

  fleet.install([fleet.agent('mara', { state: 'idle', displayName: 'Mara' })]);
  /* #619: since #454 the Model menu is disabled for an agent with no launch
     file (nothing for setModel to rewrite, so the control is unavailable
     rather than failing after a click), and the fixture agent had none, so
     this check waited forever on a disabled select. Seed the one file the
     product requires, in the shape the product writes, under the sandboxed
     launch dir, before the server starts; the menu is then enabled for a
     real reason and the change below rewrites this file. Angel agreed the
     seam (2026-08-25 03:20). */
  const create = require(path.join(ROOT, 'engine', 'create'));
  fs.mkdirSync(create.AGENTS_DIR, { recursive: true });
  fs.writeFileSync(create.plistPath('mara'), create.plistFor('mara', '/bin/echo', process.env.AGENT_WORKFORCE_TMUX_BIN, null, null, 'claude'));
  try { firstrun.complete(); } catch { /* fine */ }
  const server = await srv.start(0);
  const URL = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(URL + '/?tab=detail&agent=mara', { waitUntil: 'networkidle' }); await page.waitForTimeout(1500);
  if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(300); }
  await page.waitForSelector('#panel-detail:not([hidden])', { timeout: 8000 });
  await page.click('#d-nav [data-go="model"]'); await page.waitForTimeout(500);
  const shape = await page.evaluate(() => ({
    provider: !!document.getElementById('d-provider'), account: !!document.getElementById('d-account'), model: !!document.getElementById('d-model'),
    chained: !!document.querySelector('#d-sec-model .msteps .mstep .mstep #d-model'),
    models: document.querySelectorAll('#d-model option').length,
  }));
  chk(shape.provider && shape.account && shape.model && shape.chained, 'provider, account, model, chained like the create form', JSON.stringify(shape));

  /* #1373: WHICH OpenAI sign-in the agent lands on. Creation has offered this
     since #540; the switch stated a default and named it, and that asymmetry
     was the card. Computed state only (hidden, option count), so headless is
     sound. */
  await page.selectOption('#d-provider', 'openai');
  /* ⏱ WAIT ON THE CONDITION, NOT ON A NUMBER. A fixed sleep encodes how fast this
   machine happened to be: on a loaded box (this fleet routinely runs many agents
   at once) it is the flake shape the rest of this file works to remove, and it
   fails in the reassuring direction, reading the PREVIOUS state and passing.
   Every wait below names the thing it is waiting for, so a timeout is a loud
   failure rather than a quiet wrong answer. */
  await page.waitForFunction(() => {
    const s = document.getElementById('d-provider-account');
    return !!s && !s.hidden && s.options.length > 0;
  }, { timeout: 8000 });
  const pick = await page.evaluate(() => {
    const s = document.getElementById('d-provider-account');
    if (!s) return null;
    return { shown: !s.hidden, opts: [...s.options].map((o) => o.textContent.trim()), value: s.value };
  });
  chk(!!pick && pick.shown, '#1373: choosing OpenAI reveals which sign-in it will run on', JSON.stringify(pick));
  chk(!!pick && pick.opts.length === 2, '#1373: both sign-ins on this computer are offered', JSON.stringify(pick && pick.opts));
  chk(!!pick && !!pick.value, '#1373: one is preselected, so pressing Switch without opening it still works', JSON.stringify(pick && pick.value));
  /* 🛑 AND ONE ASSERTION THAT ONLY A BROWSER CAN MAKE. Everything above reads
     `hidden` and the option list, which is the SAME fact web.switch-account-1373.test.js
     already pins by reading the source, so as a rendering gate it measured no rendering:
     a CSS regression that left the control zero-width, collapsed or off-screen kept every
     arm above green.
     ⚠️ Deliberately a FLOOR, not an exact width. The row is flex and wraps, so pinning a
     number here would re-arm the trap this branch keeps finding: a check that fails on a
     harmless reflow teaches people to widen it until it catches nothing.
     📌 160 IS CENTRED ON MEASUREMENTS, NOT PICKED. Healthy render is 253px wide. A planted
     `width: 0 !important` regression rendered at 118px, because `flex: 1` still hands the
     control some of the row even with its width zeroed, so "collapsed" is not "zero" here
     and a floor near zero would have caught nothing. ⚠️ A FLOOR OF 120 PASSES BY 2px, which
     is luck rather than method: 160 sits ~93px under the healthy value and ~42px over the
     broken one. */
  const box = await page.locator('#d-provider-account').boundingBox();
  chk(!!box && box.width > 160 && box.height > 10,
    '#1373: the sign-in picker occupies real space on screen, not just an unhidden node',
    JSON.stringify(box));
  /* The picker, on screen, RENDERED AND CLOSED. Nothing opens the dropdown and a
     native select popup would not appear in a Playwright screenshot anyway. Written only when SHOT_1373 names a
     path, so the release gate never pays for it and a PR can still get the picture
     the worker rules ask for. Taken HERE because the negative arm below hides the
     control again, and a screenshot of the hidden state proves the wrong thing. */
  if (process.env.SHOT_1373) {
    await page.screenshot({ path: process.env.SHOT_1373 });
    console.log('NOTE  wrote #1373 screenshot to ' + process.env.SHOT_1373);
  }
  /* 🛑 THE CONFIRM SENTENCE ITSELF, RENDERED. Everything above this pins the CONTROL; the
     six-arm sentence the dialog builds from it was pinned only by source regexes, which is
     exactly the argument that justified giving the route its own executed test: a regex
     inspects the expression and never its use. This is the last screen before a restart, so
     it is the worst place to have no arm that runs.
     ⇒ TWO ARMS, because the pair is what proves the claim is gated rather than decorative:
     UNPICKED must hedge, and a REAL pick must name the account. Both open the dialog and
     close it with "Keep it as it is", so nothing is switched and the checks below are
     undisturbed. */
  await page.click('#d-provider-go');
  await page.waitForFunction(() => {
    const m = document.getElementById('chg-modal');
    const e = document.getElementById('chg-small');
    return !!m && !m.hidden && !!e && e.textContent.trim().length > 0;
  }, { timeout: 8000 });
  const untouched = await page.$eval('#chg-small', (e) => e.textContent);
  chk(/sign-in shown above/.test(untouched) && /if that one has gone/.test(untouched),
    '#1373: with the menu showing and untouched, the dialog hedges instead of promising a row',
    untouched.slice(-90));
  chk(!/you picked/.test(untouched),
    '#1373: an untouched menu must not claim the person chose', untouched.slice(-90));
  await page.click('#chg-keep');
  await page.waitForFunction(() => document.getElementById('chg-modal').hidden, { timeout: 8000 });

  /* Now a REAL pick: selecting an option fires `change`, which is what sets the flag. */
  const second = await page.$eval('#d-provider-account', (s2) => s2.options[1].value);
  await page.selectOption('#d-provider-account', second);
  await page.click('#d-provider-go');
  await page.waitForFunction(() => {
    const m = document.getElementById('chg-modal');
    const e = document.getElementById('chg-small');
    return !!m && !m.hidden && !!e && e.textContent.trim().length > 0;
  }, { timeout: 8000 });
  const picked = await page.$eval('#chg-small', (e) => e.textContent);
  chk(/it will run on /.test(picked) && /BETA|ALFA/.test(picked),
    '#1373: a real pick is named back in the sentence, not hedged',
    picked.slice(-90));
  chk(!/if that one has gone/.test(picked),
    '#1373: a real pick must not be hedged, because a picked account the engine cannot use is REFUSED rather than replaced',
    picked.slice(-90));
  await page.click('#chg-keep');
  await page.waitForFunction(() => document.getElementById('chg-modal').hidden, { timeout: 8000 });

  /* 🔑 THE ARM THAT MAKES THE THREE ABOVE MEAN ANYTHING. A control that is
     always visible would pass every one of them, and this shows the picker can
     go away.
     ⚠️ BUT BE PRECISE ABOUT WHICH CLAUSE IT EXERCISES, because the old label read
     wider than the test is. `mara` is a CLAUDE fixture, so selecting anthropic
     makes `armed` false, and the picker would hide on THAT ALONE whether or not
     the `!openai` clause existed. ⇒ This arm proves NOT-ALWAYS-VISIBLE. It does
     NOT prove the OpenAI clause, which is pinned at source level in
     web.switch-account-1373.test.js instead. A second fixture already on OpenAI
     is what would make this arm say what its name says. */
  await page.selectOption('#d-provider', 'anthropic');
  await page.waitForFunction(() => {
    const s = document.getElementById('d-provider-account');
    return !!s && s.hidden;
  }, { timeout: 8000 });
  /* The BEFORE state, for judging the layout change rather than guessing at it: the
     same row with the picker hidden is exactly what this section looked like before
     the card. */
  if (process.env.SHOT_1373_BEFORE) {
    await page.screenshot({ path: process.env.SHOT_1373_BEFORE });
    console.log('NOTE  wrote #1373 BEFORE screenshot to ' + process.env.SHOT_1373_BEFORE);
  }
  const gone = await page.evaluate(() => document.getElementById('d-provider-account').hidden);
  chk(gone === true, "#1373: switching back to the agent's own provider hides the sign-in picker", String(gone));
  /* 🛑 AND THE SAME ARGUMENT THE POSITIVE ARM GOT, APPLIED SYMMETRICALLY. The line above
     reads the DOM property the code just set, so it cannot fail for a RENDERING reason:
     a rule that left the control visible while `hidden` was true would keep it green.
     `boundingBox()` returns null only when the element is genuinely not rendered, so this
     is the half the property read cannot cover. Cheap, and it closes the arm rather than
     leaving the negative case weaker than the positive one it exists to balance. */
  const goneBox = await page.locator('#d-provider-account').boundingBox();
  chk(goneBox === null,
    '#1373: the hidden picker occupies no space on screen, not merely a set property',
    JSON.stringify(goneBox));
  /* NOTE, and it belongs to the `selectOption('anthropic')` ABOVE rather
     than to whatever follows: that call is the negative arm, and it happens to
     leave the menu on the fixture agent's own provider, so the model-change flow
     below does not inherit a perturbed provider menu. ⚠️ If `mara` ever became an
     OpenAI fixture those two purposes would want opposite values and this would
     quietly stop being true. */
  await page.screenshot({ path: process.env.SHOT || path.join(os.tmpdir(), 'model-section.png') });
  const opt = await page.$eval('#d-model', (s) => { const o = [...s.options].find((x) => x.value); return o ? o.value : null; });
  chk(!!opt, 'the model menu offers a choice', opt);
  if (opt) {
    await page.selectOption('#d-model', opt);
    await page.click('#d-model-go'); await page.waitForTimeout(300);
    chk(!(await page.$eval('#chg-modal', (m) => m.hidden)), 'the change opens a dialog rather than acting');
    const small = await page.$eval('#chg-small', (e) => e.textContent);
    chk(/agreed to and has not done yet/.test(small) && /^Mara restarts/.test(small), 'the dialog names what is lost, before it happens', small.slice(0, 60));
    chk(/^Change Mara to /.test(await page.$eval('#chg-title', (e) => e.textContent)), 'the title names the agent and the model');
    await page.click('#chg-go');
    /* Wait for the sentence, not a fixed 2.5 s: the change rewrites the job
       and restarts it, and how long the restart takes is the product's. A
       verdict that never arrives is still caught, by the bound. */
    let out = 'Working…';
    for (let i = 0; i < 60 && out === 'Working…'; i += 1) { await page.waitForTimeout(500); out = await page.$eval('#chg-msg', (e) => e.textContent); }
    chk(out.length > 0 && out !== 'Working…', 'the outcome is reported inside the dialog, in a sentence', out.slice(0, 80));
    chk(!(await page.$eval('#chg-modal', (m) => m.hidden)) && (await page.$eval('#chg-keep', (b) => b.textContent)) !== 'Keep it as it is', 'the dialog stays open with a Done/Close rather than vanishing');
    await page.click('#chg-keep'); await page.waitForTimeout(200);
    chk(await page.$eval('#chg-modal', (m) => m.hidden), 'Done closes it');
  }
  chk(errs.length === 0, 'no page errors', errs.join(' | '));
  await browser.close();
  /* ⚠️ NOT AWAITED. `close()` waits for keep-alive sockets, and undici (global
     fetch) holds one to the stub for a few seconds after the last live check, so
     awaiting it can hang this check with no output. `process.exit` on the next
     statement tears the stub down regardless, which is why `server.close()` beside
     it is not awaited either. */
  oaiStub.close(); server.close(); process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
