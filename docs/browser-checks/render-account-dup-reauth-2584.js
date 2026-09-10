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
 * neither carrying a label. Before #2584 both took qual="main" and the two reauth
 * controls read "Sign in again as agent@example.com (main)". After #2612 the first
 * default keeps "main" and the second is qualified by its PROVIDER, so the accessible
 * names differ AND neither announces a filesystem path.
 *
 * 🛑 WHAT THIS CHECK REDS WITH ON origin/main, MEASURED RATHER THAN REMEMBERED. The
 * parenthetical here used to read "(both labels identical)", which describes the
 * PRE-#2584 state, not origin/main: #2584 already made the two names distinct, and the
 * defect #2612 removes is the SECOND one announcing a path. Run against origin/main's
 * page it reds with two problems and these names:
 *   ["Sign in again as agent@example.com (main)",
 *    "Sign in again as agent@example.com (/home/.codex)"]
 * ⚠️ The stale version mattered because it told a reader to expect a collision, so a
 * run showing two DISTINCT names would look like the check had stopped working. A
 * "reds on X" claim ages every time the baseline moves, and nobody re-runs it.
 *
 * 📌 #2612 CHANGED THE SECOND HALF OF THAT SENTENCE, and the old wording is worth
 * recording rather than just overwriting: the second default used to fall back to its
 * unique `dir`, which was distinct but announced "/Users/x/.codex" to a screen reader.
 * The arms below now REFUSE a path, so a header still describing the dir fallback would
 * tell a reader to expect exactly what this check forbids.
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
       interpolates it.

       🛑 THE SLASH TEST RUNS ON THE QUALIFIER, NOT ON THE WHOLE LABEL. An
       earlier version tested the entire aria-label, which is a wider region
       than the claim its own message makes ("announces a filesystem path" is a
       statement about the QUALIFIER). It passed only because the seeded `who`
       is an email with no slash; the day a name, label or email carries one,
       the check fails and blames the qualifier for a character that was never
       in it. The aria-label shape is `Sign in again as <who> (<qual>)`, so the
       qualifier is the trailing parenthetical and that is what gets tested.

       🛑 ANCHORED ON THE KNOWN PREFIX, NOT PATTERN-MATCHED. A
       `/\(([^()]*)\)\s*$/` takes the LAST parenthetical, and `who` is
       `esc(acctPrimaryName(a))`, which is arbitrary user-typed text. Seed a
       `name` of `work (old)` and let the qualifier regress to EMPTY: the label
       is `Sign in again as work (old)`, the regex happily matches `(old)`, and
       the empty-qualifier arm below (whose entire job is catching that
       regression) silently does not fire while the path arm inspects a
       substring of the person's own name. A hand-made dir carrying parentheses
       defeats `[^()]*` the same way.
       ⇒ Because this fixture KNOWS what `who` is, the honest parse is to demand
       the exact prefix and the closing paren and take what is between. Anything
       else is not a qualifier, and saying so is the point of the arm.

       ⚠️ THE TRADE, STATED RATHER THAN HIDDEN, because it is a real one.
       Measured on both parsers over five shapes:

         shape                              old regex      this parser
         qualifier empty, name has parens   "old"          null   <- the bug
         qualifier empty, plain name        null           null
         healthy "(OpenAI)"                 "OpenAI"       "OpenAI"
         path "(/home/.codex)"              "/home/.codex" "/home/.codex"
         name has parens AND a real qual    "OpenAI"       null   <- the cost

       On the last row the old regex is RIGHT and this parser fires. That is
       accepted deliberately: this is a deterministic check over a fixture it
       seeds itself, so a `who` that stops matching the seed means the FIXTURE
       changed shape, and the right response is to re-anchor the check rather
       than to keep parsing something that is no longer the qualifier. Failing
       loudly on a fixture change beats parsing a person's name and reporting
       confidently about it. The message names the exact shape it wanted, so the
       fix is one line for whoever trips it. */
    /* ONE prefix for both controls, deliberately NOT `ACCOUNTS[i].email`: that
       would assume the rendered order matches the seeded order (it does today,
       since accountGroupsHtml emits Anthropic before OpenAI, but nothing here
       pins that and this arm does not need it). The whole point of the fixture
       is that both rows share ONE email, so both labels carry the same prefix
       and the index never has to be trusted. */
    const pre = 'Sign in again as ' + ACCOUNTS[0].email + ' (';
    for (let i = 0; i < names.length; i++) {
      const ok = names[i].startsWith(pre) && names[i].endsWith(')');
      const m = ok ? [null, names[i].slice(pre.length, -1)] : null;
      if (!m) {
        /* Every row in this fixture shares one email, so `accountQualifiers`
           counts the key ambiguous and both rows MUST carry a qualifier. A name
           that does not fit `<prefix> (<qual>)` is the qualifier coming back
           empty, or the render path changing shape under this check. */
        problems.push('reauth control ' + i + ' does not read "' + pre + '<qualifier>)": ' + JSON.stringify(names[i])
          + ' -- #2612: two same-email defaults must both be qualified');
        continue;
      }
      if (/[/\\]/.test(m[1])) {
        problems.push('reauth control ' + i + ' announces a filesystem path as its qualifier: '
          + JSON.stringify(m[1]) + ' in ' + JSON.stringify(names[i])
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
  /* The pass line names all THREE properties this check now asserts. It used to
     claim only "two DISTINCT names", which was the original #2584 assertion and
     stopped being the whole story when #2612 added the no-path and
     provider-qualified arms. A pass line that under-reports is how a later
     reader deletes an arm believing it was never covered. */
  console.log('render-account-dup-reauth-2584: two cross-provider defaults sharing an email render two reauth accessible names that are DISTINCT, carry no filesystem path as their qualifier, and use the provider name.');
})();
