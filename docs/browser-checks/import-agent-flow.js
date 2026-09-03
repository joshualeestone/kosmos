/**
 * The "import my existing agent" flow, end to end in a real browser (#1652).
 *
 * 🔑 EVERY ASSERTION HERE IS ABOUT SOMETHING A SOURCE TEST CANNOT SEE. The
 * import path is built (the `/api/agent-import` route parses a raw CLAUDE.md,
 * and `importLoad` in web/index.html lays the parsed fields onto the create
 * form). What a `node --test` cannot see is whether, after the person pastes a
 * file and presses "Bring it in", the create-instr TEXTAREA actually ends up
 * holding the imported instructions. That fill is the exact defect Josh asked
 * this walk to exercise (2026-09-25, "make it visible"): a parse that succeeds
 * on the wire but a textarea that stays empty reads as a working import in the
 * diff and a broken one on screen.
 *
 * TWO ARMS, and the second is the control that makes the first mean something:
 *
 *   POSITIVE  a valid agent file fills name + role + the instructions textarea
 *             and advances to the name step. This is the fill defect's guard.
 *   NEGATIVE  a file that is not a Kosmos agent is refused WHOLE -- an import
 *             surface takes input from outside the machine, so it must refuse
 *             what it cannot parse rather than half-apply it. Asserts the panel
 *             stays put, names a reason, and leaves the create-instr textarea
 *             EMPTY. Without this arm the positive arm could pass on a flow that
 *             fills the form from anything.
 *
 * It does NOT press Create: import PARSES, it never creates (web/index.html's
 * own comment), so this walk stops at the filled form and spawns nothing. The
 * full create is covered by render-create-made.js.
 *
 * Needs a SANDBOXED board (all four roots, fake-tmux) -- see the README in this
 * directory. This script completes first run itself via /api/first-run/complete
 * so the launch overlay does not intercept the create picks (Escape does not
 * reliably clear it for the create flow, only for read-only views). Because it
 * POSTs, it calls requireSandbox() first (like render-accounts-openai.js): it
 * refuses unless its OWN AGENT_WORKFORCE_DATA is a temp root, so a misaimed run
 * cannot complete first run on a live board.
 *
 * It runs HEADLESS unconditionally: every assertion reads DOM state (a textarea's
 * value, hidden flags), never paint or geometry, so SwiftShader-vs-real-compositor
 * does not matter and it works in any bot session with no console.
 *
 * Run (from any session -- no MCP, no claude-fe). The check POSTs to the board, so
 * its OWN data root must be the sandbox too; point AGENT_WORKFORCE_DATA at the same
 * $SB the board booted under, or run it through tools/browser-checks.sh:
 *   NODE_PATH=~/work/pw-runtime/node_modules AGENT_WORKFORCE_DATA="$SB/data" \
 *     node docs/browser-checks/import-agent-flow.js http://127.0.0.1:4399
 * (Renet Tilley measured 2026-09-03 that the committed headless checks run from
 * a plain bot session via ~/work/pw-runtime; the interactive MCP is a separate
 * thing these walks do not use. Verified again in-session for this check.)
 */
'use strict';

const playwright = require('playwright');

// This check POSTs /api/first-run/complete to whatever board BASE points at, so it
// refuses to run unless its own data root is a sandbox. Same guard, same reason,
// as render-accounts-openai.js.
require('./lib-sandbox-guard.js').requireSandbox('import-agent-flow.js');

const BASE = process.argv[2] || 'http://127.0.0.1:4399';

/* A minimal but genuinely valid Kosmos agent file: no header, but its text
   introduces an agent ("You are ...") the way importAgent recognises from
   content. Kept small so the assertion about the textarea's contents is exact. */
const AGENT_FILE = [
  '# You are Testy McTest',
  '',
  '## Who you report to',
  'You report to the person who runs this computer.',
  '',
  'You are a test agent used to verify the import flow fills the form.',
].join('\n');

/* Not a Kosmos agent file and not agent-shaped prose: the whole-refusal case. */
const HOSTILE_FILE = 'just random text, not a Kosmos agent file at all';

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
}

/* Get a page onto the create flow with the import panel open. Completes first
   run through the real route first: the launch cover (#boot-cover) and the
   first-run overlay (#firstrun) both intercept pointer events on the picks
   until first run resolves. */
async function openImportPanel(page) {
  await page.goto(BASE + '/?tab=create', { waitUntil: 'load' });
  const frOk = await page.evaluate(() => fetch('/api/first-run/complete', { method: 'POST' }).then((r) => r.ok).catch(() => false));
  if (!frOk) { console.log('FAIL  could not complete first run on the board (is it up and sandboxed?)'); process.exit(1); }
  await page.goto(BASE + '/?tab=create', { waitUntil: 'load' });
  await page.waitForFunction(() => { const c = document.getElementById('boot-cover'); return !c || c.hidden; }, { timeout: 10000 });
  await page.waitForSelector('#pick-import:not([hidden])', { timeout: 10000 });
  await page.click('#pick-import');
  await page.waitForSelector('#importpick:not([hidden])', { timeout: 8000 });
}

async function run() {
  // DOM-state assertions only, so headless unconditionally (see the header).
  const browser = await playwright.chromium.launch({ headless: true });
  try {
    // ── POSITIVE: a valid file fills the form ────────────────────────────────
    const p = await browser.newPage();
    await openImportPanel(p);
    const importOffered = await p.evaluate(() => { const e = document.getElementById('pick-import'); return !!e && !e.hidden; });
    check('the import option is offered on the create flow', importOffered, `#pick-import visible=${importOffered}`);
    await p.fill('#import-text', AGENT_FILE);
    await p.click('#import-load');
    // The success outcome advances to the name step with the fields laid on.
    let filled = false;
    try {
      await p.waitForFunction(() => {
        const t = document.getElementById('create-instr');
        return t && typeof t.value === 'string' && t.value.length > 10;
      }, { timeout: 8000 });
      filled = true;
    } catch { /* assertions below report the miss */ }
    const pos = await p.evaluate(() => ({
      name: (document.getElementById('create-name') || {}).value || '',
      label: (document.getElementById('create-label') || {}).value || '',
      instr: (document.getElementById('create-instr') || {}).value || '',
      onNameStep: document.getElementById('cstep-name') ? !document.getElementById('cstep-name').hidden : false,
    }));
    check('import fills the instructions TEXTAREA (the #1652 fill defect)',
      filled && pos.instr.includes('test agent used to verify the import flow'),
      `instr length ${pos.instr.length}`);
    check('import fills the role label from the file', pos.label === 'Testy McTest', `label=${JSON.stringify(pos.label)}`);
    check('import fills the name from the file', pos.name === 'testy-mctest', `name=${JSON.stringify(pos.name)}`);
    check('a successful import advances to the name step', pos.onNameStep === true, `onNameStep=${pos.onNameStep}`);
    await p.close();

    // ── NEGATIVE (control): a non-agent file is refused WHOLE ─────────────────
    const p2 = await browser.newPage();
    await openImportPanel(p2);
    await p2.fill('#import-text', HOSTILE_FILE);
    await p2.click('#import-load');
    // Wait for the TERMINAL refusal state, not a fixed sleep. importLoad writes a
    // transient "Reading it…" BEFORE the fetch, then on refusal re-enables the
    // button and writes the reason; on success it leaves the button disabled and
    // advances. A fixed sleep could read the transient message with the form not
    // yet applied and green vacuously. Wait for: button re-enabled AND a message
    // that is neither empty nor the transient "Reading it…".
    await p2.waitForFunction(() => {
      const b = document.getElementById('import-load');
      const m = document.getElementById('import-msg');
      return b && !b.disabled && m && m.textContent && !/Reading it/i.test(m.textContent);
    }, { timeout: 8000 }).catch(() => { /* assertions below report the miss */ });
    const neg = await p2.evaluate(() => ({
      msg: (document.getElementById('import-msg') || {}).textContent || '',
      msgShown: document.getElementById('import-msg') ? !document.getElementById('import-msg').hidden : false,
      stillOnPanel: document.getElementById('importpick') ? !document.getElementById('importpick').hidden : false,
      instrLen: ((document.getElementById('create-instr') || {}).value || '').length,
      onNameStep: document.getElementById('cstep-name') ? !document.getElementById('cstep-name').hidden : false,
    }));
    check('a non-agent file is refused with a reason', neg.msgShown && neg.msg.trim().length > 0 && !/Reading it/i.test(neg.msg), `msg=${JSON.stringify(neg.msg.slice(0, 60))}`);
    check('a refused import stays on the import panel', neg.stillOnPanel === true, `stillOnPanel=${neg.stillOnPanel}`);
    check('a refused import does NOT half-fill the form', neg.instrLen === 0 && neg.onNameStep === false, `instrLen=${neg.instrLen} onNameStep=${neg.onNameStep}`);
    await p2.close();
  } finally {
    await browser.close();
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\nimport-agent-flow: ${results.length - failed.length} passed, ${failed.length} failed`);
  process.exit(failed.length ? 1 : 0);
}

run().catch((e) => { console.error(e); process.exit(1); });
