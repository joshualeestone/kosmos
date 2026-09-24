// Browser-check-surface: d-say-count pj-post-count cpost-count
/* #3403 (Josh: raise the message cap, "it just cut off mid-message with no
 * warning"): the cap is now 10000, and a SOFT near-limit counter appears in the
 * last stretch before it so the cap is never a silent cutoff. This drives the two
 * REAL multi-line message composers -- the agent Talk box (#d-say) in both themes,
 * and the project room box (#pj-post) once -- and asserts the counter's facts:
 *   - it is HIDDEN far from the cap (soft, not chrome in the common case),
 *   - it APPEARS within 500 of the cap with the right remaining count,
 *   - it turns AMBER within 100, a computed-colour change only a browser can see,
 *   - and it LAYS OUT on its own line below the input row -- a real geometry read.
 *     .composerbox is display:flex with no wrap, so the counter is a BLOCK sibling
 *     AFTER the box, not a child; a text-only check would pass on a squished
 *     inline counter, so the geometry arm is what proves the placement.
 *
 * 🔑 THE SETUP CONTROL IS THE WHOLE TEST. "The counter shows N left" is vacuous
 * unless, one arm earlier, the same composer showed NOTHING while far from the
 * cap. The far-from-cap HIDDEN arm is asserted before the near arms and named,
 * so a failure says which half broke: a counter stuck on would pass every
 * "shows N" arm while being exactly the always-there chrome this design avoids.
 *
 * 🔑 AND ONE ARM TYPES REAL KEYS across the threshold, because every other arm
 * sets `value` and fires a synthetic `input`. That proves the SHIPPED d-say
 * input listener drives the counter (through pjGrowComposer -> pjComposerCount),
 * not just this script's own dispatched event.
 *
 * ⚠️ Why a browser check and not a JSDOM source test: the amber switch is a
 * COMPUTED colour and the appearance is `hidden` -> `display`, neither of which
 * JSDOM lays out or resolves. A source-regex test reads the rule text; only a
 * real browser reads that the rule WON and what colour it painted.
 *
 * Run: NODE_PATH=$HOME/work/pw-runtime/node_modules node docs/browser-checks/render-msg-counter-3403.js
 *      (HEADED=0 on a machine with no console session)
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const REPO = path.resolve(__dirname, '..', '..');
const freePort = () => Number(require('node:child_process').execFileSync(process.execPath,
  ['-e', "const s=require('node:net').createServer();s.listen(0,()=>{console.log(s.address().port);s.close();});"]).toString().trim());
const PORT = freePort();
const MAX = 10000;           // must track d-say's maxlength; asserted below as a control
const SOFT_AT = 500;         // must track SOFT_COUNT_AT in web/index.html
const NEAR_AT = 100;         // must track COUNT_NEAR_AT in web/index.html

let failures = 0, ran = 0;
const ok = (n, note) => { ran++; console.log('PASS  ' + n + (note ? '  ' + note : '')); };
const bad = (n, why) => { ran++; failures++; console.log('FAIL  ' + n + '  --  ' + why); };
const say = (n, cond, note) => (cond ? ok(n, note) : bad(n, note || 'assertion failed'));

(async () => {
  const roots = {};
  for (const k of ['DATA', 'WORKERS', 'LAUNCH', 'PROJECTS']) {
    roots[k] = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-' + k.toLowerCase() + '-'));
  }
  /* A FIXTURE pane, never a live agent -- sandboxing the store is not sandboxing
     delivery, so this names a made-up session rather than typing into a real
     agent's pane. */
  fs.writeFileSync(roots.DATA + '/fake-panes',
    require('../../test-support/fleet').line({ session: 'mc-discord', claim: 'mc', title: '✳ idle' }));
  fs.writeFileSync(roots.DATA + '/fake-sessions', 'mc-discord\n');

  const srv = spawn('node', ['server.js'], {
    cwd: REPO,
    env: { ...process.env, PORT: String(PORT), AGENT_WORKFORCE_RELEASE_BASE: 'http://127.0.0.1:9/dist',
      AGENT_WORKFORCE_DATA: roots.DATA, AGENT_WORKFORCE_WORKERS: roots.WORKERS,
      AGENT_WORKFORCE_LAUNCH: roots.LAUNCH, AGENT_WORKFORCE_PROJECTS: roots.PROJECTS,
      AGENT_WORKFORCE_TMUX_BIN: path.join(REPO, 'test-support', 'fake-tmux.sh'),
      AGENT_WORKFORCE_FAKE_PANES: roots.DATA + '/fake-panes',
      AGENT_WORKFORCE_FAKE_SESSIONS: roots.DATA + '/fake-sessions' },
    stdio: 'ignore',
  });
  await new Promise((r) => setTimeout(r, 1200));

  const b = await chromium.launch({ headless: process.env.HEADED !== '1' });

  // Set a composer's value to leave `remaining` chars before the cap and fire the
  // page's REAL input event, so the shipped listener runs (pjGrowComposer ->
  // pjComposerCount). Returns nothing; read the counter with counterOf().
  const setRemaining = (page, id, remaining) => page.evaluate(({ cid, rem, max }) => {
    const el = document.getElementById(cid);
    el.value = 'x'.repeat(Math.max(0, max - rem));
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, { cid: id, rem: remaining, max: MAX });

  const counterOf = (page, id) => page.evaluate((cid) => {
    const out = document.getElementById(cid + '-count');
    if (!out) return { missing: true };
    const cs = getComputedStyle(out);
    const inp = document.getElementById(cid);
    const box = inp && inp.closest('.composerbox');
    const r = out.getBoundingClientRect();
    const br = box ? box.getBoundingClientRect() : null;
    return { hidden: out.hidden, display: cs.display, color: cs.color,
      near: out.classList.contains('near'), text: (out.textContent || '').trim(),
      textAlign: cs.textAlign,
      // geometry, only meaningful when visible: on its own line BELOW the input row.
      rectTop: r.top, rectBottom: r.bottom, rectWidth: r.width,
      boxBottom: br ? br.bottom : null, boxWidth: br ? br.width : null,
      // is the block a flex CHILD of the composerbox (the bug) or a sibling (correct)?
      parentIsComposerbox: !!(out.parentElement && out.parentElement.classList.contains('composerbox')) };
  }, id);

  // One theme's full run. Opening a real agent puts #d-say in its real, enabled,
  // focusable state -- which is why this rides the server flow rather than file://.
  const runTheme = async (theme) => {
    const p = await b.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: theme });
    const errs = [];
    p.on('pageerror', (e) => errs.push(String(e)));
    const T = (n) => `[${theme}] ` + n;
    try {
      await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
      if (await p.isVisible('#firstrun')) { await p.keyboard.press('Escape'); await p.waitForTimeout(300); }
      await p.waitForSelector('[data-agent="mc"]', { timeout: 15000 });
      await p.click('[data-agent="mc"]');
      await p.waitForSelector('#panel-detail:not([hidden])', { timeout: 15000 });
      await p.waitForFunction(() => {
        const e = document.getElementById('d-say');
        return e && e.getClientRects().length > 0 && !e.disabled;
      }, null, { timeout: 15000 });

      // CONTROL: the cap this counter counts toward is really 10000 (chat.MAX_TEXT) on d-say.
      const maxAttr = await p.getAttribute('#d-say', 'maxlength');
      say(T('CONTROL: #d-say caps at ' + MAX + ' (chat.MAX_TEXT)'), maxAttr === String(MAX), 'maxlength=' + maxAttr);

      // 1. Empty composer: nothing shown.
      await setRemaining(p, 'd-say', MAX);
      let c = await counterOf(p, 'd-say');
      say(T('empty composer shows no counter'), !c.missing && c.hidden === true && c.display === 'none', JSON.stringify(c));

      // 2. SETUP CONTROL: far from the cap, still nothing. If this fails the
      //    counter is always-on chrome and every "shows N" arm below is vacuous.
      await setRemaining(p, 'd-say', SOFT_AT + 500);   // 1000 remaining
      c = await counterOf(p, 'd-say');
      say(T('SETUP: far from the cap (1000 left) the counter stays HIDDEN'),
        !c.missing && c.hidden === true, JSON.stringify(c));

      // 3. At the soft threshold: it appears, with the right remaining count and
      //    NOT yet amber. Capture the muted base colour for the amber arm.
      await setRemaining(p, 'd-say', SOFT_AT);         // exactly 500 remaining
      c = await counterOf(p, 'd-say');
      say(T('at ' + SOFT_AT + ' left the counter APPEARS'), !c.missing && c.hidden === false && c.display !== 'none', JSON.stringify(c));
      say(T('it reads "' + SOFT_AT + ' characters left"'), c.text === SOFT_AT + ' characters left', JSON.stringify(c.text));
      say(T('at ' + SOFT_AT + ' left it is not yet amber'), c.near === false, 'near=' + c.near);
      // GEOMETRY: the counter sits on its OWN LINE below the composer input row, not
      // squished inline. A block sibling of the flex .composerbox (not a child), full
      // width, right-aligned. A text-only check passes on the squished-inline bug; this
      // is the arm that would red it.
      say(T('the counter is a sibling of the composerbox, not a flex child'), c.parentIsComposerbox === false, 'parentIsComposerbox=' + c.parentIsComposerbox);
      say(T('the counter renders BELOW the composer input row (own line)'),
        typeof c.rectTop === 'number' && typeof c.boxBottom === 'number' && c.rectTop >= c.boxBottom - 4,
        'rectTop=' + Math.round(c.rectTop) + ' boxBottom=' + Math.round(c.boxBottom));
      say(T('the counter spans the composer width and right-aligns'),
        c.textAlign === 'right' && typeof c.rectWidth === 'number' && typeof c.boxWidth === 'number' && c.rectWidth >= c.boxWidth - 24,
        'textAlign=' + c.textAlign + ' rectWidth=' + Math.round(c.rectWidth) + ' boxWidth=' + Math.round(c.boxWidth));
      const baseColor = c.color;

      // 4. At the near threshold: amber. The computed-colour change is the
      //    browser-only fact a source test cannot see.
      await setRemaining(p, 'd-say', NEAR_AT);         // exactly 100 remaining
      c = await counterOf(p, 'd-say');
      say(T('at ' + NEAR_AT + ' left it reads "' + NEAR_AT + ' characters left"'), c.text === NEAR_AT + ' characters left', JSON.stringify(c.text));
      say(T('at ' + NEAR_AT + ' left it turns amber (.near)'), c.near === true, 'near=' + c.near);
      say(T('the amber is a real computed-colour change, not just a class'),
        !!c.color && c.color !== baseColor, 'base=' + baseColor + ' near=' + c.color);

      // 5. Singular grammar at one character left.
      await setRemaining(p, 'd-say', 1);
      c = await counterOf(p, 'd-say');
      say(T('one left reads the SINGULAR "1 character left"'), c.text === '1 character left', JSON.stringify(c.text));

      // 6. At the cap: zero left, still shown and amber (never a silent cutoff).
      await setRemaining(p, 'd-say', 0);
      c = await counterOf(p, 'd-say');
      say(T('at the cap it reads "0 characters left" and is amber'),
        c.text === '0 characters left' && c.near === true && c.hidden === false, JSON.stringify(c));

      // 7. Clearing hides it again.
      await setRemaining(p, 'd-say', MAX);
      c = await counterOf(p, 'd-say');
      say(T('clearing the composer hides the counter again'), c.hidden === true, JSON.stringify(c));

      // 8. REAL KEYS across the threshold: the shipped input listener drives it.
      //    Prime just OUTSIDE the window (502 left, hidden), place the caret at
      //    the end, then type 3 real characters to cross to 499 left.
      await setRemaining(p, 'd-say', SOFT_AT + 2);     // 502 remaining, hidden
      c = await counterOf(p, 'd-say');
      say(T('SETUP real-keys: 502 left is still hidden before typing'), c.hidden === true, JSON.stringify(c));
      await p.evaluate(() => {
        const el = document.getElementById('d-say');
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      });
      await p.locator('#d-say').pressSequentially('abc', { delay: 8 });
      c = await counterOf(p, 'd-say');
      say(T('typing REAL keys across the threshold reveals the counter'),
        c.hidden === false && c.text === (SOFT_AT - 1) + ' characters left', JSON.stringify(c));

      say(T('no page errors'), errs.length === 0, errs.join(' | '));
    } catch (e) {
      bad(T('the check ran to completion'), String(e && e.message ? e.message : e));
    } finally {
      await p.close().catch(() => {});
    }
  };

  // pj-post (the project ROOM composer) is the OTHER multi-line message composer that
  // got the cap + counter. It rides pjGrowComposer exactly as d-say does, so this proves
  // the counter is wired there and lays out in the room composer's own context. One
  // theme only: the amber is a per-theme fact already proven on d-say; what is new here
  // is the wiring + placement for a DIFFERENT composer. A synthetic `input` event drives
  // pj-post's SHIPPED input listener (which calls pjGrowComposer -> pjComposerCount).
  const runPjPost = async () => {
    const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
    const errs = [];
    p.on('pageerror', (e) => errs.push(String(e)));
    const T = (n) => '[pj-post] ' + n;
    try {
      await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
      if (await p.isVisible('#firstrun')) { await p.keyboard.press('Escape'); await p.waitForTimeout(300); }
      await p.evaluate(async () => {
        const r = await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'Msg Counter' }) });
        if (!r.ok) throw new Error('project create failed: ' + r.status);
        const body = await r.json();
        await fetch('/api/project/' + body.project.id + '/agent/mc', { method: 'POST', headers: { 'content-type': 'application/json' } });
      });
      await p.click('[data-tab="projects"]');
      await p.locator('#pj-list').getByText('Msg Counter').first().click();
      await p.waitForFunction(() => {
        const e = document.getElementById('pj-post');
        return e && e.getClientRects().length > 0;
      }, null, { timeout: 15000 });

      const maxAttr = await p.getAttribute('#pj-post', 'maxlength');
      say(T('CONTROL: #pj-post caps at ' + MAX + ' (chat.MAX_TEXT)'), maxAttr === String(MAX), 'maxlength=' + maxAttr);

      // SETUP: far from the cap, hidden (or every "shows N" arm is vacuous).
      await setRemaining(p, 'pj-post', SOFT_AT + 500);
      let c = await counterOf(p, 'pj-post');
      say(T('SETUP: far from the cap the pj-post counter is HIDDEN'), !c.missing && c.hidden === true, JSON.stringify(c));

      // At the soft threshold: appears, right text, own line below the input, not amber.
      await setRemaining(p, 'pj-post', SOFT_AT);
      c = await counterOf(p, 'pj-post');
      say(T('at ' + SOFT_AT + ' left the pj-post counter APPEARS with the right text'),
        !c.missing && c.hidden === false && c.text === SOFT_AT + ' characters left', JSON.stringify(c));
      say(T('the pj-post counter is a sibling of the composerbox, not a flex child'), c.parentIsComposerbox === false, 'parentIsComposerbox=' + c.parentIsComposerbox);
      say(T('the pj-post counter renders BELOW the input row (own line), full width'),
        typeof c.rectTop === 'number' && typeof c.boxBottom === 'number' && c.rectTop >= c.boxBottom - 4
          && c.textAlign === 'right' && c.rectWidth >= c.boxWidth - 24,
        'rectTop=' + Math.round(c.rectTop) + ' boxBottom=' + Math.round(c.boxBottom) + ' rectWidth=' + Math.round(c.rectWidth) + ' boxWidth=' + Math.round(c.boxWidth));
      const baseColor = c.color;

      // Amber within 100 (a computed-colour change), proving pj-post shares the mechanism.
      await setRemaining(p, 'pj-post', NEAR_AT);
      c = await counterOf(p, 'pj-post');
      say(T('at ' + NEAR_AT + ' left the pj-post counter turns amber'),
        c.near === true && !!c.color && c.color !== baseColor, 'base=' + baseColor + ' near=' + c.color);

      // Clearing hides it again (pj-post's send/reset path rides pjGrowComposer too).
      await setRemaining(p, 'pj-post', MAX);
      c = await counterOf(p, 'pj-post');
      say(T('clearing pj-post hides the counter again'), c.hidden === true, JSON.stringify(c));

      say(T('no page errors'), errs.length === 0, errs.join(' | '));
    } catch (e) {
      bad(T('the check ran to completion'), String(e && e.message ? e.message : e));
    } finally {
      await p.close().catch(() => {});
    }
  };

  try {
    await runTheme('light');
    await runTheme('dark');
    await runPjPost();
  } finally {
    await b.close().catch(() => {});
    srv.kill();
  }
  console.log((failures ? 'FAIL' : 'PASS') + '  render-msg-counter-3403  (' + ran + ' assertions)');
  process.exit(failures ? 1 : 0);
})();
