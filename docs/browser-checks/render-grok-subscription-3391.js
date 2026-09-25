// Browser-check-surface: acct-grok-flow acct-grok-pick acct-grok-sub-go fr-grok-sub data-grok-reauth
'use strict';
/**
 * kosmos#3391 part 2: a Grok SUBSCRIPTION sign-in, started from Settings > AI Models and from
 * first run's Grok row, and signing an existing one in again from its row. HERMETIC (file://,
 * fetch stubbed). The status poll is captured rather than run on a timer, so each state is
 * delivered by an explicit tick. Asserts:
 *   - Settings: picking Grok shows the choice (subscription or key) with the key step hidden;
 *     "Use an API key" opens the key step; the sign-in POSTs no reauthDir, shows the link and
 *     the code, says what to do, and on connected shows the gold success box with the email;
 *   - an engine error is said in words and the button re-arms; a missing grok names the tool;
 *     Stop and closing the dialog both cancel on the engine, and a late answer paints nothing;
 *   - a row's Sign in again opens straight onto the sign-in with that account's reauthDir, and
 *     a fresh "+ Add a provider" afterwards is not a sign-in again;
 *   - first run: Grok's box offers the sign-in; closing the box cancels it; connected closes
 *     the box, names the account and leaves Gemini's row as it was.
 *
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" HEADED=0 node docs/browser-checks/render-grok-subscription-3391.js
 */
const path = require('node:path');
let chromium;
try { ({ chromium } = require('playwright')); }
catch { console.log('render-grok-subscription-3391: playwright not on NODE_PATH - SKIPPED, not passed.'); process.exit(0); }

const PAGE = 'file://' + path.join(path.resolve(__dirname, '..', '..'), 'web', 'index.html');
const fail = [];
const chk = (ok, label, extra) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
};

(async () => {
  let browser;
  try { browser = await chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch (err) {
    console.error('FAIL  render-grok-subscription-3391: could not start a browser'
      + (process.env.HEADED === '0' ? '.' : ' (headed; try HEADED=0).'));
    console.error('  ' + (err && err.message ? err.message.split('\n')[0] : err));
    process.exit(1);
  }
  const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  await page.addInitScript(() => {
    window.__starts = [];
    window.__cancels = [];
    window.__status = { state: 'starting' };
    window.__startAnswer = null;   // null: a session; otherwise [status, body]
    window.__accounts = [];
    window.__polls = new Map();
    let nextId = 1;
    const enc = (o, status) => new Response(JSON.stringify(o), { status: status || 200, headers: { 'content-type': 'application/json' } });
    // Only the Grok status poll is kept; every other page timer is a no-op, as in the #3658 check.
    window.setInterval = (fn) => {
      if (!/grok\/subscription\/status/.test(String(fn))) return 0;
      const id = nextId++;
      window.__polls.set(id, fn);
      return id;
    };
    window.clearInterval = (id) => { window.__polls.delete(id); };
    window.__tick = async () => {
      for (const fn of [...window.__polls.values()]) await fn();
      await new Promise((r) => setTimeout(r, 30));
    };
    window.fetch = async (url, opts) => {
      const u = String(url);
      if (/\/api\/accounts\/grok\/subscription\/start$/.test(u)) {
        const body = JSON.parse((opts && opts.body) || '{}');
        window.__starts.push(body);
        if (window.__holdStart) await window.__holdStart;
        if (window.__startAnswer) return enc(window.__startAnswer[1], window.__startAnswer[0]);
        return enc({ sessionId: 'sess' + window.__starts.length });
      }
      if (/\/api\/accounts\/grok\/subscription\/cancel$/.test(u)) {
        window.__cancels.push(JSON.parse((opts && opts.body) || '{}').sessionId);
        return enc({ cancelled: true });
      }
      if (/\/api\/accounts\/grok\/subscription\/status/.test(u)) {
        if (window.__status === 404) return enc({ error: 'no such sign-in in progress' }, 404);
        return enc(window.__status);
      }
      if (/\/api\/accounts\/(gemini|grok)\/apikey$/.test(u)) return enc({ error: 'that does not look like a key' }, 400);
      if (/\/api\/accounts(\?|$)/.test(u)) return enc({ accounts: window.__accounts.slice() });
      return enc({});
    };
  });
  await page.goto(PAGE);
  // Let the page boot: with no accounts stubbed it opens first run, which makes the rest of the
  // page inert. The Settings arms close it the page's own way (frClose lifts the inert), so a
  // focus assertion there can pass; first run's arms reopen it later.
  await page.waitForTimeout(800);
  const q = (fn, arg) => page.evaluate(fn, arg);
  const tick = () => q(() => window.__tick());
  const G = (id) => q((i) => { const e = document.getElementById(i); return e ? { hidden: e.hidden, text: e.textContent, disabled: e.disabled, href: e.getAttribute('href') } : null; }, id);

  /* ---------------- Settings, AI Models ---------------- */
  await q(() => { frClose(); openAcctAdd(); acctPick('xai'); });
  const pick = await q(() => ({
    flow: !document.getElementById('acct-grok-flow').hidden,
    pick: !document.getElementById('acct-grok-pick').hidden,
    sub: !document.getElementById('acct-grok-sub-step').hidden,
    key: !document.getElementById('acct-apikey-flow').hidden,
    focus: document.activeElement && document.activeElement.id,
  }));
  chk(pick.flow && pick.pick && !pick.sub && !pick.key && pick.focus === 'acct-grok-pick-sub',
    'picking Grok shows the choice, with the key step hidden until it is chosen', JSON.stringify(pick));

  const key = await q(() => {
    document.getElementById('acct-grok-pick-key').click();
    return { key: !document.getElementById('acct-apikey-flow').hidden, grok: !document.getElementById('acct-grok-flow').hidden,
      focus: document.activeElement && document.activeElement.id };
  });
  chk(key.key && !key.grok && key.focus === 'acct-apikey-key', '"Use an API key" opens the key step', JSON.stringify(key));

  const gemini = await q(() => { acctPick('google'); return { grok: !document.getElementById('acct-grok-flow').hidden, key: !document.getElementById('acct-apikey-flow').hidden }; });
  chk(!gemini.grok && gemini.key, 'Gemini has no subscription choice: straight to its key step', JSON.stringify(gemini));

  await q(() => { acctPick('xai'); document.getElementById('acct-grok-pick-sub').click(); window.__status = { state: 'starting' }; document.getElementById('acct-grok-sub-go').click(); });
  await q(() => new Promise((r) => setTimeout(r, 50)));
  await q(() => { window.__status = { state: 'awaiting-code', authUrl: 'https://accounts.x.ai/oauth2/device?user_code=QWER-TYUI', userCode: 'QWER-TYUI' }; });
  await tick();
  const mid = await q(() => ({
    starts: window.__starts.slice(),
    link: document.getElementById('acct-grok-sub-open').getAttribute('href'),
    linkShown: !document.getElementById('acct-grok-sub-open-row').hidden,
    code: document.getElementById('acct-grok-sub-code').textContent,
    stop: !document.getElementById('acct-grok-sub-cancel-row').hidden,
    go: document.getElementById('acct-grok-sub-go').disabled,
    msg: document.getElementById('acct-grok-msg').textContent,
    focus: document.activeElement && document.activeElement.id,
  }));
  chk(mid.focus === 'acct-grok-sub-cancel', 'focus moves to Stop when the sign-in starts, not to the page body', JSON.stringify({ focus: mid.focus }));
  chk(mid.starts.length === 1 && !('reauthDir' in mid.starts[0]), 'a new sign-in POSTs start with no reauthDir', JSON.stringify(mid.starts));
  chk(mid.linkShown && /user_code=QWER-TYUI/.test(mid.link) && /QWER-TYUI/.test(mid.code) && mid.stop && mid.go && /Confirm the code/.test(mid.msg),
    'the link, the code, a way to stop and what to do are shown while it waits', JSON.stringify(mid));

  await q(() => { window.__status = { state: 'connected', account: { provider: 'xai', email: 'me@example.com', authMode: 'subscription', dir: '/h/.grok-work1' } }; });
  await tick();
  const ok = await q(() => ({
    success: !document.getElementById('acct-success').hidden,
    box: document.getElementById('acct-success-box').textContent,
    grokFlow: !document.getElementById('acct-grok-flow').hidden,
    polls: window.__polls.size,
  }));
  chk(ok.success && /Grok is connected/.test(ok.box) && /me@example\.com/.test(ok.box) && !ok.grokFlow && ok.polls === 0,
    'connected shows the gold success box with the email, hides the sign-in and stops polling', JSON.stringify(ok));

  // A repaint that throws after connected says so rather than sitting on "Checking...".
  const thrown = await q(async () => {
    closeAcctAdd(); openAcctAdd(); acctPick('xai'); document.getElementById('acct-grok-pick-sub').click();
    document.getElementById('acct-grok-sub-go').click();
    await new Promise((r) => setTimeout(r, 50));
    const real = window.paintAccounts;
    window.paintAccounts = async () => { throw new Error('repaint failed'); };
    window.__status = { state: 'connected', account: { email: 'me@example.com' } };
    const rejections = [];
    const onRej = (e) => rejections.push(String(e.reason));
    window.addEventListener('unhandledrejection', onRej);
    await window.__tick();
    await new Promise((r) => setTimeout(r, 50));
    window.removeEventListener('unhandledrejection', onRej);
    window.paintAccounts = real;
    return { msg: document.getElementById('acct-grok-msg').textContent, rejections };
  });
  chk(thrown.msg === 'Signed in, but this screen could not update. Close it and look in Settings, AI Models.' && thrown.rejections.length === 0,
    'a repaint that throws after connected is said in Settings\' own words, not left on Checking', JSON.stringify(thrown));

  // An engine error is said in words; the button re-arms.
  await q(() => { closeAcctAdd(); openAcctAdd(); acctPick('xai'); document.getElementById('acct-grok-pick-sub').click(); document.getElementById('acct-grok-sub-go').click(); });
  await q(() => new Promise((r) => setTimeout(r, 50)));
  await q(() => { window.__status = { state: 'error', error: 'that sign-in was for a different account, so this account was left unchanged' }; });
  await tick();
  const bad = await q(() => ({ msg: document.getElementById('acct-grok-msg').textContent, go: document.getElementById('acct-grok-sub-go').disabled,
    link: !document.getElementById('acct-grok-sub-open-row').hidden, polls: window.__polls.size,
    focus: document.activeElement && document.activeElement.id }));
  chk(bad.focus === 'acct-grok-sub-go', 'when it ends with Stop focused, focus returns to Sign in with Grok', JSON.stringify({ focus: bad.focus }));
  chk(/^That sign-in was for a different account, so this account was left unchanged\. You can try again\.$/.test(bad.msg) && !bad.go && !bad.link && bad.polls === 0,
    'an engine error is said in its own words and the button re-arms', JSON.stringify(bad));

  // A missing grok names the tool.
  await q(() => { window.__startAnswer = [400, { needsRunner: true, error: 'we could not find the Grok runner' }]; document.getElementById('acct-grok-sub-go').click(); });
  await q(() => new Promise((r) => setTimeout(r, 50)));
  const miss = await q(() => ({ msg: document.getElementById('acct-grok-msg').textContent, go: document.getElementById('acct-grok-sub-go').disabled }));
  chk(/"grok"/.test(miss.msg) && /not installed/.test(miss.msg) && !miss.go, 'a missing grok names its tool and re-arms', JSON.stringify(miss));
  await q(() => { window.__startAnswer = null; });

  // Stop cancels on the engine.
  await q(() => { window.__cancels.length = 0; window.__status = { state: 'awaiting-code', userCode: 'AAAA-BBBB' }; document.getElementById('acct-grok-sub-go').click(); });
  await q(() => new Promise((r) => setTimeout(r, 50)));
  const sid = await q(() => 'sess' + window.__starts.length);
  await q(() => document.getElementById('acct-grok-sub-cancel').click());
  const stop = await q(() => ({ cancels: window.__cancels.slice(), msg: document.getElementById('acct-grok-msg').textContent, polls: window.__polls.size,
    code: !document.getElementById('acct-grok-sub-code').hidden }));
  chk(stop.cancels.length === 1 && stop.cancels[0] === sid && stop.msg === 'Sign-in stopped.' && stop.polls === 0 && !stop.code,
    'Stop cancels this sign-in on the engine and says so', JSON.stringify({ ...stop, sid }));

  // Closing the dialog mid-sign-in cancels it, and a late connected paints nothing.
  await q(() => { window.__cancels.length = 0; document.getElementById('acct-grok-sub-go').click(); });
  await q(() => new Promise((r) => setTimeout(r, 50)));
  const sid2 = await q(() => 'sess' + window.__starts.length);
  const lateTick = await q(() => { const fns = [...window.__polls.values()]; closeAcctAdd(); window.__late = fns; return fns.length; });
  await q(async () => { window.__status = { state: 'connected', account: { email: 'late@example.com' } }; for (const fn of window.__late) await fn(); await new Promise((r) => setTimeout(r, 30)); });
  const closed = await q(() => ({ cancels: window.__cancels.slice(), success: !document.getElementById('acct-success').hidden,
    modal: !document.getElementById('acct-add-modal').hidden, box: document.getElementById('acct-success-box').textContent }));
  chk(lateTick === 1 && closed.cancels.includes(sid2) && !closed.success && !closed.modal && !/late@/.test(closed.box),
    'closing mid-sign-in cancels it on the engine, and a late answer paints nothing', JSON.stringify({ ...closed, lateTick, sid2 }));

  // Switching provider mid-sign-in ends it on the engine.
  const sw = await q(async () => {
    openAcctAdd(); acctPick('xai'); document.getElementById('acct-grok-pick-sub').click();
    window.__cancels.length = 0;
    document.getElementById('acct-grok-sub-go').click();
    await new Promise((r) => setTimeout(r, 50));
    const id = 'sess' + window.__starts.length;
    acctPick('google');
    return { id, cancels: window.__cancels.slice(), polls: window.__polls.size };
  });
  chk(sw.cancels.length === 1 && sw.cancels[0] === sw.id && sw.polls === 0, 'switching provider mid-sign-in ends it on the engine', JSON.stringify(sw));

  // A start that answers after the dialog closed is cancelled, not polled.
  const held = await q(async () => {
    acctPick('xai'); document.getElementById('acct-grok-pick-sub').click();
    window.__cancels.length = 0;
    let release; window.__holdStart = new Promise((r) => { release = r; });
    document.getElementById('acct-grok-sub-go').click();
    await new Promise((r) => setTimeout(r, 30));
    closeAcctAdd();
    release(); window.__holdStart = null;
    await new Promise((r) => setTimeout(r, 80));
    return { id: 'sess' + window.__starts.length, cancels: window.__cancels.slice(), polls: window.__polls.size };
  });
  chk(held.cancels.includes(held.id) && held.polls === 0, 'a start answered after the dialog closed is cancelled on the engine and never polled', JSON.stringify(held));

  // Sign in again from a row.
  await q(async () => {
    window.__accounts = [
      { provider: 'xai', providerName: 'Grok', email: 'lapsed@example.com', label: 'lapsed@example.com', dir: '/h/.grok-gl', isDefault: false, keyTail: null, authMode: 'subscription',
        memoryShared: true, offerable: true, connection: { state: 'none', checkedLive: true, because: 'Grok sign-in expired' } },
    ];
    await paintAccounts();
  });
  const again = await q(async () => {
    window.__starts.length = 0;
    const b = document.querySelector('#set-accounts [data-grok-reauth]');
    if (!b) return { button: false };
    b.click();
    const view = {
      button: true, label: b.getAttribute('aria-label'),
      title: document.getElementById('acct-add-t').textContent,
      provider: !document.getElementById('acct-provider-field').hidden,
      pick: !document.getElementById('acct-grok-pick').hidden,
      sub: !document.getElementById('acct-grok-sub-step').hidden,
      focus: document.activeElement && document.activeElement.id,
    };
    document.getElementById('acct-grok-sub-go').click();
    await new Promise((r) => setTimeout(r, 50));
    view.starts = window.__starts.slice();
    return view;
  });
  chk(again.button && /Sign in again as lapsed@example\.com/.test(again.label), 'a lapsed Grok subscription row has a Sign in again button', JSON.stringify(again));
  chk(again.title === 'Sign in again' && !again.provider && !again.pick && again.sub && again.focus === 'acct-grok-sub-go',
    'it opens straight onto the sign-in, in sign-in-again chrome', JSON.stringify(again));
  chk(again.starts.length === 1 && again.starts[0].reauthDir === '/h/.grok-gl', 'its start carries that account as reauthDir', JSON.stringify(again.starts));

  /* Reopened WITHOUT a close in between, so openAcctAdd's own clear is what is tested (a
     close does not clear the account; nothing but a sign-in again sets it). */
  const fresh = await q(async () => {
    window.__starts.length = 0;
    openAcctAdd(); acctPick('xai');
    const pickShown = !document.getElementById('acct-grok-pick').hidden;
    document.getElementById('acct-grok-pick-sub').click();
    document.getElementById('acct-grok-sub-go').click();
    await new Promise((r) => setTimeout(r, 50));
    const out = { pickShown, starts: window.__starts.slice(), title: document.getElementById('acct-add-t').textContent };
    closeAcctAdd();
    return out;
  });
  chk(fresh.pickShown && fresh.starts.length === 1 && !('reauthDir' in fresh.starts[0]) && fresh.title !== 'Sign in again',
    'a fresh "+ Add a provider" afterwards is a new sign-in, not a sign-in again', JSON.stringify(fresh));

  /* ---------------- first run ---------------- */
  await q(async () => {
    window.__accounts = [{ provider: 'google', providerName: 'Gemini', dir: '/h/.gemini-work1', keyTail: 'ab12', authMode: 'apikey', connection: { state: 'connected' } }];
    const fr = document.getElementById('firstrun'); if (fr) fr.hidden = false;
    frGo(5);
    await new Promise((r) => setTimeout(r, 120));
  });
  const fr1 = await q(async () => {
    document.getElementById('fr-grok-connect').click();
    await new Promise((r) => setTimeout(r, 120));
    return { box: !document.getElementById('fr-apikey-flow').hidden, sub: !document.getElementById('fr-grok-sub').hidden,
      head: document.getElementById('fr-apikey-t').textContent, gemini: document.getElementById('fr-gemini-connect').textContent.trim(),
      focus: document.activeElement && document.activeElement.id };
  });
  chk(fr1.focus === 'fr-grok-sub-go', 'first run: Grok\'s box puts focus on its sign-in, the first thing in it', JSON.stringify({ focus: fr1.focus }));
  chk(fr1.box && fr1.sub && /Sign in with your Grok subscription, or paste an xAI API key/.test(fr1.head),
    'first run: Grok\'s box offers the subscription sign-in beside the key', JSON.stringify(fr1));
  chk(/Connected/.test(fr1.gemini), 'CONTROL: Gemini is connected before the Grok sign-in', JSON.stringify(fr1));

  const frSwitch = await q(async () => {
    window.__cancels.length = 0;
    window.__starts.length = 0;
    window.__status = { state: 'awaiting-code', userCode: 'CCCC-DDDD' };
    document.getElementById('fr-grok-sub-go').click();
    await new Promise((r) => setTimeout(r, 50));
    await window.__tick();
    const code = document.getElementById('fr-grok-sub-code').textContent;
    return { code, starts: window.__starts.slice() };
  });
  chk(frSwitch.starts.length === 1 && !('reauthDir' in frSwitch.starts[0]) && /CCCC-DDDD/.test(frSwitch.code),
    'first run\'s sign-in starts as a new account and shows its code', JSON.stringify(frSwitch));

  // The key's own answer survives the sign-in's poll: the two write different lines.
  const lines = await q(async () => {
    document.getElementById('fr-apikey-key').value = '';
    document.getElementById('fr-apikey-go').click();
    await new Promise((r) => setTimeout(r, 50));
    const keySaid = document.getElementById('fr-apikey-msg').textContent;
    await window.__tick();
    return { keySaid, keyAfter: document.getElementById('fr-apikey-msg').textContent, subSaid: document.getElementById('fr-grok-sub-msg').textContent };
  });
  chk(lines.keySaid === 'Paste the key first.' && lines.keyAfter === lines.keySaid && /Confirm the code/.test(lines.subSaid),
    'first run: the sign-in\'s progress has its own line and does not wipe the key\'s answer', JSON.stringify(lines));

  // Close and reopen Grok's box: the sign-in in flight is cancelled on the engine.
  const frClose = await q(async () => {
    window.__cancels.length = 0;
    document.getElementById('fr-grok-connect').click();   // a second press closes the box
    await new Promise((r) => setTimeout(r, 120));
    return { cancels: window.__cancels.slice(), box: !document.getElementById('fr-apikey-flow').hidden, polls: window.__polls.size };
  });
  chk(frClose.cancels.length === 1 && !frClose.box && frClose.polls === 0,
    'first run: closing Grok\'s box ends its sign-in on the engine', JSON.stringify(frClose));

  // Leaving the step (no close) ends the sign-in at the next poll.
  const frLeave = await q(async () => {
    document.getElementById('fr-grok-connect').click();
    await new Promise((r) => setTimeout(r, 120));
    window.__cancels.length = 0;
    window.__status = { state: 'awaiting-code', userCode: 'EEEE-FFFF' };
    document.getElementById('fr-grok-sub-go').click();
    await new Promise((r) => setTimeout(r, 50));
    const id = 'sess' + window.__starts.length;
    frGo(6);
    await window.__tick();
    const out = { id, cancels: window.__cancels.slice(), polls: window.__polls.size };
    frGo(5);
    await new Promise((r) => setTimeout(r, 120));
    return out;
  });
  chk(frLeave.cancels.includes(frLeave.id) && frLeave.polls === 0, 'first run: leaving the model step ends a sign-in in flight', JSON.stringify(frLeave));

  // First run's own words when its repaint throws (review pass 6: the texts are per caller).
  const frThrown = await q(async () => {
    document.getElementById('fr-grok-connect').click();
    await new Promise((r) => setTimeout(r, 120));
    document.getElementById('fr-grok-sub-go').click();
    await new Promise((r) => setTimeout(r, 50));
    const real = window.frPaintKeyed;
    window.frPaintKeyed = async () => { throw new Error('repaint failed'); };
    window.__status = { state: 'connected', account: { email: 'me@example.com' } };
    await window.__tick();
    await new Promise((r) => setTimeout(r, 50));
    window.frPaintKeyed = real;
    const out = { msg: document.getElementById('fr-grok-sub-msg').textContent };
    document.getElementById('fr-apikey-flow').hidden = true; FR_APIKEY_WHICH = null; frApikeyExpanded(null);
    return out;
  });
  chk(frThrown.msg === 'Signed in, but this screen could not update. Grok will show as connected in Settings, AI Models.',
    'first run: a repaint that throws after connected is said in first run\'s own words', JSON.stringify(frThrown));

  const frDone = await q(async () => {
    document.getElementById('fr-grok-connect').click();
    await new Promise((r) => setTimeout(r, 120));
    document.getElementById('fr-grok-sub-go').click();
    await new Promise((r) => setTimeout(r, 50));
    window.__accounts.push({ provider: 'xai', providerName: 'Grok', email: 'me@example.com', dir: '/h/.grok-work1', authMode: 'subscription', connection: { state: 'connected', badge: 'signed_in_unverified' } });
    window.__status = { state: 'connected', account: { provider: 'xai', email: 'me@example.com', authMode: 'subscription', dir: '/h/.grok-work1', connection: { state: 'connected' } } };
    await window.__tick();
    await new Promise((r) => setTimeout(r, 120));
    return {
      box: !document.getElementById('fr-apikey-flow').hidden,
      msg: document.getElementById('fr-apikey-msg').textContent,
      grok: document.getElementById('fr-grok-connect').textContent.trim(),
      grokDisabled: document.getElementById('fr-grok-connect').disabled,
      gemini: document.getElementById('fr-gemini-connect').textContent.trim(),
    };
  });
  chk(!frDone.box && frDone.msg === 'Grok is connected (me@example.com).' && /Connected/.test(frDone.grok) && frDone.grokDisabled,
    'first run: connected closes the box, names the account and marks Grok Connected', JSON.stringify(frDone));
  chk(/Connected/.test(frDone.gemini), 'first run: Gemini\'s row is left as it was', JSON.stringify(frDone));

  chk(errs.length === 0, 'no page errors', errs.join(' | '));
  await browser.close();
  if (fail.length) {
    console.error('render-grok-subscription-3391: ' + fail.length + ' check(s) failed');
    process.exit(1);
  }
  console.log('render-grok-subscription-3391: Grok signs in with a subscription from Settings and first run, and a row signs in again in place.');
})().catch((err) => {
  console.error('FAIL  render-grok-subscription-3391: the check itself threw: ' + (err && err.message ? err.message.split('\n')[0] : err));
  process.exit(1);
});
