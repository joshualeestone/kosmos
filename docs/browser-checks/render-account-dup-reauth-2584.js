'use strict';

/**
 * kosmos#2584: two "Sign in again" (reauth) controls on Settings > Accounts must
 * never answer to the same accessible name.
 *
 * 🛑 WHY A DETERMINISTIC BROWSER CHECK, AND NOT named-controls.js. named-controls
 * walks the live board and reports a duplicate accessible name IF the board it runs
 * against happens to hold two accounts that collide. That is how the 0.6.51 cut
 * caught this at all: the machine it ran on had a Claude account and an OpenAI
 * ChatGPT account under one email, both defaults. A clean CI board has no such
 * pair, so named-controls would pass VACUOUSLY for this case -- the guard stays
 * green while the page breaks, the exact gap #1720 exists to close. This seeds the
 * colliding pair itself, so the coverage does not depend on the box's real accounts.
 *
 * ⚠️ WHY A BROWSER AND NOT ONLY web.account-qualifier.test.js. That unit test
 * proves the SOURCE helper (accountQualifiers) hands the two rows distinct
 * qualifiers. It cannot prove paintAccounts actually RENDERS those qualifiers into
 * two distinct `aria-label`s on real reauth buttons -- the render path
 * ("Sign in again as " + who + (qual ? " (" + qual + ")" : "")) could regress on
 * its own. This drives the real paintAccounts() against a stubbed /api/accounts
 * (no board) and reads the rendered `.acct-reauth` aria-labels.
 *
 * The seeded pair mirrors the real collision: one email (agent@example.com) with a
 * Claude subscription default in ~/.claude and an OpenAI ChatGPT default in ~/.codex,
 * neither carrying a label. Before the fix both take qual="main" and the two reauth
 * controls read "Sign in again as agent@example.com (main)". After the fix the first
 * default keeps "main" and the second falls back to its unique dir, so the accessible
 * names differ. This check REDS on origin/main (both labels identical) and passes on
 * the fix.
 *
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-account-dup-reauth-2584.js
 *
 * ⚠️ HEADED by default, matching the other checks here. HEADED=0 on a machine with
 * no console session; the verdicts are the same (computed DOM, not pixels).
 */

const nodePath = require('node:path');

let chromium;
try { ({ chromium } = require('playwright')); }
catch {
  console.log('render-account-dup-reauth-2584: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}

const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');

const conn = () => ({
  state: 'connected', badge: 'working', plan: null, checkedLive: true,
  because: 'a real request succeeded', observedAt: Date.now() - 9000, observedAgeMs: 9000,
});

// One email, a Claude subscription default and an OpenAI ChatGPT default, neither
// labelled -- the shape that made both take qual="main". A Claude subscription row
// (apiKey falsy) carries a reauth control on every row; an OpenAI ChatGPT row
// (authMode 'chatgpt', no keyTail) carries one too. So exactly two reauth buttons.
const ACCOUNTS = [
  {
    provider: 'anthropic', providerName: 'Anthropic / Claude',
    email: 'agent@example.com', label: null, dir: '/home/.claude',
    organization: null, isDefault: true, apiKey: false, keyTail: null, name: null,
    memoryShared: true, offerable: true, connection: conn(),
  },
  {
    provider: 'openai', providerName: 'OpenAI', authMode: 'chatgpt',
    email: 'agent@example.com', label: null, dir: '/home/.codex',
    organization: null, isDefault: true, apiKey: false, keyTail: null, name: null,
    memoryShared: true, offerable: true, connection: conn(),
  },
];

(async () => {
  let browser;
  try { browser = await chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch (err) {
    console.error('FAIL  render-account-dup-reauth-2584: could not start a browser'
      + (process.env.HEADED === '0' ? '.' : ' (headed; try HEADED=0).'));
    console.error('  ' + (err && err.message ? err.message.split('\n')[0] : err));
    process.exit(1);
  }
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  await page.goto('file://' + PAGE);

  const r = await page.evaluate(async (accounts) => {
    const realFetch = window.fetch;
    window.fetch = (u, opts) => (String(u).indexOf('/api/accounts') !== -1
      ? Promise.resolve({ ok: true, json: async () => ({ accounts }) })
      : realFetch(u, opts));
    if (typeof paintAccounts !== 'function') return { error: 'paintAccounts is not a function' };
    await paintAccounts();
    const btns = [...document.querySelectorAll('#set-accounts .acct-reauth')];
    return {
      names: btns.map((b) => (b.getAttribute('aria-label') || '').trim()),
      texts: btns.map((b) => (b.textContent || '').trim()),
    };
  }, ACCOUNTS);

  await browser.close();

  const problems = [];
  if (r.error) problems.push(r.error);

  const names = r.names || [];
  // The fixture seeds exactly two reauth-bearing rows. If the count is off, the
  // render conditions changed and this check would be asserting on the wrong thing.
  if (names.length !== 2) {
    problems.push('expected 2 reauth controls (one per seeded default), got ' + names.length
      + ' -- reauth render conditions changed, or the fixture no longer produces them; names=' + JSON.stringify(names));
  } else {
    // Every reauth control must carry a non-empty accessible name...
    for (let i = 0; i < names.length; i++) {
      if (!names[i]) problems.push('reauth control ' + i + ' has an empty accessible name');
    }
    // ...and the two must be DISTINCT, or a screen-reader user hearing "Sign in
    // again as agent@example.com (main)" twice cannot tell which account is which.
    if (names[0] && names[1] && names[0] === names[1]) {
      problems.push('both reauth controls answer to one accessible name: ' + JSON.stringify(names[0])
        + ' -- deferred finding 9: two defaults sharing an email both took qual="main"');
    }
    /* 🔑 #2612: DISTINCT IS NOT ENOUGH; NEITHER MAY BE A FILESYSTEM PATH. The
       assertion above passed while the second default's qualifier was its raw
       `dir`, so a screen reader announced "Sign in again as agent@example.com
       (/Users/x/.codex)". Distinctness and readability are separate properties
       and only one of them was pinned.
       ⚠️ Checked on the RENDERED aria-label rather than on the helper's return,
       because that is the string a person actually hears, and the render path
       interpolates it. */
    for (let i = 0; i < names.length; i++) {
      if (/[/\\]/.test(names[i])) {
        problems.push('reauth control ' + i + ' announces a filesystem path: ' + JSON.stringify(names[i])
          + ' -- #2612: a second default with no label fell through to its dir');
      }
    }
    /* And the provider IS the qualifier for this pair, which is the fix #2612
       asked for rather than merely the absence of a path. Seeded as one Claude
       default and one OpenAI default, so the second one reads "(OpenAI)". */
    if (!names.some((n) => /\(OpenAI\)$/.test(n))) {
      problems.push('no reauth control is qualified by its provider; names=' + JSON.stringify(names)
        + ' -- #2612 expects the second cross-provider default to read "(OpenAI)"');
    }
  }

  console.log('  ' + JSON.stringify(r.names));
  if (problems.length) {
    console.error(`render-account-dup-reauth-2584: ${problems.length} problem(s)`);
    for (const p of problems) console.error('  FAIL  ' + p);
    process.exit(1);
  }
  console.log('render-account-dup-reauth-2584: two cross-provider defaults sharing an email render two DISTINCT reauth accessible names.');
})();
