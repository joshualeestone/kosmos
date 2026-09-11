'use strict';

/**
 * kosmos#2575 (STATE half): DRIVE the project-page "Not waiting? Clear it"
 * dismiss button in a real browser.
 *
 * ⚠️ WHY THIS EXISTS. The button shipped in PR #2591 with node coverage
 * (`web.pj-clear-state-2575.test.js`), but that test LIFTS `pjClearState` and
 * runs it against stubs -- it never puts the button on a screen. `node --test`
 * cannot see whether the button actually renders inside a painted `#pj-question`
 * block, whether it is REACHABLE (this repo has shipped a control that was in
 * the DOM and `inert` -- render-talk screenshotted a perfect page nothing on it
 * could click), whether the real click-listener (`web/index.html`) invokes
 * `pjClearState`, or whether a successful clear takes the question OFF screen.
 * That paint->click->loadThread wiring is exactly the runtime gap the card's own
 * disposition named as the reason it stayed needs-browser. This check closes it.
 * It does NOT close #2575's needs-OPERATOR half (Josh's live prod verify).
 *
 * Per docs/browser-checks/README.md (#1769): a committed headless check runs
 * from ANY session, no MCP, no operator. It loads the page over file:// and
 * answers every route from `addInitScript` (like render-talk), so it needs no
 * board and can never touch a real one.
 *
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 \
 *     node docs/browser-checks/render-pj-clear-2575.js
 *
 * ⚠️ NODE_PATH is not optional: require resolves from THIS file's directory, so
 * without it the script walks docs/browser-checks/node_modules and exits
 * MODULE_NOT_FOUND.
 *
 * The BODY SHAPE it feeds `paintThread` is the REPORTED needs_you (the
 * Priya-Raman case #2575 was filed about), matched to what paintThread reads
 * -- asking + question.reported -- not hand-rolled, so a wrong-shape fixture
 * cannot route the paint into a different branch and answer a different
 * question.
 */

const playwright = require('playwright');
const path = require('node:path');

const PAGE = 'file://' + path.join(path.resolve(__dirname, '..', '..'), 'web', 'index.html');
const HEADED = process.env.HEADED !== '0';

const results = [];
/* Ternary emit shape (like render-projects-map's check()): a PASS/FAIL result
   line, NOT a counted SHAPE-1 finding-emit site, so the reason-grep guard's
   EXPECTED_SITES is untouched. */
function check(name, pass, detail) {
  results.push({ name, pass: Boolean(pass) });
  console.log((pass ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  ' + detail : ''));
}

/* The reported-needs_you thread body paintThread consumes. `asking` and the
   clear result are read from page globals so scenarios can re-arm the stub. */
function initStub() {
  window.__posted = [];
  // Refuse the page's 5s polls: a Playwright page is VISIBLE, so tick's
  // document.hidden guard does not stop it, and a background poll would race
  // every hand-driven paint (the render-talk lesson). We only need to refuse it,
  // not record it, so this stub returns a fake id and keeps nothing.
  window.setInterval = () => 0;
  // The project this check drives, defined here so the stub's OWN /api/projects
  // response carries it too -- not only the global we seed below.
  // 🛑 WHY (kosmos#2575 flake, ~50% before this): setInterval=0 stops REPEAT
  // polls, but the page's ONE-TIME startup loadProjects() (already in flight from
  // page load) still resolves, and it does `PROJECTS = body.projects || []`. When
  // /api/projects fell through to the catch-all (`{agents:[]}`, no `projects`),
  // that late resolve WIPED our seeded p1 -- so paintThread had already unhidden
  // #pj-question, then the project vanished, the view reset to the list
  // (`if (!p) pjView('list'); PJ_CURRENT=null`), and the question re-hid. Whether
  // the poll landed before or after our openProject was a coin-flip = the flake.
  // Answering /api/projects with p1 makes every read agree, so no late poll can
  // clobber the seed. This is a HARNESS completeness fix; the product paints
  // correctly (proven: the run passes whenever this race is won).
  window.__project = {
    id: 'p1', name: 'Project 1C', parent: null, archived: false,
    agents: [{ sessionName: 'Mara', name: 'Mara' }],
    defaultAgent: 'Mara', summary: { total: 1, needsYou: 1 },
  };
  window.__asking = true;      // does the thread say the agent is asking?
  window.__clearOk = true;     // should the clear route succeed?
  const enc = (o) => new Response(JSON.stringify(o), {
    status: 200, headers: { 'content-type': 'application/json' },
  });
  window.fetch = async (url, opts) => {
    const u = String(url);
    window.__posted.push({ url: u, opts: opts || null });
    if (u.includes('/clear-selfreport')) {
      return window.__clearOk
        ? enc({ ok: true, cleared: true, state: 'idle', by: 'operator' })
        : new Response(JSON.stringify({ ok: false, because: 'that self-report could not be cleared' }),
            { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (u.includes('/thread/')) {
      if (window.__asking) {
        return enc({
          ok: true,
          asking: true,
          agent: { sessionName: 'Mara' },
          question: { text: 'No materials on this machine for Harbor Health. What should Project 1C produce?', reported: true },
          messages: [],
          viewport: { text: null },
        });
      }
      return enc({ ok: true, asking: false, agent: { sessionName: 'Mara' }, messages: [], viewport: { text: null } });
    }
    // The projects LIST GET (plural, no id) -- carry our project so a startup
    // loadProjects() (`PROJECTS = body.projects || []`) populates/keeps p1 rather
    // than wiping the seed. Must not match the singular `/api/project/<id>/...`,
    // and scoped to GET so the create POST (same bare path) still hits the
    // catch-all rather than being handed a list.
    if (/\/api\/projects(\?|$)/.test(u) && (!opts || !opts.method || String(opts.method).toUpperCase() === 'GET')) {
      return enc({ ok: true, projects: [window.__project] });
    }
    // #2691 (Josh 2026-09-10): the "Not waiting? Clear it" control now lives in the
    // Engineering-mode-only #pj-thread box (pjApplyEngMode hides it while ENG_ON is
    // false). This harness must report Engineering mode ON so the button is on screen;
    // the sibling render-engmode-gate-2131 asserts the same box is hidden in Off and
    // shown in On, so this is the intended, not-a-regression behaviour.
    if (u.includes('/api/engmode')) return enc({ on: true });
    // Everything else (first-run, docs, you, avatar) gets a benign ok so a
    // startup poll cannot fill the console and mask a real error. The agents poll
    // assigns `LAST = data.agents`, so it must carry an array or LAST becomes
    // undefined and paintFreeAgentPicker throws.
    return enc({ ok: true, agents: [] });
  };
}

(async () => {
  let browser;
  try { browser = await playwright.chromium.launch({ headless: !HEADED }); }
  catch (err) {
    console.error('FAIL  render-pj-clear-2575: could not start a browser'
      + (HEADED ? ' (headed; try HEADED=0).' : '.'));
    console.error('  ' + (err && err.message ? err.message.split('\n')[0] : err));
    process.exit(1);
  }
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    // file:// cannot serve the open agent's avatar; that is this harness's own
    // condition, not the page's defect (the render-talk exemption).
    if (/ERR_FILE_NOT_FOUND/.test(m.text())) return;
    pageErrors.push('console: ' + m.text());
  });

  await page.addInitScript(initStub);
  await page.goto(PAGE);
  if (await page.isVisible('#firstrun')) await page.keyboard.press('Escape');
  // Activate the Projects tab, or #panel-projects stays display:none and the
  // project view (and its button) has no layout box.
  await page.click('[data-tab="projects"]').catch(() => {});

  // Open a project whose one member is a reported-needs_you agent. openProject
  // shows the detail view (pjView('one')) and fires loadThread, which paints the
  // question block through the real path.
  await page.evaluate(() => {
    // Defensive: the first-run overlay sets `inert` on body children; a leftover
    // inert makes every elementFromPoint answer BODY (a page that screenshots
    // perfectly and cannot be clicked). Clear any that survived Escape.
    document.querySelectorAll('body > [inert]').forEach((el) => el.removeAttribute('inert'));
    // The fleet's free-agent snapshot the picker reads; seed it so a load-time
    // poll that resolved to no `agents` cannot have left it undefined.
    LAST = [];
    // Seed from the SAME object the /api/projects stub returns, so the global we
    // open and the value a late startup poll would re-read cannot disagree.
    PROJECTS.length = 0;
    PROJECTS.push(window.__project);
    openProject('p1');
  });

  // Wait for the async loadThread to paint the question block.
  await page.waitForFunction(() => {
    const q = document.getElementById('pj-question');
    return q && q.hidden === false;
  }, { timeout: 5000 }).catch(() => {});

  // #2691 (Josh 2026-09-10): the clear control moved into the Engineering-mode-only
  // #pj-thread box, so turn Engineering mode ON through the app's own refresh (reading
  // the stub's on:true above). Without this the box stays display:none and the button
  // has a 0x0 box -- reachable=false and page.click times out -- which is the CORRECT
  // Off-mode behaviour, not a regression. Done after the paint wait so the startup
  // engmode poll cannot race it back off.
  await page.evaluate(async () => {
    if (typeof refreshEngMode === 'function') await refreshEngMode();
    if (typeof pjApplyEngMode === 'function') pjApplyEngMode();
  });
  await page.waitForFunction(() => {
    const t = document.getElementById('pj-thread');
    return t && t.hidden === false;
  }, { timeout: 5000 }).catch(() => {});

  // ---- Scenario 1: paint + reachability ----
  const s1 = await page.evaluate(() => {
    const q = document.getElementById('pj-question');
    const btn = document.getElementById('pj-question-clear');
    if (!btn) return { error: 'the clear button is not in the DOM' };
    btn.scrollIntoView({ block: 'center' });
    const r = btn.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return {
      questionShown: q && q.hidden === false,
      btnText: (btn.textContent || '').trim(),
      // reachable: the point at the button's centre is the button (or inside it),
      // not BODY (inert/covered).
      reachable: !!(hit && (hit === btn || btn.contains(hit))),
      target: PJ_QUESTION_AGENT,
    };
  });
  if (s1.error) { console.error('render-pj-clear-2575: ' + s1.error); await browser.close(); process.exit(1); }
  check('the question block paints for a reported needs_you', s1.questionShown, JSON.stringify(s1.questionShown));
  check('the clear button reads "Not waiting? Clear it"', s1.btnText === 'Not waiting? Clear it', JSON.stringify(s1.btnText));
  check('the clear button is reachable (not inert/covered)', s1.reachable, 'hit=' + JSON.stringify(s1.reachable));
  check('paintThread set PJ_QUESTION_AGENT to the asking agent', s1.target === 'Mara', JSON.stringify(s1.target));

  // ---- Scenario 2: a successful click clears, the question comes off screen, it persists ----
  await page.evaluate(() => { window.__posted = []; window.__clearOk = true; window.__asking = false; });
  await page.click('#pj-question-clear');
  await page.waitForFunction(() => {
    const q = document.getElementById('pj-question');
    return q && q.hidden === true;
  }, { timeout: 5000 }).catch(() => {});
  const s2 = await page.evaluate(() => {
    const q = document.getElementById('pj-question');
    const btn = document.getElementById('pj-question-clear');
    const emsg = document.getElementById('pj-question-clear-msg');
    const posts = window.__posted.filter((p) => p.url.includes('/clear-selfreport'));
    const c = posts[0] || null;
    let body = null;
    try { body = c && c.opts && c.opts.body ? JSON.parse(c.opts.body) : null; } catch { body = 'unparseable'; }
    return {
      clearCalls: posts.length,
      url: c && c.url,
      method: c && c.opts && c.opts.method,
      body,
      questionHidden: q && q.hidden === true,
      target: PJ_QUESTION_AGENT,
      errText: (emsg && emsg.textContent) || '',
      btnEnabled: btn && btn.disabled === false,
    };
  });
  check('a successful click POSTs the clear route exactly once', s2.clearCalls === 1, 'calls=' + s2.clearCalls);
  check('it clears the painted agent (correct route + method)',
    /\/api\/agent\/Mara\/clear-selfreport$/.test(s2.url || '') && s2.method === 'POST',
    (s2.url || '') + ' ' + (s2.method || ''));
  check('it sends the operator-dismissed reason', s2.body && s2.body.reason === 'operator-dismissed', JSON.stringify(s2.body));
  check('a successful clear takes the question OFF screen', s2.questionHidden, JSON.stringify(s2.questionHidden));
  check('the clear target is dropped after success', s2.target == null, JSON.stringify(s2.target));
  check('no stale error line after a success', s2.errText === '', JSON.stringify(s2.errText));
  check('the button is re-enabled after a success', s2.btnEnabled, JSON.stringify(s2.btnEnabled));

  // Persistence: a re-read (the poll / a reload) still sees asking:false, so the
  // question stays off screen rather than flashing back.
  await page.evaluate(() => loadThread());
  // Race-proof: assert the persisted hidden state directly rather than sleeping a
  // fixed span. loadThread is awaited above, so this resolves at once; it removes the
  // one place a slow/loaded machine could have flaked a timed wait.
  await page.waitForFunction(() => {
    const q = document.getElementById('pj-question');
    return q && q.hidden === true;
  }, { timeout: 5000 }).catch(() => {});
  const s2b = await page.evaluate(() => {
    const q = document.getElementById('pj-question');
    return { stillHidden: q && q.hidden === true };
  });
  check('the cleared question stays off screen on the next read (persists)', s2b.stillHidden, JSON.stringify(s2b.stillHidden));

  // ---- Scenario 3: the red-capable contrast -- a FAILED clear keeps the question up ----
  // Re-arm an asking state, then make the clear route reject. Success hides the
  // question; failure must NOT -- a regression that always-hides or never-hides
  // is caught by the two arms disagreeing.
  await page.evaluate(async () => { window.__asking = true; await loadThread(); });
  await page.waitForFunction(() => {
    const q = document.getElementById('pj-question');
    return q && q.hidden === false;
  }, { timeout: 5000 }).catch(() => {});
  await page.evaluate(() => { window.__posted = []; window.__clearOk = false; });
  await page.click('#pj-question-clear');
  // Race-proof: wait for the failure's OWN signal (the could-not-clear line pjClearState
  // writes after its mocked-rejected fetch) instead of a fixed sleep. Once that positive
  // event is present, pjClearState has finished, so the still-shown / no-re-read / button
  // assertions below observe a settled state rather than one on a timer.
  await page.waitForFunction(() => {
    const emsg = document.getElementById('pj-question-clear-msg');
    return emsg && /could not clear/i.test(emsg.textContent || '');
  }, { timeout: 5000 }).catch(() => {});
  const s3 = await page.evaluate(() => {
    const q = document.getElementById('pj-question');
    const btn = document.getElementById('pj-question-clear');
    const emsg = document.getElementById('pj-question-clear-msg');
    const threadReads = window.__posted.filter((p) => p.url.includes('/thread/')).length;
    return {
      questionStillShown: q && q.hidden === false,
      errText: (emsg && emsg.textContent) || '',
      noReRead: threadReads === 0,
      btnEnabled: btn && btn.disabled === false,
    };
  });
  check('a FAILED clear leaves the question ON screen', s3.questionStillShown, JSON.stringify(s3.questionStillShown));
  check('a FAILED clear surfaces the could-not-clear line', /could not clear/i.test(s3.errText), JSON.stringify(s3.errText));
  check('a FAILED clear does not re-read the thread (no false progress)', s3.noReRead, JSON.stringify(s3.noReRead));
  check('a FAILED clear re-enables the button for a retry', s3.btnEnabled, JSON.stringify(s3.btnEnabled));

  if (pageErrors.length) check('no page/console errors during the run', false, pageErrors.join(' | '));
  else check('no page/console errors during the run', true);

  await browser.close();
  const failed = results.filter((r) => !r.pass);
  console.log('\n' + (failed.length ? 'FAIL  ' + failed.length + ' of ' + results.length + ' checks failed'
    : 'PASS  all ' + results.length + ' checks passed'));
  process.exit(failed.length ? 1 : 0);
})().catch((err) => {
  /* Without this a rejection inside the IIFE (a renamed selector, a null read on an
     evaluate result, an un-timed-out click) exits on an unhandled rejection with NO
     quotable FAIL line, so the runner's reason-grep gate has nothing to report and the
     browser is never closed. Same lesson as render-restore-dircheck-2615.js. */
  console.error('FAIL  render-pj-clear-2575: the check itself threw: '
    + (err && err.message ? err.message.split('\n')[0] : err));
  process.exit(1);
});
