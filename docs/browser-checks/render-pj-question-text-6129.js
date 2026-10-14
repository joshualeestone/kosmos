'use strict';

// Browser-check-functions: paintThread pjSetScreen

/**
 * kosmos#6129: assert that an agent's OWN reported question TEXT actually
 * reaches the answer surface the person reads it in.
 *
 * ⚠️ WHY THIS EXISTS. When an agent asks (needs_you) and the board has its own
 * words (a REPORTED question), the person answers it on the project page: the
 * `#pj-question` block, whose `#pj-question-text` <pre> is painted by the real
 * `paintThread` through `pjSetScreen(qText, body.question.text)` (web/index.html).
 * Two checks already drive this area -- `render-pj-clear-2575` (the "Not waiting?
 * Clear it" button) and `render-project-needsyou-2699` -- but NEITHER asserts the
 * question TEXT itself equals what the agent said, only the surrounding controls
 * and card treatment (found in the #6101 review). So a regression that blanked the
 * question in the answer surface -- e.g. `pjSetScreen(qText, '')`, or a pjSetScreen
 * that stopped writing textContent -- would leave the block, the label, the button
 * and every current check green while the person saw an empty box. This closes
 * exactly that gap: the agent's words are VISIBLE, verbatim, in the box.
 *
 * It drives the REAL page, not a fixture: it loads web/index.html over file://,
 * answers every route from `addInitScript` (like render-pj-clear-2575, the #1769
 * hermetic pattern), seeds a reported-needs_you thread body matched to what
 * `paintThread` reads (`asking` + `question.reported`), and reads back the text the
 * real `pjSetScreen` wrote. The check never writes `#pj-question-text` itself, so it
 * cannot pass by testing its own fixture.
 *
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 \
 *     node docs/browser-checks/render-pj-question-text-6129.js
 *
 * ⚠️ NODE_PATH is not optional: require resolves from THIS file's directory, so
 * without it the script walks docs/browser-checks/node_modules and exits
 * MODULE_NOT_FOUND. The runner (tools/browser-checks.sh) sets it.
 *
 * The NEGATIVE CONTROL is renderer-side and demonstrated on the PR (not an in-check
 * arm, because the renderer is fixed product code): a throwaway edit that stops
 * paintThread writing the text (`pjSetScreen(qText, '')`) makes the exact-text
 * assertion go RED; reverting it goes GREEN. Both outputs are on the PR. The in-check
 * contrast below (a not-asking re-read must take the block OFF screen) is internal
 * robustness, NOT that negative control.
 *
 * The `// Browser-check-functions:` line above opts this check into the #4119 PR
 * selector for changes INSIDE paintThread's or pjSetScreen's body -- the exact
 * blank-the-text regression names no selector on its changed line, so the body-scope
 * route (the #3828/asbAvatar case) is the only one that would catch it.
 */

const playwright = require('playwright');
const path = require('node:path');

const PAGE = 'file://' + path.join(path.resolve(__dirname, '..', '..'), 'web', 'index.html');
const HEADED = process.env.HEADED !== '0';

// A distinctive sentence so a textContent match cannot be a coincidence with any
// other copy on the page, and so the exact-equality assertion is meaningful.
const Q_TEXT = 'Which of the two candidate vendors should Project 1C evaluate first, and by when?';

const results = [];
/* Ternary emit shape (like render-pj-clear-2575's check()): a PASS/FAIL result line,
   NOT a counted SHAPE-1 finding-emit site, so the reason-grep guard's SITE_COUNTS
   line does not count it. */
function check(name, pass, detail) {
  results.push({ name, pass: Boolean(pass) });
  console.log((pass ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  ' + detail : ''));
}

/* The reported-needs_you thread body paintThread consumes. `asking` is read from a
   page global so the contrast scenario can re-arm the stub to a not-asking read. The
   question string is passed in (addInitScript arg) so the ONE module-scope Q_TEXT is
   both what we seed and what we assert -- no second literal to drift from it. */
function initStub(qtext) {
  // Refuse the page's 5s polls: a Playwright page is VISIBLE, so tick's
  // document.hidden guard does not stop it, and a background poll would race
  // every hand-driven paint (the render-pj-clear-2575 / render-talk lesson).
  window.setInterval = () => 0;
  // The project this check drives, defined here so the stub's OWN /api/projects
  // response carries it too -- not only the global we seed below. Answering
  // /api/projects with p1 stops a one-time startup loadProjects() from wiping the
  // seed (the #2575 flake); see render-pj-clear-2575 for the full rationale.
  window.__project = {
    id: 'p1', name: 'Project 1C', parent: null, archived: false,
    agents: [{ sessionName: 'Mara', name: 'Mara' }],
    defaultAgent: 'Mara', summary: { total: 1, needsYou: 1 },
  };
  window.__asking = true;      // does the thread say the agent is asking?
  window.__qtext = qtext;      // the seeded question (module-scope Q_TEXT, passed in)
  const enc = (o) => new Response(JSON.stringify(o), {
    status: 200, headers: { 'content-type': 'application/json' },
  });
  window.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes('/thread/')) {
      if (window.__asking) {
        // REPORTED question (reported:true) -- the agent's own words, the case a
        // person answers on the project page. Matched to paintThread's asking arm.
        return enc({
          ok: true,
          asking: true,
          agent: { sessionName: 'Mara' },
          question: { text: window.__qtext, reported: true },
          messages: [],
          viewport: { text: null },
        });
      }
      return enc({ ok: true, asking: false, agent: { sessionName: 'Mara' }, messages: [], viewport: { text: null } });
    }
    // The projects LIST GET (plural, no id) -- carry our project so a startup
    // loadProjects() keeps p1 rather than wiping the seed. Scoped to GET so the
    // create POST still hits the catch-all.
    if (/\/api\/projects(\?|$)/.test(u) && (!opts || !opts.method || String(opts.method).toUpperCase() === 'GET')) {
      return enc({ ok: true, projects: [window.__project] });
    }
    // #2691: #pj-question lives in the Engineering-mode-only #pj-thread box, so the
    // text is only VISIBLE with Engineering mode ON. Report on:true; the sibling
    // render-engmode-gate-2131 asserts the Off/On hide/show, so this is intended.
    if (u.includes('/api/engmode')) return enc({ on: true });
    // Everything else gets a benign ok with an agents array so a startup poll
    // cannot fill the console or leave LAST undefined (paintFreeAgentPicker reads it).
    return enc({ ok: true, agents: [] });
  };
}

(async () => {
  let browser;
  try { browser = await playwright.chromium.launch({ headless: !HEADED }); }
  catch (err) {
    console.error('FAIL  render-pj-question-text-6129: could not start a browser'
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

  await page.addInitScript(initStub, Q_TEXT);
  await page.goto(PAGE);
  if (await page.isVisible('#firstrun')) await page.keyboard.press('Escape');
  // Activate the Projects tab, or #panel-projects stays display:none and the
  // project view (and the question block) has no layout box.
  await page.click('[data-tab="projects"]').catch(() => {});

  // Open a project whose one member is a reported-needs_you agent. openProject
  // fires loadThread, which paints the question block through the real path.
  await page.evaluate(() => {
    // Defensive: a leftover `inert` from the first-run overlay makes every
    // elementFromPoint answer BODY (a page that screenshots perfectly and cannot
    // be clicked). Clear any that survived Escape.
    document.querySelectorAll('body > [inert]').forEach((el) => el.removeAttribute('inert'));
    LAST = [];
    // Seed from the SAME object the /api/projects stub returns so no late poll
    // can disagree with the global we open.
    PROJECTS.length = 0;
    PROJECTS.push(window.__project);
    openProject('p1');
  });

  // Wait for the async loadThread to paint the question block.
  await page.waitForFunction(() => {
    const q = document.getElementById('pj-question');
    return q && q.hidden === false;
  }, { timeout: 5000 }).catch(() => {});

  // #2691: #pj-question is inside the Engineering-mode-only #pj-thread box, so turn
  // Engineering mode ON through the app's own refresh (reading the stub's on:true)
  // before asserting the text is VISIBLE. Without this #pj-thread stays display:none
  // and the text has a 0x0 box -- the CORRECT Off-mode behaviour, not a regression.
  await page.evaluate(async () => {
    if (typeof refreshEngMode === 'function') await refreshEngMode();
    if (typeof pjApplyEngMode === 'function') pjApplyEngMode();
  });
  await page.waitForFunction(() => {
    const t = document.getElementById('pj-thread');
    return t && t.hidden === false;
  }, { timeout: 5000 }).catch(() => {});

  // ---- Scenario 1: the agent's question text is painted, verbatim and visible ----
  const s1 = await page.evaluate(() => {
    const q = document.getElementById('pj-question');
    const qText = document.getElementById('pj-question-text');
    const qLabel = document.getElementById('pj-question-label');
    if (!qText) return { error: 'the question text element #pj-question-text is not in the DOM' };
    qText.scrollIntoView({ block: 'center' });
    const r = qText.getBoundingClientRect();
    // Hit a point near the top-left of the <pre>, inset past the padding, where the
    // text actually sits -- the centre of a tall terminal pre can land between lines.
    const hit = document.elementFromPoint(r.left + 8, r.top + 8);
    return {
      questionShown: q && q.hidden === false,
      textShown: qText.hidden === false,
      text: (qText.textContent || ''),
      // reachable: the point inside the text box is the <pre> itself (or a child of
      // it), not BODY / an ancestor (inert, covered, or a zero-box element). An
      // ancestor hit is a FAIL -- it means something sits over the text.
      reachable: !!(hit && (hit === qText || qText.contains(hit))),
      label: (qLabel && qLabel.textContent) || '',
      target: PJ_QUESTION_AGENT,
    };
  });
  if (s1.error) { console.error('render-pj-question-text-6129: ' + s1.error); await browser.close(); process.exit(1); }
  check('the question block paints for a reported needs_you', s1.questionShown, JSON.stringify(s1.questionShown));
  check('the question text box is not hidden', s1.textShown, JSON.stringify(s1.textShown));
  check('#pj-question-text holds the exact question text, verbatim',
    s1.text.trim() === Q_TEXT, JSON.stringify(s1.text));
  check('the question text is reachable on screen (not inert/covered/zero-box)',
    s1.reachable, 'hit=' + JSON.stringify(s1.reachable));
  check('the reported-question label reads "told us it needs", not the live-pane wording',
    / This is what it told us it needs:$/.test(s1.label), JSON.stringify(s1.label));
  check('paintThread set PJ_QUESTION_AGENT to the asking agent', s1.target === 'Mara', JSON.stringify(s1.target));

  // ---- Internal contrast (NOT the card's negative control): a not-asking re-read
  // must take the whole question block OFF screen, so the text's visibility tracks
  // the asking state through the real renderer rather than sticking once painted. ----
  await page.evaluate(async () => { window.__asking = false; await loadThread(); });
  await page.waitForFunction(() => {
    const q = document.getElementById('pj-question');
    return q && q.hidden === true;
  }, { timeout: 5000 }).catch(() => {});
  const s2 = await page.evaluate(() => {
    const q = document.getElementById('pj-question');
    return { hidden: q && q.hidden === true };
  });
  check('a not-asking re-read takes the question block off screen', s2.hidden, JSON.stringify(s2.hidden));

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
     quotable FAIL line, so the runner's reason-grep gate has nothing to report and
     the browser is never closed. Same lesson as render-pj-clear-2575.js. */
  console.error('FAIL  render-pj-question-text-6129: the check itself threw: '
    + (err && err.message ? err.message.split('\n')[0] : err));
  process.exit(1);
});
