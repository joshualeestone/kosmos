#!/usr/bin/env node
/**
 * kosmos#3939 slice 3b: Meta Muse in Settings > AI Models > Add a provider. HERMETIC (file://, fetch
 * stubbed). The sign-in poll is captured rather than run on a timer, so each state is delivered by an
 * explicit tick. Asserts:
 *   - flag off (GET /api/muse says enabled:false): the Meta option stays disabled, as today;
 *   - flag on: the option is live, picking it shows Muse's step and hides the other providers';
 *   - Sign in with Meta POSTs a start, keeps the id it answered, shows Meta's page as a link and the code in
 *     the #3952 boxes, and says what to do;
 *   - an expired code offers "Get a new code", which POSTs a retry naming this sign-in's id;
 *   - a poll naming ANOTHER sign-in's id ends this one in words and drives nothing;
 *   - a failure is said in words and the button re-arms; done says so;
 *   - Stop and closing the dialog both stop the engine's sign-in by id.
 * Later slices add their arms below: 3c-2 (the Settings row), 3c-3b (the Create form, an agent on Muse), and
 * 3c-4, the first-run Meta row: switched off it is today's Coming soon; switched on, Connect opens the same
 * sign-in under the row (a second press closes it), Muse Code missing is said and re-asked on the next press,
 * closing first run or leaving its model step stops the sign-in by id, and a sign-in driven to done reads
 * Connected with focus kept (also when the read after it fails).
 *
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" HEADED=0 node docs/browser-checks/render-muse-signin-3939.js
 */
const path = require('node:path');
let chromium;
try { ({ chromium } = require('playwright')); }
catch { console.log('render-muse-signin-3939: playwright not on NODE_PATH - SKIPPED, not passed.'); process.exit(0); }

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
    console.error('FAIL  render-muse-signin-3939: could not start a browser' + (process.env.HEADED === '0' ? '.' : ' (headed; try HEADED=0).'));
    console.error('  ' + (err && err.message ? err.message.split('\n')[0] : err));
    process.exit(1);
  }
  const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  await page.addInitScript(() => {
    window.__museOn = false;
    window.__posts = [];
    window.__status = { state: 'idle' };
    window.__startAnswer = null;
    window.__accountsPainted = 0;
    window.__polls = new Map();
    let nextId = 1;
    const enc = (o, status) => new Response(JSON.stringify(o), { status: status || 200, headers: { 'content-type': 'application/json' } });
    // Only the Muse sign-in poll is kept; every other page timer is a no-op.
    window.setInterval = (fn) => {
      if (!/\/api\/muse\/signin/.test(String(fn))) return 0;
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
      const method = (opts && opts.method) || 'GET';
      if (/\/api\/muse$/.test(u)) window.__museReads = (window.__museReads || 0) + 1;
      if (/\/api\/muse$/.test(u)) { const hold = window.__holdMuse; if (hold) { window.__holdMuse = null; const ans = window.__museOn; await hold; return enc(ans ? { enabled: true, installed: true, because: null, signedIn: false } : { enabled: false }); } }
      if (/\/api\/muse$/.test(u)) { if (window.__museRead === 'throw') throw new Error('offline'); if (window.__museRead === 500) return enc({ error: 'x' }, 500); }
      if (/\/api\/muse$/.test(u)) return enc(window.__museOn ? { enabled: true, installed: window.__museInstalled !== false, because: window.__museInstalled === false ? 'Muse Code is not on this computer' : null, signedIn: window.__museSignedIn === true } : { enabled: false });
      if (/\/api\/muse\/signin(\/retry|\/stop)?$/.test(u) && method === 'POST') {
        const body = JSON.parse((opts && opts.body) || '{}');
        window.__posts.push({ path: u.replace(/^.*\/api\/muse\/signin/, '') || '/', id: body.id || null });
        if (/\/stop$/.test(u)) return enc({ ok: true });
        if (/\/retry$/.test(u)) { if (window.__holdRetry) await window.__holdRetry; return enc({ ok: true, id: body.id, state: 'starting' }); }
        if (window.__holdStart) await window.__holdStart;
        if (window.__startAnswer) return enc(window.__startAnswer[1], window.__startAnswer[0]);
        return enc({ ok: true, id: 'mine000000000001', state: 'starting' });
      }
      if (/\/api\/muse\/signin$/.test(u)) { if (window.__holdStatus) await window.__holdStatus; return enc(window.__status); }
      if (/\/api\/accounts(\?|$)/.test(u)) { window.__accountsPainted += 1; return enc({ accounts: window.__accounts || [] }); }
      if (/\/api\/agents$/.test(u) && method === 'POST') { window.__created = JSON.parse((opts && opts.body) || '{}'); return enc({ outcome: 'created', name: window.__created.name, steps: [] }); }
      return enc({});
    };
  });
  await page.goto(PAGE);
  await page.waitForTimeout(800);
  const q = (fn, arg) => page.evaluate(fn, arg);
  const tick = () => q(() => window.__tick());
  const settle = () => page.waitForTimeout(60);
  const G = (id) => q((i) => { const e = document.getElementById(i); return e ? { hidden: e.hidden, text: e.textContent, disabled: e.disabled, href: e.getAttribute('href') } : null; }, id);
  const choose = (v) => q((w) => { const s = document.getElementById('acct-provider-pick'); s.value = w; s.dispatchEvent(new Event('change')); }, v);

  /* ---- flag off: exactly today's menu ---- */
  await q(() => { frClose(); openAcctAdd(); });
  await settle();
  const off = await q(() => {
    const o = document.querySelector('#acct-provider-pick option[value="meta"]');
    return { disabled: o && o.disabled, text: o && o.textContent };
  });
  chk(off.disabled === true, 'flag off: the Meta option stays disabled (coming soon)', JSON.stringify(off));
  chk(/coming soon/.test(off.text || ''), 'flag off: its words are unchanged', JSON.stringify(off));
  chk((await G('acct-muse-flow')).hidden === true, 'flag off: no Muse step');
  const offPill = await q(() => {
    const o = document.querySelector('#acct-provider-pick option[value="meta"]');
    const trig = document.querySelector('#acct-provider-pick').parentElement.querySelector('.pcombo-trigger');
    if (trig) trig.click();
    const li = [...document.querySelectorAll('.pcombo li')].find((l) => l.dataset.value === 'meta' && l.offsetParent !== null);
    const pill = li && li.querySelector('.pcombo-soon');
    if (trig) trig.click();
    return { off: o.dataset.off || '', pill: pill ? pill.textContent : null };
  });
  chk(offPill.off === '' && offPill.pill === 'Coming soon', 'flag off: no reason on the option, and the row\'s pill reads Coming soon', JSON.stringify(offPill));
  chk(/Google Gemini and xAI Grok work today/.test((await G('acct-add-in')).text), 'flag off: the intro names the four that work today');
  for (const bad of [500, 'throw']) {
    await q((b) => { window.__museOn = true; window.__museRead = b; closeAcctAdd(); openAcctAdd(); }, bad);
    await settle();
    chk(await q(() => { const o = document.querySelector('#acct-provider-pick option[value="meta"]'); return o.disabled && !o.dataset.off; }), 'a failed read (' + bad + ') keeps Meta coming soon, with no reason');
  }
  await q(() => { window.__museOn = false; window.__museRead = null; });

  /* ---- flag on ---- */
  await q(() => { window.__museOn = true; closeAcctAdd(); openAcctAdd(); });
  await settle();
  chk(await q(() => document.querySelector('#acct-provider-pick option[value="meta"]').disabled === false), 'flag on: the Meta option is live');
  chk(/xAI Grok and Meta Muse work today/.test((await G('acct-add-in')).text), 'flag on: the intro names Meta Muse too', (await G('acct-add-in')).text);
  await choose('meta');
  await settle();
  const shown = await q(() => ({
    muse: !document.getElementById('acct-muse-flow').hidden,
    claude: !document.getElementById('acct-claude-flow').hidden,
    openai: !document.getElementById('acct-openai-flow').hidden,
    key: !document.getElementById('acct-apikey-flow').hidden,
    focus: document.activeElement && document.activeElement.id,
  }));
  chk(shown.muse && !shown.claude && !shown.openai && !shown.key, 'picking Meta shows Muse\'s step and only it', JSON.stringify(shown));
  chk(shown.focus === 'acct-muse-go', 'focus lands on Sign in with Meta', shown.focus);

  // Start, then the code.
  await q(() => document.getElementById('acct-muse-go').click());
  await settle();
  chk(await q(() => window.__posts.length === 1 && window.__posts[0].path === '/'), 'Sign in with Meta POSTs one start');
  chk(!(await G('acct-muse-cancel-row')).hidden, 'Stop this sign-in is offered while it runs');
  // #4569 (Josh): from the click on, the button stays in place, off, with Connecting and a spinner beside it.
  const conn = await q(() => ({ go: !document.getElementById('acct-muse-go').hidden, off: document.getElementById('acct-muse-go').disabled,
    spin: !document.getElementById('acct-muse-spin').hidden, words: document.getElementById('acct-muse-spin').textContent,
    beside: document.getElementById('acct-muse-spin').parentElement === document.getElementById('acct-muse-go').parentElement }));
  chk(conn.go && conn.off && conn.spin && /Connecting/.test(conn.words) && conn.beside, 'while it runs: the button is off and Connecting spins beside it (#4569)', JSON.stringify(conn));
  await q(() => { window.__status = { id: 'mine000000000001', state: 'code', url: 'https://auth.meta.com/device?user_code=WXYZ-1234', code: 'WXYZ-1234' }; });
  await tick();
  const code = await q(() => {
    const host = document.getElementById('acct-muse-code');
    const cells = [...host.querySelectorAll('.devcode-cell')].map((c) => c.textContent).join('');
    return { hidden: host.hidden, cells };
  });
  chk(!code.hidden && code.cells === 'WXYZ1234', 'the code shows in the #3952 boxes', JSON.stringify(code));
  const link = await G('acct-muse-open');
  chk(link.href === 'https://auth.meta.com/device?user_code=WXYZ-1234' && !(await G('acct-muse-open-row')).hidden, 'Meta\'s page is a link', link.href);
  chk(/Confirm the code on Meta's page/.test((await G('acct-muse-say')).text), 'it says what to do', (await G('acct-muse-say')).text);

  // Expired: a new code, asked for by this sign-in's id.
  await q(() => { window.__status = { id: 'mine000000000001', state: 'expired', because: 'The code expired before it was approved' }; });
  await tick();
  chk(!(await G('acct-muse-retry-row')).hidden, 'an expired code offers Get a new code');
  chk((await G('acct-muse-spin')).hidden, 'an expired code stops the spinner: it waits on the person now (#4569 review round 1)');
  chk((await G('acct-muse-code')).hidden, 'the expired code is no longer shown');
  await q(() => document.getElementById('acct-muse-retry').click());
  await settle();
  chk(await q(() => { const p = window.__posts[window.__posts.length - 1]; return p.path === '/retry' && p.id === 'mine000000000001'; }), 'Get a new code POSTs a retry naming this sign-in');

  // Done.
  await q(() => { window.__status = { id: 'mine000000000001', state: 'done' }; });
  const before = await q(() => window.__accountsPainted);
  await tick();
  // #4569 (Josh): the success line REPLACES the button, and Close is the thing to press.
  const done = await q(() => ({ line: document.getElementById('acct-muse-done').hidden ? '' : document.getElementById('acct-muse-done').textContent,
    go: document.getElementById('acct-muse-go').hidden, spin: document.getElementById('acct-muse-spin').hidden,
    say: document.getElementById('acct-muse-say').textContent, close: document.getElementById('acct-add-close').classList.contains('uprime'),
    focus: document.activeElement && document.activeElement.id }));
  chk(/Signed in to Meta Muse\. You can close this window\./.test(done.line), 'done says so, and that the window can be closed (#4569)', JSON.stringify(done));
  chk(done.go && done.spin && done.say === '', 'done: the button and the spinner are gone, not left under the success line (#4569)', JSON.stringify(done));
  chk(done.close && done.focus === 'acct-add-close', 'done: Close is the primary action and has focus (#4569)', JSON.stringify(done));
  chk(await q(() => document.getElementById('acct-add-close').getAttribute('aria-describedby') === 'acct-muse-done'), 'done: Close is described by the success line, so a screen reader hears it (#4569 review round 1)');
  chk(await q((b) => window.__accountsPainted > b, before), 'done repaints the accounts');
  chk((await G('acct-muse-cancel-row')).hidden, 'after done, Stop goes');

  // Another tab's sign-in: this screen ends in words and drives nothing.
  await q(() => { window.__status = { id: 'other00000000002', state: 'code', url: 'https://auth.meta.com/device?user_code=QQQQ-9999', code: 'QQQQ-9999' }; document.getElementById('acct-muse-go').click(); });
  await settle();
  const postsBefore = await q(() => window.__posts.length);
  await tick();
  chk(/Another sign-in started/.test((await G('acct-muse-say')).text), 'a poll naming another sign-in ends this one in words', (await G('acct-muse-say')).text);
  chk((await G('acct-muse-code')).hidden, 'another sign-in\'s code is never shown here');
  chk(await q((n) => window.__polls.size === 0 && window.__posts.length === n, postsBefore), 'and nothing is sent for it');

  // A failure in words, and the button re-arms.
  await q(() => { window.__status = { id: 'mine000000000001', state: 'failed', because: 'Muse Code signed in but could not save the sign-in on this computer' }; document.getElementById('acct-muse-go').click(); });
  await settle();
  await tick();
  const failed = await G('acct-muse-say');
  chk(/could not save the sign-in/.test(failed.text) && /try again/.test(failed.text), 'a failure is said in words', failed.text);
  chk((await G('acct-muse-go')).disabled === false && !(await G('acct-muse-go')).hidden, 'the button re-arms after a failure');
  const tryAgain = await q(() => ({ label: document.getElementById('acct-muse-go').textContent, spin: document.getElementById('acct-muse-spin').hidden,
    done: document.getElementById('acct-muse-done').hidden, close: document.getElementById('acct-add-close').classList.contains('uprime') }));
  chk(tryAgain.label === 'Try again' && tryAgain.spin && tryAgain.done && !tryAgain.close, 'a failure offers Try again, with no spinner, no success line and Close back to plain (#4569)', JSON.stringify(tryAgain));
  // Review round 1: reopened after a failure, the step starts fresh (the label said Try again with no failure shown).
  await q(() => { closeAcctAdd(); openAcctAdd(); }); await settle();
  await choose('meta'); await settle();
  chk(await q(() => document.getElementById('acct-muse-go').textContent === 'Sign in with Meta' && !document.getElementById('acct-add-close').hasAttribute('aria-describedby')),
    'reopened after a failure, the button reads Sign in with Meta again (#4569 review round 1)');

  // A refused start is said in words.
  await q(() => { window.__startAnswer = [400, { ok: false, error: 'Muse Code is not on this computer' }]; document.getElementById('acct-muse-go').click(); });
  await settle();
  chk(/not on this computer/.test((await G('acct-muse-say')).text), 'a refused start is said in words', (await G('acct-muse-say')).text);
  await q(() => { window.__startAnswer = null; });

  // Stop, and closing the dialog, each stop the engine's sign-in by id.
  await q(() => { window.__status = { id: 'mine000000000001', state: 'starting' }; document.getElementById('acct-muse-go').click(); });
  await settle();
  await q(() => document.getElementById('acct-muse-cancel').click());
  await settle();
  chk(await q(() => { const p = window.__posts[window.__posts.length - 1]; return p.path === '/stop' && p.id === 'mine000000000001'; }), 'Stop stops the engine\'s sign-in by id');
  chk(/Sign-in stopped/.test((await G('acct-muse-say')).text), 'Stop says so');
  chk(await q(() => document.getElementById('acct-muse-go').textContent === 'Sign in with Meta' && document.getElementById('acct-muse-spin').hidden), 'after Stop the button reads Sign in with Meta and the spinner is gone (#4569)');
  await q(() => document.getElementById('acct-muse-go').click());
  await settle();
  await q(() => closeAcctAdd());
  await settle();
  chk(await q(() => { const p = window.__posts[window.__posts.length - 1]; return p.path === '/stop' && p.id === 'mine000000000001' && window.__polls.size === 0; }), 'closing the dialog stops it and stops polling');

  // Another provider puts Muse's step away.
  await q(() => { openAcctAdd(); });
  await settle();
  await choose('meta'); await settle();
  await choose('claude'); await settle();
  chk((await G('acct-muse-flow')).hidden, 'picking another provider puts Muse\'s step away');

  /* ---- round 1 of review: focus, idle, races, switches ---- */
  const act = () => q(() => (document.activeElement && document.activeElement.id) || document.activeElement.tagName);
  const running = async () => { await q(() => { window.__status = { id: 'mine000000000001', state: 'code', url: 'https://auth.meta.com/device?user_code=WXYZ-1234', code: 'WXYZ-1234' }; }); await choose('meta'); await settle(); await q(() => document.getElementById('acct-muse-go').click()); await settle(); await tick(); };
  await q(() => { closeAcctAdd(); openAcctAdd(); }); await settle();
  await running();
  // Get a new code: focus goes to Stop, never to a hidden button.
  await q(() => { window.__status = { id: 'mine000000000001', state: 'expired' }; }); await tick();
  await q(() => document.getElementById('acct-muse-retry').focus());
  await q(() => document.getElementById('acct-muse-retry').click()); await settle();
  chk(await act() === 'acct-muse-cancel', 'after Get a new code, focus is on Stop, not lost', await act());
  // Expiry while focus is on the link: focus goes to Stop, and the hidden link keeps no address.
  await q(() => { window.__status = { id: 'mine000000000001', state: 'code', url: 'https://auth.meta.com/device?user_code=QRST-5678', code: 'QRST-5678' }; }); await tick();
  await q(() => document.getElementById('acct-muse-open').focus());
  await q(() => { window.__status = { id: 'mine000000000001', state: 'expired' }; }); await tick();
  chk(await act() === 'acct-muse-cancel', 'an expiry with focus on the link moves focus to Stop', await act());
  chk((await G('acct-muse-open')).href === '#', 'the hidden link keeps no address', (await G('acct-muse-open')).href);
  // A retry answered after Stop paints nothing.
  await q(() => { window.__holdRetry = new Promise((r) => { window.__releaseRetry = r; }); document.getElementById('acct-muse-retry').click(); });
  await settle();
  await q(() => document.getElementById('acct-muse-cancel').click()); await settle();
  await q(() => { window.__releaseRetry(); window.__holdRetry = null; }); await settle();
  chk(/Sign-in stopped/.test((await G('acct-muse-say')).text), 'a retry answered after Stop paints nothing', (await G('acct-muse-say')).text);
  // A failure while focus is on Stop brings focus back to the button.
  await running();
  await q(() => document.getElementById('acct-muse-cancel').focus());
  await q(() => { window.__status = { id: 'mine000000000001', state: 'failed', because: 'x' }; }); await tick();
  chk(await act() === 'acct-muse-go', 'a failure with focus on Stop returns focus to the button', await act());
  // Idle (the board restarted mid sign-in) is not "another sign-in".
  await running();
  await q(() => { window.__status = { state: 'idle' }; }); await tick();
  chk(/ended before it finished/.test((await G('acct-muse-say')).text), 'an idle poll says the sign-in ended, not that another started', (await G('acct-muse-say')).text);
  // A poll answered after Stop paints nothing.
  await running();
  await q(() => { window.__holdStatus = new Promise((r) => { window.__releaseStatus = r; }); window.__tickP = window.__tick(); });
  await settle();
  await q(() => document.getElementById('acct-muse-cancel').click()); await settle();
  await q(async () => { window.__releaseStatus(); window.__holdStatus = null; await window.__tickP; }); await settle();
  chk((await G('acct-muse-code')).hidden && /Sign-in stopped/.test((await G('acct-muse-say')).text), 'a poll answered after Stop paints nothing', (await G('acct-muse-say')).text);
  // A start answered after the dialog closed is stopped by its own id.
  await q(() => { window.__holdStart = new Promise((r) => { window.__releaseStart = r; }); window.__startAnswer = [200, { ok: true, id: 'late000000000009', state: 'starting' }]; });
  await choose('meta'); await settle();
  await q(() => document.getElementById('acct-muse-go').click()); await settle();
  await q(() => closeAcctAdd()); await settle();
  await q(() => { window.__releaseStart(); window.__holdStart = null; }); await settle();
  chk(await q(() => { const p = window.__posts[window.__posts.length - 1]; return p.path === '/stop' && p.id === 'late000000000009' && window.__polls.size === 0; }), 'a start answered after close is stopped by its own id');
  await q(() => { window.__startAnswer = null; openAcctAdd(); }); await settle();
  // Switching provider mid sign-in stops it.
  await running();
  await choose('claude'); await settle();
  chk(await q(() => { const p = window.__posts[window.__posts.length - 1]; return p.path === '/stop' && p.id === 'mine000000000001' && window.__polls.size === 0; }), 'switching provider mid sign-in stops it by id');
  // Meta puts away a key step left open, and a ChatGPT sign-in.
  await q(() => { document.getElementById('acct-apikey-flow').hidden = false; ACCT_OPENAI_SUB_SESSION = 'sess-1'; });
  await choose('meta'); await settle();
  chk((await G('acct-apikey-flow')).hidden, 'picking Meta puts away another provider\'s key step');
  chk(await q(() => ACCT_OPENAI_SUB_SESSION === null), 'picking Meta ends a ChatGPT sign-in left running');

  /* ---- round 2 of review ---- */
  // A reauth door (acctPick, not the select's change) stops a running Muse sign-in.
  await q(() => { closeAcctAdd(); openAcctAdd(); }); await settle();
  await running();
  await q(() => acctPick('claude', { focus: false })); await settle();
  chk(await q(() => { const p = window.__posts[window.__posts.length - 1]; return p.path === '/stop' && p.id === 'mine000000000001' && window.__polls.size === 0; }), 'a door that picks another provider directly stops the Muse sign-in by id');
  // A double press of Get a new code sends one retry.
  await q(() => { closeAcctAdd(); openAcctAdd(); }); await settle();
  await running();
  await q(() => { window.__status = { id: 'mine000000000001', state: 'expired' }; }); await tick();
  const retriesBefore = await q(() => window.__posts.filter((p) => p.path === '/retry').length);
  await q(() => { window.__holdRetry = new Promise((r) => { window.__releaseRetry = r; }); const b = document.getElementById('acct-muse-retry'); b.click(); b.click(); });
  await settle();
  await q(() => { window.__releaseRetry(); window.__holdRetry = null; }); await settle();
  chk(await q((n) => window.__posts.filter((p) => p.path === '/retry').length === n + 1, retriesBefore), 'a double press of Get a new code sends one retry');
  await q(() => document.getElementById('acct-muse-cancel').click()); await settle();
  // Turned on but Muse Code not installed: the option stays disabled and says why.
  await q(() => { window.__museInstalled = false; closeAcctAdd(); openAcctAdd(); }); await settle();
  const missing = await q(() => { const o = document.querySelector('#acct-provider-pick option[value="meta"]'); return { disabled: o.disabled, off: o.dataset.off || '' }; });
  chk(missing.disabled && /not on this computer/.test(missing.off) && missing.off !== 'Not ready on this computer', 'turned on but not installed: the Meta option stays disabled and gives the engine\'s reason', JSON.stringify(missing));
  await q(() => { window.__museInstalled = true; closeAcctAdd(); openAcctAdd(); }); await settle();
  chk(await q(() => { const o = document.querySelector('#acct-provider-pick option[value="meta"]'); return !o.disabled && !o.dataset.off; }), 'installed again: live, with no leftover reason');

  /* ---- round 4 of review: stuck, with and without a code ---- */
  await q(() => { window.__museInstalled = true; closeAcctAdd(); openAcctAdd(); }); await settle();
  await running();
  await q(() => { window.__status = { id: 'mine000000000001', state: 'stuck', because: 'Muse Code did not start waiting for the approval', url: 'https://auth.meta.com/device?user_code=WXYZ-1234', code: 'WXYZ-1234' }; }); await tick();
  const stuckCode = await q(() => ({ msg: document.getElementById('acct-muse-say').textContent, code: !document.getElementById('acct-muse-code').hidden,
    link: !document.getElementById('acct-muse-open-row').hidden, retry: !document.getElementById('acct-muse-retry-row').hidden, stop: !document.getElementById('acct-muse-cancel-row').hidden }));
  chk(/did not start waiting/.test(stuckCode.msg) && stuckCode.code && stuckCode.link && !stuckCode.retry && stuckCode.stop,
    'stuck with a code: says why, keeps the code and link (Meta\'s page may still take it), offers Stop, no retry', JSON.stringify(stuckCode));
  await q(() => { window.__status = { id: 'mine000000000001', state: 'stuck', because: 'Muse Code is showing a step Kosmos does not recognise' }; }); await tick();
  const stuckBare = await q(() => ({ msg: document.getElementById('acct-muse-say').textContent, code: !document.getElementById('acct-muse-code').hidden, stop: !document.getElementById('acct-muse-cancel-row').hidden }));
  chk(/does not recognise/.test(stuckBare.msg) && !stuckBare.code && stuckBare.stop, 'stuck with no code: says why, no code, Stop offered', JSON.stringify(stuckBare));
  await q(() => document.getElementById('acct-muse-cancel').click()); await settle();

  /* ---- round 5 of review ---- */
  chk(await q(() => ACCT_ADD_INTRO_MUSE !== ACCT_ADD_INTRO && /Meta Muse/.test(ACCT_ADD_INTRO_MUSE)), 'the Muse intro is derived from the stock one and really differs');
  // The latest read wins: an older answer (off) landing after a newer one (on) changes nothing.
  await q(() => { closeAcctAdd(); window.__museOn = false; window.__holdMuse = new Promise((r) => { window.__releaseMuse = r; }); openAcctAdd(); });
  await settle();
  await q(() => { window.__museOn = true; closeAcctAdd(); openAcctAdd(); });
  await settle();
  await q(() => { window.__releaseMuse(); }); await settle();
  chk(await q(() => !document.querySelector('#acct-provider-pick option[value="meta"]').disabled), 'an older /api/muse answer landing last does not undo the newer one');
  // An open logo list refreshes when the answer lands.
  await q(() => { closeAcctAdd(); window.__museOn = false; openAcctAdd(); }); await settle();
  await q(() => { window.__museOn = true; window.__holdMuse = new Promise((r) => { window.__releaseMuse = r; }); closeAcctAdd(); openAcctAdd(); });
  await settle();
  await q(() => { const t = document.querySelector('#acct-provider-pick').parentElement.querySelector('.pcombo-trigger'); if (t && t.getAttribute('aria-expanded') !== 'true') t.click(); });
  await q(() => { const o = document.querySelector('#acct-provider-pick option[value="meta"]'); o.disabled = true; });   // as the list was when it opened
  await q(() => { window.__releaseMuse(); }); await settle();
  const openRow = await q(() => { const li = [...document.querySelectorAll('.pcombo li')].find((l) => l.dataset.value === 'meta' && l.offsetParent !== null); return li ? { dis: li.getAttribute('aria-disabled'), pill: !!li.querySelector('.pcombo-soon') } : null; });
  chk(openRow && openRow.dis === null && !openRow.pill, 'a list already open drops Meta\'s disabled state and pill when the answer lands', JSON.stringify(openRow));
  await q(() => { const t = document.querySelector('#acct-provider-pick').parentElement.querySelector('.pcombo-trigger'); if (t && t.getAttribute('aria-expanded') === 'true') t.click(); });
  // The intro swap never touches a sign-in again's sentence.
  await q(() => { closeAcctAdd(); window.__museOn = true; window.__holdMuse = new Promise((r) => { window.__releaseMuse = r; }); openAcctAdd(); document.getElementById('acct-add-in').textContent = 'Sign in again as her@example.com.'; });
  await q(() => { window.__releaseMuse(); }); await settle();
  chk((await G('acct-add-in')).text === 'Sign in again as her@example.com.', 'the intro swap leaves a sign-in again\'s sentence alone', (await G('acct-add-in')).text);
  // A reason that already says to start again is not told twice.
  await q(() => { closeAcctAdd(); openAcctAdd(); }); await settle();
  await running();
  await q(() => { window.__status = { id: 'mine000000000001', state: 'failed', because: 'Muse Code did not send a new code, so start the sign-in again' }; }); await tick();
  const twice = (await G('acct-muse-say')).text;
  chk(!/You can try again/.test(twice) && /start the sign-in again/.test(twice), 'a reason that says to start again is not told twice', twice);
  // Put away with focus inside: focus goes to the provider picker.
  await running();
  await q(() => document.getElementById('acct-muse-cancel').focus());
  await q(() => acctPick('claude', { focus: false })); await settle();
  chk(await q(() => !!document.activeElement && document.activeElement.classList.contains('pcombo-trigger')), 'Muse\'s step put away with focus inside leaves focus on the provider picker', await act());

  /* ---- #3939 slice 3c-2: the Meta Muse row in Settings, AI Models ---- */
  const MUSE_ROW = { provider: 'meta', providerName: 'Meta', dir: null, label: null, name: null, isDefault: false, email: null, authMode: 'muse', keyTail: null,
    connection: { state: 'connected', checkedLive: false, badge: 'signed_in_unverified' } };
  await q(() => { closeAcctAdd(); window.__accounts = []; }); await settle();
  await q(() => paintAccounts()); await settle();
  chk(await q(() => !document.querySelector('#set-accounts [data-muse-row]')), 'no Meta Muse row when the list has none (CONTROL)');
  await q((row) => { window.__accounts = [row, { provider: 'openai', providerName: 'OpenAI', dir: '/h/.codex', email: null, keyTail: 'ab12', authMode: 'apikey', connection: { state: 'connected', badge: 'working' } }]; }, MUSE_ROW);
  await q(() => paintAccounts()); await settle();
  const row = await q(() => {
    const r = document.querySelector('#set-accounts [data-muse-row]');
    if (!r) return null;
    const box = r.closest('.acct-prov');
    const head = box && box.querySelector('.acct-prov-name');
    return {
      text: r.textContent.replace(/\s+/g, ' ').trim(),
      buttons: [...r.querySelectorAll('button')].map((b) => b.textContent.trim()),
      claudeBits: r.querySelectorAll('[data-check-claude], [data-check-dir], [data-check-signin], [data-reauth], [data-share], [data-forget-provider], [data-forget]').length,
      group: head ? head.textContent.trim() : '',
      claudeGroup: /Claude/.test(head ? head.textContent : ''),
    };
  });
  chk(row && /Meta account/.test(row.text) && /through Muse Code/.test(row.text) && /Signed in/.test(row.text), 'the Meta Muse row says what it is and that it is signed in', JSON.stringify(row));
  chk(row && row.buttons.length === 1 && row.buttons[0] === 'Sign in again', 'its only action is Sign in again', JSON.stringify(row && row.buttons));
  chk(row && row.claudeBits === 0, 'none of a Claude row\'s actions are on it', JSON.stringify(row));
  chk(row && row.group === 'Meta', 'it is grouped under its own Meta heading, not Claude\'s', JSON.stringify(row && row.group));
  /* #4569 (Josh, 10:47: "After I signed in I didn't get a green Signed In. It was black"): the three states. */
  const pillOf = async (connection) => {
    await q((r) => { window.__accounts = [r]; }, { ...MUSE_ROW, connection });
    await q(() => paintAccounts()); await settle();
    return q(() => { const r = document.querySelector('#set-accounts [data-muse-row]'); const p = r && r.querySelector('.acct-box-top > span');
      return p ? { cls: p.className, text: p.childNodes[1] ? p.textContent.replace(/\s*\(.*$/, '').trim() : '', color: getComputedStyle(p).color,
        buttons: [...r.querySelectorAll('button')].map((b) => b.textContent.trim()) } : null; });
  };
  const green = await pillOf({ state: 'connected', checkedLive: false, badge: 'working', observedFrom: 'sign', observedAgeMs: 30000 });
  chk(green && green.cls === 'acct-connected' && /^Signed in · confirmed /.test(green.text), 'after Kosmos\'s own sign-in the row is green, with when (#4569)', JSON.stringify(green));
  const amber = await pillOf({ state: 'connected', checkedLive: false, badge: 'signed_in_unverified' });
  chk(amber && amber.cls === 'acct-unverified' && amber.text === 'Signed in' && amber.color !== green.color, 'on Muse\'s own record alone it is amber, not green (#4569)', JSON.stringify(amber));
  const red = await pillOf({ state: 'none', checkedLive: false, badge: 'rejected' });
  chk(red && red.cls === 'acct-none' && red.text === 'Not connected' && red.buttons.join() === 'Sign in again', 'after Meta refused a turn it is red Not connected, with Sign in again (#4569)', JSON.stringify(red));
  chk(await q(() => !document.querySelector('#set-accounts [data-muse-row] .acct-unknown')), 'no Meta row is the black unknown pill any more (#4569)');
  // Sign in again, Muse offered: Add a provider opens on Meta's step, focus on its Start.
  const rowPostsBefore = await q(() => window.__posts.length);
  await q(() => { window.__museOn = true; document.querySelector('#set-accounts [data-muse-reauth]').click(); });
  await page.waitForTimeout(300);
  const again = await q(() => ({
    modal: !document.getElementById('acct-add-modal').hidden,
    step: !document.getElementById('acct-muse-flow').hidden,
    pick: document.getElementById('acct-provider-pick').value,
    focus: document.activeElement && document.activeElement.id,
    claude: !document.getElementById('acct-claude-flow').hidden,
  }));
  chk(again.modal && again.step && again.pick === 'meta' && again.focus === 'acct-muse-go' && !again.claude, 'Sign in again opens Add a provider on Meta\'s step, focus on Start, never Claude\'s sign-in', JSON.stringify(again));
  chk(await q(() => window.__posts.length) === rowPostsBefore, 'Sign in again starts nothing by itself (the person presses Start)', String(await q(() => window.__posts.length) - rowPostsBefore));
  // Sign in again, Muse no longer offered: the dialog says so rather than opening on nothing.
  await q(() => { closeAcctAdd(); window.__museOn = false; document.querySelector('#set-accounts [data-muse-reauth]').click(); });
  await page.waitForTimeout(300);
  // Round 1: the line must be SEEN, not only present (it was written into a hidden element).
  const gone = await q(() => { const p = document.getElementById('acct-add-pick-say'); return { say: p && p.textContent, seen: !!p && p.checkVisibility(), role: p && p.getAttribute('role'), step: !document.getElementById('acct-muse-flow').hidden }; });
  chk(/not available on this computer/.test(gone.say) && gone.seen && gone.role === 'status' && !gone.step, 'Sign in again with Muse no longer offered says so where it is seen and announced, and opens no step', JSON.stringify(gone));
  // Round 11: focus is on the picker's visible button, not the hidden native select.
  chk(await q(() => !!document.activeElement && document.activeElement.classList.contains('pcombo-trigger')), 'and focus is on the picker\'s visible button', await q(() => document.activeElement && (document.activeElement.id || document.activeElement.className)));
  // A live answer afterwards ends that stale line (round 1, N3).
  await q(async () => { window.__museOn = true; await museAsk(); });
  chk(await q(() => document.getElementById('acct-add-pick-say').textContent === ''), 'a later live answer takes the stale "not available" line away');
  // Round 3: the line is a live region that stays in the tree (it is heard the first time), empty when silent.
  chk(await q(() => { const p = document.getElementById('acct-add-pick-say'); return !p.hidden && p.getAttribute('aria-live') === 'polite'; }), 'the line beside the picker is never hidden (a live region must stay in the tree to be heard)');
  // Round 3: any provider choice ends what it said.
  await q(() => { acctAddPickSay('stale words'); acctPick('openai', { focus: false }); });
  chk(await q(() => document.getElementById('acct-add-pick-say').textContent === ''), 'choosing a provider ends what the line beside the picker said');
  // Round 1, W2: another provider picked while the answer is out is left alone.
  await q(() => { closeAcctAdd(); window.__museOn = true; window.__holdMuse = new Promise((r) => { window.__releaseMuse = r; }); document.querySelector('#set-accounts [data-muse-reauth]').click(); });
  await settle();
  await choose('openai'); await settle();
  await q(() => window.__releaseMuse()); await page.waitForTimeout(200);
  const kept = await q(() => ({ pick: document.getElementById('acct-provider-pick').value, muse: !document.getElementById('acct-muse-flow').hidden }));
  chk(kept.pick === 'openai' && !kept.muse, 'a late answer does not take over a provider picked meanwhile', JSON.stringify(kept));
  // Round 1, W3: closed and reopened while the answer is out: the fresh dialog is left alone.
  await q(() => { closeAcctAdd(); window.__museOn = true; window.__holdMuse = new Promise((r) => { window.__releaseMuse = r; }); document.querySelector('#set-accounts [data-muse-reauth]').click(); });
  await settle();
  await q(() => { closeAcctAdd(); openAcctAdd(); }); await settle();
  await q(() => window.__releaseMuse()); await page.waitForTimeout(200);
  const fresh = await q(() => ({ pick: document.getElementById('acct-provider-pick').value, muse: !document.getElementById('acct-muse-flow').hidden }));
  chk(fresh.pick === '' && !fresh.muse, 'an answer from an earlier visit does not drive a freshly opened dialog', JSON.stringify(fresh));
  await q(() => { closeAcctAdd(); });
  // Round 3, W1: Sign in again while another sign-in is under way says so, and lays nothing over it.
  // Round 7, N2: reached through the page's own functions (a Claude sign-in painted as running, picker left on it).
  await q(() => { ACCT_FLOW_LAST = null; closeAcctAdd(); }); await settle();
  await q(() => { openAcctAdd(); ACCT_FLOW_LAST = 'downloading|probe'; acctFlowPaint({ phase: 'downloading' }); });
  await q(() => { closeAcctAdd(); window.__museOn = true; document.querySelector('#set-accounts [data-muse-reauth]').click(); });
  await page.waitForTimeout(300);
  const busy = await q(() => ({ say: document.getElementById('acct-add-pick-say').textContent, pick: document.getElementById('acct-provider-pick').value, muse: !document.getElementById('acct-muse-flow').hidden, claudeShown: !document.getElementById('acct-claude-flow').hidden, focus: document.activeElement && document.activeElement.id }));
  chk(/Finish or stop the Claude sign-in first/.test(busy.say) && busy.pick === 'claude' && !busy.muse && busy.claudeShown && busy.focus === 'acct-cancel', 'Sign in again while another sign-in is under way says so, shows it, focuses its Stop, and does not lay Meta\'s step over it', JSON.stringify(busy));
  // Round 7, W2: the line is written after the dialog appears, not in the same step (so it is announced).
  await q(() => { ACCT_FLOW_LAST = null; closeAcctAdd(); }); await settle();
  await q(() => { openAcctAdd(); ACCT_FLOW_LAST = 'downloading|probe'; acctFlowPaint({ phase: 'downloading' }); });
  const sameStep = await q(() => { closeAcctAdd(); document.querySelector('#set-accounts [data-muse-reauth]').click(); return document.getElementById('acct-add-pick-say').textContent; });
  await page.waitForTimeout(300);
  const later = await q(() => document.getElementById('acct-add-pick-say').textContent);
  chk(sameStep === '' && /Claude sign-in first/.test(later), 'the "under way" line is written after the dialog appears, not in the same step', JSON.stringify({ sameStep, later }));
  // Round 8: another provider picked, or the sign-in ended, inside that moment: nothing stale is written.
  for (const [how, act] of [['another provider picked', "const s = document.getElementById('acct-provider-pick'); s.value = 'openai'; s.dispatchEvent(new Event('change'));"], ['the sign-in ended', 'ACCT_FLOW_LAST = null;']]) {
    await q(() => { ACCT_FLOW_LAST = null; closeAcctAdd(); }); await settle();
    await q(() => { openAcctAdd(); ACCT_FLOW_LAST = 'downloading|probe'; acctFlowPaint({ phase: 'downloading' }); });
    await q((a) => { closeAcctAdd(); document.querySelector('#set-accounts [data-muse-reauth]').click(); (0, eval)(a); }, act);
    await page.waitForTimeout(300);
    const stale = await q(() => document.getElementById('acct-add-pick-say').textContent);
    chk(stale === '', 'with ' + how + ' inside that moment, the "under way" line is not written', JSON.stringify(stale));
  }
  // Round 4: when that sign-in ends (here in failure), the line no longer asks to finish or stop it. Round 9: the
  // arm makes its own state and checks the line is THERE first, or it would pass on an earlier arm's empty line.
  await q(() => { ACCT_FLOW_LAST = null; closeAcctAdd(); }); await settle();
  await q(() => { openAcctAdd(); ACCT_FLOW_LAST = 'downloading|probe'; acctFlowPaint({ phase: 'downloading' }); });
  await q(() => { closeAcctAdd(); document.querySelector('#set-accounts [data-muse-reauth]').click(); });
  await page.waitForTimeout(300);
  chk(/Claude sign-in first/.test(await q(() => document.getElementById('acct-add-pick-say').textContent)), 'CONTROL: the "under way" line is there before the sign-in ends');
  await q(() => acctFlowPaint({ phase: 'failed', because: 'Claude closed before the sign-in finished' })); await settle();
  chk(await q(() => document.getElementById('acct-add-pick-say').textContent === ''), 'the "under way" line goes when that sign-in ends in failure');
  // Round 4: the line takes room only while it speaks (the page reset gives every element no margin).
  const gap = await q(() => { const p = document.getElementById('acct-add-pick-say'); const empty = getComputedStyle(p).marginTop; acctAddPickSay('x'); const full = getComputedStyle(p).marginTop; acctAddPickSay(''); return { empty, full }; });
  chk(gap.empty === '0px' && gap.full !== '0px', 'the line beside the picker takes room only while it has something to say', JSON.stringify(gap));
  await q(() => { ACCT_FLOW_LAST = null; closeAcctAdd(); });
  // Round 5, N1: the picker moved off Claude mid-sign-in (its step and Stop hidden): Sign in again puts Claude's
  // step back on screen, so the line never points at a Stop that cannot be seen.
  // As a person gets there: a Claude sign-in painted as running, the picker moved to OpenAI by its own change
  // event, the dialog closed, then the row's Sign in again.
  await q(() => { closeAcctAdd(); openAcctAdd(); ACCT_FLOW_LAST = 'downloading|probe'; acctFlowPaint({ phase: 'downloading' }); });
  await q(() => { const sel = document.getElementById('acct-provider-pick'); sel.value = 'openai'; sel.dispatchEvent(new Event('change')); });
  await q(() => { closeAcctAdd(); window.__museOn = true; document.querySelector('#set-accounts [data-muse-reauth]').click(); });
  await page.waitForTimeout(300);
  const moved = await q(() => ({ say: document.getElementById('acct-add-pick-say').textContent, pick: document.getElementById('acct-provider-pick').value, claudeShown: !document.getElementById('acct-claude-flow').hidden, openaiShown: !document.getElementById('acct-openai-flow').hidden, focus: document.activeElement && document.activeElement.id, inDialog: !!(document.activeElement && document.activeElement.closest('#acct-add-modal')) }));
  chk(/Claude sign-in first/.test(moved.say) && moved.pick === 'claude' && moved.claudeShown && !moved.openaiShown, 'with the picker moved off a running Claude sign-in, Sign in again puts that sign-in back on screen beside the line', JSON.stringify(moved));
  // Round 6: and focus lands inside the dialog, on that sign-in's Stop (never left on the page behind it, #1918).
  chk(moved.inDialog && moved.focus === 'acct-cancel', 'focus lands on the running sign-in\'s Stop, inside the dialog', JSON.stringify({ focus: moved.focus, inDialog: moved.inDialog }));
  // Round 7, N1: at the sign-in's code step, focus goes to the code field instead.
  await q(() => { ACCT_FLOW_LAST = null; closeAcctAdd(); }); await settle();
  await q(() => { openAcctAdd(); ACCT_FLOW_LAST = 'signin-awaiting-code|probe'; acctFlowPaint({ phase: 'signin-awaiting-code' }); });
  await q(() => { const sel = document.getElementById('acct-provider-pick'); sel.value = 'openai'; sel.dispatchEvent(new Event('change')); });
  await q(() => { closeAcctAdd(); document.querySelector('#set-accounts [data-muse-reauth]').click(); });
  await page.waitForTimeout(300);
  const codeStep = await q(() => ({ focus: document.activeElement && document.activeElement.id, codeShown: !document.getElementById('acct-code-row').hidden }));
  chk(codeStep.codeShown && codeStep.focus === 'acct-code', 'at the running sign-in\'s code step, focus lands on the code field', JSON.stringify(codeStep));
  // Round 7, W1: the picker set back to "Choose a provider" mid-sign-in still counts as a sign-in under way:
  // Meta's step is never laid over it, and nothing stops a Muse sign-in behind the person's back.
  await q(() => { ACCT_FLOW_LAST = null; closeAcctAdd(); }); await settle();
  await q(() => { openAcctAdd(); ACCT_FLOW_LAST = 'downloading|probe'; acctFlowPaint({ phase: 'downloading' }); });
  await q(() => { const sel = document.getElementById('acct-provider-pick'); sel.value = ''; sel.dispatchEvent(new Event('change')); });
  const stopsBefore = await q(() => window.__posts.filter((p) => p.path === '/stop').length);
  await q(() => { closeAcctAdd(); window.__museOn = true; document.querySelector('#set-accounts [data-muse-reauth]').click(); });
  await page.waitForTimeout(300);
  const emptied = await q(() => ({ pick: document.getElementById('acct-provider-pick').value, muse: !document.getElementById('acct-muse-flow').hidden, claudeShown: !document.getElementById('acct-claude-flow').hidden, say: document.getElementById('acct-add-pick-say').textContent }));
  chk(emptied.pick === 'claude' && !emptied.muse && emptied.claudeShown && /Claude sign-in first/.test(emptied.say), 'with the picker set back to "Choose a provider" mid-sign-in, Sign in again still keeps that sign-in on screen and says so', JSON.stringify(emptied));
  chk(await q((n) => window.__posts.filter((p) => p.path === '/stop').length === n, stopsBefore), 'and no Muse sign-in is started or stopped by it');
  // And with that panel not painted (no poll has run yet), focus still stays inside the dialog, on the picker.
  await q(() => { ACCT_FLOW_LAST = null; closeAcctAdd(); }); await settle();   // the previous arm's flow fully put away first
  await q(() => { document.getElementById('acct-flow').hidden = true; ACCT_FLOW_LAST = 'downloading|probe'; document.getElementById('acct-provider-pick').value = 'openai'; document.querySelector('#set-accounts [data-muse-reauth]').click(); });
  await page.waitForTimeout(300);
  const unpainted = await q(() => ({ inDialog: !!(document.activeElement && document.activeElement.closest('#acct-add-modal')), body: document.activeElement === document.body, active: document.activeElement && (document.activeElement.id || document.activeElement.className), modal: !document.getElementById('acct-add-modal').hidden, say: document.getElementById('acct-add-pick-say').textContent }));
  chk(unpainted.inDialog && !unpainted.body, 'with the running sign-in\'s panel not painted yet, focus still stays inside the dialog', JSON.stringify(unpainted));
  await q(() => { ACCT_FLOW_LAST = null; closeAcctAdd(); });
  // Round 5, N2: going back to "Choose a provider" clears the line too.
  await q(() => { openAcctAdd(); acctAddPickSay('stale words'); const sel = document.getElementById('acct-provider-pick'); sel.value = ''; sel.dispatchEvent(new Event('change')); });
  chk(await q(() => document.getElementById('acct-add-pick-say').textContent === ''), 'going back to "Choose a provider" clears the line beside the picker');
  await q(() => closeAcctAdd());
  // Round 9: Meta picked in the picker while a Claude sign-in runs stays on Claude and says so; nothing of
  // Muse's is started (and so nothing is stopped by that sign-in's next poll).
  await q(() => { ACCT_FLOW_LAST = null; closeAcctAdd(); }); await settle();
  await q(() => { openAcctAdd(); window.__museOn = true; ACCT_FLOW_LAST = 'downloading|probe'; acctFlowPaint({ phase: 'downloading' }); });
  const museCallsBefore = await q(() => window.__posts.length);
  // Round 10: through the REAL logo picker (its button, then Meta's row), which closes and refocuses itself.
  await q(() => { const s = document.getElementById('acct-provider-pick'); const t = s.parentElement.querySelector('.pcombo-trigger'); if (t.getAttribute('aria-expanded') !== 'true') t.click(); });
  await settle();
  await q(() => { const li = [...document.querySelectorAll('.pcombo li')].find((l) => l.dataset.value === 'meta' && l.offsetParent !== null); li.click(); });
  await settle();
  const pickedMeta = await q(() => ({ pick: document.getElementById('acct-provider-pick').value, muse: !document.getElementById('acct-muse-flow').hidden, claudeShown: !document.getElementById('acct-claude-flow').hidden, say: document.getElementById('acct-add-pick-say').textContent, focus: document.activeElement && document.activeElement.id }));
  chk(pickedMeta.pick === 'claude' && !pickedMeta.muse && pickedMeta.claudeShown && /Claude sign-in first/.test(pickedMeta.say), 'Meta picked while a Claude sign-in runs stays on Claude and says so', JSON.stringify(pickedMeta));
  chk(pickedMeta.focus === 'acct-cancel', 'and focus lands on that sign-in\'s Stop, not left on the picker\'s button', JSON.stringify(pickedMeta.focus));
  // Round 11: a second pick is announced again (the line is emptied, then rewritten in a later task).
  const changes = await q(async () => {
    const p = document.getElementById('acct-add-pick-say'); const seen = [];
    const mo = new MutationObserver(() => seen.push(p.textContent)); mo.observe(p, { childList: true, characterData: true, subtree: true });
    const s = document.getElementById('acct-provider-pick'); s.value = 'meta'; s.dispatchEvent(new Event('change'));
    await new Promise((r) => setTimeout(r, 50)); mo.disconnect(); return seen;
  });
  chk(changes.includes('') && /Claude sign-in first/.test(changes[changes.length - 1]), 'picking Meta again is announced again (emptied, then said)', JSON.stringify(changes));
  // Round 13: a dialog closed before the line speaks (the visit re-check): nothing is written into it.
  await q(() => { ACCT_FLOW_LAST = null; closeAcctAdd(); }); await settle();
  await q(() => { openAcctAdd(); ACCT_FLOW_LAST = 'downloading|probe'; acctFlowPaint({ phase: 'downloading' }); });
  await q(() => { closeAcctAdd(); document.querySelector('#set-accounts [data-muse-reauth]').click(); closeAcctAdd(); });
  await page.waitForTimeout(200);
  chk(await q(() => document.getElementById('acct-add-pick-say').textContent === ''), 'a dialog closed before the line speaks gets nothing written into it');
  // Round 12: the picker path's delayed line checks again too: another provider picked, or the sign-in ended,
  // before it speaks, leaves nothing stale.
  for (const [how, act] of [['another provider picked', "const s2 = document.getElementById('acct-provider-pick'); s2.value = 'openai'; s2.dispatchEvent(new Event('change'));"], ['the sign-in ended', "acctFlowPaint({ phase: 'failed', because: 'Claude closed before the sign-in finished' });"]]) {
    await q(() => { ACCT_FLOW_LAST = null; closeAcctAdd(); }); await settle();
    await q(() => { openAcctAdd(); ACCT_FLOW_LAST = 'downloading|probe'; acctFlowPaint({ phase: 'downloading' }); });
    await q((a) => { const s = document.getElementById('acct-provider-pick'); s.value = 'meta'; s.dispatchEvent(new Event('change')); (0, eval)(a); }, act);
    await page.waitForTimeout(200);
    const stale = await q(() => document.getElementById('acct-add-pick-say').textContent);
    chk(stale === '', 'Meta picked, then ' + how + ' before the line speaks: nothing stale is written', JSON.stringify(stale));
  }
  await q(() => { ACCT_FLOW_LAST = null; closeAcctAdd(); }); await settle();
  await q(() => acctFlowPaint({ phase: 'signin-browser-open' })); await settle();
  chk(await q((n) => window.__posts.length === n, museCallsBefore), 'and no Muse sign-in is started or stopped around it, even as the Claude sign-in moves on');
  await q(() => { ACCT_FLOW_LAST = null; closeAcctAdd(); }); await settle();
  // #3939 3c-3b: an agent can be made on Meta Muse now, so the Connections box counts a signed-in Muse.
  await q((row) => { window.__accounts = [row]; }, MUSE_ROW);
  await q(() => paintConnLive()); await settle();
  const connOnly = await q(() => document.getElementById('conn-live').textContent);
  chk(/^One account is connected and thinking for your agents/.test(connOnly), 'with only Meta Muse signed in, the Connections box counts it', connOnly);
  await q((row) => { window.__accounts = [row, { provider: 'openai', providerName: 'OpenAI', dir: '/h/.codex', email: null, keyTail: 'ab12', authMode: 'apikey', connection: { state: 'connected', badge: 'working' } }]; }, MUSE_ROW);
  await q(() => paintConnLive()); await settle();
  const connTwo = await q(() => document.getElementById('conn-live').textContent);
  chk(/^2 accounts /.test(connTwo), 'beside an OpenAI account it counts two', connTwo);
  // CONTROL: a Muse row that is not signed in is not counted.
  await q((row) => { window.__accounts = [{ ...row, connection: { state: 'none', badge: 'signed_out' } }]; }, MUSE_ROW);
  await q(() => paintConnLive()); await settle();
  const connOut = await q(() => document.getElementById('conn-live').textContent);
  chk(/Nothing is connected yet/.test(connOut), 'CONTROL: a signed-out Meta Muse is not counted', connOut);
  await q((row) => { window.__accounts = [{ ...row, connection: { state: 'none', badge: 'rejected' } }]; }, MUSE_ROW);
  await q(() => paintConnLive()); await settle();
  chk(/Nothing is connected yet/.test(await q(() => document.getElementById('conn-live').textContent)), 'a Meta Muse Meta refused is not counted (#4569)');
  await q(() => { window.__accounts = []; });
  /* Round 2: the create-agent form, through its own functions and its own elements. With only Meta Muse
     and an OpenAI account, the form must start on OpenAI (Muse is not a Claude account), and its Claude
     account picker must never list the Muse row. */
  const OPENAI_ROW = { provider: 'openai', providerName: 'OpenAI', dir: '/h/.codex', email: 'o@example.com', keyTail: null, authMode: 'chatgpt', connection: { state: 'connected', badge: 'working' } };
  const CLAUDE_ROW = { provider: 'anthropic', providerName: 'Anthropic', dir: '/h/.claude-a', email: 'c@example.com', isDefault: true, memoryShared: true, connection: { state: 'connected', badge: 'working' } };
  const createPick = await q(([m, o]) => {
    CREATE_ACCOUNTS = [m, o];
    resetCreateProvider();
    return document.getElementById('create-provider').value;
  }, [MUSE_ROW, OPENAI_ROW]);
  chk(createPick === 'openai', 'the create form starts on OpenAI when the only other account is Meta Muse (Muse is not a Claude account)', createPick);
  // No shared history on the Claude row: the case where the picker falls back to every working row.
  const claudeList = await q(([m, c]) => {
    CREATE_ACCOUNTS = [m, { ...c, memoryShared: false }];
    document.getElementById('create-provider').value = 'anthropic';
    fillCreateAccounts();
    return [...document.getElementById('create-account').options].map((o) => o.value + '|' + o.textContent.trim());
  }, [MUSE_ROW, CLAUDE_ROW]);
  chk(claudeList.length === 1 && claudeList[0].startsWith('/h/.claude-a'), 'the Claude account picker lists the Claude account and never the Meta Muse row', JSON.stringify(claudeList));
  const withCtl = await q(([c]) => { CREATE_ACCOUNTS = [c, { ...c, dir: '/h/.claude-b', email: 'd@example.com', isDefault: false }]; document.getElementById('create-provider').value = 'anthropic'; fillCreateAccounts(); return document.getElementById('create-account').options.length; }, [CLAUDE_ROW]);
  chk(withCtl >= 2, 'CONTROL: the same picker does list two real Claude accounts', String(withCtl));
  await q(() => { CREATE_ACCOUNTS = []; });

  /* ---- #3939 3c-3b: Meta Muse in the Create Agent form ---- */
  const createMeta = () => q(() => { const o = document.querySelector('#create-provider option[value="meta"]'); return { disabled: o.disabled, off: o.dataset.off || '' }; });
  const museRead = async () => { await q(() => museCreateAsk()); await settle(); };
  // Flag off: exactly today's option (disabled, the "Coming soon" pill, no reason).
  await q(() => { window.__museOn = false; window.__museSignedIn = false; CREATE_ACCOUNTS = []; fillCreateAccounts(); });
  await museRead();
  let cm = await createMeta();
  chk(cm.disabled === true && cm.off === '', 'create form, flag off: Meta stays disabled with no reason (Coming soon)', JSON.stringify(cm));
  // Flag off is settled for the page (the board reads it when it starts): the next paint does not ask again.
  const readsOff = await q(() => window.__museReads || 0);
  await museRead();
  chk(await q((n) => (window.__museReads || 0) === n, readsOff), 'create form, flag off: a repaint does not ask /api/muse again');
  // On but not signed in: disabled, and it says where to set it up. (A board with the flag on is a new page.)
  await q(() => { MUSE_CREATE = null; window.__museOn = true; window.__museSignedIn = false; });
  const readsOn = await q(() => window.__museReads || 0);
  await museRead();
  cm = await createMeta();
  chk(cm.disabled === true && cm.off === 'Set up in Settings: Add a provider', 'create form, on but not signed in: disabled, says where to set it up', JSON.stringify(cm));
  chk(await q((n) => (window.__museReads || 0) > n, readsOn), 'CONTROL: with the flag on, the read is made');
  // On, installed and signed in: offered.
  await q(() => { window.__museSignedIn = true; });
  await museRead();
  cm = await createMeta();
  chk(cm.disabled === false && cm.off === '', 'create form, signed in: Meta is offered', JSON.stringify(cm));
  // The agent page never offers a switch ONTO Meta (only its own current provider).
  const dMeta = await q(() => { const s = document.getElementById('d-provider'); paintMuseOption(s, 'anthropic'); const a = s.querySelector('option[value="meta"]').disabled; paintMuseOption(s, 'meta'); const b = s.querySelector('option[value="meta"]').disabled; return [a, b]; });
  chk(dMeta[0] === true && dMeta[1] === false, 'agent page: Meta is selectable only as an agent\'s current provider', JSON.stringify(dMeta));
  chk(await q(() => providerOf({ runner: 'muse' }) === 'meta' && providerOf({ runner: 'claude' }) === 'anthropic'), 'an agent on the muse runner reads as Meta (CONTROL: a Claude agent as Anthropic)');
  // An agent on Muse gets no Claude model list and no Claude account to move to.
  const musePage = await q(async ([c]) => {
    ACCOUNTS = [c, { ...c, dir: '/h/.claude-b', email: 'd@example.com', isDefault: false }];
    CREATE_MODELS = [{ id: 'claude-sonnet-5', label: 'Claude Sonnet 5' }];
    const muse = { sessionName: 'm1', runner: 'muse', provider: 'meta', account: null, isNamedOurs: true };
    CURRENT = muse;
    await paintModelPicker(muse);
    await paintAccountPicker(muse);
    paintProviderPicker(muse);
    const pSel = document.getElementById('d-provider');
    const pTrig = pSel.parentElement.querySelector('.pcombo-trigger');
    const out = {
      provValue: pSel.value, provOff: pSel.disabled, provTrigOff: !!(pTrig && pTrig.disabled),
      provGoOff: document.getElementById('d-provider-go').disabled,
      provMsg: document.getElementById('d-provider-msg').textContent,
      models: [...document.getElementById('d-model').options].map((o) => o.textContent),
      modelOff: document.getElementById('d-model').disabled,
      accts: [...document.getElementById('d-account').options].map((o) => o.value).filter(Boolean),
      acctMsg: document.getElementById('d-account-msg').textContent,
      // #4569 (Josh): no dead Move control, the provider named Meta Muse (never Meta / Llama), and no "Unknown Model".
      moveRowHidden: document.getElementById('d-account').parentElement.hidden,
      provShown: pTrig ? pTrig.textContent.replace(/\s+/g, ' ').trim() : '',
      runsOn: modelLine(muse),
    };
    // CONTROL: a Claude agent on the same page is offered the Claude accounts.
    const claude = { sessionName: 'c1', runner: 'claude', provider: 'anthropic', account: { dir: c.dir } };
    CURRENT = claude;
    await paintAccountPicker(claude);
    paintProviderPicker({ ...claude, isNamedOurs: true });
    out.claudeProvOff = document.getElementById('d-provider').disabled;
    out.claudeProvMsg = document.getElementById('d-provider-msg').textContent;
    out.claudeAccts = [...document.getElementById('d-account').options].map((o) => o.value).filter(Boolean);
    out.claudeMoveRowHidden = document.getElementById('d-account').parentElement.hidden;
    CURRENT = null; ACCOUNTS = [];
    return out;
  }, [CLAUDE_ROW]);
  chk(musePage.models.length === 1 && musePage.models[0] === 'Meta Muse picks its own model' && musePage.modelOff === true,
    'agent page, Muse agent: the model menu says Meta Muse picks its own model, and nothing else', JSON.stringify(musePage));
  chk(musePage.accts.length === 0 && /Meta sign-in through Muse Code, so there is no account to move it to/.test(musePage.acctMsg),
    'agent page, Muse agent: no account to move it to, said', JSON.stringify(musePage));
  chk(musePage.claudeAccts.length >= 1, 'CONTROL: a Claude agent on the same page is offered Claude accounts', JSON.stringify(musePage));
  chk(musePage.moveRowHidden === true && musePage.claudeMoveRowHidden === false, 'agent page, Muse agent: no empty Move menu is drawn (CONTROL: a Claude agent\'s is) (#4569)', JSON.stringify(musePage));
  chk(/Meta Muse/.test(musePage.provShown) && !/Llama/.test(musePage.provShown), 'agent page, Muse agent: the provider reads Meta Muse, not Meta / Llama (#4569)', musePage.provShown);
  chk(musePage.runsOn === 'Meta Muse', 'agent page, Muse agent: Runs on names Meta Muse, not Unknown Model (#4569)', musePage.runsOn);
  chk(musePage.provValue === 'meta' && musePage.provOff === true && musePage.provTrigOff === true && musePage.provGoOff === true
    && musePage.provMsg === 'Moving an agent on Meta Muse to another provider is not offered yet.',
    'agent page, Muse agent: shows Meta, offers no switch off it, and says so', JSON.stringify(musePage));
  chk(musePage.claudeProvOff === false && musePage.claudeProvMsg === '', 'CONTROL: a Claude agent\'s provider menu stays usable, with no such line', JSON.stringify(musePage));
  // Chosen through the real logo combobox: no account row, no model row, one line on who picks the model.
  const picked = await q(([m, c]) => {
    CREATE_ACCOUNTS = [m, c];
    fillCreateAccounts();
    const sel = document.getElementById('create-provider');
    const trig = sel.parentElement.querySelector('.pcombo-trigger');
    trig.click();
    const list = document.getElementById(trig.getAttribute('aria-controls'));
    const li = [...list.querySelectorAll('li.pcombo-opt')].find((x) => x.dataset.value === 'meta');
    li.click();
    return {
      prov: sel.value,
      acct: document.getElementById('create-account').value,
      acctText: [...document.getElementById('create-account').options].map((o) => o.textContent).join('|'),
      acctHidden: document.getElementById('create-account-row').hidden,
      model: document.getElementById('create-model').value,
      modelHidden: document.getElementById('create-model-row').hidden,
      why: document.getElementById('create-model-why').textContent,
    };
  }, [MUSE_ROW, CLAUDE_ROW]);
  chk(picked.prov === 'meta' && picked.acct === '' && picked.acctHidden === true && picked.model === '' && picked.modelHidden === true,
    'Meta chosen: no account and no model travel with the create (both empty, both rows hidden)', JSON.stringify(picked));
  chk(picked.acctText === '', 'Meta chosen: the account menu holds nothing (no Muse row, no "Meta Muse key" fallback)', JSON.stringify(picked));
  chk(picked.why === 'Meta Muse picks its own model.', 'Meta chosen: one line says Meta Muse picks its own model', JSON.stringify(picked));
  /* The accounts read failed (an empty list) while Meta is chosen: the account menu still holds nothing.
     Aimed here because with a signed-in Muse row in the list the old path listed that row, whose value and
     name are empty too, so only the empty list tells the Meta branch from the key fallback. */
  const emptyList = await q(() => {
    CREATE_ACCOUNTS = []; CREATE_ACCOUNTS_KNOWN = false;
    fillCreateAccounts();
    return { prov: document.getElementById('create-provider').value, text: [...document.getElementById('create-account').options].map((o) => o.textContent).join('|') };
  });
  chk(emptyList.prov === 'meta' && emptyList.text === '', 'Meta chosen, account list unread: no "Meta Muse key" line, nothing to pick', JSON.stringify(emptyList));
  await q(() => { CREATE_ACCOUNTS_KNOWN = true; });
  // Signed out with Meta chosen: the pick goes back to the default, and the form says why.
  await q(() => { window.__museSignedIn = false; });
  await museRead();
  const back = await q(() => ({ prov: document.getElementById('create-provider').value, why: document.getElementById('create-model-why').textContent }));
  chk(back.prov === 'anthropic' && /^Meta Muse is not signed in on this computer, so this is back on Claude\./.test(back.why), 'a Meta pick that is no longer signed in goes back to Claude, said', JSON.stringify(back));
  // CONTROL: a failed read leaves a good answer as it was (never a confident "off" from a failure).
  await q(() => { window.__museSignedIn = true; });
  await museRead();
  await q(() => { window.__museRead = 'throw'; });
  await museRead();
  cm = await createMeta();
  chk(cm.disabled === false, 'CONTROL: a failed /api/muse read keeps the last good answer', JSON.stringify(cm));
  /* Create pressed with Meta chosen: the request itself says provider meta and carries no account and no model
     (read from the request, not the form, so a value sent from anywhere else would show). */
  await q(() => { window.__museRead = null; window.__museSignedIn = true; });
  await museRead();
  const sent = await q(([m, c]) => {
    CREATE_ACCOUNTS = [m, c]; CREATE_ACCOUNTS_KNOWN = true;
    const sel = document.getElementById('create-provider');
    sel.value = 'meta'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    fillCreateAccounts();
    PICKED = 'own'; OWN_ROLE = OWN_ROLE || { key: 'own', label: '', instructions: '' };   // the roles read is not served here
    document.getElementById('create-label').value = 'Checks Meta';
    const name = document.getElementById('create-name');
    name.value = 'musecheck'; name.dispatchEvent(new Event('input', { bubbles: true }));
    window.__created = null;
    document.getElementById('create-go').click();
    return new Promise((r) => setTimeout(() => r(window.__created || { notSent: document.getElementById('create-msg').textContent
      + ' | ' + ((document.getElementById('create-label-err') || {}).textContent || '') + ' | prov ' + sel.value }), 300));
  }, [MUSE_ROW, CLAUDE_ROW]);
  chk(!!sent && sent.provider === 'meta' && !('account' in sent) && !('model' in sent),
    'Create with Meta chosen sends provider meta, no account, no model', JSON.stringify(sent));
  chk(!!sent && sent.name === 'musecheck', 'CONTROL: the request captured is this create', JSON.stringify(sent));
  await q(() => { window.__museRead = null; window.__museOn = false; window.__museSignedIn = false; CREATE_ACCOUNTS = []; MUSE_CREATE = null; });
  await museRead();

  /* ---- #3939 3c-4: Meta Muse on the first-run model step ---- */
  const frMeta = () => q(() => {
    const row = document.getElementById('fr-meta-row'); const btn = document.getElementById('fr-meta-connect');
    return { off: row.classList.contains('off'), on: row.classList.contains('on'), soon: !document.getElementById('fr-meta-soon').hidden,
      btn: !btn.hidden, btnText: btn.textContent.trim(), btnOff: btn.disabled, flow: !document.getElementById('fr-muse-flow').hidden,
      msg: document.getElementById('fr-muse-msg').textContent.trim(), box: document.getElementById('fr-muse-msg').className };
  });
  await q(() => { MUSE_CREATE = null; window.__museOn = false; window.__museSignedIn = false; window.__museInstalled = true; frOpen(); frGo(5); });
  await settle(); await settle();
  let fm = await frMeta();
  chk(fm.off && !fm.on && fm.soon && !fm.btn && !fm.flow, 'first run, switched off: the Meta row is today\'s Coming soon, no Connect, no panel', JSON.stringify(fm));
  await q(() => { MUSE_CREATE = null; window.__museOn = true; }); await q(() => frPaintMeta()); await settle();
  fm = await frMeta();
  chk(fm.on && !fm.off && !fm.soon && fm.btn && fm.btnText === 'Connect' && !fm.btnOff && !fm.flow, 'first run, switched on and signed out: Connect, no pill, panel shut', JSON.stringify(fm));
  const frOpenState = () => q(() => ({ flow: !document.getElementById('fr-muse-flow').hidden, focus: document.activeElement && (document.activeElement.id || document.activeElement.tagName), exp: document.getElementById('fr-meta-connect').getAttribute('aria-expanded') }));
  await q(() => document.getElementById('fr-meta-connect').click()); await settle();
  const opened = await frOpenState();
  chk(opened.flow && opened.focus === 'fr-muse-go' && opened.exp === 'true', 'Connect opens Meta\'s sign-in under the row, focus on Sign in with Meta', JSON.stringify(opened));
  const frPostsBefore = await q(() => window.__posts.length);
  await q(() => document.getElementById('fr-muse-go').click()); await settle();
  chk(await q((n) => window.__posts.length === n + 1 && window.__posts[window.__posts.length - 1].path === '/', frPostsBefore), 'Sign in with Meta on first run starts one sign-in');
  await q(() => frClose()); await settle();
  chk(await q(() => { const p = window.__posts[window.__posts.length - 1]; return p.path === '/stop' && p.id === 'mine000000000001' && window.__polls.size === 0; }), 'closing first run stops that sign-in by its id and stops polling');
  // A second press on Connect closes the panel, as its aria-expanded says.
  await q(() => { MUSE_CREATE = null; frOpen(); frGo(5); }); await settle(); await settle();
  await q(() => document.getElementById('fr-meta-connect').click()); await settle();
  await q(() => document.getElementById('fr-meta-connect').click()); await settle();
  const toggled = await frOpenState();
  chk(!toggled.flow && toggled.exp === 'false' && toggled.focus === 'fr-meta-connect', 'a second press on Connect closes the panel and keeps focus on Connect', JSON.stringify(toggled));
  // Leaving the model step mid sign-in stops it by id, as Gemini's and Grok's do.
  await q(() => document.getElementById('fr-meta-connect').click()); await settle();
  await q(() => document.getElementById('fr-muse-go').click()); await settle();
  await q(() => frGo(6)); await settle();
  chk(await q(() => { const p = window.__posts[window.__posts.length - 1]; return p.path === '/stop' && p.id === 'mine000000000001' && window.__polls.size === 0; }), 'leaving the model step mid sign-in stops it by id');
  // Driven to done on first run: the row reads Connected and focus is not lost to the page.
  await q(() => { frGo(5); }); await settle(); await settle();
  await q(() => document.getElementById('fr-meta-connect').click()); await settle();
  await q(() => document.getElementById('fr-muse-go').click()); await settle();
  await q(() => { document.getElementById('fr-muse-cancel').focus(); window.__museSignedIn = true; window.__status = { id: 'mine000000000001', state: 'done' }; });
  await tick(); await settle(); await settle();
  let doneSt = await frMeta();
  let doneFocus = await q(() => document.activeElement && (document.activeElement.id || document.activeElement.tagName));
  chk(doneSt.btnOff && /Connected/.test(doneSt.btnText) && doneSt.box === 'fr-connbox' && !doneSt.flow, 'a first-run sign-in that finishes reads Connected with the gold box', JSON.stringify(doneSt));
  chk(doneFocus === 'fr-muse-msg', 'and focus moves to the line under the row, not the page', String(doneFocus));
  // The read after done fails: the row stays Meta's (never back to Coming soon) and focus is kept.
  await q(() => { frClose(); MUSE_CREATE = null; window.__museSignedIn = false; window.__status = { state: 'idle' }; frOpen(); frGo(5); }); await settle(); await settle();
  await q(() => document.getElementById('fr-meta-connect').click()); await settle();
  await q(() => document.getElementById('fr-muse-go').click()); await settle();
  await q(() => { document.getElementById('fr-muse-cancel').focus(); window.__museRead = 'throw'; window.__status = { id: 'mine000000000001', state: 'done' }; });
  await tick(); await settle(); await settle();
  doneSt = await frMeta();
  doneFocus = await q(() => document.activeElement && (document.activeElement.id || document.activeElement.tagName));
  chk(doneSt.on && !doneSt.soon && doneSt.btn && doneFocus !== 'BODY', 'a failed read right after a first-run sign-in keeps the Meta row, and focus', JSON.stringify(doneSt) + ' focus ' + doneFocus);
  chk(!doneSt.flow && /^Signed in to Meta\. It shows here as connected once Kosmos can check it again\.$/.test(doneSt.msg),
    'and the sign-in panel is put away with a line that says what happened (no "Signed in" beside a live Sign in button)', JSON.stringify(doneSt));
  await q(() => { window.__museRead = null; frClose(); window.__status = { state: 'idle' }; });
  // Not installed: Connect says so and opens nothing.
  await q(() => { MUSE_CREATE = null; window.__museInstalled = false; frOpen(); frGo(5); }); await settle(); await settle();
  await q(() => document.getElementById('fr-meta-connect').click()); await settle();
  fm = await frMeta();
  chk(!fm.flow && /^Muse Code is not on this computer yet\./.test(fm.msg), 'first run, Muse Code missing: Connect says so and opens no sign-in', JSON.stringify(fm));
  // Installed while the step is open: the next press asks again, opens the sign-in and drops the missing line.
  await q(() => { window.__museInstalled = true; });
  await q(() => document.getElementById('fr-meta-connect').click()); await settle();
  fm = await frMeta();
  chk(fm.flow && fm.msg === '', 'installed after being told it is missing: Connect opens the sign-in and the line is gone', JSON.stringify(fm));
  await q(() => { frClose(); MUSE_CREATE = null; frOpen(); frGo(5); }); await settle(); await settle();
  // Signed in: Connected, with the gold box.
  await q(() => { MUSE_CREATE = null; window.__museInstalled = true; window.__museSignedIn = true; }); await q(() => frPaintMeta()); await settle();
  fm = await frMeta();
  chk(fm.btn && fm.btnOff && /Connected/.test(fm.btnText) && fm.box === 'fr-connbox' && /Meta Muse is connected/.test(fm.msg), 'first run, signed in: the row reads Connected with the gold box', JSON.stringify(fm));
  /* The box is DRAWN, not only named: its computed style matches Gemini's box on the same step (a class name
     with no rule behind it reads as a bare line). CONTROL: Gemini's line given the same class is the reference. */
  const boxes = await q(() => {
    const cs = (el) => { const c = getComputedStyle(el); return c.backgroundColor + '|' + c.paddingTop + '|' + c.borderTopLeftRadius; };
    const muse = document.getElementById('fr-muse-msg');
    const gem = document.getElementById('fr-gemini-msg');
    const was = gem.className; gem.className = 'fr-connbox';
    const out = { muse: cs(muse), gemini: cs(gem) };
    gem.className = was;
    return out;
  });
  /* The step offers Next once Meta Muse is connected, as it does for Gemini and Grok (not only Skip). */
  const frAct = await q(() => { const n = document.getElementById('fr-next'); const a = document.getElementById('fr-alt'); return { next: !!n && !n.hidden && n.textContent.trim(), alt: !!a && !a.hidden && a.textContent.trim() }; });
  chk(frAct.next === 'Next', 'first run, Meta Muse signed in: the step offers Next', JSON.stringify(frAct));
  chk(boxes.gemini !== 'rgba(0, 0, 0, 0)|0px|0px' && boxes.muse === boxes.gemini, 'first run, signed in: the Meta box is drawn like Gemini\'s (background, padding, corners)', JSON.stringify(boxes));
  await q(() => { frClose(); MUSE_CREATE = null; window.__museOn = false; window.__museSignedIn = false; });

  chk(errs.length === 0, 'no page errors', errs.join(' | '));
  await browser.close();
  if (fail.length) { console.error('\nrender-muse-signin-3939: ' + fail.length + ' check(s) failed'); process.exit(1); }
  console.log('\nrender-muse-signin-3939: all checks passed');
})().catch((e) => { console.error('FAIL  render-muse-signin-3939: ' + (e && e.stack || e)); process.exit(1); });
