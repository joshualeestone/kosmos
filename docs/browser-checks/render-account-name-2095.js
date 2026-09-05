'use strict';

/**
 * kosmos#2095: the human-chosen account name (the `.kosmos-name` sidecar, served
 * as `a.name`) is the PRIMARY label in the Settings AI-models row; the key last-4
 * stays as a secondary detail. Before this the row showed only "API key ending
 * NfYA" and the name Josh typed was a dead input control.
 *
 * ⚠️ WHY A BROWSER. `web.account-name-2095.test.js` asserts the SOURCE helpers
 * (acctPrimaryName / accountQualifiers) pick the right label. It cannot prove the
 * row actually RENDERS the name into a real DOM with the key demoted to a
 * secondary line - the exact gap #1720 exists to catch. This drives the real
 * paintAccounts() against a stubbed /api/accounts (no board needed) and reads the
 * rendered `#set-accounts .acct-box`. Load-bearing assertions: a NAMED OpenAI row
 * shows its name (never the key) as the primary `.acct-who b`, with the key on a
 * secondary `.acct-org` line; an UNNAMED OpenAI row is unchanged (key is primary);
 * a Claude row is unchanged (email is primary); and an arbitrary name is HTML-
 * escaped, never injected as markup.
 *
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-account-name-2095.js
 *
 * ⚠️ HEADED by default, matching the other checks here. HEADED=0 on a machine with
 * no console session; the verdicts are the same (computed DOM, not pixels).
 */

const nodePath = require('node:path');

let chromium;
try { ({ chromium } = require('playwright')); }
catch {
  console.log('render-account-name-2095: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}

const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');

function openai(name, keyTail, dir, isDefault) {
  return {
    provider: 'openai', providerName: 'OpenAI',
    email: null, label: name || null, dir: '/home/.codex-' + dir,
    organization: null, isDefault: !!isDefault, keyTail, name: name,
    memoryShared: true, offerable: true,
    connection: { state: 'connected', badge: 'working', plan: null, checkedLive: true,
      because: 'a real request succeeded', observedAt: Date.now() - 9000, observedAgeMs: 9000 },
  };
}
function claude(email, dir) {
  return {
    provider: 'anthropic', providerName: 'Anthropic / Claude',
    email, label: email, dir: '/home/.claude-' + dir,
    organization: null, isDefault: false, keyTail: null, name: null,
    memoryShared: true, offerable: true,
    connection: { state: 'connected', badge: 'working', plan: null, checkedLive: true,
      because: 'a real request succeeded', observedAt: Date.now() - 9000, observedAgeMs: 9000 },
  };
}

// A named account, an unnamed one (key stays primary), a Claude one (email stays
// primary), and an XSS-payload name to prove escaping.
const ACCOUNTS = [
  openai('account1', 'NfYA', 'named', true),
  openai(null, 'ZZ99', 'nameless', false),
  claude('josh@stuff.io', 'main'),
  openai('x<b>y', 'QQQQ', 'xss', false),
];

(async () => {
  let browser;
  try { browser = await chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch (err) {
    console.error('FAIL  render-account-name-2095: could not start a browser'
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
    const boxes = [...document.querySelectorAll('#set-accounts .acct-box')];
    const rows = boxes.map((b) => {
      const who = b.querySelector('.acct-who b');
      // #2095: the key last-4 secondary detail is `.acct-keytail` (a dedicated
      // class, so it does not collide with `.acct-org` = organisation, per #1393).
      const keytails = [...b.querySelectorAll('.acct-keytail')].map((o) => (o.textContent || '').trim());
      return {
        primary: who ? (who.textContent || '').trim() : null,
        // an injected <b>/<span> inside the name would show as an element child
        primaryChildEls: who ? who.childElementCount : -1,
        orgs: keytails,
      };
    });
    return { count: boxes.length, rows };
  }, ACCOUNTS);

  await browser.close();

  const problems = [];
  if (r.error) problems.push(r.error);
  if (r.count !== 4) problems.push('expected 4 account rows, got ' + r.count);

  const byPrimary = {};
  for (const row of (r.rows || [])) byPrimary[row.primary] = row;

  // 1. The named OpenAI account renders its NAME, never the key, as primary.
  const named = byPrimary['account1'];
  if (!named) problems.push('the named account did not render "account1" as its primary label (the #2095 bug: key shown instead of name)');
  else {
    if (!named.orgs.some((o) => /API key ending NfYA/.test(o))) {
      problems.push('the named account did not keep "API key ending NfYA" as a secondary .acct-org detail');
    }
  }
  // The key-tail must NOT be a primary label for the NAMED account.
  if (byPrimary['API key ending NfYA']) {
    problems.push('a row rendered "API key ending NfYA" as its PRIMARY label - the named account still shows the key, not the name');
  }

  // 2. The UNNAMED OpenAI account is unchanged: key is the primary label.
  if (!byPrimary['API key ending ZZ99']) {
    problems.push('the unnamed OpenAI account no longer shows its key last-4 as the primary label (regressed the common case)');
  }

  // 3. The Claude account is unchanged: email is the primary label.
  if (!byPrimary['josh@stuff.io']) {
    problems.push('the Claude account no longer shows its email as the primary label (Claude rows must be untouched)');
  }

  // 4. An arbitrary name is HTML-escaped, never injected as markup.
  const xss = byPrimary['x<b>y'];
  if (!xss) problems.push('the XSS-payload name did not render as escaped text "x<b>y"');
  else if (xss.primaryChildEls !== 0) {
    problems.push('a name containing <b> injected a real element child - it was NOT escaped (childElementCount=' + xss.primaryChildEls + ')');
  }

  console.log('  ' + JSON.stringify(r.rows));
  if (problems.length) {
    console.error(`render-account-name-2095: ${problems.length} problem(s)`);
    for (const p of problems) console.error('  FAIL  ' + p);
    process.exit(1);
  }
  console.log('render-account-name-2095: the account name renders as the primary label; the key last-4 is a secondary detail; Claude rows and unnamed rows are unchanged; an arbitrary name is escaped.');
})();
