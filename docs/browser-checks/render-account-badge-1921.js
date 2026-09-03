'use strict';

/**
 * kosmos#1921: the Settings account badge renders VERIFIED liveness from the
 * server-computed `connection.badge`, not the stored-login state alone.
 *
 * ⚠️ WHY A BROWSER. `web.badge-observed-1921.test.js` asserts the SOURCE of
 * paintAccounts emits the right class/text per badge state. It cannot prove the
 * badge actually RENDERS into a real DOM with those classes - the same gap #1720
 * exists to catch (a guard green while the page breaks). This drives the real
 * paintAccounts() against a stubbed /api/accounts (no board needed) and reads the
 * rendered `#set-accounts .acct-box` badge per state. The load-bearing assertion is
 * the honesty invariant: a merely-existing credential (`signed_in_unverified`) must
 * render the MUTED class, never the green `.acct-connected`, in a real render.
 *
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-account-badge-1921.js
 *
 * ⚠️ HEADED by default, matching the other checks here. HEADED=0 on a machine with
 * no console session; the verdicts are the same, this asserts the rendered class +
 * text (computed DOM), not pixels.
 */

const nodePath = require('node:path');

let chromium;
try { ({ chromium } = require('playwright')); }
catch {
  console.log('render-account-badge-1921: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}

const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');

// checkLive state each badge is layered on: the point of the feature is that the
// SAME connected checkLive yields working / rejected / signed_in_unverified.
const STATE_FOR = {
  working: 'connected', rejected: 'connected', signed_in_unverified: 'connected',
  signed_out: 'none', unchecked: 'unknown',
};
function row(email, badge, dir) {
  const timed = badge === 'working' || badge === 'rejected';
  return {
    provider: 'anthropic', providerName: 'Anthropic / Claude',
    email, label: email, dir: '/home/.claude-' + dir,
    organization: null, isDefault: false, keyTail: null,
    memoryShared: true, offerable: true,
    connection: {
      state: STATE_FOR[badge], badge, plan: null, checkedLive: true,
      because: 'because ' + badge,
      observedAt: timed ? Date.now() - 12000 : null,
      observedAgeMs: timed ? 12000 : null,
    },
  };
}
const ACCOUNTS = [
  row('work@example.com', 'working', 'wd'),
  row('rej@example.com', 'rejected', 'rd'),
  row('unver@example.com', 'signed_in_unverified', 'ud'),
  row('out@example.com', 'signed_out', 'od'),
  row('unk@example.com', 'unchecked', 'kd'),
];

(async () => {
  let browser;
  try { browser = await chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch (err) {
    console.error('FAIL  render-account-badge-1921: could not start a browser'
      + (process.env.HEADED === '0' ? '.' : ' (headed; try HEADED=0).'));
    console.error('  ' + (err && err.message ? err.message.split('\n')[0] : err));
    process.exit(1);
  }
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  await page.goto('file://' + PAGE);

  const r = await page.evaluate(async (accounts) => {
    // Stub the accounts fetch so paintAccounts renders the fixture without a board.
    const realFetch = window.fetch;
    window.fetch = (u, opts) => (String(u).indexOf('/api/accounts') !== -1
      ? Promise.resolve({ ok: true, json: async () => ({ accounts }) })
      : realFetch(u, opts));
    if (typeof paintAccounts !== 'function') return { error: 'paintAccounts is not a function' };
    await paintAccounts();
    const boxes = [...document.querySelectorAll('#set-accounts .acct-box')];
    // Key each rendered badge by the account email in the same box, so the assertions
    // do not depend on render order (the list groups by provider).
    const byEmail = {};
    for (const b of boxes) {
      const who = b.querySelector('.acct-who b');
      const badge = b.querySelector('.acct-connected, .acct-none, .acct-unknown');
      if (who) byEmail[(who.textContent || '').trim()] = {
        cls: badge ? badge.className : null,
        text: badge ? (badge.textContent || '').trim() : null,
      };
    }
    return { count: boxes.length, byEmail };
  }, ACCOUNTS);

  await browser.close();

  const problems = [];
  if (r.error) problems.push(r.error);
  if (r.count !== 5) problems.push('expected 5 account rows, got ' + r.count);

  const want = [
    { email: 'work@example.com', cls: 'acct-connected', text: /Signed in.*active/ },
    { email: 'rej@example.com', cls: 'acct-none', text: /Not connected/ },
    { email: 'unver@example.com', cls: 'acct-unknown', text: /not recently checked/, honesty: true },
    { email: 'out@example.com', cls: 'acct-none' },
    { email: 'unk@example.com', cls: 'acct-unknown' },
  ];
  for (const w of want) {
    const got = (r.byEmail || {})[w.email];
    if (!got) { problems.push(`no badge rendered for ${w.email}`); continue; }
    if (!got.cls || got.cls.indexOf(w.cls) === -1) problems.push(`${w.email}: expected class ${w.cls}, got "${got.cls}"`);
    if (w.text && !w.text.test(got.text || '')) problems.push(`${w.email}: text "${got.text}" does not match ${w.text}`);
    if (w.honesty && got.cls && got.cls.indexOf('acct-connected') !== -1) {
      problems.push(`${w.email}: a merely-existing credential rendered GREEN (acct-connected) - the #874 false-green is back`);
    }
  }

  console.log('  ' + JSON.stringify(r.byEmail));
  if (problems.length) {
    console.error(`render-account-badge-1921: ${problems.length} problem(s)`);
    for (const p of problems) console.error('  FAIL  ' + p);
    process.exit(1);
  }
  console.log('render-account-badge-1921: the badge renders verified liveness per state; a merely-existing credential is muted, never green.');
})();
