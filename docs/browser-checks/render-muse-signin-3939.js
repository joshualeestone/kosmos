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
      if (/\/api\/muse$/.test(u)) { const hold = window.__holdMuse; if (hold) { window.__holdMuse = null; const ans = window.__museOn; await hold; return enc(ans ? { enabled: true, installed: true, because: null, signedIn: false } : { enabled: false }); } }
      if (/\/api\/muse$/.test(u)) { if (window.__museRead === 'throw') throw new Error('offline'); if (window.__museRead === 500) return enc({ error: 'x' }, 500); }
      if (/\/api\/muse$/.test(u)) return enc(window.__museOn ? { enabled: true, installed: window.__museInstalled !== false, because: window.__museInstalled === false ? 'Muse Code is not on this computer' : null, signedIn: false } : { enabled: false });
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
  chk((await G('acct-muse-code')).hidden, 'the expired code is no longer shown');
  await q(() => document.getElementById('acct-muse-retry').click());
  await settle();
  chk(await q(() => { const p = window.__posts[window.__posts.length - 1]; return p.path === '/retry' && p.id === 'mine000000000001'; }), 'Get a new code POSTs a retry naming this sign-in');

  // Done.
  await q(() => { window.__status = { id: 'mine000000000001', state: 'done' }; });
  const before = await q(() => window.__accountsPainted);
  await tick();
  chk(/Signed in to Meta Muse/.test((await G('acct-muse-say')).text), 'done says so', (await G('acct-muse-say')).text);
  chk(await q((b) => window.__accountsPainted > b, before), 'done repaints the accounts');
  chk(!(await G('acct-muse-go')).hidden && (await G('acct-muse-cancel-row')).hidden, 'after done, Stop goes and the button is back');

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
  await q(() => { closeAcctAdd(); window.__museOn = true; ACCT_FLOW_LAST = 'downloading|probe'; document.getElementById('acct-provider-pick').value = 'claude'; document.querySelector('#set-accounts [data-muse-reauth]').click(); });
  await page.waitForTimeout(300);
  const busy = await q(() => ({ say: document.getElementById('acct-add-pick-say').textContent, pick: document.getElementById('acct-provider-pick').value, muse: !document.getElementById('acct-muse-flow').hidden }));
  chk(/Finish or stop the sign-in that is under way/.test(busy.say) && busy.pick === 'claude' && !busy.muse, 'Sign in again while another sign-in is under way says so, and does not lay Meta\'s step over it', JSON.stringify(busy));
  await q(() => { ACCT_FLOW_LAST = null; closeAcctAdd(); });
  // Round 1, W5: the Connections box never counts Meta Muse as thinking for agents (no agent runs on it yet).
  await q((row) => { window.__accounts = [row]; }, MUSE_ROW);
  await q(() => paintConnLive()); await settle();
  const connOnly = await q(() => document.getElementById('conn-live').textContent);
  chk(/Meta Muse is signed in, but no agent can run on it yet/.test(connOnly) && !/thinking for your agents/.test(connOnly), 'with only Meta Muse the Connections box says so, never that it thinks for agents', connOnly);
  await q((row) => { window.__accounts = [row, { provider: 'openai', providerName: 'OpenAI', dir: '/h/.codex', email: null, keyTail: 'ab12', authMode: 'apikey', connection: { state: 'connected', badge: 'working' } }]; }, MUSE_ROW);
  await q(() => paintConnLive()); await settle();
  const connTwo = await q(() => document.getElementById('conn-live').textContent);
  chk(/^One account /.test(connTwo), 'beside an OpenAI account it counts one account, not two', connTwo);
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

  chk(errs.length === 0, 'no page errors', errs.join(' | '));
  await browser.close();
  if (fail.length) { console.error('\nrender-muse-signin-3939: ' + fail.length + ' check(s) failed'); process.exit(1); }
  console.log('\nrender-muse-signin-3939: all checks passed');
})().catch((e) => { console.error('FAIL  render-muse-signin-3939: ' + (e && e.stack || e)); process.exit(1); });
