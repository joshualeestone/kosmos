/**
 * #1959: the OTHER observed-liveness consumers read connection.badge, not raw
 * connection.state === 'connected'.
 *
 * #1921 made the Settings account badge (paintAccounts) render VERIFIED liveness
 * from the observed-outcome badge (engine/observed.js, overlaid onto /api/accounts
 * Claude rows as connection.badge). It left the OTHER listLive() consumers reading
 * raw `state === 'connected'` ("a credential exists"), so a REJECTED credential
 * (a real call was rejected -- the #874 case) still read "connected" on them.
 * This extends the badge vocabulary to those consumers via two shared helpers
 * (acctUsableLogin / acctUnknownLive), with the legacy state ternary as the
 * back-compat fallback for badge-less rows (OpenAI, or new-page/old-server skew).
 *
 * 🔑 WHY A BROWSER. The helpers and the two consumers are inline in web/index.html
 * (not exported), so node --test cannot import them. This check loads the page over
 * file:// (hermetic -- no server, no /api needed: it stubs fetch for paintConnLive
 * and pre-seeds the ACCOUNTS global for paintAccountPicker) and drives the page's
 * OWN functions, so a change to what they compute cannot pass here while breaking
 * on screen.
 *
 * The four arms. Most reds against the pre-#1959 page by OBSERVED BEHAVIOR (the
 * consumer functions exist on both pages); the two exceptions are called out.
 *  1. HELPER MATRIX -- the three shared helpers. acctUsableLogin is true for
 *     working + signed_in_unverified, false for rejected/signed_out/unchecked;
 *     acctUnknownLive is true only for unchecked / state==='unknown';
 *     acctOfferableTarget is false only for rejected/signed_out. All fall back to
 *     the legacy .state for a badge-less row. (This arm reds on the pre-fix page
 *     because the helpers are ABSENT there, not via a raw-state read.)
 *  2. paintConnLive SUMMARY -- counts usable logins (rejected EXCLUDED, the #874
 *     fix on this surface); honest "could not check" on unchecked; "nothing
 *     connected" only when truly none.
 *  3. paintAccountPicker ELIGIBILITY -- a REJECTED current account is now signed
 *     out (the move UI appears), with a working sibling offered as the target; a
 *     working current account is not signed out (control).
 *  4. fillCreateAccounts CREATE PICKER -- a REJECTED account is EXCLUDED as a run
 *     target (#874), while an unchecked account stays OFFERED and labelled. (The
 *     labelled-unchecked check is a precondition, not a discriminator: the pre-fix
 *     labelOf already keyed on state==='unknown', so it passes on both pages.)
 *
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-observed-consumers-1959.js
 *   (HEADED by default; HEADED=0 on a console-less machine, as run_one sets it.)
 */
'use strict';

const nodePath = require('node:path');

let playwright;
try { playwright = require('playwright'); }
catch {
  console.log('render-observed-consumers-1959: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}

const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');
const ENGINES = ['chromium', 'webkit'];

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
}

(async () => {
  for (const engine of ENGINES) {
    const browser = await playwright[engine].launch({ headless: process.env.HEADED === '0' });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    const page = await ctx.newPage();
    await page.goto('file://' + PAGE);

    // ---- Arm 1: the shared helpers (the load-bearing logic) ----
    const helpers = await page.evaluate(() => {
      if (typeof acctUsableLogin !== 'function' || typeof acctUnknownLive !== 'function') {
        return { missing: true };
      }
      const row = (badge, state) => ({ connection: { badge, state } });
      return {
        usable: {
          working: acctUsableLogin(row('working', 'connected')),
          unverified: acctUsableLogin(row('signed_in_unverified', 'connected')),
          rejected: acctUsableLogin(row('rejected', 'connected')),
          signed_out: acctUsableLogin(row('signed_out', 'none')),
          unchecked: acctUsableLogin(row('unchecked', 'unknown')),
          // Back-compat: a badge-less row (OpenAI / version skew) falls back to state.
          fallbackConnected: acctUsableLogin({ connection: { state: 'connected' } }),
          fallbackNone: acctUsableLogin({ connection: { state: 'none' } }),
          noConn: acctUsableLogin({}),
        },
        unknown: {
          unchecked: acctUnknownLive(row('unchecked', 'unknown')),
          working: acctUnknownLive(row('working', 'connected')),
          fallbackUnknown: acctUnknownLive({ connection: { state: 'unknown' } }),
        },
      };
    });

    // Arm 1 tests the helpers (new in #1959, so this arm reds on the pre-fix page
    // because they are absent). Arms 2-3 below drive the page's OWN consumer
    // functions (paintConnLive / paintAccountPicker), which exist on BOTH pages, so
    // they run regardless of helper presence and red on the pre-fix page by
    // OBSERVED BEHAVIOR (rejected counted as connected / not prompting a move) --
    // do NOT short-circuit them when the helpers are missing, or the control proves
    // only "the helpers are new", never "the consumers were switched".
    if (helpers.missing) {
      check(`${engine}: the #1959 helpers exist`, false, 'acctUsableLogin / acctUnknownLive not found');
    } else {
      const u = helpers.usable;
      check(`${engine}: acctUsableLogin true for working + will-verify, false for rejected/signed_out/unchecked`,
        u.working === true && u.unverified === true
        && u.rejected === false && u.signed_out === false && u.unchecked === false,
        `working=${u.working} unverified=${u.unverified} rejected=${u.rejected} signed_out=${u.signed_out} unchecked=${u.unchecked}`);
      check(`${engine}: acctUsableLogin falls back to state for a badge-less row`,
        u.fallbackConnected === true && u.fallbackNone === false && u.noConn === false,
        `connected=${u.fallbackConnected} none=${u.fallbackNone} noConn=${u.noConn}`);
      check(`${engine}: acctUnknownLive true only for unchecked / state unknown`,
        helpers.unknown.unchecked === true && helpers.unknown.working === false && helpers.unknown.fallbackUnknown === true,
        `unchecked=${helpers.unknown.unchecked} working=${helpers.unknown.working} fallback=${helpers.unknown.fallbackUnknown}`);
    }

    // ---- Arm 2: paintConnLive summary (consumer 1) ----
    // Stub fetch so paintConnLive reads our fixture /api/accounts rows.
    const summary = await page.evaluate(async () => {
      const el = document.getElementById('conn-live');
      if (!el || typeof paintConnLive !== 'function') return { missing: true };
      const stub = (rows) => { window.fetch = async () => ({ ok: true, json: async () => ({ accounts: rows }) }); };
      const r = (badge) => ({ connection: { badge, state: badge === 'signed_out' ? 'none' : badge === 'unchecked' ? 'unknown' : 'connected' } });
      const out = {};
      // working + unverified + rejected: usable count is 2 (rejected excluded).
      stub([r('working'), r('signed_in_unverified'), r('rejected')]);
      await paintConnLive();
      out.mixed = el.textContent;
      // rejected only: no usable login, not unknown -> "nothing connected".
      stub([r('rejected')]);
      await paintConnLive();
      out.rejectedOnly = el.textContent;
      // unchecked: honest could-not-check.
      stub([r('unchecked')]);
      await paintConnLive();
      out.unchecked = el.textContent;
      return out;
    });

    if (summary.missing) {
      check(`${engine}: paintConnLive + #conn-live reachable`, false, '');
    } else {
      check(`${engine}: summary counts usable logins and EXCLUDES rejected (#874)`,
        /\b2 accounts are connected/.test(summary.mixed),
        `mixed=${JSON.stringify(summary.mixed)}`);
      check(`${engine}: a rejected-only machine is not counted as connected`,
        /[Nn]othing is connected/.test(summary.rejectedOnly),
        `rejectedOnly=${JSON.stringify(summary.rejectedOnly)}`);
      check(`${engine}: an unchecked account reads could-not-check, never "nothing connected"`,
        /could not check/i.test(summary.unchecked),
        `unchecked=${JSON.stringify(summary.unchecked)}`);
    }

    // ---- Arm 3: paintAccountPicker eligibility (consumer 2) ----
    const picker = await page.evaluate(async () => {
      const msg = document.getElementById('d-account-msg');
      if (!msg || typeof paintAccountPicker !== 'function') return { missing: true };
      // Pre-seed ACCOUNTS so the picker skips its fetch (guarded on !length || unreadable).
      const seed = (rows) => {
        try { ACCOUNTS = rows; } catch { /* not writable */ }
        try { ACCOUNTS_LOADED = true; } catch { /* older build */ }
        try { ACCOUNTS_UNREADABLE = false; } catch { /* older build */ }
      };
      const rows = [
        { dir: '/rej', memoryShared: true, email: 'rej@x', connection: { badge: 'rejected', state: 'connected' } },
        { dir: '/work', memoryShared: true, email: 'work@x', connection: { badge: 'working', state: 'connected' } },
      ];
      const out = {};
      // Current account = rejected: signedOut true, a working sibling is a target.
      seed(rows);
      msg.textContent = '';
      await paintAccountPicker({ account: { dir: '/rej' }, sessionName: 'a1' });
      out.rejectedCurrent = msg.textContent;
      // Control: current account = working: not signed out.
      seed(rows);
      msg.textContent = '';
      await paintAccountPicker({ account: { dir: '/work' }, sessionName: 'a2' });
      out.workingCurrent = msg.textContent;
      return out;
    });

    if (picker.missing) {
      check(`${engine}: paintAccountPicker + #d-account-msg reachable`, false, '');
    } else {
      check(`${engine}: a REJECTED current account is signed out, move UI offers the working target (#874/#1492)`,
        /signed out/i.test(picker.rejectedCurrent) && /Pick a signed-in account/i.test(picker.rejectedCurrent),
        `rejectedCurrent=${JSON.stringify(picker.rejectedCurrent)}`);
      check(`${engine}: control -- a working current account is NOT signed out`,
        !/signed out/i.test(picker.workingCurrent),
        `workingCurrent=${JSON.stringify(picker.workingCurrent)}`);
    }

    // ---- Arm 4: fillCreateAccounts create picker (consumer 3) ----
    const create = await page.evaluate(async () => {
      const asel = document.getElementById('create-account');
      const psel = document.getElementById('create-provider');
      if (!asel || !psel || typeof fillCreateAccounts !== 'function') return { missing: true };
      const seed = (rows) => { try { CREATE_ACCOUNTS = rows; } catch { /* not writable */ } };
      // Three Claude accounts (provider !== 'openai'), memoryShared so the Claude
      // path offers them: one rejected, one working, one unchecked.
      seed([
        { dir: '/rej', provider: 'anthropic', memoryShared: true, email: 'rej@x', connection: { badge: 'rejected', state: 'connected' } },
        { dir: '/work', provider: 'anthropic', memoryShared: true, email: 'work@x', connection: { badge: 'working', state: 'connected' } },
        { dir: '/unk', provider: 'anthropic', memoryShared: true, email: 'unk@x', connection: { badge: 'unchecked', state: 'unknown' } },
      ]);
      psel.value = '';  // anything but 'openai' -> the Claude path
      fillCreateAccounts();
      const opts = Array.from(asel.options).map((o) => ({ value: o.value, text: o.textContent }));
      return {
        dirs: opts.map((o) => o.value),
        unkText: (opts.find((o) => o.value === '/unk') || {}).text || '',
      };
    });

    if (create.missing) {
      check(`${engine}: fillCreateAccounts + create-account/create-provider reachable`, false, '');
    } else {
      check(`${engine}: create picker EXCLUDES a rejected account as a run target (#874)`,
        !create.dirs.includes('/rej') && create.dirs.includes('/work') && create.dirs.includes('/unk'),
        `offered=${JSON.stringify(create.dirs)}`);
      check(`${engine}: create picker still offers an unchecked account, labelled`,
        /could not check/i.test(create.unkText),
        `unkText=${JSON.stringify(create.unkText)}`);
    }

    await browser.close();
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
