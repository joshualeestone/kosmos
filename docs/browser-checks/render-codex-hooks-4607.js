// Browser-check-surface: d-qask d-qask-lab d-qask-codex d-qask-codex-what d-qask-codex-trust d-qask-codex-skip d-qask-codex-close d-qask-codex-msg codexHooks
'use strict';

/**
 * #4607: a Codex agent stopped on Codex's "Hooks need review" is answered from the agent page by the PERSON, with
 * two buttons (Trust them / Continue without them), never through the composer (#4589 refuses every message there).
 * Drives the page's own paintTalk against a stubbed thread route and its own button handler against a stubbed POST,
 * in Chromium and WebKit (the Mac app is a WKWebView), and asserts:
 *   1. with body.asking and body.codexHooks, the needs-you box shows the Codex block: the label names the agent, and
 *      the summary says only what the screen said (the count and events from the table; a source when one is sent);
 *   2. with body.asking and NO codexHooks, the box stays hidden (it is not a general question box, #3419);
 *   3. Trust POSTs { choice: 'trust' } to /api/agent/<encoded name>/codex-hooks and shows the done line on ok;
 *   4. Continue POSTs { choice: 'skip' } and shows the route's own refusal sentence when it is refused;
 *   5. both buttons are enabled again after the answer, and no page error is thrown;
 *   6. (review round 1) the trusted-but-open list shows only Close, which POSTs { choice: 'close' };
 *   7. the summary says Trust covers every hook Codex lists.
 * CONTROL: on origin/main the Codex block does not exist, so arm 1 is red there (measured when this check was made).
 *
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" HEADED=0 node docs/browser-checks/render-codex-hooks-4607.js
 */

const nodePath = require('node:path');

let playwright;
try { playwright = require('playwright'); }
catch {
  console.log('render-codex-hooks-4607: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}

const PAGE = 'file://' + nodePath.join(__dirname, '..', '..', 'web', 'index.html');
const ENGINES = (process.env.ENGINES || 'chromium,webkit').split(',').map((s) => s.trim()).filter(Boolean);
const TABLE = { screen: 'table', count: 2, events: [{ event: 'SubagentStop', count: 1 }, { event: 'Stop', count: 1 }], source: null };
const HOOK = { screen: 'hook', count: null, events: [{ event: 'Stop', count: 1 }], source: 'Project config - ~/projects/newsletter/.codex/hooks.json', command: 'true' };

const fail = [];
let passes = 0;
const chk = (cond, name, detail) => { if (cond) { passes += 1; console.log('PASS  ' + name); } else { fail.push(name); console.log('FAIL  ' + name + (detail ? '  ' + detail : '')); } };

(async () => {
  for (const engine of ENGINES) {
    let browser;
    try { browser = await playwright[engine].launch({ headless: process.env.HEADED === '0' }); }
    catch (err) { console.log(`SKIPPED ${engine}: could not start (${String(err && err.message).split('\n')[0]}), not passed`); continue; }
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    const errs = [];
    page.on('pageerror', (e) => { if (!/access control checks|Failed to fetch|Load failed|ERR_FILE_NOT_FOUND/.test(e.message)) errs.push(e.message); });
    await page.addInitScript(() => { window.setInterval = () => 0; });
    await page.goto(PAGE);
    const t = `[${engine}]`;

    /* Paint the talk section for an agent whose thread says `thread`, through the page's own paintTalk. */
    const paint = (thread) => page.evaluate(async (th) => {
      const fr = document.getElementById('firstrun'); if (fr) fr.hidden = true;
      CURRENT = { sessionName: 'sam doe', name: 'Sam' };
      for (let el = document.getElementById('d-qask'); el && el !== document.body; el = el.parentElement) { el.hidden = false; }
      window.fetch = async (url) => {
        if (String(url).indexOf('/thread') !== -1) return new Response(JSON.stringify(th), { status: 200, headers: { 'content-type': 'application/json' } });
        return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
      };
      await paintTalk('sam doe', 'Sam');
      const box = document.getElementById('d-qask');
      const codex = document.getElementById('d-qask-codex');
      return {
        exists: !!codex,
        box: box ? !box.hidden : null,
        codex: codex ? !codex.hidden : null,
        label: (document.getElementById('d-qask-lab') || {}).textContent || '',
        what: (document.getElementById('d-qask-codex-what') || {}).textContent || '',
        source: (() => { const r = document.getElementById('d-qask-codex-source'); return r && !r.hidden ? document.getElementById('d-qask-codex-source-text').textContent : null; })(),
        command: (() => { const r = document.getElementById('d-qask-codex-command'); return r && !r.hidden ? document.getElementById('d-qask-codex-command-text').textContent : null; })(),
        shown: ['d-qask-codex-trust', 'd-qask-codex-skip', 'd-qask-codex-close'].filter((id) => { const b = document.getElementById(id); return b && !b.hidden; }),
        trustLabel: (document.getElementById('d-qask-codex-trust') || {}).textContent || '',
      };
    }, thread);

    const base = { messages: [], presence: 'on', asking: true };
    const a = await paint({ ...base, codexHooks: TABLE });
    chk(a.exists && a.box && a.codex, `${t} the needs-you box shows the Codex hook choice`, JSON.stringify(a));
    chk(/Sam needs you to decide about Codex hooks\./.test(a.label), `${t} the label names the agent`, a.label);
    chk(/Codex found 2 hooks it has not been told to trust \(SubagentStop, Stop\)\./.test(a.what) && a.source === null,
      `${t} the summary says the count and events the table showed, and no source it did not show`, a.what);
    chk(/Trusting covers every hook Codex lists/.test(a.what), `${t} the summary says Trust covers every hook listed`, a.what);
    const m = await paint({ ...base, codexHooks: { screen: 'menu', count: 2, events: [], source: null } });
    chk(/Its screen does not name them or say what they run\./.test(m.what), `${t} from the menu, the page says the screen names no hook`, m.what);
    chk(!/does not name them/.test(a.what), `${t} and does not say so when events were shown`, a.what);
    chk(JSON.stringify(a.shown) === JSON.stringify(['d-qask-codex-trust', 'd-qask-codex-skip']), `${t} the question offers Trust and Continue, not Close`, JSON.stringify(a.shown));
    const open = await paint({ ...base, codexHooks: { screen: 'trusted', count: null, events: [], source: null } });
    chk(open.box && open.codex && JSON.stringify(open.shown) === JSON.stringify(['d-qask-codex-close']) && /hooks are trusted, and their list is still open/.test(open.label),
      `${t} the trusted-but-open list offers only Close`, JSON.stringify(open));
    const h = await paint({ ...base, codexHooks: HOOK });
    chk(/agent could have written it/.test(h.what), `${t} a project-settings hook is flagged as writable by the agent`, h.what);
    chk(h.trustLabel === 'Show the full list' && a.trustLabel === 'Trust all of them', `${t} on one hook's page the button says it shows the full list`, JSON.stringify({ h: h.trustLabel, a: a.trustLabel }));
    chk(h.command === 'true' && a.command === null, `${t} what a hook runs is shown as its own literal, only when the screen shows it`, JSON.stringify({ h: h.command, a: a.command }));
    chk(/Codex found hooks it has not been told to trust \(Stop\)\./.test(h.what) && h.source === HOOK.source,
      `${t} from one hook's page: no count it did not show, the event, and the source as a literal of its own`, JSON.stringify(h));
    const none = await paint({ ...base, codexHooks: null });
    chk(none.box === false && none.codex === false, `${t} an ordinary question without codexHooks keeps the box hidden`, JSON.stringify(none));

    /* The buttons, through the page's own handler, against a stubbed POST. */
    const press = (id, answer) => page.evaluate(async ({ id, answer }) => {
      CURRENT = { sessionName: 'sam doe', name: 'Sam' };
      document.getElementById('d-qask-codex').hidden = false;
      document.getElementById('d-qask-codex-msg').textContent = '';
      let sent = null;
      window.fetch = async (url, opts) => {
        sent = { url: String(url), method: opts && opts.method, body: opts && opts.body };
        return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { 'content-type': 'application/json' } });
      };
      document.getElementById(id).click();
      for (let i = 0; i < 40 && document.getElementById('d-qask-codex-trust').disabled; i++) await new Promise((r) => setTimeout(r, 25));
      return {
        sent,
        msg: document.getElementById('d-qask-codex-msg').textContent,
        enabled: !document.getElementById('d-qask-codex-trust').disabled && !document.getElementById('d-qask-codex-skip').disabled,
      };
    }, { id, answer });

    const tr = await press('d-qask-codex-trust', { status: 200, body: { ok: true, choice: 'trust', because: null } });
    chk(tr.sent && tr.sent.url === '/api/agent/sam%20doe/codex-hooks' && tr.sent.method === 'POST' && JSON.parse(tr.sent.body || '{}').choice === 'trust'
      && JSON.parse(tr.sent.body || '{}').seen && JSON.parse(tr.sent.body).seen.screen === 'hook',
      `${t} Trust POSTs { choice: 'trust' } to the encoded codex-hooks route`, JSON.stringify(tr.sent));
    chk(/Done\. Its screen is no longer asking about hooks\./.test(tr.msg) && !/should now be trusted/.test(tr.msg) && tr.enabled, `${t} Trust shows the done line, buttons enabled again`, tr.msg);
    const sk = await press('d-qask-codex-skip', { status: 200, body: { ok: false, choice: 'skip', because: 'the hook question is not on its screen now, so nothing was pressed' } });
    chk(sk.sent && JSON.parse(sk.sent.body || '{}').choice === 'skip', `${t} Continue POSTs { choice: 'skip' }`, JSON.stringify(sk.sent));
    chk(sk.msg === 'the hook question is not on its screen now, so nothing was pressed' && sk.enabled,
      `${t} a refusal shows the route's own sentence`, sk.msg);
    const cl = await press('d-qask-codex-close', { status: 200, body: { ok: true, choice: 'close', because: null } });
    chk(cl.sent && JSON.parse(cl.sent.body || '{}').choice === 'close' && /The list is closed\./.test(cl.msg), `${t} Close POSTs { choice: 'close' }`, JSON.stringify(cl));
    chk(errs.length === 0, `${t} no page errors`, errs.join(' | '));
    await browser.close();
  }
  if (fail.length) { console.log('\n' + fail.length + ' FAILED'); process.exit(1); }
  if (passes === 0) { console.log('\nno engine ran, so nothing was checked: FAILED'); process.exit(1); }
  console.log(`\nall passed (${passes})`);
})().catch((e) => { console.error(e); process.exit(2); });
