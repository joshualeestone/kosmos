// Browser-check-surface: acct-grok-flow acct-grok-pick acct-grok-sub-go fr-grok-sub-step data-grok-reauth devcode devcode-cell devcode-note
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
 *   - first run (#3731, GPT's flow in Grok's own panel): the choice, then the sign-in starts at
 *     once; the key, another provider or leaving the step cancels it; connected closes the panel,
 *     names the account and leaves Gemini's row as it was.
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
    /* #3731: Settings shows Grok's choice, or Gemini's key, only once /api/runners says the
       software is here, so a pick settles before anything on it is pressed. */
    window.__pick = async (w) => { acctPick(w); for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 10)); };
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
      // #3731: both tools are installed here; the install itself is render-firstrun-keyed-connect-3658.js's.
      if (/\/api\/runners(\?|$)/.test(u)) return enc({ runners: { gemini: { present: true }, grok: { present: true } } });
      if (/\/api\/accounts(\?|$)/.test(u)) return enc({ accounts: window.__accounts.slice() });
      // #3874: Gemini's own subscription choice is render-settings-agy-3874.js's; here it is not offered.
      if (/\/api\/antigravity(\?|$)/.test(u)) return enc({ enabled: true, supported: false, installed: false });
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
  /* #3952 (Josh 09-26): the code on its own row, one box per character, grouped as xAI groups it, and the line that
     heads off xAI's "terminal" wording. Read off the rendered page: boxes, their text, one row, and their size. */
  const boxesIn = (id) => q((i) => {
    const host = document.getElementById(i);
    const row = host && host.querySelector('.devcode');
    const cells = row ? [...row.querySelectorAll('.devcode-cell')] : [];
    const rects = cells.map((c) => c.getBoundingClientRect());
    const note = host && host.querySelector('.devcode-note');
    return { cells: cells.length, dashes: row ? row.querySelectorAll('.devcode-dash').length : 0,
      text: cells.map((c) => c.textContent).join(''), label: row ? row.getAttribute('aria-label') : null,
      oneRow: rects.length > 0 && rects.every((b) => Math.abs(b.top - rects[0].top) < 1),
      minW: rects.length ? Math.min(...rects.map((b) => b.width)) : 0, minH: rects.length ? Math.min(...rects.map((b) => b.height)) : 0,
      note: note ? note.textContent : '',
      // What a person copies by selecting the row: one run, never one character per line (a flex layout did that).
      copied: row ? row.innerText : '',
      // Every box inside the host's own width (a phone must never cut the code off), and where it breaks, it breaks at
      // the dash: each group stays on one row.
      inside: !!host && rects.every((b) => b.right <= host.getBoundingClientRect().right + 0.5 && b.left >= host.getBoundingClientRect().left - 0.5),
      groupsWhole: row ? [...row.querySelectorAll('.devcode-grp')].every((g) => { const cs = [...g.querySelectorAll('.devcode-cell')].map((c) => c.getBoundingClientRect().top); return cs.every((t) => Math.abs(t - cs[0]) < 1); }) : false };
  }, id);
  const narrowOk = (b, text) => b.cells === text.length && b.inside && b.groupsWhole && b.minW >= 20;
  const atPhone = async (id) => {
    await page.setViewportSize({ width: 360, height: 800 }); await page.waitForTimeout(150);
    const b = await boxesIn(id);
    if (process.env.SHOTS) await page.locator('#' + id).screenshot({ path: require('node:path').join(process.env.SHOTS, id + '-360.png') });
    await page.setViewportSize({ width: 1100, height: 1000 }); await page.waitForTimeout(150);
    return b;
  };
  const boxesOk = (b, text, label) => b.cells === text.length && b.dashes === 1 && b.text === text && b.label === label
    && b.copied === text.slice(0, 4) + '-' + text.slice(4) && b.oneRow && b.minW >= 24 && b.minH >= 30 && /xAI's page says "terminal": it means this code here in Kosmos\./.test(b.note);
  const G = (id) => q((i) => { const e = document.getElementById(i); return e ? { hidden: e.hidden, text: e.textContent, disabled: e.disabled, href: e.getAttribute('href') } : null; }, id);

  /* ---------------- Settings, AI Models ---------------- */
  await q(async () => { frClose(); openAcctAdd(); await window.__pick('xai'); });
  const pick = await q(() => ({
    flow: !document.getElementById('acct-grok-flow').hidden,
    pick: !document.getElementById('acct-grok-pick').hidden,
    sub: !document.getElementById('acct-grok-sub-step').hidden,
    key: !document.getElementById('acct-apikey-flow').hidden,
    focus: document.activeElement && document.activeElement.id,
  }));
  chk(pick.flow && pick.pick && !pick.sub && !pick.key && pick.focus === 'acct-grok-pick-sub',
    'picking Grok shows the choice, with the key step hidden until it is chosen', JSON.stringify(pick));
  // #3731 (review pass 2): Settings' buttons draw Kosmos's ink ring on the keyboard, not the browser's blue.
  await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
  const sring = await q(() => {
    const b = document.getElementById('acct-grok-pick-sub');
    const probe = document.createElement('i'); probe.style.color = 'var(--k-ink)'; document.getElementById('acct-add-dialog').appendChild(probe);
    const ink = getComputedStyle(probe).color; probe.remove();
    const cs = getComputedStyle(b);
    return { focused: document.activeElement === b, visible: b.matches(':focus-visible'), style: cs.outlineStyle, color: cs.outlineColor, ink };
  });
  chk(sring.focused && sring.visible && sring.style === 'solid' && sring.color === sring.ink,
    '#3731 Settings: on the keyboard the ring is Kosmos\'s ink, not the browser\'s blue', JSON.stringify(sring));

  const key = await q(() => {
    document.getElementById('acct-grok-pick-key').click();
    return { key: !document.getElementById('acct-apikey-flow').hidden, grok: !document.getElementById('acct-grok-flow').hidden,
      focus: document.activeElement && document.activeElement.id };
  });
  chk(key.key && !key.grok && key.focus === 'acct-apikey-key', '"Use an API key" opens the key step', JSON.stringify(key));

  const gemini = await q(async () => { await window.__pick('google'); return { grok: !document.getElementById('acct-grok-flow').hidden, key: !document.getElementById('acct-apikey-flow').hidden }; });
  chk(!gemini.grok && gemini.key, 'where Gemini\'s subscription is not offered (#3874: not a Mac, or switched off), no choice: straight to its key step', JSON.stringify(gemini));

  await q(async () => { await window.__pick('xai'); document.getElementById('acct-grok-pick-sub').click(); window.__status = { state: 'starting' }; document.getElementById('acct-grok-sub-go').click(); });
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
  const setBoxes = await boxesIn('acct-grok-sub-code');
  chk(boxesOk(setBoxes, 'QWERTYUI', 'Q W E R, T Y U I'), '#3952 Settings: the code in big boxes on one row, 4 - 4, with the "terminal" line', JSON.stringify(setBoxes));
  if (process.env.SHOTS) await page.locator('#acct-grok-sub-code').screenshot({ path: require('node:path').join(process.env.SHOTS, 'grok-code-settings.png') });
  const setPhone = await atPhone('acct-grok-sub-code');
  chk(narrowOk(setPhone, 'QWERTYUI'), '#3952 Settings at 360px: every box inside its box, groups whole (review round 1)', JSON.stringify(setPhone));

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
    closeAcctAdd(); openAcctAdd(); await window.__pick('xai'); document.getElementById('acct-grok-pick-sub').click();
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
    const m = document.getElementById('acct-grok-msg');
    return { msg: m.textContent, visible: m.getClientRects().length > 0, rejections };
  });
  chk(thrown.msg === 'Signed in, but this screen could not update. Close it and look in Settings, AI Models.' && thrown.visible && thrown.rejections.length === 0,
    'a repaint that throws after connected is said in Settings\' own words, not left on Checking', JSON.stringify(thrown));

  // An engine error is said in words; the button re-arms.
  await q(async () => { closeAcctAdd(); openAcctAdd(); await window.__pick('xai'); document.getElementById('acct-grok-pick-sub').click(); document.getElementById('acct-grok-sub-go').click(); });
  await q(() => new Promise((r) => setTimeout(r, 50)));
  await q(() => { window.__status = { state: 'error', error: 'that sign-in was for a different account, so this account was left unchanged' }; });
  await tick();
  const bad = await q(() => ({ msg: document.getElementById('acct-grok-msg').textContent, go: document.getElementById('acct-grok-sub-go').disabled,
    link: !document.getElementById('acct-grok-sub-open-row').hidden, polls: window.__polls.size,
    focus: document.activeElement && document.activeElement.id }));
  chk(bad.focus === 'acct-grok-sub-go', 'when it ends with Stop focused, focus returns to Sign in with Grok', JSON.stringify({ focus: bad.focus }));
  chk(/^That sign-in was for a different account, so this account was left unchanged\. You can try again\.$/.test(bad.msg) && !bad.go && !bad.link && bad.polls === 0,
    'an engine error is said in its own words and the button re-arms', JSON.stringify(bad));

  // A missing grok names the tool (reachable only if it went missing after the box opened).
  await q(() => { window.__startAnswer = [400, { needsRunner: true, error: 'we could not find the Grok runner' }]; document.getElementById('acct-grok-sub-go').click(); });
  await q(() => new Promise((r) => setTimeout(r, 50)));
  const miss = await q(() => ({ msg: document.getElementById('acct-grok-msg').textContent, go: document.getElementById('acct-grok-sub-go').disabled,
    install: !document.getElementById('acct-keyed-install').hidden, ask: document.getElementById('acct-keyed-install-t').textContent,
    grok: !document.getElementById('acct-grok-flow').hidden }));
  // #3713: Kosmos installs grok now, so a sign-in that finds none opens the download box in its place.
  chk(miss.install && miss.ask === 'In order to connect to xAI Grok we need to download the installer.' && !miss.grok && !/cannot install/.test(miss.msg),
    '#3713 a sign-in that finds no grok opens the download box in its place', JSON.stringify(miss));
  // Windows installs grok now too, so the same answer opens the same download box there.
  // (#3731: "Sign in with Grok" starts the sign-in itself, so the answer is staged before it.)
  await q(async () => {
    document.querySelector('meta[name="kosmos-platform"]').content = 'win32';
    window.__startAnswer = [400, { needsRunner: true, error: 'we could not find the Grok runner' }];
    await window.__pick('xai');
    document.getElementById('acct-grok-pick-sub').click();
  });
  await q(() => new Promise((r) => setTimeout(r, 50)));
  const winMiss = await q(() => ({ msg: document.getElementById('acct-grok-msg').textContent,
    install: !document.getElementById('acct-keyed-install').hidden, ask: document.getElementById('acct-keyed-install-t').textContent }));
  chk(winMiss.install && winMiss.ask === 'In order to connect to xAI Grok we need to download the installer.' && !/Windows/.test(winMiss.msg),
    'on Windows, a sign-in that finds no grok opens the same download box as the Mac', JSON.stringify(winMiss));
  await q(() => { window.__startAnswer = null; document.querySelector('meta[name="kosmos-platform"]').content = '__KOSMOS_PLATFORM__'; });

  // Stop cancels on the engine.
  await q(() => { window.__cancels.length = 0; window.__status = { state: 'awaiting-code', userCode: 'AAAA-BBBB' }; document.getElementById('acct-grok-sub-go').click(); });
  await q(() => new Promise((r) => setTimeout(r, 50)));
  const sid = await q(() => 'sess' + window.__starts.length);
  await q(() => document.getElementById('acct-grok-sub-cancel').click());
  const stop = await q(() => ({ cancels: window.__cancels.slice(), polls: window.__polls.size,
    code: !document.getElementById('acct-grok-sub-code').hidden, pick: !document.getElementById('acct-grok-pick').hidden,
    step: !document.getElementById('acct-grok-sub-step').hidden, focus: document.activeElement && document.activeElement.id }));
  // #3731 (review pass 3): as GPT's Settings Stop does, back to the choice, with "Use an API key" one press away.
  chk(stop.cancels.length === 1 && stop.cancels[0] === sid && stop.polls === 0 && !stop.code && stop.pick && !stop.step && stop.focus === 'acct-grok-pick-sub',
    'Stop cancels this sign-in on the engine and goes back to the choice', JSON.stringify({ ...stop, sid }));

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
    openAcctAdd(); await window.__pick('xai'); document.getElementById('acct-grok-pick-sub').click();
    window.__cancels.length = 0;
    document.getElementById('acct-grok-sub-go').click();
    await new Promise((r) => setTimeout(r, 50));
    const id = 'sess' + window.__starts.length;
    await window.__pick('google');
    return { id, cancels: window.__cancels.slice(), polls: window.__polls.size };
  });
  chk(sw.cancels.length === 1 && sw.cancels[0] === sw.id && sw.polls === 0, 'switching provider mid-sign-in ends it on the engine', JSON.stringify(sw));

  // A start that answers after the dialog closed is cancelled, not polled.
  const held = await q(async () => {
    await window.__pick('xai'); document.getElementById('acct-grok-pick-sub').click();
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
  // #3731 (review pass 4): a sign in again has no choice to go back to, so its Stop stays on its own
  // step, says so, and gives the Sign-in button back (a new sign-in's Stop goes back to the choice).
  const againStop = await q(async () => {
    document.getElementById('acct-grok-sub-cancel').click();
    await new Promise((r) => setTimeout(r, 30));
    return { msg: document.getElementById('acct-grok-msg').textContent, step: !document.getElementById('acct-grok-sub-step').hidden,
      pick: !document.getElementById('acct-grok-pick').hidden, go: !document.getElementById('acct-grok-sub-go').hidden,
      focus: document.activeElement && document.activeElement.id };
  });
  chk(againStop.msg === 'Sign-in stopped.' && againStop.step && !againStop.pick && againStop.go && againStop.focus === 'acct-grok-sub-go',
    '#3731 a sign in again\'s Stop stays on its own step, says so, and gives the Sign-in button back', JSON.stringify(againStop));

  /* Reopened WITHOUT a close in between, so openAcctAdd's own clear is what is tested (a
     close does not clear the account; nothing but a sign-in again sets it). */
  const fresh = await q(async () => {
    window.__starts.length = 0;
    openAcctAdd(); await window.__pick('xai');
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

  /* ---------------- first run (#3731: Grok's own panel, GPT's flow) ---------------- */
  await q(async () => {
    window.__accounts = [{ provider: 'google', providerName: 'Gemini', dir: '/h/.gemini-work1', keyTail: 'ab12', authMode: 'apikey', connection: { state: 'connected' } }];
    const fr = document.getElementById('firstrun'); if (fr) fr.hidden = false;
    frGo(5);
    await new Promise((r) => setTimeout(r, 120));
  });
  const fr1 = await q(async () => {
    document.getElementById('fr-grok-connect').click();
    await new Promise((r) => setTimeout(r, 200));
    return { pick: !document.getElementById('fr-grok-pick').hidden, gemini: document.getElementById('fr-gemini-connect').textContent.trim(),
      focus: document.activeElement && document.activeElement.id };
  });
  chk(fr1.pick && fr1.focus === 'fr-grok-pick-sub', 'first run: with grok installed, Grok\'s Connect shows the choice, focus on Sign in with Subscription', JSON.stringify(fr1));
  chk(/Connected/.test(fr1.gemini), 'CONTROL: Gemini is connected before the Grok sign-in', JSON.stringify(fr1));

  const frSwitch = await q(async () => {
    window.__cancels.length = 0;
    window.__starts.length = 0;
    window.__status = { state: 'awaiting-code', userCode: 'CCCC-DDDD' };
    document.getElementById('fr-grok-pick-sub').click();
    await new Promise((r) => setTimeout(r, 50));
    await window.__tick();
    return { code: document.getElementById('fr-grok-sub-code').textContent, starts: window.__starts.slice(),
      msg: document.getElementById('fr-grok-msg').textContent };
  });
  chk(frSwitch.starts.length === 1 && !('reauthDir' in frSwitch.starts[0]) && /CCCC-DDDD/.test(frSwitch.code) && /Confirm the code/.test(frSwitch.msg),
    'first run\'s sign-in starts at once as a new account and shows its code', JSON.stringify(frSwitch));
  const frBoxes = await boxesIn('fr-grok-sub-code');
  chk(boxesOk(frBoxes, 'CCCCDDDD', 'C C C C, D D D D'), '#3952 first run: the code in big boxes on one row, 4 - 4, with the "terminal" line', JSON.stringify(frBoxes));
  if (process.env.SHOTS) await page.locator('#fr-grok-sub-code').screenshot({ path: require('node:path').join(process.env.SHOTS, 'grok-code-firstrun.png') });
  const frPhone = await atPhone('fr-grok-sub-code');
  chk(narrowOk(frPhone, 'CCCCDDDD'), '#3952 first run at 360px: every box inside its box, groups whole (review round 1)', JSON.stringify(frPhone));

  // Choosing the key instead ends the sign-in on the engine (the two cannot both be open).
  const toKey = await q(async () => {
    window.__cancels.length = 0;
    document.getElementById('fr-grok-connect').click();
    await new Promise((r) => setTimeout(r, 200));
    document.getElementById('fr-grok-pick-key').click();
    await new Promise((r) => setTimeout(r, 50));
    return { cancels: window.__cancels.slice(), polls: window.__polls.size, key: !document.getElementById('fr-grok-flow').hidden,
      step: !document.getElementById('fr-grok-sub-step').hidden };
  });
  chk(toKey.cancels.length === 1 && toKey.polls === 0 && toKey.key && !toKey.step, 'first run: choosing the key ends a sign-in in flight on the engine', JSON.stringify(toKey));

  // Opening another provider collapses Grok's panel and ends its sign-in on the engine.
  const frClose = await q(async () => {
    window.__status = { state: 'awaiting-code', userCode: 'CCCC-DDDD' };
    document.getElementById('fr-grok-connect').click();
    await new Promise((r) => setTimeout(r, 200));
    document.getElementById('fr-grok-pick-sub').click();
    await new Promise((r) => setTimeout(r, 50));
    window.__cancels.length = 0;
    document.getElementById('fr-openai-connect').click();
    await new Promise((r) => setTimeout(r, 200));
    return { cancels: window.__cancels.slice(), step: !document.getElementById('fr-grok-sub-step').hidden, polls: window.__polls.size };
  });
  chk(frClose.cancels.length === 1 && !frClose.step && frClose.polls === 0,
    'first run: opening another provider closes Grok\'s panel and ends its sign-in on the engine', JSON.stringify(frClose));

  // Leaving the step ends the sign-in (the panel closes with it).
  const frLeave = await q(async () => {
    document.getElementById('fr-grok-connect').click();
    await new Promise((r) => setTimeout(r, 200));
    window.__cancels.length = 0;
    window.__status = { state: 'awaiting-code', userCode: 'EEEE-FFFF' };
    document.getElementById('fr-grok-pick-sub').click();
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

  // First run's own words when its repaint throws (the texts are per caller).
  const frThrown = await q(async () => {
    document.getElementById('fr-grok-connect').click();
    await new Promise((r) => setTimeout(r, 200));
    document.getElementById('fr-grok-pick-sub').click();
    await new Promise((r) => setTimeout(r, 50));
    const real = window.frPaintKeyed;
    window.frPaintKeyed = async () => { throw new Error('repaint failed'); };
    window.__status = { state: 'connected', account: { email: 'me@example.com' } };
    await window.__tick();
    await new Promise((r) => setTimeout(r, 50));
    window.frPaintKeyed = real;
    const line = document.getElementById('fr-grok-msg');
    return { msg: line.textContent, visible: line.getClientRects().length > 0, step: !document.getElementById('fr-grok-sub-step').hidden };
  });
  chk(frThrown.visible && !frThrown.step && frThrown.msg === 'Grok is connected (me@example.com). This screen could not update the Grok row; Grok will show as connected in Settings, AI Models.',
    'first run: a repaint that throws after connected is said on the line that stays on screen', JSON.stringify(frThrown));

  const frDone = await q(async () => {
    document.getElementById('fr-grok-connect').click();
    await new Promise((r) => setTimeout(r, 200));
    window.__cancels.length = 0;
    document.getElementById('fr-grok-pick-sub').click();
    await new Promise((r) => setTimeout(r, 50));
    window.__accounts.push({ provider: 'xai', providerName: 'Grok', email: 'me@example.com', dir: '/h/.grok-work1', authMode: 'subscription', connection: { state: 'connected', badge: 'signed_in_unverified' } });
    window.__status = { state: 'connected', account: { provider: 'xai', email: 'me@example.com', authMode: 'subscription', dir: '/h/.grok-work1', connection: { state: 'connected' } } };
    await window.__tick();
    await new Promise((r) => setTimeout(r, 120));
    return {
      step: !document.getElementById('fr-grok-sub-step').hidden,
      msg: document.getElementById('fr-grok-msg').textContent,
      box: document.getElementById('fr-grok-msg').className,
      grok: document.getElementById('fr-grok-connect').textContent.trim(),
      grokDisabled: document.getElementById('fr-grok-connect').disabled,
      gemini: document.getElementById('fr-gemini-connect').textContent.trim(),
      cancels: window.__cancels.slice(),
    };
  });
  // #3731: GPT's connected state, cloned: the gold check box naming the provider and the account.
  chk(!frDone.step && frDone.box === 'fr-connbox' && /xAI Grok is connected/.test(frDone.msg) && /signed in as me@example\.com\./.test(frDone.msg) && /Connected/.test(frDone.grok) && frDone.grokDisabled && frDone.cancels.length === 0,
    'first run: connected closes the panel, names the account, marks Grok Connected, and cancels nothing', JSON.stringify(frDone));
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
