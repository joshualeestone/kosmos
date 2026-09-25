'use strict';
/**
 * kosmos#3658 (Josh, 2026-09-24 17:46), rebuilt for #3731 (Josh, 2026-09-25, testing 0.6.94):
 * on first run's "Choose a model", Gemini and Grok connect EXACTLY like GPT, each directly under
 * its own row: Connect, the install (Confirm / Not now, with progress), then the choice (Sign in
 * with Subscription / Use an API key), then the sign-in or the key. HERMETIC (file://, fetch
 * stubbed). Asserts, beside the list itself (one list, Claude, GPT, Gemini, Grok first):
 *   - each provider's panels sit under its own row, with GPT's copy and no command-line talk;
 *   - a missing tool shows the install first (never a key box), Not now, a refused install,
 *     the real progress; then Gemini's key step (its subscription is #3568's, not live) and
 *     Grok's choice; Grok's "Sign in with Subscription" starts xAI's sign-in AT ONCE;
 *   - the key: empty Add, a switch mid-request, an unconfirmed key, away and back, Enter,
 *     the accessible name, a slow read, step entry; Windows says it plainly.
 * Screenshots to SHOTS (argv[2]) for Josh's before/after.
 *
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" HEADED=0 node docs/browser-checks/render-firstrun-keyed-connect-3658.js
 */
const path = require('node:path');
let chromium;
try { ({ chromium } = require('playwright')); }
catch { console.log('render-firstrun-keyed-connect-3658: playwright not on NODE_PATH - SKIPPED, not passed.'); process.exit(0); }

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
    console.error('FAIL  render-firstrun-keyed-connect-3658: could not start a browser'
      + (process.env.HEADED === '0' ? '.' : ' (headed; try HEADED=0).'));
    console.error('  ' + (err && err.message ? err.message.split('\n')[0] : err));
    process.exit(1);
  }
  const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  await page.addInitScript(() => {
    window.__posts = [];
    window.__accounts = [];
    window.__runnerMissing = {};
    window.__hold = null;
    window.__unknown = false;
    const enc = (o, status) => new Response(JSON.stringify(o), { status: status || 200, headers: { 'content-type': 'application/json' } });
    window.setInterval = () => 0;
    window.fetch = async (url, opts) => {
      const u = String(url);
      const m = u.match(/\/api\/accounts\/(gemini|grok)\/apikey$/);
      if (m && opts && opts.method === 'POST') {
        const body = JSON.parse(opts.body || '{}');
        window.__posts.push({ route: m[1], body });
        // Same order as the server: the runner first, then the key.
        if (window.__runnerMissing[m[1]]) return enc({ needsRunner: true, error: 'we could not find the runner' }, 400);
        if (!body.key) return enc({ error: 'that does not look like a key' }, 400);
        if (window.__hold) await window.__hold;
        const provider = m[1] === 'gemini' ? 'google' : 'xai';
        const account = { provider, connection: { state: window.__unknown ? 'unknown' : 'connected' } };
        window.__accounts.push(account);   // the server keeps an unconfirmed key too
        return enc({ ok: true, account });
      }
      /* #3713: the runner install. POST starts a job; each GET /api/runners moves it on,
         downloading first, then present (or failed, when __installFail names why). */
      const inst = u.match(/\/api\/runners\/(gemini|grok)\/install$/);
      if (inst && opts && opts.method === 'POST') {
        window.__installs = (window.__installs || 0) + 1;
        window.__job = { runner: inst[1], ticks: 0, phase: 'downloading', receivedBytes: 10e6, totalBytes: 20772697 };
        return enc({ job: window.__job });
      }
      if (/\/api\/runners(\?|$)/.test(u)) {
        if (window.__runnersDelay) await new Promise((r) => setTimeout(r, window.__runnersDelay));
        const out = {};
        for (const r of ['gemini', 'grok']) {
          let job = null;
          if (window.__job && window.__job.runner === r) {
            window.__job.ticks += 1;
            if (window.__installFail) window.__job = { ...window.__job, phase: 'failed', because: window.__installFail };
            else if (window.__job.ticks >= 2) { window.__runnerMissing[r] = false; window.__job = null; }
            job = window.__job;
          }
          out[r] = { present: !window.__runnerMissing[r] && !job, downloadBytes: r === 'gemini' ? 20772697 : 42511097, job };
        }
        return enc({ runners: out });
      }
      // #3731: Grok's subscription sign-in (the driver's start / status / cancel).
      if (/\/api\/accounts\/grok\/subscription\/start$/.test(u)) {
        window.__subStarts = (window.__subStarts || 0) + 1;
        if (window.__subStartFail) return enc({ error: 'xAI did not answer' }, 502);
        return enc({ sessionId: 's1' });
      }
      if (/\/api\/accounts\/grok\/subscription\/status/.test(u)) return enc({ state: 'awaiting-code', url: 'https://accounts.x.ai/oauth2/device?user_code=ABCD-EFGH', userCode: 'ABCD-EFGH' });
      if (/\/api\/accounts\/grok\/subscription\/cancel/.test(u)) return enc({ ok: true });
      if (/\/api\/accounts(\?|$)/.test(u)) {
        const snap = window.__accounts.slice();   // the list as it was when the read began
        if (window.__holdRead) await window.__holdRead;
        return enc({ accounts: snap });
      }
      return enc({});
    };
  });
  await page.goto(PAGE);
  const q = (fn, arg) => page.evaluate(fn, arg);
  const settle = () => q(() => new Promise((r) => setTimeout(r, 120)));
  await q(() => {
    const fr = document.getElementById('firstrun'); if (fr) fr.hidden = false;
    frGo(5);
  });
  await settle();

  const list = await q(() => {
    const pane = document.getElementById('fr-pane-5');
    const names = [...pane.querySelectorAll('.llm .llm-w b')].map((b) => b.textContent);
    const text = pane.innerText;
    return { visible: !pane.hidden, first4: names.slice(0, 4), heading: !!pane.querySelector('.smore-t'), after: /After setup/.test(text),
      later: !!document.getElementById('fr-later-models'), runs: /Runs on this computer/i.test(text) };
  });
  chk(list.visible, 'frGo(5) shows the model step', JSON.stringify(list));
  chk(JSON.stringify(list.first4) === JSON.stringify(['Claude', 'GPT', 'Gemini', 'Grok']), 'the list starts Claude, GPT, Gemini, Grok', JSON.stringify(list.first4));
  chk(!list.heading && !list.runs, 'one uninterrupted list: no "Runs on this computer" heading', JSON.stringify(list));
  chk(!list.after && !list.later, 'no "After setup" pill and no "connect later in Settings" line', JSON.stringify(list));

  const SHOTS = process.argv[2] || null;
  const shot = async (name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: false }); };
  const vis = (id) => { const e = document.getElementById(id); return !!e && !e.hidden; };

  // #3731: each provider's panels sit directly under ITS OWN row (Josh: "not underneath Grok").
  const place = await q(() => {
    const rowOf = (id) => document.getElementById(id).closest('.llm');
    const next = (el) => { let n = el.nextElementSibling; return n; };
    const after = (rowId, panelId) => {
      let n = rowOf(rowId).nextElementSibling;
      return !!n && n.id === panelId;
    };
    const paneText = document.getElementById('fr-pane-5').textContent;
    return { gemini: after('fr-gemini-connect', 'fr-gemini-confirm'), grok: after('fr-grok-connect', 'fr-grok-confirm'),
      nerd: /command-line|command line|runner/i.test(paneText) };
  });
  chk(place.gemini && place.grok, '#3731 Gemini\'s and Grok\'s panels sit directly under their own rows', JSON.stringify(place));
  chk(!place.nerd, '#3731 no command-line or "runner" talk anywhere on the model step', JSON.stringify(place));

  // A missing tool: the install comes first, never a key box (Josh: an API key cannot work yet).
  const miss = await q(async () => {
    window.__posts.length = 0;
    window.__runnerMissing = { gemini: true, grok: true };
    document.getElementById('fr-gemini-connect').click();
    await new Promise((r) => setTimeout(r, 250));
    return { posts: window.__posts.length, confirm: !document.getElementById('fr-gemini-confirm').hidden,
      key: !document.getElementById('fr-gemini-flow').hidden, ask: document.getElementById('fr-gemini-confirm-t').textContent,
      focus: document.activeElement && document.activeElement.id, expanded: document.getElementById('fr-gemini-connect').getAttribute('aria-expanded') };
  });
  chk(miss.posts === 0 && miss.confirm && !miss.key && miss.ask === 'In order to connect to Google Gemini we need to download the installer.'
      && miss.focus === 'fr-gemini-confirm-go' && miss.expanded === 'true',
    '#3731 a missing tool shows GPT\'s install confirm under Gemini, in GPT\'s words, and no key box', JSON.stringify(miss));
  await shot('3731-1-gemini-install-confirm');

  const notNow = await q(async () => {
    document.getElementById('fr-gemini-confirm-no').click();
    await new Promise((r) => setTimeout(r, 50));
    return { hidden: document.getElementById('fr-gemini-confirm').hidden, expanded: document.getElementById('fr-gemini-connect').getAttribute('aria-expanded'),
      installs: window.__installs || 0, focus: document.activeElement && document.activeElement.id };
  });
  chk(notNow.hidden && notNow.expanded === 'false' && notNow.installs === 0 && notNow.focus === 'fr-gemini-connect', 'Not now closes it, downloads nothing, and returns focus to Connect', JSON.stringify(notNow));

  const failed = await q(async () => {
    document.getElementById('fr-gemini-connect').click();
    await new Promise((r) => setTimeout(r, 250));
    window.__installFail = 'the downloaded runner did not match its published checksum, so it was discarded';
    document.getElementById('fr-gemini-confirm-go').click();
    await new Promise((r) => setTimeout(r, 2600));
    const out = { msg: document.getElementById('fr-gemini-confirm-msg').textContent, go: document.getElementById('fr-gemini-confirm-go').disabled,
      shown: !document.getElementById('fr-gemini-confirm').hidden, key: !document.getElementById('fr-gemini-flow').hidden };
    window.__installFail = null;
    return out;
  });
  chk(/did not match its published checksum/i.test(failed.msg) && failed.go === false && failed.shown && !failed.key,
    'an install the engine refuses says why, re-arms Confirm, and never opens the key box', JSON.stringify(failed));

  const g = await q(async () => {
    const seen = [];
    const msgEl = document.getElementById('fr-gemini-confirm-msg');
    const obs = new MutationObserver(() => seen.push(msgEl.textContent));
    obs.observe(msgEl, { childList: true, characterData: true, subtree: true });
    document.getElementById('fr-gemini-confirm-go').click();
    await new Promise((r) => setTimeout(r, 3500));
    obs.disconnect();
    return { seen, confirmHidden: document.getElementById('fr-gemini-confirm').hidden, pick: !document.getElementById('fr-gemini-pick').hidden,
      key: !document.getElementById('fr-gemini-flow').hidden, head: document.getElementById('fr-gemini-key-t').textContent,
      href: document.getElementById('fr-gemini-getkey').getAttribute('href'), focus: document.activeElement && document.activeElement.id,
      expanded: document.getElementById('fr-gemini-connect').getAttribute('aria-expanded') };
  });
  chk(g.seen.some((x) => /Downloading… 10 of 21 MB/.test(x)), 'the install shows its real progress, from the engine\'s own byte counts', JSON.stringify(g.seen));
  // Gemini's subscription is Angel's Antigravity sign-in (#3568), not live yet: the key step follows the install.
  chk(g.confirmHidden && !g.pick && g.key && /^Download complete\. You will need a Google API key to finish\./.test(g.head) && /aistudio\.google\.com/.test(g.href)
      && g.focus === 'fr-gemini-key' && g.expanded === 'true',
    '#3731 once installed, Gemini shows GPT\'s key step (its subscription choice waits on #3568)', JSON.stringify(g));
  await shot('3731-2-gemini-key-step');

  // Grok: the install, then GPT's choice, under Grok's row; Gemini's panels close.
  /* Pressed with the real mouse (page.click), as Josh did: that is what decides whether the focus
     moved to the choice draws a ring (#3731, "is there really a blue stroke around the buttons?"). */
  await q(() => { document.getElementById('fr-gemini-key').value = 'AIza-typed-for-gemini'; });
  await page.click('#fr-grok-connect');
  await page.waitForTimeout(250);
  const kc = await q(() => ({ confirm: !document.getElementById('fr-grok-confirm').hidden, ask: document.getElementById('fr-grok-confirm-t').textContent }));
  await page.click('#fr-grok-confirm-go');
  await page.waitForTimeout(3500);
  const k = await q(async ({ confirm, ask }) => {
    return { confirm, ask, pick: !document.getElementById('fr-grok-pick').hidden, pickT: document.getElementById('fr-grok-pick-t').textContent,
      sub: document.getElementById('fr-grok-pick-sub').textContent, key: document.getElementById('fr-grok-pick-key').textContent,
      gemOpen: !document.getElementById('fr-gemini-flow').hidden, gem: document.getElementById('fr-gemini-connect').getAttribute('aria-expanded'),
      grok: document.getElementById('fr-grok-connect').getAttribute('aria-expanded'), focus: document.activeElement && document.activeElement.id };
  }, kc);
  chk(k.confirm && k.ask === 'In order to connect to xAI Grok we need to download the installer.', '#3731 Grok\'s install confirm, in GPT\'s words', JSON.stringify(k));
  chk(k.pick && k.pickT === 'Download complete. Choose how to connect xAI Grok.' && k.sub === 'Sign in with Subscription' && k.key === 'Use an API key'
      && !k.gemOpen && k.gem === 'false' && k.grok === 'true' && k.focus === 'fr-grok-pick-sub',
    '#3731 then GPT\'s choice for Grok, and Gemini\'s panels closed', JSON.stringify(k));
  await shot('3731-3-grok-choice');

  /* The focus ring on the choice (#3731): none after a mouse press (the browser's own rule, pinned
     here because a regression would put Josh's blue stroke back); Kosmos's ink ring, not the
     browser's blue, for someone on the keyboard. The ring colour is compared with --k-ink resolved
     by the page itself, so a theme change cannot make this pass or fail on its own. */
  const ring = () => q(() => {
    const b = document.getElementById('fr-grok-pick-sub');
    const cs = getComputedStyle(b);
    const probe = document.createElement('i'); probe.style.color = 'var(--k-ink)'; document.body.appendChild(probe);
    const ink = getComputedStyle(probe).color; probe.remove();
    return { focused: document.activeElement === b, visible: b.matches(':focus-visible'), style: cs.outlineStyle, color: cs.outlineColor, ink };
  });
  const mouseRing = await ring();
  chk(mouseRing.focused && !mouseRing.visible && mouseRing.style === 'none',
    '#3731 after a mouse-driven download, the choice has focus and draws no ring', JSON.stringify(mouseRing));
  await page.keyboard.press('Tab');         // to "Use an API key"
  await page.keyboard.press('Shift+Tab');   // and back, as a keyboard user would arrive
  const keyRing = await ring();
  chk(keyRing.focused && keyRing.visible && keyRing.style === 'solid' && keyRing.color === keyRing.ink,
    '#3731 on the keyboard the ring is Kosmos\'s ink, not the browser\'s blue', JSON.stringify(keyRing));
  await shot('3731-3b-grok-choice-keyboard');
  await page.mouse.move(5, 5); await page.mouse.down(); await page.mouse.up();   // back to the mouse, as Josh would be
  await q(() => document.getElementById('fr-grok-pick-sub').focus());

  // "Sign in with Subscription" goes STRAIGHT to xAI's sign-in: no screen asking to sign in again.
  const sub = await q(async () => {
    const before = window.__subStarts || 0;
    document.getElementById('fr-grok-pick-sub').click();
    await new Promise((r) => setTimeout(r, 300));
    return { starts: (window.__subStarts || 0) - before, step: !document.getElementById('fr-grok-sub-step').hidden,
      goHidden: document.getElementById('fr-grok-sub-go').hidden, pick: !document.getElementById('fr-grok-pick').hidden,
      head: document.getElementById('fr-grok-sub-t').textContent };
  });
  chk(sub.starts === 1 && sub.step && sub.goHidden && !sub.pick && /Sign in with your Grok subscription/.test(sub.head),
    '#3731 Grok\'s "Sign in with Subscription" starts xAI\'s sign-in at once, with no second screen', JSON.stringify(sub));
  await shot('3731-4-grok-signing-in');

  // Back to the key: the choice again, then "Use an API key".
  const stop = await q(async () => {
    document.getElementById('fr-grok-sub-cancel').click();
    await new Promise((r) => setTimeout(r, 50));
    return { pick: !document.getElementById('fr-grok-pick').hidden, step: !document.getElementById('fr-grok-sub-step').hidden,
      focus: document.activeElement && document.activeElement.id };
  });
  chk(stop.pick && !stop.step && stop.focus === 'fr-grok-pick-sub', '#3731 Stop returns to the choice, as GPT\'s does, with focus on it', JSON.stringify(stop));
  const toKey = await q(async () => {
    document.getElementById('fr-grok-pick-key').click();
    await new Promise((r) => setTimeout(r, 50));
    return { key: !document.getElementById('fr-grok-flow').hidden, head: document.getElementById('fr-grok-key-t').textContent,
      href: document.getElementById('fr-grok-getkey').getAttribute('href'), step: !document.getElementById('fr-grok-sub-step').hidden };
  });
  chk(toKey.key && !toKey.step && /^Download complete\. You will need an xAI API key to finish\./.test(toKey.head) && /console\.x\.ai/.test(toKey.href),
    '#3731 "Use an API key" shows GPT\'s key step for Grok', JSON.stringify(toKey));

  const empty = await q(async () => {
    window.__posts.length = 0;
    document.getElementById('fr-grok-go').click();
    await new Promise((r) => setTimeout(r, 50));
    return { posts: window.__posts.length, msg: document.getElementById('fr-grok-msg').textContent };
  });
  chk(empty.posts === 0 && /Paste the key first/.test(empty.msg), 'an empty Add is refused without a request', JSON.stringify(empty));

  // Switch provider while an Add is in flight: Add must not stay disabled, and the key that
  // landed must still show its row as Connected.
  const sw = await q(async () => {
    window.__posts.length = 0;
    let release; window.__hold = new Promise((r) => { release = r; });
    document.getElementById('fr-grok-key').value = 'xai-in-flight';
    document.getElementById('fr-grok-go').click();
    await new Promise((r) => setTimeout(r, 30));
    document.getElementById('fr-gemini-connect').click();
    await new Promise((r) => setTimeout(r, 120));
    release(); window.__hold = null;
    await new Promise((r) => setTimeout(r, 200));
    const b = document.getElementById('fr-grok-connect');
    return { addDisabled: document.getElementById('fr-grok-go').disabled, grok: b.textContent.trim(), grokDisabled: b.disabled };
  });
  chk(sw.addDisabled === false, 'switching provider mid-request leaves Add usable', JSON.stringify(sw));
  chk(/Connected/.test(sw.grok) && sw.grokDisabled, 'a key that landed after the switch still shows its row as Connected', JSON.stringify(sw));

  // A normal Add for Gemini (installed now: Connect goes straight to the key), answer "unknown".
  const unk = await q(async () => {
    window.__unknown = true;
    document.getElementById('fr-gemini-connect').click();
    await new Promise((r) => setTimeout(r, 200));
    document.getElementById('fr-gemini-key').value = '  AIza-secret  ';
    document.getElementById('fr-gemini-go').click();
    for (let i = 0; i < 50 && !/saved|connected/.test(document.getElementById('fr-gemini-msg').textContent); i++) await new Promise((r) => setTimeout(r, 20));
    window.__unknown = false;
    const b = document.getElementById('fr-gemini-connect');
    return { last: window.__posts[window.__posts.length - 1], msg: document.getElementById('fr-gemini-msg').textContent,
      flowHidden: document.getElementById('fr-gemini-flow').hidden, btn: b.textContent.trim(), disabled: b.disabled, expanded: b.getAttribute('aria-expanded'),
      focused: document.activeElement && document.activeElement.id };
  });
  chk(unk.last && unk.last.route === 'gemini' && unk.last.body.key === 'AIza-secret', 'Add POSTs the trimmed key to the Gemini route', JSON.stringify(unk.last));
  chk(unk.flowHidden && /key is saved/.test(unk.msg) && unk.btn === 'Key saved' && unk.disabled, 'an unconfirmed key is said to be saved, not connected, and Connect is not offered again (no duplicate)', JSON.stringify(unk));
  chk(unk.expanded === 'false' && unk.focused === 'fr-gemini-msg', 'after Add the button is no longer expanded and focus lands on the result', JSON.stringify(unk));
  await q(async () => { window.__accounts = window.__accounts.filter((a) => a.provider !== 'google'); await frPaintKeyed(); });

  // Away and back: a Gemini Add lands after the person opened another provider and came back.
  // The reopened step must close (a second Add would make a second account) and the row show Connected.
  const back = await q(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    document.getElementById('fr-gemini-connect').click(); await wait(200);
    document.getElementById('fr-gemini-key').value = 'AIza-away-and-back';
    let release; window.__hold = new Promise((r) => { release = r; });
    document.getElementById('fr-gemini-go').click(); await wait(30);
    document.getElementById('fr-openai-connect').click(); await wait(200);   // away: GPT's panel, Gemini's closes
    document.getElementById('fr-gemini-connect').click(); await wait(200);   // back: Gemini's key step again
    const reopened = !document.getElementById('fr-gemini-flow').hidden;
    release(); window.__hold = null; await wait(200);
    const b = document.getElementById('fr-gemini-connect');
    return { reopened, flowHidden: document.getElementById('fr-gemini-flow').hidden, btn: b.textContent.trim(),
      msg: document.getElementById('fr-gemini-msg').textContent, box: document.getElementById('fr-gemini-msg').className,
      next: document.getElementById('fr-next').hidden ? null : document.getElementById('fr-next').textContent.trim() };
  });
  // #3731: the connected line is GPT's gold check box, not a plain sentence.
  chk(back.reopened && back.flowHidden && /Connected/.test(back.btn) && back.box === 'fr-connbox' && /Google Gemini is connected/.test(back.msg),
    'an Add that lands after going away and back closes the reopened step and shows Connected', JSON.stringify(back));
  chk(back.next === 'Next', '#3731 a connected Gemini offers Next, as a connected GPT does (Claude not connected here)', JSON.stringify(back));

  // Enter adds the key and does not bubble; the accessible name follows the state; going away mid-Add clears the message.
  const more = await q(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    window.__accounts = window.__accounts.filter((a) => a.provider !== 'google');
    await frPaintKeyed();
    const labelBefore = document.getElementById('fr-gemini-connect').getAttribute('aria-label');
    document.getElementById('fr-gemini-connect').click(); await wait(200);
    let bubbled = false;
    const spy = () => { bubbled = true; };
    document.addEventListener('keydown', spy);
    let release; window.__hold = new Promise((r) => { release = r; });
    window.__posts.length = 0;
    const key = document.getElementById('fr-gemini-key');
    key.value = 'AIza-enter';
    key.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await wait(30);
    document.removeEventListener('keydown', spy);
    const posted = window.__posts.length;
    document.getElementById('fr-openai-connect').click(); await wait(80);   // away while the Add is pending
    const msgAfterAway = document.getElementById('fr-gemini-msg').textContent;
    release(); window.__hold = null; await wait(200);
    return { labelBefore, posted, bubbled, msgAfterAway,
      msgEnd: document.getElementById('fr-gemini-msg').textContent,
      labelAfter: document.getElementById('fr-gemini-connect').getAttribute('aria-label') };
  });
  chk(more.posted === 1 && more.bubbled === false, 'Enter in the key field adds the key and does not reach the step', JSON.stringify(more));
  chk(more.msgAfterAway === '' && !/Checking/.test(more.msgEnd), 'going away mid-Add clears the message and "Checking..." never comes back', JSON.stringify(more));
  chk(more.labelBefore === 'Connect Gemini' && more.labelAfter === 'Gemini is connected', 'the button\'s accessible name follows the state', JSON.stringify(more));

  // A slow account read that began BEFORE an Add must not repaint Connected back to Connect.
  const slow = await q(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    window.__accounts = window.__accounts.filter((a) => a.provider !== 'google');
    await frPaintKeyed();
    let releaseRead; window.__holdRead = new Promise((r) => { releaseRead = r; });
    const oldRead = frPaintKeyed();            // the step-entry read, now pending with the pre-Add list
    window.__holdRead = null;
    document.getElementById('fr-gemini-connect').click(); await wait(200);
    document.getElementById('fr-gemini-key').value = 'AIza-slow-read';
    document.getElementById('fr-gemini-go').click();
    for (let i = 0; i < 50 && !/connected/.test(document.getElementById('fr-gemini-msg').textContent); i++) await wait(20);
    const afterAdd = document.getElementById('fr-gemini-connect').textContent.trim();
    releaseRead(); await oldRead; await wait(50);
    return { afterAdd, afterOldRead: document.getElementById('fr-gemini-connect').textContent.trim() };
  });
  chk(/Connected/.test(slow.afterAdd) && /Connected/.test(slow.afterOldRead), 'a slow read from before an Add does not repaint the row back to Connect', JSON.stringify(slow));

  // #3731 review pass 1: the lines under Gemini's and Grok's rows are styled as GPT's are.
  const css = await q(async () => {
    // All three in the same state (nothing connected, a plain line), so the rules compared are the same rules.
    window.__accounts = window.__accounts.filter((a) => a.provider !== 'google' && a.provider !== 'xai');
    await frPaintKeyed();
    for (const id of ['fr-openai-msg', 'fr-gemini-msg', 'fr-grok-msg']) document.getElementById(id).textContent = 'a line';
    const g = (id) => { const e = document.getElementById(id); const c = getComputedStyle(e); return { mt: c.marginTop, font: c.font }; };
    return { openai: g('fr-openai-msg'), gemini: g('fr-gemini-msg'), grok: g('fr-grok-msg'),
      oc: g('fr-openai-confirm-msg').font, gc: g('fr-gemini-confirm-msg').font, kc: g('fr-grok-confirm-msg').font };
  });
  await q(() => { for (const id of ['fr-openai-msg', 'fr-gemini-msg', 'fr-grok-msg']) document.getElementById(id).textContent = ''; });
  chk(css.gemini.mt === css.openai.mt && css.grok.mt === css.openai.mt && css.openai.mt === '-4px'
      && css.gemini.font === css.openai.font && css.grok.font === css.openai.font && css.gc === css.oc && css.kc === css.oc,
    '#3731 the result and progress lines match GPT\'s spacing and type', JSON.stringify(css));

  // A slow read for one row must not reopen it after another row's Connect closed it.
  const stale = await q(async () => {
    await frPaintKeyed();
    const grokOpen = !document.getElementById('fr-openai-connect').disabled;   // precondition: GPT's Connect can be pressed
    window.__runnerMissing.gemini = true; window.__runnersDelay = 400;
    document.getElementById('fr-gemini-connect').click();   // only Gemini's read is slow
    await new Promise((r) => setTimeout(r, 50));
    window.__runnersDelay = 0;   // GPT's own read answers at once, so no later close of its can hide a reopen
    document.getElementById('fr-openai-connect').click();   // GPT's Connect closes Gemini's panel (frCollapseProviders), bumping nothing of its own
    await new Promise((r) => setTimeout(r, 900));
    const out = { grokOpen, gemConfirm: !document.getElementById('fr-gemini-confirm').hidden, gem: document.getElementById('fr-gemini-connect').getAttribute('aria-expanded') };
    frCollapseProviders(null);   // tidy up only AFTER reading: a close before the read would hide the very reopen this looks for
    return out;
  });
  chk(stale.grokOpen && !stale.gemConfirm && stale.gem === 'false', '#3731 a late read for Gemini does not reopen it after GPT\'s Connect closed it', JSON.stringify(stale));

  // A reopened install starts clean: no progress bar or message left from the last time.
  const fresh = await q(async () => {
    document.getElementById('fr-gemini-confirm-bar').hidden = false;
    document.getElementById('fr-gemini-confirm-msg').textContent = 'left over';
    document.getElementById('fr-gemini-connect').click();
    await new Promise((r) => setTimeout(r, 250));
    return { confirm: !document.getElementById('fr-gemini-confirm').hidden, bar: !document.getElementById('fr-gemini-confirm-bar').hidden,
      msg: document.getElementById('fr-gemini-confirm-msg').textContent };
  });
  chk(fresh.confirm && !fresh.bar && fresh.msg === '', '#3731 opening the install again shows no leftover bar or message', JSON.stringify(fresh));
  await q(() => { frKeyedHideAll(); window.__runnerMissing.gemini = false; });

  // #3731 (review pass 3): a paint that lands with Gemini connected closes an open key form under
  // it, as GPT's does (#2621), or a second paste would make a second account.
  const late = await q(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    window.__accounts = window.__accounts.filter((a) => a.provider !== 'google' && a.provider !== 'xai');
    await frPaintKeyed();
    window.__accounts.push({ provider: 'google', connection: { state: 'connected' } });
    let release; window.__holdRead = new Promise((r) => { release = r; });
    const painting = frPaintKeyed();   // its read began after Gemini connected, and is held
    await wait(30);
    document.getElementById('fr-gemini-connect').click();
    await wait(250);
    const before = !document.getElementById('fr-gemini-flow').hidden;
    release(); window.__holdRead = null; await painting; await wait(50);
    return { before, flow: !document.getElementById('fr-gemini-flow').hidden, box: document.getElementById('fr-gemini-msg').className,
      btn: document.getElementById('fr-gemini-connect').textContent.trim() };
  });
  chk(late.before && !late.flow && late.box === 'fr-connbox' && /Connected/.test(late.btn),
    '#3731 a paint that finds Gemini connected closes the key form still open under it', JSON.stringify(late));

  // A Grok sign-in that fails to start gives its Sign-in button back, as the retry.
  const retry = await q(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    window.__accounts = window.__accounts.filter((a) => a.provider !== 'google' && a.provider !== 'xai');
    await frPaintKeyed();
    window.__subStartFail = true;
    document.getElementById('fr-grok-connect').click(); await wait(250);
    document.getElementById('fr-grok-pick-sub').click(); await wait(250);
    const out = { step: !document.getElementById('fr-grok-sub-step').hidden, go: !document.getElementById('fr-grok-sub-go').hidden,
      disabled: document.getElementById('fr-grok-sub-go').disabled, msg: document.getElementById('fr-grok-msg').textContent };
    window.__subStartFail = false;
    frKeyedHideAll();
    return out;
  });
  chk(retry.step && retry.go && !retry.disabled && /did not answer/.test(retry.msg), '#3731 a Grok sign-in that fails to start shows why and gives the Sign-in button back', JSON.stringify(retry));

  // Windows: Kosmos does not install these there (#3713), so it says so and offers nothing.
  const win = await q(async () => {
    window.__accounts = window.__accounts.filter((a) => a.provider !== 'xai');
    await frPaintKeyed();
    window.__runnerMissing.grok = true;
    const m = document.querySelector('meta[name="kosmos-platform"]'); const was = m.content; m.content = 'win32';
    document.getElementById('fr-grok-connect').click();
    await new Promise((r) => setTimeout(r, 250));
    const out = { confirm: !document.getElementById('fr-grok-confirm').hidden, msg: document.getElementById('fr-grok-msg').textContent };
    m.content = was;
    return out;
  });
  chk(!win.confirm && /cannot connect xAI Grok on Windows yet/.test(win.msg) && !/command/i.test(win.msg), 'on Windows, a missing tool is said plainly and no install is offered', JSON.stringify(win));

  // Entering the step paints a row whose account already connected.
  const entry = await q(async () => {
    window.__accounts.push({ provider: 'google', connection: { state: 'connected' } });
    frGo(5);
    await new Promise((r) => setTimeout(r, 150));
    const b = document.getElementById('fr-gemini-connect');
    return { btn: b.textContent.trim(), disabled: b.disabled };
  });
  chk(/Connected/.test(entry.btn) && entry.disabled, 'entering the step shows an already-connected Gemini as Connected', JSON.stringify(entry));
  chk(errs.length === 0, 'no page errors', errs.join(' | '));

  await browser.close();
  if (fail.length) {
    console.error('render-firstrun-keyed-connect-3658: ' + fail.length + ' check(s) failed');
    process.exit(1);
  }
  console.log('render-firstrun-keyed-connect-3658: Gemini and Grok connect by API key on first run, in one uninterrupted list.');
})().catch((err) => {
  console.error('FAIL  render-firstrun-keyed-connect-3658: the check itself threw: ' + (err && err.message ? err.message.split('\n')[0] : err));
  process.exit(1);
});
