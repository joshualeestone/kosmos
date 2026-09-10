'use strict';

/**
 * kosmos#2456: the project-room question banner falls back to the agent's
 * REPORTED needs_you sentence when the live pane no longer shows the question,
 * instead of the false "we cannot find the question on its screen right now"
 * (PR #2493). The label is also source-aware: "This is what it told us it needs:"
 * for a reported question vs "This is the part of its screen that asked:" for a
 * live-pane one.
 *
 * ⚠️ WHY THIS EXISTS. That fix shipped with node coverage on the lifted logic but
 * NO rendered assertion - no browser-check drove `paintThread` and read the label
 * a person sees. `node --test` reads source; it cannot see which of two sentences
 * the banner actually paints. This check drives the real `paintThread` through the
 * four states and reads `#pj-question-label`. Since the kosmos app runs
 * web/index.html FROM SOURCE (no build step; release bundles just package it), a
 * file:// render of that source IS the served behavior (the #1769 correction).
 *
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 \
 *     node docs/browser-checks/render-needsyou-fallback-2456.js
 *
 * ⚠️ NODE_PATH is not optional: require resolves from THIS file's directory.
 *
 * SCOPE: covers the PROJECT ROOM (`paintThread`). The AGENT PAGE (`paintTalk`)
 * carries the identical strings/branches and is driven by render-talk.js; a
 * per-surface divergence on the agent page is the noted residual (see the plan).
 *
 * The four states and their two red-capable contrasts:
 *   1 reported question    -> "This is what it told us it needs:"
 *   2 live-pane question   -> "This is the part of its screen that asked:"   (contrast to 1)
 *   3 asking, reported why -> shows the reported sentence                    (the #2456 fix)
 *   4 asking, nothing      -> "we cannot find the question on its screen right now" (contrast to 3)
 * A regression that dropped the source-aware label collapses 1 into 2; one that
 * ignored questionBecause collapses 3 into 4.
 */

const playwright = require('playwright');
const path = require('node:path');

const PAGE = 'file://' + path.join(path.resolve(__dirname, '..', '..'), 'web', 'index.html');
const HEADED = process.env.HEADED !== '0';
const REPORTED_WHY = 'it is waiting on a materials decision only a person can make';

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: Boolean(pass) });
  console.log((pass ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  ' + detail : ''));
}

/* The thread body paintThread consumes, switched by window.__state (1-4). Read
   from a page global so scenarios re-arm the stub between loadThread runs. */
function initStub() {
  window.__posted = [];
  // Refuse the 5s polls so a background paint cannot race the hand-driven one
  // (the render-talk lesson). Return a fake id, keep nothing.
  window.setInterval = () => 0;
  window.__state = 1;
  const enc = (o) => new Response(JSON.stringify(o), {
    status: 200, headers: { 'content-type': 'application/json' },
  });
  const REPORTED_WHY = 'it is waiting on a materials decision only a person can make';
  window.fetch = async (url, opts) => {
    const u = String(url);
    window.__posted.push({ url: u, opts: opts || null });
    if (u.includes('/thread/')) {
      const base = { ok: true, asking: true, agent: { sessionName: 'Mara' }, messages: [], viewport: { text: null } };
      switch (window.__state) {
        case 1: return enc(Object.assign({}, base, { question: { text: 'No materials on this machine for Harbor Health.', reported: true } }));
        case 2: return enc(Object.assign({}, base, { question: { text: '1) retry  2) skip', reported: false } }));
        case 3: return enc(Object.assign({}, base, { question: null, questionBecause: REPORTED_WHY }));
        case 4: return enc(Object.assign({}, base, { question: null, questionBecause: null }));
        default: return enc(base);
      }
    }
    // Benign default; the agents poll assigns LAST = data.agents, so carry an array.
    return enc({ ok: true, agents: [] });
  };
}

// Re-arm a state and repaint through the real loadThread -> paintThread, then
// return #pj-question-label's text.
async function labelFor(page, state) {
  await page.evaluate(async (s) => { window.__state = s; await loadThread(); }, state);
  await page.waitForFunction(() => {
    const q = document.getElementById('pj-question');
    return q && q.hidden === false;
  }, { timeout: 5000 }).catch(() => {});
  return page.evaluate(() => {
    const el = document.getElementById('pj-question-label');
    return (el && el.textContent) || '';
  });
}

(async () => {
  let browser;
  try { browser = await playwright.chromium.launch({ headless: !HEADED }); }
  catch (err) {
    console.error('FAIL  render-needsyou-fallback-2456: could not start a browser'
      + (HEADED ? ' (headed; try HEADED=0).' : '.'));
    console.error('  ' + (err && err.message ? err.message.split('\n')[0] : err));
    process.exit(1);
  }
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (/ERR_FILE_NOT_FOUND/.test(m.text())) return;   // file:// avatar, harness condition
    pageErrors.push('console: ' + m.text());
  });

  await page.addInitScript(initStub);
  await page.goto(PAGE);
  if (await page.isVisible('#firstrun')) await page.keyboard.press('Escape');
  await page.click('[data-tab="projects"]').catch(() => {});

  await page.evaluate(() => {
    document.querySelectorAll('body > [inert]').forEach((el) => el.removeAttribute('inert'));
    LAST = [];
    PROJECTS.length = 0;
    PROJECTS.push({
      id: 'p1', name: 'Project 1C', parent: null, archived: false,
      agents: [{ sessionName: 'Mara', name: 'Mara' }],
      defaultAgent: 'Mara', summary: { total: 1, needsYou: 1 },
    });
    openProject('p1');
  });
  await page.waitForFunction(() => {
    const q = document.getElementById('pj-question');
    return q && q.hidden === false;
  }, { timeout: 5000 }).catch(() => {});

  // State 1: a reported question uses the source-aware "told us it needs" label.
  const l1 = await labelFor(page, 1);
  check('1 reported question -> "This is what it told us it needs:"',
    l1.includes('This is what it told us it needs:') && !l1.includes('part of its screen that asked'),
    JSON.stringify(l1));

  // State 2: a live-pane question uses the "part of its screen" label (contrast to 1).
  const l2 = await labelFor(page, 2);
  check('2 live-pane question -> "This is the part of its screen that asked:"',
    l2.includes('This is the part of its screen that asked:') && !l2.includes('told us it needs'),
    JSON.stringify(l2));

  // State 3: asking with a reported sentence supplied shows THAT sentence, not the
  // false "we cannot find the question" -- the #2456 fix.
  const l3 = await labelFor(page, 3);
  check('3 asking + reported sentence -> shows the reported sentence (the #2456 fix)',
    l3.includes(REPORTED_WHY) && !l3.includes('we cannot find the question'),
    JSON.stringify(l3));

  // State 4: asking with nothing reported correctly shows the cannot-find fallback
  // (the red-capable contrast to 3 -- proves 3 is not vacuously satisfied).
  const l4 = await labelFor(page, 4);
  check('4 asking + nothing reported -> "we cannot find the question on its screen right now"',
    l4.includes('we cannot find the question on its screen right now') && !l4.includes(REPORTED_WHY),
    JSON.stringify(l4));

  if (pageErrors.length) check('no page/console errors during the run', false, pageErrors.join(' | '));
  else check('no page/console errors during the run', true);

  await browser.close();
  const failed = results.filter((r) => !r.pass);
  console.log('\n' + (failed.length ? 'FAIL  ' + failed.length + ' of ' + results.length + ' checks failed'
    : 'PASS  all ' + results.length + ' checks passed'));
  process.exit(failed.length ? 1 : 0);
})().catch((err) => {
  /* Without this a rejection inside the IIFE exits on an unhandled rejection with
     NO quotable FAIL line and leaves Chromium unclosed. Same lesson as
     render-restore-dircheck-2615.js; multi-line, so Shape A does not count it. */
  console.error('FAIL  render-needsyou-fallback-2456: the check itself threw: '
    + (err && err.message ? err.message.split('\n')[0] : err));
  process.exit(1);
});
