// Browser-check-surface: plus-state1 plus-state2 plus-si-done plus-si-owned plus-si-name-count plus-si-expired plus-si-second-lead plus-si-second-help plus-si-cancel plus-si-code-resend plus-si-code-to plus-si-email plus-si-code plus-si-second plus-si-enrol plus-si-enrol-sms plus-si-enrol-why plus-si-enrol-confirm plus-si-secret plus-si-register plus-flow plus-status otp-boxes otp-cell otp-cells
'use strict';
/**
 * #3478: the Kosmos+ sign-in links open the IN-APP wizard, not the web.
 *
 * The bug: `plus-signin-top` / `plus-signin-bottom` bounced to KOSMOS_SITE + '/plus'
 * (a #2625/#2626 stopgap). Josh's ask is the in-app flow. The backend (server.js
 * signin-* proxies + engine/remote.js's stage machine) was built under #3149; this
 * change wires the client. `node --test` proves the markup and the stage-routing
 * shape; only a browser proves what a person SEES: that clicking "Sign in" reveals
 * the wizard (it does not navigate away), and that the wizard walks the engine's
 * stages to a named, addressed computer.
 *
 * /api/remote is stubbed unenrolled so state 1 (and the sign-in link) is on screen;
 * the signin-* POSTs are stubbed per scenario so the same sandboxed server can be
 * driven through all three signin-verify branches (existing 2FA / enrol a 2FA /
 * straight to a session) without a real coordinator, account, email or phone.
 *
 *   node docs/browser-checks/render-plus-signin-3478.js            # headed
 *   HEADED=0 node docs/browser-checks/render-plus-signin-3478.js   # headless
 */
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-plussignin-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-plussignin-workers-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-plussignin-projects-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-plussignin-launch-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-plussignin-config-'));
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';

const { chromium } = require('playwright');
const fleet = require('../../test-support/fleet');
const srv = require('../../server.js');

const OUT = process.env.SHOT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'plussignin-shots-'));
const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

const UNENROLLED = { configured: true, on: false, ok: true, enrolled: false, email: '', status: {} };

// The three signin-verify branches, each a path -> mock response map. Every step
// returns { ok:true, stage } plus whatever fields the wizard renders for that stage.
const SCENARIOS = {
  'existing-2fa': {
    label: 'account already has a second factor (email code -> phone code -> name)',
    steps: {
      '/api/remote/signin-start': { ok: true, stage: 'code_sent' },
      '/api/remote/signin-verify': { ok: true, stage: 'second', second_kind: 'totp', sent_to: '' },   // #3796: Josh's account
      '/api/remote/signin-second': { ok: true, stage: 'session' },
      '/api/remote/signin-register': { ok: true, stage: 'registered', address: 'sunny-otter', name: 'sunny-otter', standing: 'active' },
    },
  },
  'enrol-2fa': {
    label: 'account needs a second factor (email code -> set up authenticator -> name)',
    steps: {
      '/api/remote/signin-start': { ok: true, stage: 'code_sent' },
      '/api/remote/signin-verify': { ok: true, stage: 'enrol_second_factor', sms_available: true, why_authenticator: 'An authenticator app on your phone gives a fresh code every time you sign in.' },
      '/api/remote/signin-enrol': { ok: true, stage: 'enrolment_started', kind: 'totp', secret: 'ABCD1234EFGH5678' },
      '/api/remote/signin-confirm-enrol': { ok: true, stage: 'session' },
      '/api/remote/signin-register': { ok: true, stage: 'registered', address: 'brave-finch', name: 'brave-finch', standing: 'active' },
    },
  },
  'straight-session': {
    label: 'email code lands straight on a session (no phone step -> name)',
    steps: {
      '/api/remote/signin-start': { ok: true, stage: 'code_sent' },
      '/api/remote/signin-verify': { ok: true, stage: 'session', account_address: 'quiet-heron.kosmosplus.com' },   // #3796 addendum 8: owns an address
      '/api/remote/signin-register': { ok: true, stage: 'registered', address: 'quiet-heron', name: 'quiet-heron', standing: 'active' },
    },
  },
  'enrol-2fa-sms': {
    label: 'account sets up its second factor by TEXT (email code -> text a code -> name)',
    entry: 'plus-signin-bottom',   // also exercises the foot "Already a member? Sign in" link
    smsEnrol: true,
    ownedRefusalFirst: 'calm-otter',   // #3796 addendum 8: an older coordinator refuses a different name, naming the owned one
    steps: {
      '/api/remote/signin-start': { ok: true, stage: 'code_sent' },
      '/api/remote/signin-verify': { ok: true, stage: 'enrol_second_factor', sms_available: true, why_authenticator: 'An authenticator app on your phone gives a fresh code every time you sign in.' },
      '/api/remote/signin-enrol': { ok: true, stage: 'enrolment_started', kind: 'sms', sent_to: '(•••) •••-4321' },
      '/api/remote/signin-confirm-enrol': { ok: true, stage: 'session' },
      '/api/remote/signin-register': { ok: true, stage: 'registered', address: 'calm-otter', name: 'calm-otter', standing: 'active' },
    },
  },
};

/* #3841: the wizard's separation on its real navy card, measured in the page (see the arms below). */
function WIZ_SEP() {
          const STOPS = [[27, 44, 80], [15, 29, 56]];
  const parse = (c) => { const m = /rgba?\(([^)]+)\)/.exec(c || ''); if (!m) return null; const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); return { rgb: p.slice(0, 3), a: p.length > 3 ? p[3] : 1 }; };
  const over = (c, bg) => c.rgb.map((v, i) => Math.round(v * c.a + bg[i] * (1 - c.a)));
  const lum = (rgb) => { const f = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2]; };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const worst = (colors) => { let w = Infinity; for (const c of colors) { const q = parse(c); if (!q) return 0; for (const st of STOPS) w = Math.min(w, ratio(over(q, st), st)); } return w; };
  const card = document.getElementById('plus-state2');
  const fields = [...card.querySelectorAll('input.tk-inp')].map((i) => ({ id: i.id, r: worst([getComputedStyle(i).borderTopColor]) }));
  const sec = [...card.querySelectorAll('.btn:not(.uprime)')].map((b) => ({ id: b.id, r: worst([getComputedStyle(b).borderTopColor]) }));
  /* Review: the FACE and the EDGE are measured apart. Taking the better of the two let a button whose
     fill matched the card pass on its 1px edge alone. */
  const prim = [...card.querySelectorAll('.btn.uprime')].map((b) => {
    const cs = getComputedStyle(b);
    const fill = (cs.backgroundImage.match(/rgba?\([^)]+\)/g) || []).concat(parse(cs.backgroundColor) && parse(cs.backgroundColor).a > 0 ? [cs.backgroundColor] : []);
    return { id: b.id, r: worst(fill.length ? fill : ['rgba(0,0,0,0)']), edge: worst([cs.borderTopColor]) };
  });
  return { fields, sec, prim };
}

async function openPlusState1(page) {
  await page.route('**/api/remote', (route, req) => {
    const m = req.method();
    if (m === 'GET' || m === 'HEAD') {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(UNENROLLED) });
    } else { route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); }
  });
  await page.route('**/api/remote/devices**', (route) => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ allowed: [], pending: [] }) });
  });
  await page.goto(page.__url, { waitUntil: 'networkidle' });
  if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
  await page.evaluate(() => showTab('settings'));
  await page.waitForSelector('#panel-settings:not([hidden])');
  await page.click('#s-nav button[data-go="plus"]');
  await page.waitForFunction(() => {
    const s1 = document.getElementById('plus-state1');
    return s1 && s1.offsetHeight > 0;
  }, null, { timeout: 5000 });
}

// Stub the signin-* POSTs for one scenario. Unroute first: a scenario runs on its
// own page, but be explicit so a future refactor onto a shared page cannot stack
// handlers (the #1615 flake).
async function routeScenario(page, steps, ownedRefusalFirst) {
  let refused = false;
  await page.unroute('**/api/remote/signin-**');
  await page.route('**/api/remote/signin-**', (route, req) => {
    const p = new URL(req.url()).pathname;
    if (ownedRefusalFirst && p === '/api/remote/signin-register' && !refused) {
      refused = true;
      route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'the coordinator said no (409): your account already owns the name ' + ownedRefusalFirst + '. This Mac signs in to that name; it cannot claim a different one here.' }) });
      return;
    }
    const body = steps[p];
    if (!body) { route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'no stub for ' + p }) }); return; }
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

const visible = (page, sel) => page.evaluate((s) => {
  const e = document.querySelector(s);
  return !!(e && e.getBoundingClientRect().height > 0 && !e.hidden);
}, sel);

(async () => {
  fleet.install([fleet.agent('april', { state: 'idle', displayName: 'April', role: 'a researcher' })]);
  const server = await srv.start(0);
  const URL = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    for (const key of Object.keys(SCENARIOS)) {
      const sc = SCENARIOS[key];
      const page = await browser.newPage({ viewport: { width: 1400, height: 950 }, colorScheme: 'light' });
      page.__url = URL;
      const errs = [];
      page.on('pageerror', (e) => errs.push(e.message));
      const regBodies = [];   // #3796 addendum 9: every register the wizard sends, including the automatic one
      page.on('request', (r) => { if (r.method() === 'POST' && /\/api\/remote\/signin-register$/.test(r.url())) regBodies.push(r.postDataJSON()); });
      await openPlusState1(page);
      await routeScenario(page, sc.steps, sc.ownedRefusalFirst);

      // Before the click: state 1 is on screen and the wizard is NOT. The click must
      // NOT navigate away (the whole bug was that it did).
      const beforeUrl = page.url();
      chk(await visible(page, '#plus-state1'), `[${key}] state 1 is on screen before the click`);
      chk(!(await visible(page, '#plus-si-email')), `[${key}] the wizard email step is hidden before the click`);

      const entry = sc.entry || 'plus-signin-top';
      await page.click('#' + entry);
      await page.waitForTimeout(300);  // give a real navigation a beat to begin, then assert none did
      chk(page.url() === beforeUrl, `[${key}] the #${entry} sign-in link did NOT navigate away`, page.url());
      await page.waitForSelector('#plus-si-email', { state: 'visible', timeout: 5000 });
      chk(!(await visible(page, '#plus-state1')), `[${key}] state 1 gives way to the wizard on the sign-in click`);

      // #12/#13 (once, on the first scenario): "Sign out" (#3796, was "Not now") hides the wizard
      // synchronously and returns to the marketing state, re-entering starts from a cleared field
      // rather than a stale one, and (#3796) it tells the engine to drop the held sign-in.
      if (key === 'existing-2fa') {
        await page.fill('#plus-signin-email', 'stale@example.com');
        chk((await page.textContent('#plus-si-cancel')).trim() === 'Cancel', `[${key}] #3796 addendum 4: on the email step (nothing started) the way out reads "Cancel"`, await page.textContent('#plus-si-cancel'));
        const cancelPost = page.waitForRequest((r) => r.method() === 'POST' && /\/api\/remote\/signin-cancel$/.test(r.url()), { timeout: 3000 }).then(() => true, () => false);
        await page.click('#plus-si-cancel');
        chk(await cancelPost, `[${key}] #3796 "Sign out" asks the engine to drop the held sign-in (POST signin-cancel)`);
        chk(await visible(page, '#plus-state1'), `[${key}] "Sign out" returns to the marketing state`);
        chk(!(await visible(page, '#plus-si-email')), `[${key}] "Sign out" hides the wizard`);
        await page.click('#' + entry);
        await page.waitForSelector('#plus-si-email', { state: 'visible', timeout: 5000 });
        const stale = await page.inputValue('#plus-signin-email');
        chk(stale === '', `[${key}] re-entering the wizard clears the stale field`, JSON.stringify(stale));
      }

      // #3796 (Josh, 14:00): the email step's copy, a 75% field, and the card centred vertically.
      // The card is centred in the room between the section's top and the window's bottom
      // (less the 32px foot margin plusSiMeasure leaves), so the gap above equals the gap below.
      const centred = () => page.evaluate(() => {
        const sec = document.getElementById('s-sec-plus').getBoundingClientRect();
        const c = document.getElementById('plus-state2').getBoundingClientRect();
        return { above: Math.round(c.top - sec.top), below: Math.round(innerHeight - 32 - c.bottom) };
      });
      if (key === 'existing-2fa') {
        const e = await page.evaluate(() => {
          const card = document.getElementById('plus-state2'); const cs = getComputedStyle(card);
          const inner = card.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
          return { h: card.querySelector('h3').textContent.trim(), label: document.querySelector('label[for="plus-signin-email"]').textContent.trim(),
            ratio: document.getElementById('plus-signin-email').getBoundingClientRect().width / inner,
            gone: !card.textContent.includes('You have Kosmos+') };
        });
        chk(e.h === 'Sign in to activate Kosmos+', `[${key}] #3796 the heading is "Sign in to activate Kosmos+"`, e.h);
        chk(e.label === 'Enter your Kosmos+ account email address', `[${key}] #3796 the email label`, e.label);
        chk(e.gone, `[${key}] #3796 the "You have Kosmos+..." line is gone`);
        chk(e.ratio > 0.7 && e.ratio < 0.8, `[${key}] #3796 the email field is about 75% of the card`, e.ratio.toFixed(3));
        const g = await centred();
        chk(g.above > 40 && Math.abs(g.above - g.below) <= 4, `[${key}] #3796 the email step's card is centred vertically`, JSON.stringify(g));
      }

      // Step: email -> code.
      await page.fill('#plus-signin-email', 'you@example.com');
      // #3596 (Josh, 0.6.91 QA): every Kosmos+ pane input (the wizard and the enrol flow) is
      // #14161a on #ffffff in both themes (the Kosmos+ skin once made typed text
      // white-on-white), and the button row sits a gap below the email field.
      // Scenario-independent, so once (like "Not now" above).
      const themeBefore = key === 'existing-2fa' ? await page.evaluate(() => document.documentElement.getAttribute('data-theme')) : null;
      for (const theme of key === 'existing-2fa' ? ['light', 'dark'] : []) {
        /* #3796 (Josh, 13:57): the WIZARD's fields are now the site's dark field ("not a white slab on
           navy"), light ink on #16223e; the enrol flow's (#plus-flow) stay #3596's white. Either way the
           typed text is readable in both themes, which is what #3596 guarded. */
        const r = await page.evaluate((t) => {
          document.documentElement.setAttribute('data-theme', t);
          const inputs = [...document.querySelectorAll('#s-sec-plus input.tk-inp')];
          const WANT = (i) => i.closest('#plus-state2') ? 'rgb(230, 235, 247) on rgb(22, 34, 62)' : 'rgb(20, 22, 26) on rgb(255, 255, 255)';
          const f = document.getElementById('plus-signin-email').getBoundingClientRect();
          const btn = document.getElementById('plus-signin-code').getBoundingClientRect();
          const probe = document.getElementById('plus-signin-email');
          probe.classList.add('bad');
          const badBorder = getComputedStyle(probe).borderTopColor;
          probe.classList.remove('bad');
          const okBorder = getComputedStyle(probe).borderTopColor;
          return { gap: btn.top - f.bottom, n: inputs.length, badBorder, okBorder,
            wiz: inputs.filter((i) => i.closest('#plus-state2')).length,
            /* #3942: a code field is transparent over its six boxes, so what the digits sit on is the
               boxes' fill: read that, not the input's own (now see-through) background. */
            bad: inputs.map((i) => { const c = getComputedStyle(i); const boxed = i.closest('.otp-boxes');
              const under = boxed ? getComputedStyle(boxed.querySelector('.otp-cell')).backgroundColor : c.backgroundColor;
              return { id: i.id, raw: c.color + ' on ' + under, want: WANT(i) }; })
              .filter((x) => x.raw !== x.want).map((x) => x.id + ': ' + x.raw) };
        }, theme);
        chk(r.n === 10, `[${key}] #3596 CONTROL: the Kosmos+ pane's 10 inputs were found (${theme})`, String(r.n));
        chk(r.badBorder !== r.okBorder, `[${key}] #3596 a field marked .bad still shows the error border (${theme})`, r.badBorder + ' vs ' + r.okBorder);
        chk(r.wiz === 7 && r.n - r.wiz === 3, `[${key}] #3796 CONTROL: 7 wizard inputs and 3 enrol-flow inputs (${theme})`, r.wiz + '/' + (r.n - r.wiz));
        chk(r.bad.length === 0, `[${key}] #3596/#3796 wizard inputs are light on #16223e, enrol-flow inputs #14161a on #ffffff (${theme})`, r.bad.join(' | '));
        chk(r.gap >= 8, `[${key}] #3596 a gap separates the email field from "Email me a code" (${theme})`, String(r.gap));
        /* #3841 (plus-rf-3796's review): render-fields cannot measure the wizard on its real ground (the navy
           card is scoped to body.plus-active and paints a gradient), so THIS check measures separation there:
           each wizard field's border, the secondary button's stroke, and every primary button's fill and edge,
           composited over BOTH of the card's gradient stops (#1b2c50, #0f1d38), at least 1.1:1 (render-fields'
           bar). A restyle that sets any of them to the card's own colour turns this red. */
        const sep = await page.evaluate(WIZ_SEP);
        const low = (xs) => xs.filter((x) => !(x.r >= 1.1)).map((x) => x.id + '=' + (x.r || 0).toFixed(2));
        chk(sep.fields.length === 7 && low(sep.fields).length === 0, `[${key}] #3841 every wizard field's border separates it from the navy card (${theme})`, sep.fields.length + ' ' + low(sep.fields).join(' '));
        chk(sep.sec.length >= 1 && low(sep.sec).length === 0, `[${key}] #3841 the secondary button's stroke separates it from the navy card (${theme})`, sep.sec.map((x) => x.id + '=' + x.r.toFixed(2)).join(' '));
        // The card named seven; addenda 4 and 9 added Start over (timed out) and Done (the landing). Every one counts.
        const named = ['plus-signin-code', 'plus-si-code-go', 'plus-si-second-go', 'plus-si-enrol-totp', 'plus-si-phone-go', 'plus-si-enrol-confirm-go', 'plus-si-register-go'];
        const primIds = sep.prim.map((x) => x.id);
        chk(named.every((id) => primIds.includes(id)) && low(sep.prim).length === 0, `[${key}] #3841 every primary button's FACE stands off the navy card (${theme})`, primIds.length + ' ' + low(sep.prim).join(' '));
        const lowEdge = sep.prim.filter((x) => !(x.edge >= 1.1)).map((x) => x.id + '=' + (x.edge || 0).toFixed(2));
        chk(lowEdge.length === 0, `[${key}] #3841 every primary button's edge stands off the navy card (${theme})`, lowEdge.join(' '));
      }
      if (key === 'existing-2fa') {
        await page.evaluate((v) => { if (v === null) document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', v); }, themeBefore);
      }
      await page.click('#plus-signin-code');
      await page.waitForSelector('#plus-si-code', { state: 'visible', timeout: 5000 });
      chk(true, `[${key}] email step advances to the code step`);
      if (key === 'existing-2fa') {
        // #3796 (Josh, 13:57): one short line, a compact six-digit field, a blue Verify, resend as a link.
        const c = await page.evaluate(() => {
          const inp = document.getElementById('plus-si-code-in'); const cs = getComputedStyle(inp);
          const go = getComputedStyle(document.getElementById('plus-si-code-go'));
          const rs = document.getElementById('plus-si-code-resend');
          const cells = Array.from(document.querySelectorAll('#plus-si-code .otp-cell')).map((x) => x.getBoundingClientRect());
          return { lead: document.querySelector('#plus-si-code .plus-si-lead').textContent.trim(),
            cells: cells.length, cellW: Math.min(...cells.map((r) => r.width)), cellH: Math.min(...cells.map((r) => r.height)),
            hidden: (document.querySelector('#plus-si-code .otp-cells') || { getAttribute: () => null }).getAttribute('aria-hidden'), fontPx: parseFloat(cs.fontSize),
            on: Array.from(document.querySelectorAll('#plus-si-code .otp-cell')).findIndex((x) => x.classList.contains('on')),
            mono: /mono|menlo/i.test(cs.fontFamily), otp: inp.getAttribute('autocomplete'), mode: inp.getAttribute('inputmode'),
            goBg: go.backgroundImage + ' ' + go.backgroundColor, rsTag: rs.tagName, rsText: rs.textContent.trim(),
            labelShown: document.querySelector('label[for="plus-si-code-in"]').getBoundingClientRect().width > 1 };
        });
        chk(c.lead === 'We sent a code to you@example.com. It works for 10 minutes.', `[${key}] #3796 the code step's one line names the email and how long the code works`, c.lead);
        chk((await page.textContent('#plus-si-cancel')).trim() === 'Start over', `[${key}] #3796 addendum 4: while a sign-in is in progress the way out reads "Start over"`, await page.textContent('#plus-si-cancel'));
        // #3942 (Josh, 2026-09-26) replaces #3796's compact field: one big box per digit.
        chk(c.cells === 6 && c.cellW >= 40 && c.cellH >= 48 && c.fontPx >= 26 && c.mono && c.hidden === 'true',
          `[${key}] #3942 the code is six big boxes (drawn for the eye, hidden from a screen reader), with big digits`, JSON.stringify(c));
        chk(c.on === 0, `[${key}] #3942 the first box is outlined while the field has focus`, String(c.on));
        chk(c.otp === 'one-time-code' && c.mode === 'numeric', `[${key}] #3796 the code field offers one-time-code autofill and a number pad`);
        chk(/58, 104, 216|47, 87, 196/.test(c.goBg) && !/227, 179, 65|245, 197/.test(c.goBg), `[${key}] #3796 Verify is Kosmos+ blue, not gold`, c.goBg);
        chk(c.rsTag === 'A' && c.rsText === 'Send again', `[${key}] #3796 resend is a small "Send again" link`, c.rsTag + ' ' + c.rsText);
        chk(!c.labelShown, `[${key}] #3796 the "code from the email" label is for screen readers only`);
        const g = await centred();
        chk(g.above > 40 && Math.abs(g.above - g.below) <= 4, `[${key}] #3796 the code step's card is centred vertically`, JSON.stringify(g));
      }

      // Step: email code -> the branch signin-verify chose. #3942: the sixth digit submits by itself,
      // so no click: reaching the next step below IS the auto-submit. The first scenario PASTES the
      // code with a space in it, as it arrives from an email, and counts the verify requests.
      if (key === 'existing-2fa') {
        let verifies = 0;
        const count = (r) => { if (r.method() === 'POST' && /\/api\/remote\/signin-verify$/.test(r.url())) verifies += 1; };
        page.on('request', count);
        await page.focus('#plus-si-code-in');
        await page.keyboard.insertText('123 45');
        const part = await page.evaluate(() => { const box = document.querySelector('#plus-si-code .otp-boxes');
          if (!box) return { v: document.getElementById('plus-si-code-in').value, on: -1, scroll: null, shift: null, boxes: false };   // a red, not a throw
          return { v: document.getElementById('plus-si-code-in').value,
            on: Array.from(document.querySelectorAll('#plus-si-code .otp-cell')).findIndex((x) => x.classList.contains('on')),
            scroll: box.scrollLeft + document.getElementById('plus-si-code-in').scrollLeft, shift: Math.round(box.querySelector('.otp-cell').getBoundingClientRect().left - box.getBoundingClientRect().left) }; });
        chk(part.v === '12345' && part.on === 5 && verifies === 0, `[${key}] #3942 five digits fill five boxes, outline the sixth, and do not submit yet`, JSON.stringify({ part, verifies }));
        chk(part.scroll === 0 && part.shift === 0, `[${key}] #3942 typing never scrolls the boxes sideways (the first box stays whole)`, JSON.stringify(part));
        if (process.env.SHOT_DIR || OUT) await page.screenshot({ path: path.join(OUT, `${key}-code-boxes-3942.png`) });
        await page.evaluate(() => { const i = document.getElementById('plus-si-code-in'); i.value = ''; i.dispatchEvent(new Event('input')); });
        await page.keyboard.insertText('123 456');   // one paste, space and all
        await page.waitForTimeout(300);
        chk(verifies === 1, `[${key}] #3942 one paste of "123 456" fills every box and submits exactly once`, String(verifies));
        page.off('request', count);
      } else {
        await page.fill('#plus-si-code-in', '123456');
      }

      const verifyStage = sc.steps['/api/remote/signin-verify'].stage;
      if (verifyStage === 'second') {
        await page.waitForSelector('#plus-si-second', { state: 'visible', timeout: 5000 });
        chk(true, `[${key}] verify -> the phone-code step is shown`);
        // #3796 addendum 3: an authenticator-only account is told about its authenticator, never a text,
        // and "Can't get a code?" opens the recovery line rather than dead-ending.
        const lead = (await page.textContent('#plus-si-second-lead')).trim();
        chk(lead === 'Enter the 6-digit code from your authenticator app.' && !/text/i.test(lead), `[${key}] #3796 the second step names the account's authenticator, not a text`, JSON.stringify(lead));
        chk(!(await visible(page, '#plus-si-second-recover')), `[${key}] #3796 CONTROL: the recovery line starts hidden`);
        await page.click('#plus-si-second-help');
        const rec = (await page.textContent('#plus-si-second-recover')).trim();
        chk((await visible(page, '#plus-si-second-recover')) && /I lost my phone/.test(rec), `[${key}] #3796 "Can't get a code?" opens the recovery path`, JSON.stringify(rec));
        await page.fill('#plus-si-second-in', '654321');   // #3942: auto-submits
      } else if (verifyStage === 'enrol_second_factor') {
        await page.waitForSelector('#plus-si-enrol', { state: 'visible', timeout: 5000 });
        chk(await visible(page, '#plus-si-enrol-sms'), `[${key}] verify -> set-up step offers text when sms_available`);
        const why = await page.textContent('#plus-si-enrol-why');
        chk(!!(why && why.trim()), `[${key}] the why-authenticator copy is rendered`, JSON.stringify(why));
        if (sc.smsEnrol) {
          // The text path: reveal the phone field, submit it, and confirm the code went to
          // the masked number the coordinator reports (exercises plusSiStage's non-totp lead
          // branch and the phone-go handler, which the totp path never touches).
          await page.click('#plus-si-enrol-sms');
          await page.waitForSelector('#plus-si-phone-field', { state: 'visible', timeout: 5000 });
          await page.fill('#plus-si-phone', '+15555550123');
          await page.click('#plus-si-phone-go');
          await page.waitForSelector('#plus-si-enrol-confirm', { state: 'visible', timeout: 5000 });
          const lead = await page.textContent('#plus-si-enrol-lead');
          const sentTo = sc.steps['/api/remote/signin-enrol'].sent_to;
          chk(!!(lead && lead.includes(sentTo)), `[${key}] the texted-code lead names the masked number`, JSON.stringify(lead));
          chk(!(await visible(page, '#plus-si-secret-field')), `[${key}] the authenticator key field is hidden on the text path`);
        } else {
          await page.click('#plus-si-enrol-totp');
          await page.waitForSelector('#plus-si-enrol-confirm', { state: 'visible', timeout: 5000 });
          const secret = await page.inputValue('#plus-si-secret');
          chk(secret === 'ABCD1234EFGH5678', `[${key}] the authenticator key is shown to type in`, JSON.stringify(secret));
        }
        await page.fill('#plus-si-enrol-code', '111222');   // #3942: auto-submits
      }

      // Step: session -> name -> hand off to the connected flow.
      /* #3796 addendum 9 (Josh's ruling): the landing, shared by the two owned-address paths. */
      const landed = async (addr, why) => {
        /* #3796 addendum 10 (Josh's ruling): the heading and ONE line, no address, no Copy, no tiles. */
        await page.waitForSelector('#plus-si-done', { state: 'visible', timeout: 5000 });
        const d = await page.evaluate(() => ({ title: document.getElementById('plus-si-title').textContent.trim(), text: document.getElementById('plus-si-done').innerText.replace(/\s+/g, ' ').trim(), buttons: document.querySelectorAll('#plus-si-done button').length, nameShown: !!(document.getElementById('plus-si-register') && !document.getElementById('plus-si-register').hidden), msg: document.getElementById('plus-signin-msg').textContent.trim() }));
        chk(d.title === "You're signed in to Kosmos+" && d.text === 'To use Kosmos on another device, sign in at login.kosmosplus.com. Done' && d.buttons === 1 && !d.nameShown && !/409|said no/.test(d.msg), `[${key}] #3796 addenda 9 and 10: ${why} lands on "You're signed in to Kosmos+" and one line`, JSON.stringify(d));
      };
      if (key === 'straight-session') {
        await landed('quiet-heron.kosmosplus.com', 'an account with an address skips the address step and');
        chk(regBodies.length === 1 && regBodies[0].name === 'quiet-heron', `[${key}] #3796 addendum 9: it registers the account's own name by itself, once`, JSON.stringify(regBodies));
      } else {
        await page.waitForSelector('#plus-si-register', { state: 'visible', timeout: 5000 });
        chk(true, `[${key}] the flow reaches the name step (a session)`);
        chk((await page.textContent('#plus-si-cancel')).trim() === 'Sign out', `[${key}] #3796 addendum 4: once the sign-in has finished (a held session) the way out reads "Sign out"`, await page.textContent('#plus-si-cancel'));
      }
      // The engine writes this computer's state dir SYNCHRONOUSLY before answering register,
      // so the machine reads enrolled immediately after. Flip /api/remote to enrolled BEFORE
      // the register click, so the post-register paintPlus() exercises the REAL end state:
      // the connected flow with the address. Leaving the mock permanently unenrolled (the
      // earlier shape) let a "done panel" assertion pass precisely because it never drove the
      // repaint the wizard actually performs -- false coverage of the one step most likely to
      // regress. status.state:'up' so the flow's status line renders the address now.
      const wantAddr = sc.steps['/api/remote/signin-register'].address;
      await page.unroute('**/api/remote');
      await page.route('**/api/remote', (route, req) => {
        const m = req.method();
        if (m === 'GET' || m === 'HEAD') {
          route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
            configured: true, on: true, ok: true, enrolled: true, email: 'you@example.com',
            status: { state: 'up', address: wantAddr } }) });
        } else { route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); }
      });
      if (key === 'existing-2fa') {
        /* #3796 addenda 5 and 6 (Josh typed "MacbookPro..." and was refused for capitals): the name is cleaned
           as typed, and the cleaned name is what the register request carries. */
        // #3842: the chooser arrives with a private suggestion that can be saved as is, and says so.
        const sug = await page.evaluate(() => ({ v: document.getElementById('plus-si-name').value, note: !document.getElementById('plus-si-name-suggested').hidden, save: !document.getElementById('plus-si-register-go').disabled }));
        chk(/^[abcdefghjkmnpqrstuvwxyz23456789]{8}$/.test(sug.v) && sug.note && sug.save, `[${key}] #3842 the address chooser arrives with a private suggestion`, JSON.stringify(sug));
        await page.fill('#plus-si-name', '');
        await page.type('#plus-si-name', 'Sunny Otter');
        chk((await page.inputValue('#plus-si-name')) === 'sunny-otter', `[${key}] #3796 addenda 5 and 6: a name typed with capitals and a space is cleaned as typed`, await page.inputValue('#plus-si-name'));
        chk((await page.textContent('#plus-si-name-count')).trim() === '11/32', `[${key}] #3796 addendum 7: the 32 limit shows as a live count`, await page.textContent('#plus-si-name-count'));
        const regReq = page.waitForRequest((r) => r.method() === 'POST' && /\/api\/remote\/signin-register$/.test(r.url()), { timeout: 5000 }).then((r) => r.postDataJSON(), () => null);
        await page.click('#plus-si-register-go');
        const body = await regReq;
        chk(body && body.name === 'sunny-otter', `[${key}] #3796 addenda 5 and 6: register sends the cleaned name`, JSON.stringify(body));
        chk((await page.textContent('label[for="plus-si-name"]')).trim() === 'Choose your Kosmos+ address', `[${key}] #3796 addendum 8: with no address yet, the step reads "Choose your Kosmos+ address"`);
      } else if (key === 'straight-session') {
        // Landed above; nothing to type.
      } else if (sc.ownedRefusalFirst) {
        // #3796 addendum 9 on a coordinator that does not send account_address yet: its refusal names the owned
        // name, and the wizard registers to that one by itself.
        await page.fill('#plus-si-name', 'something-else');
        await page.click('#plus-si-register-go');
        await landed(sc.ownedRefusalFirst, '"already owns the name"');
        chk(regBodies.length === 2 && regBodies[1].name === sc.ownedRefusalFirst, `[${key}] #3796 addendum 9: after the refusal it registers the owned name by itself`, JSON.stringify(regBodies));
      } else {
        await page.fill('#plus-si-name', sc.steps['/api/remote/signin-register'].name);
        await page.click('#plus-si-register-go');
      }
      if (await visible(page, '#plus-si-done')) {
        // #3796 addendum 9: the landing holds the pane (the 5s tick must not take it), until Done.
        /* Force the repaint the 5s tick would do (with /api/remote now reading enrolled): it must not take the pane. */
        await page.evaluate(() => paintPlus());
        await page.waitForTimeout(400);
        chk(await visible(page, '#plus-si-done') && !(await visible(page, '#plus-flow')), `[${key}] #3796 addendum 9: the landing stays up through a repaint until Done`);
        await page.click('#plus-si-done-go');
      }
      // The wizard hands off to the connected flow: state 2 gone, flow shown, address in
      // its status line -- the same success screen the enrol flow ends on.
      await page.waitForSelector('#plus-flow', { state: 'visible', timeout: 5000 });
      // #3829: the connected panel shows the address in its chip (the status line is now the one plain sentence).
      const flowStatus = await page.textContent('#plus-chip-addr');
      chk(!!(flowStatus && flowStatus.includes(wantAddr)), `[${key}] done: the connected flow shows the new address`, JSON.stringify(flowStatus));
      chk(!(await visible(page, '#plus-state2')), `[${key}] the wizard hands off to the connected flow after register`);
      await page.screenshot({ path: path.join(OUT, `plus-signin-${key}.png`), fullPage: false });

      chk(errs.length === 0, `[${key}] no page errors`, errs.join(' | '));
      await page.close();
    }
    /* #3841 (review): the same separation, in WebKit too. The card's colours come back through
       getComputedStyle, and gradient serialisation is exactly what can differ between engines. */
    {
      let wk = null;
      try { wk = await require('playwright').webkit.launch({ headless: process.env.HEADED === '0' }); }
      catch (e) { chk(false, '[webkit] #3841 WebKit could not start: ' + (e && e.message ? e.message.split('\n')[0] : e)); }
      if (wk) {
        try {
          const page = await wk.newPage({ viewport: { width: 1400, height: 950 } });
          page.__url = URL;
          await openPlusState1(page);
          await page.click('#plus-signin-top');
          await page.waitForSelector('#plus-si-email', { state: 'visible', timeout: 5000 });
          for (const theme of ['light', 'dark']) {
            await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
            const sep = await page.evaluate(WIZ_SEP);
            const low = (xs, k) => xs.filter((x) => !(x[k] >= 1.1)).map((x) => x.id + '=' + (x[k] || 0).toFixed(2));
            chk(sep.fields.length === 7 && !low(sep.fields, 'r').length && sep.sec.length >= 1 && !low(sep.sec, 'r').length, `[webkit] #3841 field borders and the secondary stroke separate on the navy card (${theme})`, low(sep.fields, 'r').concat(low(sep.sec, 'r')).join(' '));
            chk(sep.prim.length >= 7 && !low(sep.prim, 'r').length && !low(sep.prim, 'edge').length, `[webkit] #3841 primary faces and edges separate on the navy card (${theme})`, low(sep.prim, 'r').concat(low(sep.prim, 'edge')).join(' '));
          }
          await page.close();
        } finally { await wk.close(); }
      }
    }
    /* #3796 (review): Sign out while work is still in flight. The engine side is engine/remote.test.js; this
       is what the person SEES. (1) A verify that answers AFTER Sign out must not move the next sign-in to a
       step. (2) A resend cooldown running at Sign out must not keep writing into the next sign-in's status
       line. (3) A secondary button on navy carries a visible stroke. */
    {
      const k = 'sign-out-in-flight';
      const page = await browser.newPage({ viewport: { width: 1400, height: 950 }, colorScheme: 'light' });
      page.__url = URL;
      const errs = [];
      page.on('pageerror', (e) => errs.push(e.message));
      await openPlusState1(page);
      let startAnswer = { status: 200, body: { ok: true, stage: 'code_sent' } };
      await page.route('**/api/remote/signin-**', async (route, req) => {
        const p = req.url().replace(/^.*\/api\/remote\//, '');
        if (p === 'signin-verify') { await new Promise((r) => setTimeout(r, 1500)); route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, stage: 'second' }) }); return; }
        if (p === 'signin-start') { route.fulfill({ status: startAnswer.status, contentType: 'application/json', body: JSON.stringify(startAnswer.body) }); return; }
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, stage: 'enrol_second_factor', sms_available: true }) });
      });
      const enter = async () => { await page.click('#plus-signin-top'); await page.waitForSelector('#plus-si-email', { state: 'visible', timeout: 5000 }); };
      await enter();
      await page.fill('#plus-signin-email', 'you@example.com');
      await page.click('#plus-signin-code');
      await page.waitForSelector('#plus-si-code', { state: 'visible', timeout: 5000 });
      await page.fill('#plus-si-code-in', '123456');   // #3942: auto-submits; verify now in flight for 1.5s
      const startOverPost = page.waitForRequest((r) => r.method() === 'POST' && /\/api\/remote\/signin-cancel$/.test(r.url()), { timeout: 3000 }).then(() => true, () => false);
      await page.click('#plus-si-cancel');            // "Start over" (addendum 4)
      chk(await startOverPost, `[${k}] #3796 addendum 4: Start over drops the held sign-in (POST signin-cancel)`);
      await page.waitForSelector('#plus-si-email', { state: 'visible', timeout: 5000 });
      chk((await page.inputValue('#plus-signin-email')) === 'you@example.com', `[${k}] #3796 addendum 4: Start over returns to the email step with the email kept`, await page.inputValue('#plus-signin-email'));
      await page.waitForTimeout(2200);                 // past the late answer
      chk(await visible(page, '#plus-si-email') && !(await visible(page, '#plus-si-second')), `[${k}] #3796 a verify answering after Sign out does not move the next sign-in to a step`);
      chk(!(await page.isDisabled('#plus-signin-code')), `[${k}] #3796 after Sign out mid-request, the next sign-in's button is live`);
      // A cooldown running at Sign out.
      await page.fill('#plus-signin-email', 'you@example.com');
      await page.click('#plus-signin-code');
      await page.waitForSelector('#plus-si-code', { state: 'visible', timeout: 5000 });
      startAnswer = { status: 400, body: { error: 'you can ask for another code in 30 seconds' } };
      await page.click('#plus-si-code-resend');
      await page.waitForTimeout(300);
      const held = await page.getAttribute('#plus-si-code-resend', 'aria-disabled');
      chk(held === 'true', `[${k}] #3796 CONTROL: the resend link is held during a cooldown`, String(held));
      await page.click('#plus-si-cancel');            // Start over
      await page.waitForSelector('#plus-si-email', { state: 'visible', timeout: 5000 });
      await page.waitForTimeout(1500);                  // a surviving tick would have written by now
      const msg = (await page.textContent('#plus-signin-msg')).trim();
      chk(msg === '', `[${k}] #3796 a cooldown running at Sign out does not write into the next sign-in`, JSON.stringify(msg));
      chk((await page.getAttribute('#plus-si-code-resend', 'aria-disabled')) === null, `[${k}] #3796 the next sign-in's resend link is not left held`);
      /* #3796 addendum 4: a sign-in the coordinator has ended (401 "... start again from the email") gives way
         to the timed-out panel: no raw server text, no Verify, a Start over that keeps the email. A wrong code
         (also a 401, different words) stays on the step so the person can retype. */
      await page.unroute('**/api/remote/signin-**');
      let verifyAnswer = { status: 400, body: { error: 'the coordinator said no (401): that code is not right' } };
      await page.route('**/api/remote/signin-**', (route, req) => {
        const p = req.url().replace(/^.*\/api\/remote\//, '');
        if (p === 'signin-verify') { route.fulfill({ status: verifyAnswer.status, contentType: 'application/json', body: JSON.stringify(verifyAnswer.body) }); return; }
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, stage: 'code_sent' }) });
      });
      await page.fill('#plus-signin-email', 'you@example.com');
      await page.click('#plus-signin-code');
      await page.waitForSelector('#plus-si-code', { state: 'visible', timeout: 5000 });
      await page.fill('#plus-si-code-in', '111111');   // #3942: auto-submits
      await page.waitForTimeout(400);
      /* #3942: with all six digits in (the step stays, the code was wrong), the digits must still sit
         over their boxes: the spacing after the sixth would scroll the field's text unless reset. */
      await page.focus('#plus-si-code-in');
      const six = await page.evaluate(() => ({ scroll: document.getElementById('plus-si-code-in').scrollLeft,
        on: Array.from(document.querySelectorAll('#plus-si-code .otp-cell')).findIndex((x) => x.classList.contains('on')) }));
      chk(six.scroll === 0 && six.on === 5, `[${k}] #3942 with all six digits in, they stay over their boxes and the last box is outlined`, JSON.stringify(six));
      chk((await visible(page, '#plus-si-code-go')) && !(await visible(page, '#plus-si-expired')), `[${k}] #3796 CONTROL: a wrong code stays on the step to retype`);
      verifyAnswer = { status: 400, body: { error: 'Kosmos+ said no (401): that sign-in has expired or was already finished; start again from the email' } };
      await page.click('#plus-si-code-go');
      await page.waitForSelector('#plus-si-expired', { state: 'visible', timeout: 5000 });
      const exp = { words: (await page.textContent('#plus-si-expired-words')).trim(), msg: (await page.textContent('#plus-signin-msg')).trim(), verify: await visible(page, '#plus-si-code-go') };
      chk(await page.evaluate(() => document.activeElement && document.activeElement.id === 'plus-si-expired-go'), `[${k}] #3796 review: the timed-out panel takes the focus (its Verify is gone)`);
      chk(exp.words === "That sign-in timed out. Start over and we'll send a new code." && !/401|said no/.test(exp.msg + exp.words) && !exp.verify, `[${k}] #3796 addendum 4: an expired sign-in says it timed out, with no raw error and no Verify`, JSON.stringify(exp));
      await page.click('#plus-si-expired-go');
      await page.waitForSelector('#plus-si-email', { state: 'visible', timeout: 5000 });
      chk((await page.inputValue('#plus-signin-email')) === 'you@example.com', `[${k}] #3796 addendum 4: the panel's Start over returns to the email step with the email kept`);
      /* #3796 review: an automatic register that fails (a second computer on a web-named account is refused
         today) is not a dead end: it says so and offers Try again, which registers the owned name again. */
      await page.unroute('**/api/remote/signin-**');
      let regTries = 0;
      await page.route('**/api/remote/signin-**', (route, req) => {
        const p = req.url().replace(/^.*\/api\/remote\//, '');
        if (p === 'signin-verify') { route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, stage: 'session', account_address: 'twin-mac.kosmosplus.com' }) }); return; }
        if (p === 'signin-register') {
          regTries += 1;
          if (regTries === 1) { route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'the name twin-mac is already connected on another computer' }) }); return; }
          route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, stage: 'registered', address: 'twin-mac', name: 'twin-mac', standing: 'active' }) }); return;
        }
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, stage: 'code_sent' }) });
      });
      await page.fill('#plus-signin-email', 'you@example.com');
      await page.click('#plus-signin-code');
      await page.waitForSelector('#plus-si-code', { state: 'visible', timeout: 5000 });
      await page.fill('#plus-si-code-in', '123456');   // #3942: auto-submits
      await page.waitForSelector('#plus-si-register-go', { state: 'visible', timeout: 5000 });
      const f = await page.evaluate(() => ({ lead: document.getElementById('plus-si-owned').textContent.trim(), btn: document.getElementById('plus-si-register-go').textContent.trim(), msg: document.getElementById('plus-signin-msg').textContent.trim() }));
      chk(/could not connect as twin-mac\.kosmosplus\.com/.test(f.lead) && f.btn === 'Try again' && /already connected/.test(f.msg), `[${k}] #3796 review: a failed automatic register says so and offers Try again`, JSON.stringify(f));
      await page.click('#plus-si-register-go');
      await page.waitForSelector('#plus-si-done', { state: 'visible', timeout: 5000 });
      chk(regTries === 2, `[${k}] #3796 review: Try again registers the owned name again and lands`, String(regTries));
      await page.evaluate(() => { PLUS_SI_LANDED = false; });
      await page.click('#plus-si-done-go');
      await page.waitForTimeout(300);
      if (!(await visible(page, '#plus-si-email'))) { await page.evaluate(() => { const s1 = document.getElementById('plus-state1'); if (s1 && !s1.hidden) document.getElementById('plus-signin-top').click(); }); await page.waitForSelector('#plus-si-email', { state: 'visible', timeout: 5000 }); }
      // The stroke on a secondary button (the enrol step's "Text me the codes").
      startAnswer = { status: 200, body: { ok: true, stage: 'code_sent' } };
      await page.unroute('**/api/remote/signin-**');
      await page.route('**/api/remote/signin-**', (route, req) => {
        const p = req.url().replace(/^.*\/api\/remote\//, '');
        const body = p === 'signin-start' ? { ok: true, stage: 'code_sent' } : { ok: true, stage: 'enrol_second_factor', sms_available: true, why_authenticator: 'x' };
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      });
      await page.fill('#plus-signin-email', 'you@example.com');
      await page.click('#plus-signin-code');
      await page.waitForSelector('#plus-si-code', { state: 'visible', timeout: 5000 });
      await page.fill('#plus-si-code-in', '123456');   // #3942: auto-submits
      await page.waitForSelector('#plus-si-enrol-sms', { state: 'visible', timeout: 5000 });
      const stroke = await page.evaluate(() => { const c = getComputedStyle(document.getElementById('plus-si-enrol-sms')); return { w: c.borderTopWidth, col: c.borderTopColor, style: c.borderTopStyle }; });
      const alpha = /rgba\([^)]*,\s*([\d.]+)\)/.exec(stroke.col);
      chk(stroke.style === 'solid' && parseFloat(stroke.w) >= 1 && (!alpha || parseFloat(alpha[1]) >= 0.2), `[${k}] #3796 a secondary button on navy has a visible stroke`, JSON.stringify(stroke));
      chk(errs.length === 0, `[${k}] no page errors`, errs.join(' | '));
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
    fleet.restore();
  }
  console.log('screenshots: ' + OUT);
  if (fail.length) { console.log('\n' + fail.length + ' FAILED'); process.exit(1); }
  console.log('\nall passed');
})().catch((e) => { console.error(e); process.exit(2); });
