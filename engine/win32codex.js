'use strict';
/**
 * Driving ONE Codex (OpenAI) turn on Windows, headless (#3380).
 *
 * 🛑 WHY THIS EXISTS, AND WHY IT IS NOT A COPY OF THE CLAUDE PATH. Every Windows
 * agent is launched by `win32launch.streamArgvFor` with Claude Code's streaming
 * protocol: `-p --input-format stream-json --output-format stream-json --verbose`
 * (plus `--resume`). codex does NOT speak that protocol -- codex 0.149.1 has no
 * `proto`/stream-json arm at all -- so an OpenAI agent was created (its record
 * written, its card drawn) and then never answered a thing: the persistent child
 * the supervisor held was speaking a language codex could not read.
 *
 * 🔑 SO CODEX IS DRIVEN PER TURN, NOT AS A PERSISTENT STREAM. `codex exec` runs one
 * turn to completion and exits; `codex exec resume <threadId>` continues the same
 * conversation (VERIFIED on the box, 2026-09-22: a secret told in turn 1 was
 * recalled in turn 2). This is the codex analog of writing one `messageLine` to a
 * claude stream child -- the supervisor calls it once per delivered message and
 * parses the JSONL it prints. The turn's SIDE EFFECTS (the agent shelling out to
 * `kosmos reply`/`post`, editing files) happen inside the turn exactly as they do
 * for claude; the `agent_message` text is the turn's final message, the codex
 * analog of claude's last assistant event.
 *
 * ⚠️ AUTONOMY IS NOT OPTIONAL FOR AN UNATTENDED AGENT, the same rule
 * `win32launch.AUTONOMY` states for the streaming path. `codex exec` defaults to
 * `sandbox: read-only` and `approval: never`, so without the bypass flag the agent
 * cannot run the shell commands its whole job is made of (it cannot even run
 * `kosmos`), and there is no screen for an approval prompt to appear on. The
 * supervisor passes `autonomy: true`; the flag is `codex`'s spelling of claude's
 * `--dangerously-skip-permissions`, the pairing already in `win32launch.AUTONOMY`.
 *
 * 🔑 THE ARG BUILDER AND THE PARSER ARE PURE, so both are asserted from a Mac with
 * no codex, no key and no spawn. The only impure part is `runCodexTurn`'s spawn,
 * and its child process is an injectable seam.
 */
const { spawn } = require('node:child_process');

/* codex's spelling of claude's --dangerously-skip-permissions. The same flag
   win32launch.AUTONOMY.codex carries, written once here so the two cannot drift. */
const AUTONOMY_FLAG = '--dangerously-bypass-approvals-and-sandbox';

/**
 * The argv for one `codex exec` turn.
 *
 * 🔑 `resume <threadId>` OR A FRESH START, and which one says whether this is a
 * return. A fresh turn omits it and codex mints a thread id (emitted as
 * `thread.started`); a continuing turn names the id it already has and codex
 * carries the same conversation forward. `--skip-git-repo-check` because an agent
 * folder is not necessarily a git repo and codex otherwise refuses to run in one
 * that is not. `--json` puts the turn's events on stdout as JSONL, which is what
 * `parseCodexTurn` reads.
 *
 * @param {{ sessionId?: string, model?: string, autonomy?: boolean, message: string }} opts
 * @returns {string[]}
 */
function codexTurnArgs(opts) {
  const o = opts || {};
  const args = ['exec'];
  if (o.sessionId) args.push('resume', String(o.sessionId));
  args.push('--json', '--skip-git-repo-check');
  if (o.model) args.push('-m', String(o.model));
  if (o.autonomy) args.push(AUTONOMY_FLAG);
  args.push(String(o.message));
  return args;
}

/**
 * Read the JSONL a `codex exec --json` turn prints. Pure over the stdout string.
 *
 *   {"type":"thread.started","thread_id":"<uuid>"}                        -> the id
 *   {"type":"item.completed","item":{"type":"agent_message","text":".."}} -> response
 *   {"type":"turn.completed","usage":{...}}                               -> end of turn
 *
 * A line that is not a JSON object is skipped (codex may print a non-JSON banner
 * before the stream); the thread id defaults to `priorSessionId` so a resume that
 * emits no fresh `thread.started` keeps the id it was given.
 *
 * @returns {{ sessionId: string|null, response: string, turnComplete: boolean }}
 */
function parseCodexTurn(stdout, priorSessionId) {
  let sessionId = priorSessionId || null;
  const responses = [];
  let turnComplete = false;
  for (const line of String(stdout == null ? '' : stdout).split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t[0] !== '{') continue;
    let ev;
    try { ev = JSON.parse(t); } catch { continue; }
    if (!ev || typeof ev !== 'object') continue;
    if (ev.type === 'thread.started' && typeof ev.thread_id === 'string' && ev.thread_id) sessionId = ev.thread_id;
    if (ev.type === 'item.completed' && ev.item && ev.item.type === 'agent_message' && typeof ev.item.text === 'string') {
      responses.push(ev.item.text);
    }
    if (ev.type === 'turn.completed') turnComplete = true;
  }
  return { sessionId, response: responses.join('\n').trim(), turnComplete };
}

/* The spawn seam. Tests replace it; nothing else does. Mirrors win32launch.setSpawn. */
let spawnFn = null;
function setSpawn(fn) { spawnFn = typeof fn === 'function' ? fn : null; }
function spawner() { return spawnFn || spawn; }

/**
 * Run one codex turn and resolve with its result. Never rejects.
 *
 * @param {object} opts
 * @param {string}   opts.bin        the codex executable (path or bare name)
 * @param {string}   opts.message    the user message for this turn
 * @param {string}  [opts.sessionId] the codex thread id to resume (continuity)
 * @param {string}  [opts.model]     an explicit model, else codex picks
 * @param {boolean} [opts.autonomy]  pass the bypass flag (unattended agents: true)
 * @param {string}  [opts.cwd]       the folder to run the turn in
 * @param {object}  [opts.env]       the full child environment (preferred). When
 *                                   absent, process.env plus CODEX_HOME=opts.codexHome
 * @param {string}  [opts.codexHome] account home, used only when opts.env is absent
 * @returns {Promise<{ ok: boolean, response?: string, sessionId?: string|null,
 *                     turnComplete?: boolean, error?: string }>}
 */
function runCodexTurn(opts) {
  return new Promise((resolve) => {
    const o = opts || {};
    const args = codexTurnArgs(o);
    const env = o.env
      || Object.assign({}, process.env, o.codexHome ? { CODEX_HOME: String(o.codexHome) } : {});
    let child;
    try {
      child = spawner()(o.bin, args, {
        cwd: o.cwd || process.cwd(),
        env,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) { return resolve({ ok: false, error: 'spawn: ' + ((e && e.message) || 'unknown'), sessionId: o.sessionId || null }); }
    /* The supervisor captures the child so a stop can kill an in-flight turn's whole
       tree rather than leaving it to run to completion after the supervisor exits. */
    if (typeof o.onSpawn === 'function') { try { o.onSpawn(child); } catch { /* the caller's problem */ } }
    let out = '';
    let err = '';
    if (child.stdout && typeof child.stdout.on === 'function') child.stdout.on('data', (d) => { out += String(d); });
    if (child.stderr && typeof child.stderr.on === 'function') child.stderr.on('data', (d) => { err += String(d); });
    child.on('error', (e) => resolve({ ok: false, error: 'spawn: ' + ((e && e.message) || 'unknown'), sessionId: o.sessionId || null }));
    child.on('close', (code) => {
      const parsed = parseCodexTurn(out, o.sessionId);
      if (code === 0 && parsed.response) {
        resolve({ ok: true, response: parsed.response, sessionId: parsed.sessionId, turnComplete: parsed.turnComplete });
      } else {
        resolve({
          ok: false,
          error: `exit ${code}${err ? '; ' + err.slice(0, 300) : ''}${parsed.response ? '' : '; no agent_message'}`,
          sessionId: parsed.sessionId,
          response: parsed.response,
          turnComplete: parsed.turnComplete,
        });
      }
    });
  });
}

module.exports = { codexTurnArgs, parseCodexTurn, runCodexTurn, setSpawn, AUTONOMY_FLAG };
