'use strict';
/**
 * kosmos#9038: whether the sign-in refusal an agent is stopped on is from BEFORE its account's last sign-in.
 *
 * A repaired agent that has not been asked anything since keeps the old line in its bottom rows. Its account check
 * (engine/authprobe) reads HEALTHY, so the card is calm, but that answer is kept 30 seconds: on each re-check tick it
 * reads UNCHECKED, the card reads Sign-in Issue for a moment, and a refusal is recorded against a working account.
 * HEALTHY alone is not evidence: `claude auth status` says signed in for a token Anthropic refuses (#874), and trusting it
 * took the rejected badge off a revoked account (#9031, review round 2).
 *
 * THE EVIDENCE IS TWO TIMES, never the screen's text (two screens can be the same, reviews 1 and 2):
 *   - when the agent was last refused: Claude Code writes the refusal into the session's transcript, with its time. Its
 *     own process names the session (<config folder>/sessions/<pid>.json), and the refusal must be the LAST thing said
 *     there. A new turn, a new refusal, a /clear or a restart changes that at once;
 *   - when its login was renewed by a person: the login's own date moved LATER (claudeloginlive.signedInAfter). A renewal
 *     never moves it later (Claude Code 2.1.332 keeps the smaller of the two dates); only a new sign-in does.
 * Every doubt is "not old", which is what the board did before this file. Nothing is remembered here about a screen.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TAIL_BYTES = 256 * 1024;

/* The last `bytes` of a file as text, or null. */
function tailOf(file, bytes = TAIL_BYTES) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const from = Math.max(0, size - bytes);
    const buf = Buffer.alloc(size - from);
    const got = fs.readSync(fd, buf, 0, buf.length, from);
    return buf.toString('utf8', 0, got);
  } catch { return null; } finally { if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* closed */ } } }
}

/* The time (epoch ms) of the refusal that is the last conversation row of this transcript, or null when the last one is
   anything else, or cannot be read. A last line still being written cannot be read, so it is a doubt. */
function refusalAtEnd(file) {
  const tail = tailOf(file);
  if (tail === null) return null;
  const lines = tail.split('\n');
  if (lines.pop() !== '') return null;   // the last row has no end yet
  for (let i = lines.length - 1; i >= 0; i--) {   // a line the tail cut in half is not JSON: a doubt
    if (!lines[i]) continue;
    let row;
    try { row = JSON.parse(lines[i]); } catch { return null; }
    if (row && row.type === 'system' && row.subtype === 'local_command') return null;   // a command since: what it did is not known here
    if (!row || (row.type !== 'user' && row.type !== 'assistant')) continue;   // bookkeeping rows follow every turn
    if (row.type !== 'assistant' || row.isApiErrorMessage !== true || row.error !== 'authentication_failed') return null;
    const at = Date.parse(row.timestamp);
    return Number.isFinite(at) ? at : null;
  }
  return null;
}

/* When the agent whose process is `pid`, on the config folder `ccd` (undefined: the default), was last refused; null when the last thing said in
   its session is not a refusal, or the session cannot be told. */
const SESSION_ID = /^[0-9a-f-]{8,64}$/i;
function refusedAt({ pid, ccd }) {
  const root = ccd || path.join(os.homedir(), '.claude');
  let id;
  try {
    const own = JSON.parse(fs.readFileSync(path.join(root, 'sessions', `${pid}.json`), 'utf8'));
    if (String(own.pid) !== String(pid)) return null;
    id = own.sessionId;
  } catch { return null; }
  if (typeof id !== 'string' || !SESSION_ID.test(id)) return null;
  const projects = path.join(root, 'projects');
  let dirs;
  try { dirs = fs.readdirSync(projects); } catch { return null; }
  const files = dirs.map((d) => path.join(projects, d, `${id}.jsonl`)).filter((f) => fs.existsSync(f));
  return files.length === 1 ? refusalAtEnd(files[0]) : null;   // one session in two folders: which is live cannot be told
}

/* The login a Claude process uses, from `ps`: { ccd } (undefined: CLAUDE_CONFIG_DIR not set), or null when it cannot be
   told. `command` is its arguments alone and `withEnv` the arguments then the environment, so nothing an argument says is
   read as environment. Null too when it has a credential that outranks the login, keeps its login under another name, or speaks to another service. */
const OTHER_CREDENTIAL = /\s(?:ANTHROPIC_(?!MODEL=|SMALL_FAST_MODEL=|DEFAULT_)\w+|CLAUDE_CODE_(?:USE_\w+|\w*(?:TOKEN|API_KEY|GATEWAY)(?:_\w+)?)|CLAUDE_SECURESTORAGE_\w+)=/;   // by shape, not a list: new ones are doubts
function loginOfPs(command, withEnv) {
  const args = String(command == null ? '' : command).trim();
  const all = String(withEnv == null ? '' : withEnv).trim();
  if (!args || !all.startsWith(args)) return null;
  const env = all.slice(args.length);
  if (!/\sPATH=\S/.test(env)) return null;   // `ps` showed no environment: not the same as an unset variable
  if (OTHER_CREDENTIAL.test(env)) return null;
  const set = env.match(/\sCLAUDE_CONFIG_DIR=\S*/g) || [];
  if (set.length > 1) return null;
  const ccd = set.length ? set[0].trim().slice('CLAUDE_CONFIG_DIR='.length) : undefined;
  return ccd === '' ? null : { ccd };
}

module.exports = { refusedAt, refusalAtEnd, loginOfPs, TAIL_BYTES };
