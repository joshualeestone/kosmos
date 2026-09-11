/**
 * #2651: the untied-remove override affordance.
 *
 * When an agent's Remove is refused because Kosmos cannot tie the running session
 * to the card (`plan()` returns `{ok:false, untied:true, ...}` -- a residual /
 * auto-imported card, a teammate's bare-named session on a shared machine), the
 * detail panel must offer a USER-INITIATED "Remove from my board anyway" that
 * clears the card (DELETE /api/agent/<name>/removal?force=1) WITHOUT stopping the
 * session. Every OTHER removal state (tied -> the normal Remove; a non-untied
 * refusal -> no override) must NOT show it. This drives the real loadRemoval()
 * against a stubbed plan and checks the affordance end to end.
 *
 * Two scenarios, hermetic (file://), fetch stubbed:
 *  - A (untied refusal): plan -> {ok:false, untied:true}. The override button
 *    (#d-remove-force) + note show; #d-remove-start (the normal Remove) is hidden;
 *    clicking the override sends DELETE ...?force=1.
 *  - B (tied, removable): plan -> {ok:true}. The normal Remove shows; the override
 *    stays HIDDEN.
 *
 * CONTROL / wrong-asset guard: #d-remove-force is a DISTINCT element from the
 * normal #d-remove-start, so the check cannot pass on the wrong control.
 */

const nodePath = require('node:path');

let chromium;
try { ({ chromium } = require('playwright')); }
catch {
  console.log('render-remove-force-2651: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}

const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');

(async () => {
  let browser;
  try { browser = await chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch (err) {
    console.error('FAIL  render-remove-force-2651: could not start a browser'
      + (process.env.HEADED === '0' ? '.' : ' (headed; try HEADED=0).'));
    console.error('  ' + (err && err.message ? err.message.split('\n')[0] : err));
    process.exit(1);
  }
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  await page.goto('file://' + PAGE);

  const r = await page.evaluate(async () => {
    // Stop the board's 5s poll: it calls loadRemoval(CURRENT, {fromPoll}) on its
    // own and would race the direct calls below (bumping REMOVE_TOKEN so ours
    // returns early, or hitting the withdrawn branch off an empty board fetch).
    const realSetTimeout = window.setTimeout.bind(window);
    for (let i = 1; i < 100000; i++) { try { clearInterval(i); clearTimeout(i); } catch (_e) { /* */ } }
    // Neutralise any re-scheduling the app does after this point, so a poll cannot
    // bump REMOVE_TOKEN during the awaited loadRemoval below. Keep a real timer for
    // this check's own sleep/waitFor.
    window.setInterval = () => 0;
    window.setTimeout = () => 0;
    const sleep = (ms) => new Promise((res) => realSetTimeout(res, ms));
    const NAME = 'mortals-orch';
    const forceWrap = () => document.getElementById('d-remove-force-wrap');
    const forceBtn = () => document.getElementById('d-remove-force');
    const startBtn = () => document.getElementById('d-remove-start');
    const noteEl = () => document.getElementById('d-remove-force-note');
    const waitFor = async (pred, capMs) => {
      const end = Date.now() + capMs;
      while (Date.now() < end) { if (pred()) return true; await sleep(15); }
      return pred();
    };

    let planMode = 'untied';   // 'untied' | 'tied'
    let deleteUrl = null;
    window.fetch = (u, opts) => {
      const url = String(u);
      const method = (opts && opts.method) || 'GET';
      if (url.indexOf('/removal') !== -1 && method === 'DELETE') {
        deleteUrl = url;
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ outcome: 'removed', because: 'we cleared it from your board and left the session running.' }) });
      }
      if (url.indexOf('/removal') !== -1 && method === 'GET') {
        return planMode === 'untied'
          ? Promise.resolve({ ok: false, status: 400, json: async () => ({ ok: false, untied: true, because: 'something called ' + NAME + ' is already running, and we cannot confirm it is this agent. Kosmos will not stop it, because doing so could stop the wrong thing.' }) })
          : Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, name: NAME, label: NAME, hint: '', question: 'Remove ' + NAME + '?', reassurance: 'You can put it back.' }) });
      }
      if (url.indexOf('/leftover') !== -1) return Promise.resolve({ ok: false, status: 400, json: async () => ({ ok: false }) });
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    };

    // Point the detail panel at the agent and run the real removal loader.
    // ⚠️ A BARE ASSIGNMENT, not `window.CURRENT`. The page declares `let CURRENT`
    // at top level, which is a global LEXICAL binding, NOT a window property --
    // `window.CURRENT = ...` makes a second, unrelated property loadRemoval never
    // reads, so its `!CURRENT || CURRENT.sessionName !== sessionName` guard returns
    // early and nothing paints. An unqualified assignment inside page.evaluate
    // resolves up the scope chain to that lexical binding (as render-talk.js and
    // render-talk-search.js also rely on). loadRemoval is a top-level function
    // declaration, so it IS a window property; called bare here for symmetry.
    CURRENT = { sessionName: NAME, name: NAME, isNamedOurs: false };

    // ---- Scenario A: the untied refusal -> the override is offered ----
    planMode = 'untied';
    try { await loadRemoval(NAME); } catch (e) { return { error: 'loadRemoval(untied) threw: ' + (e && e.message || e) }; }
    await waitFor(() => forceWrap() && forceWrap().hidden === false, 2000);
    const aOverrideShown = !!(forceWrap() && !forceWrap().hidden);
    const aNoteShown = !!(noteEl() && !noteEl().hidden);
    const aStartHidden = !!(startBtn() && startBtn().hidden);
    const aForceAgent = forceBtn() ? (forceBtn().dataset.forceAgent || '') : '';
    // wrong-asset guard: the override is a distinct element from the normal Remove.
    // Both resolve by their own ids (forceBtn -> #d-remove-force, startBtn ->
    // #d-remove-start), so the only discriminating check is that they are two
    // different elements; an `id === 'd-remove-force'` conjunct would be
    // tautological (forceBtn is fetched by that id) and is deliberately omitted.
    const distinct = !!(forceBtn() && startBtn() && forceBtn() !== startBtn());

    // Clicking the override sends DELETE ...?force=1.
    deleteUrl = null;
    if (forceBtn()) forceBtn().click();
    await waitFor(() => deleteUrl !== null, 2000);
    const aDeleteForced = typeof deleteUrl === 'string' && /\/removal\?force=(?:1|true)\b/i.test(deleteUrl);

    // ---- Scenario A': the shared override button must RE-ENABLE for the NEXT
    // untied agent. The click above disabled it, and a successful clear leaves it
    // disabled on purpose ("do not re-enable a button that is now gone"). But
    // #d-remove-force is ONE element reused across every panel, so opening
    // another untied agent (a second loadRemoval) must make it clickable again,
    // or clearing residuals one-after-another dead-ends after the first -- the
    // exact flow this feature exists for. Regression guard for that reuse. ----
    await waitFor(() => forceBtn() && forceBtn().disabled === true, 2000);
    const aDisabledAfterClick = !!(forceBtn() && forceBtn().disabled === true);
    planMode = 'untied';
    CURRENT = { sessionName: NAME, name: NAME, isNamedOurs: false };
    try { await loadRemoval(NAME); } catch (e) { return { error: 'loadRemoval(untied reopen) threw: ' + (e && e.message || e) }; }
    await waitFor(() => forceBtn() && forceBtn().disabled === false, 2000);
    const aReEnabledOnReopen = !!(forceBtn() && forceBtn().disabled === false);

    // ---- Scenario B: a tied, removable agent -> the override stays hidden ----
    planMode = 'tied';
    CURRENT = { sessionName: NAME, name: NAME, isNamedOurs: true };
    try { await loadRemoval(NAME); } catch (e) { return { error: 'loadRemoval(tied) threw: ' + (e && e.message || e) }; }
    await waitFor(() => startBtn() && startBtn().hidden === false, 2000);
    const bStartShown = !!(startBtn() && !startBtn().hidden);
    const bOverrideHidden = !!(forceWrap() && forceWrap().hidden);

    return { aOverrideShown, aNoteShown, aStartHidden, aForceAgent, distinct, aDeleteForced, aDisabledAfterClick, aReEnabledOnReopen, bStartShown, bOverrideHidden };
  });

  await browser.close();

  const problems = [];
  if (r.error) problems.push('the check could not run: ' + r.error);
  if (!r.error) {
    if (!r.aOverrideShown) problems.push('on an untied-refused removal, #d-remove-force-wrap must be SHOWN so the person can clear the card, but it was hidden');
    if (!r.aNoteShown) problems.push('the override note (that it leaves the session running) must be shown alongside the override button');
    if (!r.aStartHidden) problems.push('on an untied refusal the normal "Remove this agent" (#d-remove-start) must stay HIDDEN (the engine refuses it)');
    if (r.aForceAgent !== 'mortals-orch') problems.push('the override button must carry the agent name (data-forceAgent) so it clears the right card: got "' + r.aForceAgent + '"');
    if (!r.distinct) problems.push('THE WRONG-ASSET GUARD: the override (#d-remove-force) must be a DISTINCT element from the normal Remove (#d-remove-start)');
    if (!r.aDeleteForced) problems.push('clicking the override must DELETE /api/agent/<name>/removal?force=1 (the query the server reads), but it did not');
    if (!r.aDisabledAfterClick) problems.push('the override click did not disable the button, so the re-enable guard below cannot prove anything (the click handler must disable it while the DELETE is in flight)');
    if (!r.aReEnabledOnReopen) problems.push('after a forced clear the shared override button stayed DISABLED for the next untied agent -- clearing residuals one-after-another dead-ends after the first (setForceOffered must re-enable it on show)');
    if (!r.bStartShown) problems.push('a tied removable agent must still offer the normal Remove (#d-remove-start)');
    if (!r.bOverrideHidden) problems.push('a tied removable agent must NOT show the untied override (#d-remove-force-wrap)');
  }

  console.log('  ' + JSON.stringify(r));
  if (problems.length) {
    console.error('render-remove-force-2651: ' + problems.length + ' problem(s)');
    for (const p of problems) console.error('  FAIL  ' + p);
    process.exit(1);
  }
  console.log('PASS  render-remove-force-2651');
  process.exit(0);
})();
