'use strict';

/**
 * kosmos#2808 (render half): DRIVE the agent-page "waiting on an answer"
 * controls in a real browser -- the "Clear this message" dismiss button
 * (`#d-qask-clear`) and the "Show full command" clamp toggle (`#d-qask-expand`).
 *
 * ⚠️ WHY THIS EXISTS. Both controls shipped in #2808 with node coverage
 * (`web.qask-clear-clamp-2808.test.js`), but that test LIFTS the two
 * self-contained click handlers and runs them against stubs -- it never puts
 * them on a screen. `node --test` cannot see whether the controls actually
 * render inside a painted `#d-qask` block, whether they are REACHABLE (this repo
 * has shipped a control that was in the DOM and `inert` -- render-talk
 * screenshotted a perfect page nothing on it could click), whether the real
 * click-listeners (`web/index.html`) toggle `.expanded` / POST the clear route,
 * or whether a successful clear takes the whole box OFF screen. That
 * paint->click->re-read wiring is exactly the runtime gap #2808's own node test
 * names as covered only "indirectly". This check closes it, the same split
 * render-pj-clear-2575 uses for the project room's clear.
 *
 * Per docs/browser-checks/README.md (#1769): a committed headless check runs
 * from ANY session, no MCP, no operator. It loads the page over file:// and
 * answers every route from `addInitScript` (like render-talk), so it needs no
 * board and can never touch a real one.
 *
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 \
 *     node docs/browser-checks/render-qask-clear-2808.js
 *
 * ⚠️ NODE_PATH is not optional: require resolves from THIS file's directory, so
 * without it the script walks docs/browser-checks/node_modules and exits
 * MODULE_NOT_FOUND.
 *
 * The thread body it feeds `paintTalk` is the route's own shape -- `asking:true`
 * with a `question` carrying a TALL multi-line command wall (so `qLong` is true
 * and the clamp + toggle actually engage). It is answered from the stub the same
 * way render-talk answers `/api/agent/<name>/thread`, not hand-rolled into a
 * different branch of the paint.
 */

const playwright = require('playwright');
const path = require('node:path');

const PAGE = 'file://' + path.join(path.resolve(__dirname, '..', '..'), 'web', 'index.html');
const HEADED = process.env.HEADED !== '0';

const results = [];
/* Ternary emit shape (like render-pj-clear-2575's check()): a PASS/FAIL result
   line, NOT a counted SHAPE-1 finding-emit site, so the reason-grep guard's
   EXPECTED_SITES is untouched. */
function check(name, pass, detail) {
  results.push({ name, pass: Boolean(pass) });
  console.log((pass ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  ' + detail : ''));
}

/* The asking thread body paintTalk consumes, answered from page globals so the
   scenarios can re-arm the stub. The question is a TALL wall (six lines after
   the trailing-newline trim), which is what makes `qLong` true so the clamp
   engages and `#d-qask-expand` is shown. */
function initStub() {
  // A real permission-prompt-shaped command wall: marker line first, output
  // under it, > 3 lines so paintTalk's line-count clamp fires.
  window.__q = [
    '│ Run the migration against the production database now?',
    '│ It rewrites 4 tables and cannot be undone from here.',
    '│',
    '│ ❯ 1. Yes, run it',
    '│   2. No, stop and let me look first',
    '│   3. Show me the SQL',
  ].join('\n');
  // Refuse the page's 5s polls: a Playwright page is VISIBLE, so tick's
  // document.hidden guard does not stop it, and a background poll would race
  // every hand-driven paint (the render-talk lesson). We only need to refuse it.
  window.setInterval = () => 0;
  window.__posted = [];
  window.__asking = true;      // does the thread say the agent is asking?
  window.__clearOk = true;     // should the clear route succeed?
  const enc = (o) => new Response(JSON.stringify(o), {
    status: 200, headers: { 'content-type': 'application/json' },
  });
  window.fetch = async (url, opts) => {
    const u = String(url);
    window.__posted.push({ url: u, opts: opts || null });
    if (u.includes('/clear-selfreport')) {
      // Both arms are HTTP 200; the handler branches on the BODY `ok`, so a
      // failed clear is `{ok:false}` (res.ok true, r.ok false) -- the else path
      // that keeps the box up. This mirrors render-pj-clear-2575's __clearOk.
      return window.__clearOk
        ? enc({ ok: true, cleared: true, state: 'idle', by: 'operator' })
        : enc({ ok: false, because: 'that self-report could not be cleared' });
    }
    if (u.includes('/thread')) {
      if (window.__asking) {
        return enc({
          ok: true,
          asking: true,
          agent: { sessionName: 'april' },
          // reported:true is the #2456/#2575 "agent's own words" arm; answerNote
          // is absent, so the dismiss shows (it is hidden only for the
          // folder-trust prompt, which carries answerNote).
          question: { text: window.__q, reported: true },
          presence: 'on',
          messages: [],
          options: null,
        });
      }
      return enc({ ok: true, asking: false, agent: { sessionName: 'april' }, presence: 'on', messages: [], options: null });
    }
    // tick() on a successful clear GETs /api/status; it assigns LAST = data.agents,
    // so it must carry an array or the board paint throws.
    if (u.includes('/api/status')) return enc({ agents: [], version: '0.2.0' });
    // Everything else (seen, avatar, first-run, docs) gets a benign ok so a
    // startup poll cannot fill the console and mask a real error.
    return enc({ ok: true, agents: [] });
  };
}

(async () => {
  let browser;
  try { browser = await playwright.chromium.launch({ headless: !HEADED }); }
  catch (err) {
    console.error('FAIL  render-qask-clear-2808: could not start a browser'
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

  // Open the agent detail page the way render-talk does: a bare CURRENT
  // assignment (NOT window.CURRENT -- the page's `let CURRENT` is lexical, so a
  // window property makes a second unrelated global and paintTalk's guard reads
  // the real one and paints nothing), unhide the detail panel, clear any
  // leftover first-run `inert` (otherwise every elementFromPoint answers BODY),
  // then drive the real paint.
  await page.evaluate(() => {
    document.querySelectorAll('body > [inert], body > *').forEach((el) => { el.inert = false; el.removeAttribute && el.removeAttribute('inert'); });
    LAST = [];
    CURRENT = { sessionName: 'april', name: 'April' };
    document.getElementById('panel-detail').hidden = false;
    return paintTalk('april', 'April');
  });

  // Wait for the async paint to show the question block.
  await page.waitForFunction(() => {
    const q = document.getElementById('d-qask');
    return q && q.hidden === false;
  }, { timeout: 5000 }).catch(() => {});

  // ---- Scenario 1: paint + clamp + reachability of both controls ----
  const s1 = await page.evaluate(() => {
    const q = document.getElementById('d-qask');
    const qtext = document.getElementById('d-qask-text');
    const exp = document.getElementById('d-qask-expand');
    const clr = document.getElementById('d-qask-clear');
    if (!exp || !clr) return { error: 'the expand toggle or the clear button is not in the DOM' };
    const reach = (btn) => {
      btn.scrollIntoView({ block: 'center' });
      const r = btn.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { visible: !btn.hidden && r.height > 0, reachable: !!(hit && (hit === btn || btn.contains(hit))) };
    };
    return {
      qaskShown: q && q.hidden === false,
      clamped: qtext.classList.contains('clamped'),
      expand: { ...reach(exp), text: (exp.textContent || '').trim() },
      clear: { ...reach(clr), text: (clr.textContent || '').trim() },
    };
  });
  if (s1.error) { console.error('render-qask-clear-2808: ' + s1.error); await browser.close(); process.exit(1); }
  check('the #d-qask block paints for an asking thread', s1.qaskShown, JSON.stringify(s1.qaskShown));
  check('the tall command wall gets the .clamped class', s1.clamped, JSON.stringify(s1.clamped));
  check('the "Show full command" toggle is visible', s1.expand.visible, JSON.stringify(s1.expand));
  check('the "Show full command" toggle is reachable (not inert/covered)', s1.expand.reachable, JSON.stringify(s1.expand.reachable));
  check('the toggle reads "Show full command"', s1.expand.text === 'Show full command', JSON.stringify(s1.expand.text));
  check('the dismiss button is visible', s1.clear.visible, JSON.stringify(s1.clear));
  check('the dismiss button is reachable (not inert/covered)', s1.clear.reachable, JSON.stringify(s1.clear.reachable));
  check('the dismiss button reads "Clear this message"', s1.clear.text === 'Clear this message', JSON.stringify(s1.clear.text));

  // ---- Scenario 2: the toggle flips .expanded and its label ----
  await page.click('#d-qask-expand');
  const s1b = await page.evaluate(() => {
    const qtext = document.getElementById('d-qask-text');
    const exp = document.getElementById('d-qask-expand');
    return {
      expanded: qtext.classList.contains('expanded'),
      text: (exp.textContent || '').trim(),
      aria: exp.getAttribute('aria-expanded'),
    };
  });
  check('a click on the toggle adds .expanded', s1b.expanded, JSON.stringify(s1b.expanded));
  check('the toggle label flips to "Show less" when expanded', s1b.text === 'Show less', JSON.stringify(s1b.text));
  check('the toggle aria-expanded flips to true', s1b.aria === 'true', JSON.stringify(s1b.aria));

  // ---- Scenario 3: a successful click clears and the box comes off screen ----
  await page.evaluate(() => { window.__posted = []; window.__clearOk = true; window.__asking = false; });
  await page.click('#d-qask-clear');
  await page.waitForFunction(() => {
    const q = document.getElementById('d-qask');
    return q && q.hidden === true;
  }, { timeout: 5000 }).catch(() => {});
  const s2 = await page.evaluate(() => {
    const q = document.getElementById('d-qask');
    const posts = window.__posted.filter((p) => p.url.includes('/clear-selfreport'));
    const c = posts[0] || null;
    let body = null;
    try { body = c && c.opts && c.opts.body ? JSON.parse(c.opts.body) : null; } catch { body = 'unparseable'; }
    return {
      clearCalls: posts.length,
      url: c && c.url,
      method: c && c.opts && c.opts.method,
      body,
      qaskHidden: q && q.hidden === true,
    };
  });
  check('a successful click POSTs the clear route exactly once', s2.clearCalls === 1, 'calls=' + s2.clearCalls);
  check('it clears the painted agent (correct URL-encoded route + method)',
    /\/api\/agent\/april\/clear-selfreport$/.test(s2.url || '') && s2.method === 'POST',
    (s2.url || '') + ' ' + (s2.method || ''));
  check('it sends the operator-dismissed reason', s2.body && s2.body.reason === 'operator-dismissed', JSON.stringify(s2.body));
  check('a successful clear takes the whole #d-qask box OFF screen', s2.qaskHidden, JSON.stringify(s2.qaskHidden));

  // ---- Scenario 4: the red-capable contrast -- a FAILED clear keeps the box up ----
  // Re-arm an asking state and re-read, then make the clear route reject. Success
  // hides the box; failure must NOT -- the two arms disagreeing is what makes the
  // whole check red-capable (a regression that always-hides or never-hides is caught).
  await page.evaluate(async () => { window.__asking = true; await paintTalk('april', 'April'); });
  await page.waitForFunction(() => {
    const q = document.getElementById('d-qask');
    return q && q.hidden === false;
  }, { timeout: 5000 }).catch(() => {});
  await page.evaluate(() => { window.__posted = []; window.__clearOk = false; });
  await page.click('#d-qask-clear');
  // Wait for the failure's OWN signal (the could-not-clear line the handler
  // writes after its rejected clear) rather than a fixed sleep, so the
  // still-shown assertion observes a settled state.
  await page.waitForFunction(() => {
    const m = document.getElementById('d-qask-clear-msg');
    return m && /could not be cleared|could not clear|could not reach/i.test(m.textContent || '');
  }, { timeout: 5000 }).catch(() => {});
  const s3 = await page.evaluate(() => {
    const q = document.getElementById('d-qask');
    const btn = document.getElementById('d-qask-clear');
    const m = document.getElementById('d-qask-clear-msg');
    const reread = window.__posted.filter((p) => p.url.includes('/thread')).length;
    return {
      qaskStillShown: q && q.hidden === false,
      msg: (m && m.textContent) || '',
      noReRead: reread === 0,
      btnEnabled: btn && btn.disabled === false,
    };
  });
  check('a FAILED clear leaves the #d-qask box ON screen', s3.qaskStillShown, JSON.stringify(s3.qaskStillShown));
  check('a FAILED clear surfaces the could-not-clear line', /could not be cleared/i.test(s3.msg), JSON.stringify(s3.msg));
  check('a FAILED clear does not re-read the thread (no false progress)', s3.noReRead, 'threadReads=' + JSON.stringify(s3.noReRead));
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
     browser is never closed. Same lesson as render-pj-clear-2575.js. */
  console.error('FAIL  render-qask-clear-2808: the check itself threw: '
    + (err && err.message ? err.message.split('\n')[0] : err));
  process.exit(1);
});
