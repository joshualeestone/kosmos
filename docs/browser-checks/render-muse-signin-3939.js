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
      if (/\/api\/accounts(\?|$)/.test(u)) { window.__accountsPainted += 1; return enc({ accounts: [] }); }
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

  chk(errs.length === 0, 'no page errors', errs.join(' | '));
  await browser.close();
  if (fail.length) { console.error('\nrender-muse-signin-3939: ' + fail.length + ' check(s) failed'); process.exit(1); }
  console.log('\nrender-muse-signin-3939: all checks passed');
})().catch((e) => { console.error('FAIL  render-muse-signin-3939: ' + (e && e.stack || e)); process.exit(1); });
