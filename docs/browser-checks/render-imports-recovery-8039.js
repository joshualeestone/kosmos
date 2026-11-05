// Browser-check-surface: d-qask d-qask-lab d-qask-imports d-qask-imports-no d-qask-imports-msg importsAsk
'use strict';

/**
 * kosmos#8039: Claude Code's "Allow external CLAUDE.md file imports?" stops a new agent before it starts, and on the board
 * it was the raw dialog in the chat with no way through. The needs-you box now says what is going on and offers
 * "Continue without them", which writes the answer and restarts, typing nothing. Allowing them stays in the Terminal.
 *
 * Through the page's own paintTalk, with a stubbed fetch:
 *   the box and button show for importsAsk, and the sentence names the Terminal for the other answer;
 *   the press POSTs the route, with no keys and no allow, and its answer reaches the page, refused or restarted;
 *   CONTROL: the same thread without importsAsk shows neither, so the show arm can fail; the trust recovery is unchanged;
 *   a press answered after the person moved to another agent does not write under that agent.
 *
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" HEADED=0 node docs/browser-checks/render-imports-recovery-8039.js
 */

const nodePath = require('node:path');

let playwright;
try { playwright = require('playwright'); }
catch {
  console.log('render-imports-recovery-8039: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}

const PAGE = 'file://' + nodePath.join(__dirname, '..', '..', 'web', 'index.html');
const ENGINES = (process.env.ENGINES || 'chromium,webkit').split(',').map((s) => s.trim()).filter(Boolean);

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

    const paint = (thread) => page.evaluate(async (th) => {
      const fr = document.getElementById('firstrun'); if (fr) fr.hidden = true;
      CURRENT = { sessionName: 'sam doe', name: 'Sam' };
      for (let el = document.getElementById('d-qask'); el && el !== document.body; el = el.parentElement) { el.hidden = false; }
      window.fetch = async (url) => {
        if (String(url).indexOf('/thread') !== -1) return new Response(JSON.stringify(th), { status: 200, headers: { 'content-type': 'application/json' } });
        return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
      };
      await paintTalk('sam doe', 'Sam');
      const vis = (id) => { const e = document.getElementById(id); return !!e && !e.hidden && e.getClientRects().length > 0; };
      return {
        box: vis('d-qask'), imports: vis('d-qask-imports'), button: vis('d-qask-imports-no'), trust: vis('d-qask-trust-restart'),
        label: (document.getElementById('d-qask-lab') || {}).textContent || '',
        buttonText: (document.getElementById('d-qask-imports-no') || {}).textContent || '',
      };
    }, thread);

    /* One press against a stub that answers `reply`; reads what was sent and what the page said. */
    const press = (reply, thenMove) => page.evaluate(async ({ reply, thenMove }) => {
      const sent = [];
      window.fetch = async (url, opts) => {
        sent.push({ url: String(url), method: opts && opts.method, body: opts && opts.body });
        if (thenMove) CURRENT = { sessionName: 'other', name: 'Other' };
        if (reply === 'throw') throw new Error('no network');
        return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'content-type': 'application/json' } });
      };
      const msg = document.getElementById('d-qask-imports-msg');
      msg.textContent = '';
      document.getElementById('d-qask-imports-no').click();
      await new Promise((r) => setTimeout(r, 60));
      const out = { sent, msg: msg.textContent, disabled: document.getElementById('d-qask-imports-no').disabled };
      if (thenMove) CURRENT = { sessionName: 'sam doe', name: 'Sam' };
      return out;
    }, { reply, thenMove });

    const base = { messages: [], presence: 'on', asking: true };
    const a = await paint({ ...base, importsAsk: true });
    chk(a.box && a.imports && a.button, `${t} the box and its button show for the imports question`, JSON.stringify(a));
    chk(a.buttonText === 'Continue without them', `${t} the button says what it does`, a.buttonText);
    chk(/^Sam cannot start until you answer\./.test(a.label), `${t} the label names the agent and why it is waiting`, a.label);
    chk(/open its Terminal to allow them/.test(a.label), `${t} the other answer is named, and where it is given`, a.label);
    chk(a.trust === false, `${t} the folder-trust button stays hidden here`, JSON.stringify(a));

    const c = await paint({ ...base });
    chk(c.imports === false && c.box === false, `${t} CONTROL: the same thread without importsAsk shows neither`, JSON.stringify(c));
    const n = await paint({ ...base, importsAsk: false });
    chk(n.imports === false, `${t} CONTROL: importsAsk false shows nothing`, JSON.stringify(n));
    const q = await paint({ ...base, asking: false, importsAsk: true });
    chk(q.imports === false, `${t} not asking any more: it does not show`, JSON.stringify(q));
    const tr = await paint({ ...base, answerNote: 'A sentence about folder trust.' });
    chk(tr.trust === true && tr.imports === false && /folder-trust/.test(tr.label), `${t} the trust recovery is unchanged`, JSON.stringify(tr));

    await paint({ ...base, importsAsk: true });
    const ok = await press({ status: 200, body: { ok: true, because: 'Restarting Sam.' } });
    chk(ok.sent.length === 1 && /\/api\/agent\/sam%20doe\/decline-imports$/.test(ok.sent[0].url) && ok.sent[0].method === 'POST',
      `${t} the press POSTs the route, with the name encoded`, JSON.stringify(ok.sent));
    chk(!/allow|keys|yes/i.test(String(ok.sent[0] && ok.sent[0].body)), `${t} it carries no answer the server could read as a Yes`, String(ok.sent[0] && ok.sent[0].body));
    chk(ok.msg === 'Restarting Sam.', `${t} the server's words reach the page`, ok.msg);
    chk(ok.disabled === false, `${t} the button comes back`, String(ok.disabled));
    const gone = await press({ status: 409, body: { ok: false, because: 'it is no longer asking this' } });
    chk(gone.msg === 'it is no longer asking this', `${t} a refusal is said`, gone.msg);
    const thrown = await press('throw');
    chk(/could not reach Kosmos/.test(thrown.msg), `${t} no network is said, not left blank`, thrown.msg);
    const moved = await press({ status: 200, body: { ok: true, because: 'Restarting Sam.' } }, true);
    chk(moved.msg !== 'Restarting Sam.', `${t} an answer after moving to another agent does not land under that one`, moved.msg);

    if (process.env.SHOTS) { await paint({ ...base, importsAsk: true }); await page.screenshot({ path: nodePath.join(process.env.SHOTS, `8039-${engine}.png`) }); }
    chk(errs.length === 0, `${t} no page errors`, errs.join(' | '));
    await browser.close();
  }
  if (!passes && !fail.length) { console.log('render-imports-recovery-8039: nothing ran - SKIPPED, not passed'); process.exit(1); }
  console.log(`\n${passes}/${passes + fail.length} checks passed`);
  process.exit(fail.length ? 1 : 0);
})();
