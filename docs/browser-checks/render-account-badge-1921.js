// Browser-check-surface: acct-connected acct-none acct-unknown acct-unverified acct-check
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
 * #2568 EXTENSION: also covers the OpenAI ChatGPT-subscription row, which carries no
 * server badge and whose checkLive() returns a LONG unknown-because sentence. It must
 * render a SHORT pill with that sentence in the title, never in the visible span - the
 * overflow-onto-the-email bug this row is added to guard. This is the rendered-DOM
 * instrument the source-pattern web.openai-row-2568.test.js cannot be (it reads source
 * text, not what paints), which is why the #1720/#2518 gates want it here.
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
/* #2568: an OpenAI ChatGPT-SUBSCRIPTION row. The server overlays `badge` onto
   Claude rows only, so this row carries NONE and its checkLive() honestly returns
   state 'unknown' with a LONG because sentence. Before the fix the row fell to the
   legacy fallback, which rendered that whole sentence in the pill span; the pill is
   white-space:nowrap, so it overflowed and collided with the email (Josh, v0.6.50).
   The row must now render a SHORT shape pill (the signed-in-unverified shape, since a
   subscription sign-in DOES exist) with the full sentence in the title. `authMode:
   'chatgpt'` is the SHAPE the fix gates on; no `badge`, exactly as the real payload. */
// ILLUSTRATIVE, not verbatim: this is a representative LONG unknown-because sentence, present only
// to exercise the pill/title overflow split (short pill visible, full sentence in the title). It is
// NOT a pinned copy of any real checkLive() message -- the verbatim wording lives in
// engine/openaiaccounts.js and changes independently (e.g. #2790 reworded the chatgpt unknown text),
// so do not read this as a second derivation of it. The overflow render is what is under test here.
const CHATGPT_BECAUSE = 'this sign-in method is not yet checked live; it may or may not still work';
function openaiChatgptRow(email, dir) {
  return {
    provider: 'openai', providerName: 'OpenAI',
    email, label: email, dir: '/home/.codex-' + dir,
    organization: null, isDefault: false, keyTail: null, authMode: 'chatgpt',
    memoryShared: true, offerable: true,
    connection: {
      state: 'unknown', plan: null, checkedLive: true, because: CHATGPT_BECAUSE,
      observedAt: null, observedAgeMs: null,
    },
  };
}
/* #2568/#2584: api-key rows of BOTH providers must get NEITHER reauth button (there is
   no sign-in to redo; the answer is remove-and-re-add). Proven in rendered DOM here, not
   only by the source-pattern test. A Claude api-key row is `a.apiKey` true; an OpenAI
   api-key row is authMode 'apikey' (no email, a key tail is its label). */
const CLAUDE_APIKEY_ROW = {
  provider: 'anthropic', providerName: 'Anthropic / Claude', email: 'clkey@example.com',
  label: 'clkey@example.com', dir: '/home/.claude-clkey', organization: null, isDefault: false,
  keyTail: 'ab12', apiKey: true, memoryShared: true, offerable: true,
  connection: { state: 'connected', badge: 'working', plan: null, checkedLive: true, because: 'because working', observedAt: Date.now() - 12000, observedAgeMs: 12000 },
};
const OPENAI_APIKEY_ROW = {
  provider: 'openai', providerName: 'OpenAI', email: null, label: 'apikey', dir: '/home/.codex-apikey',
  organization: null, isDefault: false, keyTail: 'cd34', authMode: 'apikey', memoryShared: true, offerable: true,
  connection: { state: 'connected', plan: null, checkedLive: true, because: 'OpenAI confirmed this key still works', observedAt: null, observedAgeMs: null },
};
/* #3391: a GROK SUBSCRIPTION row (authMode 'subscription', a sign-in not a key). The server
   badges it signed_in_unverified on its file alone, so it must render muted, and as a KEYED row
   it has no Check now, so its title must not send anyone to one. Its Disconnect and Delete
   titles must speak of a sign-in, not a key. */
const GROK_SUB_ROW = {
  provider: 'xai', providerName: 'Grok', email: 'grok@example.com', label: 'grok@example.com',
  dir: '/home/.grok-gs', organization: null, isDefault: false, keyTail: null, authMode: 'subscription',
  memoryShared: true, offerable: true,
  connection: { state: 'connected', badge: 'signed_in_unverified', plan: null, checkedLive: true, because: 'signed in with your Grok subscription', observedAt: null, observedAgeMs: null },
};
/* #3391 part 2: a Grok API-KEY row, so the Sign in again arm can see a Grok row that must
   NOT carry one (a key has no sign-in to redo). */
const GROK_KEY_ROW = { ...GROK_SUB_ROW, email: null, label: 'work2', dir: '/home/.grok-work2', keyTail: 'gk12', authMode: 'apikey' };
/* A subscription row whose email could not be read: the engine refuses a sign-in again for it
   (it tells a refresh from a swap by the email), so the row must not offer one. */
const GROK_SUB_NOEMAIL = { ...GROK_SUB_ROW, email: null, label: 'noemail', name: 'No Email Grok', dir: '/home/.grok-noemail' };
/* #3391 round 18: a LAPSED and an UNKNOWN Grok subscription. Neither is connected, so the server
   adds no badge and the page's legacy fallback puts connection.because in the VISIBLE pill. Those
   sentences must be pill-sized: the remedy is the row's own Sign in again button (#3391 part 2),
   not words in the pill. The texts are grokaccounts.subscriptionVerdict's own. */
const grokSubRow = (email, dir, state, because) => ({
  ...GROK_SUB_ROW, email, label: email, dir,
  connection: { state, plan: null, checkedLive: true, because, observedAt: null, observedAgeMs: null },
});
const GROK_SUB_LAPSED = grokSubRow('grok-lapsed@example.com', '/home/.grok-gl', 'none', 'Grok sign-in expired');
const GROK_SUB_UNKNOWN = grokSubRow('grok-unk@example.com', '/home/.grok-gu', 'unknown', 'Could not check the Grok sign-in');
const ACCOUNTS = [
  row('work@example.com', 'working', 'wd'),
  row('rej@example.com', 'rejected', 'rd'),
  row('unver@example.com', 'signed_in_unverified', 'ud'),
  row('out@example.com', 'signed_out', 'od'),
  row('unk@example.com', 'unchecked', 'kd'),
  openaiChatgptRow('sub@example.com', 'sd'),
  CLAUDE_APIKEY_ROW,
  OPENAI_APIKEY_ROW,
  GROK_SUB_ROW,
  GROK_KEY_ROW,
  GROK_SUB_NOEMAIL,
  GROK_SUB_LAPSED,
  GROK_SUB_UNKNOWN,
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
      const badge = b.querySelector('.acct-connected, .acct-none, .acct-unverified, .acct-unknown');
      if (who) byEmail[(who.textContent || '').trim()] = {
        cls: badge ? badge.className : null,
        text: badge ? (badge.textContent || '').trim() : null,
        title: badge ? (badge.getAttribute('title') || '') : null,
        // #2568/#2584: the reauth affordance in this row's actions -- a Claude row carries
        // the browser-OAuth reauth (data-reauth), an OpenAI chatgpt row the subscription
        // reauth (data-openai-reauth); they must never both appear on one row.
        claudeReauth: !!b.querySelector('[data-reauth]'),
        openaiReauth: !!b.querySelector('[data-openai-reauth]'),
        grokReauth: !!b.querySelector('[data-grok-reauth]'),   // #3391 part 2
        // #3136: the "Check now" affordance is CLAUDE-ONLY (the probe is a real
        // claude -p call). It must appear on every Claude row -- including the
        // api-key one -- and never on an OpenAI row.
        checkNow: !!b.querySelector('[data-check-claude]'),
        // #3997: the FREE Check now on a ChatGPT sign-in or a Grok subscription, and which route it asks.
        checkSignin: (b.querySelector('[data-check-signin]') || { dataset: {} }).dataset.checkSignin || '',
        // #3391: the Disconnect / Delete titles, read off the rendered buttons.
        disconnectTitle: ([...b.querySelectorAll('button')].find((x) => /^Disconnect$/.test((x.textContent || '').trim())) || { getAttribute: () => '' }).getAttribute('title') || '',
        deleteTitle: ([...b.querySelectorAll('button')].find((x) => /^Delete and remove$/.test((x.textContent || '').trim())) || { getAttribute: () => '' }).getAttribute('title') || '',
      };
    }
    return { count: boxes.length, byEmail };
  }, ACCOUNTS);

  /* #3997: a ChatGPT row whose free check the board only just started reads ONCE more, a few seconds on, and turns
     green then; a list with nothing under way is read once (CONTROL). */
  const pendingRow = ACCOUNTS.find((a) => a.email === 'sub@example.com');
  const follow = await page.evaluate(async (row) => {
    const reads = (answers) => {
      let n = 0;
      window.fetch = (u) => (String(u).indexOf('/api/accounts') !== -1
        ? Promise.resolve({ ok: true, json: async () => ({ accounts: [answers[Math.min(n++, answers.length - 1)]] }) })
        : Promise.reject(new Error('not in this check')));
      return () => n;
    };
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const pill = () => { const b = document.querySelector('#set-accounts .acct-box .acct-connected, #set-accounts .acct-box .acct-unverified'); return b ? b.className : null; };
    const pending = { ...row, connection: { ...row.connection, liveCheckPending: true } };
    const confirmed = { ...row, connection: { ...row.connection, state: 'connected', because: 'the OpenAI sign-in reached ChatGPT, so it is working' } };
    ACCT_FOLLOWUP.ms = 400;   // the page's own knob, shortened so the check is quick (the logic is the same)
    // Pending on the first two reads, confirmed on the third: it keeps reading until it can say, then turns green.
    let count = reads([pending, pending, confirmed]);
    await paintAccounts();
    const before = pill();
    await wait(2000);
    const afterOne = count();
    const after = pill();
    // Never confirmed: the reads stop at the bound (1 + ACCT_FOLLOWUP.max), never a loop.
    count = reads([pending]);
    await paintAccounts();
    await wait(400 * (ACCT_FOLLOWUP.max + 3));
    const afterTwo = count();
    const bound = 1 + ACCT_FOLLOWUP.max;
    count = reads([row]);
    await paintAccounts();
    await wait(1500);
    return { before, after, afterOne, afterTwo, bound, control: count() };
  }, pendingRow);

  /* #3997 round 2: the free Check now's click, and a follow-up that must not rebuild the list under the person. */
  const grokRow = ACCOUNTS.find((a) => a.email === 'grok@example.com');
  const clicks = await page.evaluate(async ({ row, sub }) => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    let checkAnswer = { state: 'expired', because: 'Grok renews this sign-in the next time it runs, so it cannot be checked until then' };
    let listAnswer = [row];
    let lists = 0;
    window.fetch = (u) => {
      const url = String(u);
      if (url.indexOf('/api/accounts/grok/check') !== -1) return Promise.resolve({ ok: true, json: async () => checkAnswer });
      if (url.indexOf('/api/accounts') !== -1) { lists++; return Promise.resolve({ ok: true, json: async () => ({ accounts: listAnswer }) }); }
      return Promise.reject(new Error('not in this check'));
    };
    await paintAccounts();
    const btn = () => document.querySelector('#set-accounts [data-check-signin="grok"]');
    btn().click(); await wait(200);
    const expiredSays = btn().textContent; const expiredTitle = btn().title; const listsAfterExpired = lists;
    checkAnswer = { state: 'connected' };
    listAnswer = [{ ...row, connection: { ...row.connection, badge: 'working', observedAt: new Date().toISOString(), observedAgeMs: 1000 } }];
    btn().click(); await wait(300);
    const green = !!document.querySelector('#set-accounts .acct-box .acct-connected');
    // Busy: a pending ChatGPT row, and focus on a button inside the list. The follow-up must wait, then read.
    ACCT_FOLLOWUP.ms = 300;
    const pendingSub = { ...sub, connection: { ...sub.connection, liveCheckPending: true } };
    listAnswer = [pendingSub, row];
    lists = 0;
    await paintAccounts();
    // A Check now in flight (its button disabled while it asks). The list is not on screen here, so focus cannot be
    // placed in it; the in-flight state is the same rule's other arm.
    const focusBtn = document.querySelector('#set-accounts .acct-check'); focusBtn.disabled = true;
    const focused = focusBtn.disabled === true;
    await wait(450);
    const whileBusy = lists;
    focusBtn.disabled = false;
    listAnswer = [sub, row];
    await wait(900);
    return { expiredSays, expiredTitle, listsAfterExpired, green, focused, whileBusy, afterBusy: lists };
  }, { row: grokRow, sub: ACCOUNTS.find((a) => a.email === 'sub@example.com') });

  await browser.close();

  const problems = [];
  if (clicks.expiredSays !== 'Not until Grok runs again' || !/renews this sign-in/.test(clicks.expiredTitle) || clicks.listsAfterExpired !== 1) {
    problems.push('#3997: Check now on an expired Grok key did not say so (or repainted for nothing): ' + JSON.stringify(clicks));
  }
  if (!clicks.green) problems.push('#3997: Check now answering connected did not repaint the row green: ' + JSON.stringify(clicks));
  if (!clicks.focused) problems.push('#3997: the busy arm could not mark a Check now in flight, so it tested nothing: ' + JSON.stringify(clicks));
  if (clicks.whileBusy !== 1) problems.push('#3997: a follow-up rebuilt the list while a Check now was in flight: ' + JSON.stringify(clicks));
  if (clicks.afterBusy < 2) problems.push('#3997: the follow-up never read again once the person was done: ' + JSON.stringify(clicks));
  if (r.error) problems.push(r.error);
  if (!(follow.before === 'acct-unverified' && follow.afterOne === 3 && follow.after === 'acct-connected')) {
    problems.push('#3997: a row whose check was under way was not read again until it could say, and turned green: ' + JSON.stringify(follow));
  }
  if (follow.afterTwo !== follow.bound) problems.push('#3997: a check that never finished was not read exactly up to the bound (a loop, or it gave up early): ' + JSON.stringify(follow));
  if (follow.control !== 1) problems.push('#3997 CONTROL: a list with no check under way was read again: ' + JSON.stringify(follow));
  if (r.count !== ACCOUNTS.length) problems.push('expected ' + ACCOUNTS.length + ' account rows, got ' + r.count);

  const want = [
    // A Claude subscription row carries the browser-OAuth reauth (data-reauth), never the
    // OpenAI subscription reauth. #2568/#2584: the two reauth affordances never cross.
    { email: 'work@example.com', cls: 'acct-connected', text: /Signed in.*active/, claudeReauth: true, openaiReauth: false, checkNow: true, checkSignin: '' },
    { email: 'rej@example.com', cls: 'acct-none', text: /Not connected/, checkNow: true },
    // #3136: unver@ is EXACTLY Josh's state (a signed-in but not-recently-observed account).
    // The VISIBLE pill now reads a NEUTRAL "Signed in" (Josh read the old "not recently checked"
    // as "not connected" though he was); the nuance moves to the TITLE, and it carries "Check
    // now" so he can positively verify. Still honesty:true -- muted, never green (#874).
    // #3997 (Josh 09-26): unconfirmed is AMBER (.acct-unverified) on every provider; grey is only "could not check".
    { email: 'unver@example.com', cls: 'acct-unverified', text: /^Signed in$/, notText: /not recently checked/,
      titleText: /Check now|not seen a request/, honesty: true, checkNow: true },
    // #3136: signed_out and unchecked are still CLAUDE rows, so "Check now" must render on
    // them too -- assert it, so the "every Claude row" claim is tested for every badge state
    // and a future change that conditioned the button on `badge` would red here.
    { email: 'out@example.com', cls: 'acct-none', checkNow: true },
    { email: 'unk@example.com', cls: 'acct-unknown', checkNow: true },
    // #2568: the ChatGPT-subscription row. The VISIBLE pill must be the short shape
    // label; the long because sentence must live in the TITLE, never the visible span
    // (that overflow was the bug). notText pins that the long sentence is NOT rendered
    // visibly, so a revert to the legacy fallback (which put it in the span) reds here.
    // #2584: it also now carries the OpenAI subscription reauth (data-openai-reauth), and
    // NOT the Claude data-reauth -- the affordance #2568 deferred, now that the driver exists.
    // #3997: the same amber "Signed in" as every unconfirmed sign-in (was a grey "Signed in · not checked live"),
    // and its own free Check now (codex's handshake), never the Claude probe.
    { email: 'sub@example.com', cls: 'acct-unverified', text: /^Signed in$/,
      notText: /may or may not still work|not checked live/, titleText: /may or may not still work/, honesty: true,
      claudeReauth: false, openaiReauth: true, checkNow: false, checkSignin: 'openai' },
    // api-key rows of both providers: NEITHER reauth button. (Keyed by the primary label
    // paintAccounts renders -- an api-key OpenAI row has no email, so its label is its key tail.)
    // #3136: the CLAUDE api-key row DOES get Check now (a claude -p probe works for it);
    // the OpenAI api-key row does NOT (this `checkNow` is the Claude probe; the free sign-in checks of #3997 are `checkSignin`).
    { email: 'clkey@example.com', claudeReauth: false, openaiReauth: false, checkNow: true },
    { email: 'API key ending cd34', claudeReauth: false, openaiReauth: false, checkNow: false, checkSignin: '' },
    // #3391 part 2: a Grok KEY row has no sign-in to redo, so no Grok Sign in again.
    { email: 'API key ending gk12', claudeReauth: false, openaiReauth: false, grokReauth: false, checkNow: false, checkSignin: '' },
    { email: 'No Email Grok', grokReauth: false },
    // #3391: the Grok subscription row; #3997: amber, with its own free Check now (checkSignin) and a title that
    // points at it. Disconnect / Delete say sign-in, never key.
    // #3997: amber, with its own free Check now (the models listing), so its title points at it.
    { email: 'grok@example.com', cls: 'acct-unverified', text: /^Signed in$/, honesty: true, checkNow: false, grokReauth: true,
      checkSignin: 'grok', titleText: /Check now/,
      disconnectTitle: /sign-in/, notDisconnectTitle: /key/, deleteTitle: /sign-in/, notDeleteTitle: /API key/ },
    // #3391 round 18: the lapsed and unknown Grok sign-ins show their short sentence, never green,
    // and keep the pill short (#2568). #3391 part 2: the remedy is the row's Sign in again button.
    { email: 'grok-lapsed@example.com', text: /^Grok sign-in expired$/, honesty: true, notText: /sign in again|please/i, checkNow: false, grokReauth: true, checkSignin: '' },
    { email: 'grok-unk@example.com', text: /^Could not check the Grok sign-in$/, honesty: true, notText: /sign in again|please/i, checkNow: false, grokReauth: true, checkSignin: '' },
  ];
  for (const w of want) {
    const got = (r.byEmail || {})[w.email];
    if (!got) { problems.push(`no badge rendered for ${w.email}`); continue; }
    if (w.cls && (!got.cls || got.cls.indexOf(w.cls) === -1)) problems.push(`${w.email}: expected class ${w.cls}, got "${got.cls}"`);
    if (w.text && !w.text.test(got.text || '')) problems.push(`${w.email}: text "${got.text}" does not match ${w.text}`);
    if (w.notText && w.notText.test(got.text || '')) problems.push(`${w.email}: the long status sentence is in the VISIBLE pill (${w.notText}) - the #2568 overflow is back`);
    if (w.titleText && !w.titleText.test(got.title || '')) problems.push(`${w.email}: the full reason is missing from the title (${w.titleText}); got title "${got.title}"`);
    if (w.honesty && got.cls && got.cls.indexOf('acct-connected') !== -1) {
      problems.push(`${w.email}: a merely-existing credential rendered GREEN (acct-connected) - the #874 false-green is back`);
    }
    if (typeof w.checkSignin === 'string' && got.checkSignin !== w.checkSignin) {
      problems.push(`${w.email}: free Check now "${got.checkSignin}", expected "${w.checkSignin}" (#3997)`);
    }
    if (typeof w.claudeReauth === 'boolean' && got.claudeReauth !== w.claudeReauth) {
      problems.push(`${w.email}: Claude reauth button ${got.claudeReauth ? 'present' : 'absent'}, expected ${w.claudeReauth ? 'present' : 'absent'}`);
    }
    if (typeof w.openaiReauth === 'boolean' && got.openaiReauth !== w.openaiReauth) {
      problems.push(`${w.email}: OpenAI reauth button ${got.openaiReauth ? 'present' : 'absent'}, expected ${w.openaiReauth ? 'present' : 'absent'}`);
    }
    /* #3391 part 2: checked on EVERY row, so it is also a guard that no Claude, OpenAI or
       key row grows a Grok sign-in again. */
    if (got.grokReauth !== (w.grokReauth === true)) {
      problems.push(`${w.email}: Grok sign-in again button ${got.grokReauth ? 'present' : 'absent'}, expected ${w.grokReauth ? 'present' : 'absent'}`);
    }
    if (w.notTitle && w.notTitle.test(got.title || '')) problems.push(`${w.email}: the title points at something this row does not have (${w.notTitle}); got "${got.title}"`);
    if (w.disconnectTitle && !w.disconnectTitle.test(got.disconnectTitle || '')) problems.push(`${w.email}: Disconnect title "${got.disconnectTitle}" does not match ${w.disconnectTitle}`);
    if (w.notDisconnectTitle && w.notDisconnectTitle.test(got.disconnectTitle || '')) problems.push(`${w.email}: Disconnect title "${got.disconnectTitle}" says ${w.notDisconnectTitle}`);
    if (w.deleteTitle && !w.deleteTitle.test(got.deleteTitle || '')) problems.push(`${w.email}: Delete title "${got.deleteTitle}" does not match ${w.deleteTitle}`);
    if (w.notDeleteTitle && w.notDeleteTitle.test(got.deleteTitle || '')) problems.push(`${w.email}: Delete title "${got.deleteTitle}" says ${w.notDeleteTitle}`);
    if (typeof w.checkNow === 'boolean' && got.checkNow !== w.checkNow) {
      problems.push(`${w.email}: Check now button ${got.checkNow ? 'present' : 'absent'}, expected ${w.checkNow ? 'present' : 'absent'} (#3136 is Claude-only)`);
    }
  }

  console.log('  ' + JSON.stringify(r.byEmail));
  if (problems.length) {
    console.error(`render-account-badge-1921: ${problems.length} problem(s)`);
    for (const p of problems) console.error('  FAIL  ' + p);
    process.exit(1);
  }
  console.log('render-account-badge-1921: the badge renders verified liveness per state; a merely-existing credential is amber (unconfirmed), never green.');
})();
