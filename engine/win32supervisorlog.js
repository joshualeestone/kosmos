'use strict';
/**
 * A bounded, per-agent PERSISTED log of a Windows supervisor's event/error lines
 * (#3441).
 *
 * 🛑 WHY THIS EXISTS. `engine/win32supervisor.js` writes one line per transition
 * and every error to `process.stderr` "so a task log captures it". But the Windows
 * Scheduled Task that runs the supervisor does NOT redirect that stderr anywhere,
 * so every one of those lines is DROPPED. When a codex agent silently failed for
 * days (#3439, a config.toml parse error), there was nothing to see on the box --
 * even though `runCodexTurn` had captured codex's stderr into the turn error and
 * the supervisor emitted it as a `turn-failed` event. The error CONTENT already
 * existed; it just was not persisted anywhere a person could read it.
 *
 * This keeps those SAME lines, IN ADDITION to the stderr writes (which still help
 * where a task log IS captured), in a small file per agent under the store root.
 * It benefits every agent that goes through the supervisor's sink -- claude and
 * codex alike -- because both emit through `win32supervisor`'s `onEvent`.
 *
 * 🔑 THREE PROPERTIES, EACH LOAD-BEARING:
 *   - BOUNDED. A crash-loop can emit a line every restart forever; without a cap
 *     that fills a disk. See the rotate note on `MAX_BYTES` below.
 *   - REDACTED. The `because` fields echo captured error text, which can in
 *     principle carry a key or token. `redactSecrets` scrubs the high-confidence
 *     credential shapes before anything lands on disk.
 *   - NEVER FATAL. A failed log write must never take down the supervisor or blank
 *     a tick, so every filesystem call here is wrapped and best-effort, exactly as
 *     the stderr writes it mirrors are.
 */

const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');

/* The per-file cap. A healthy agent writes one line per start and per death, so
   256 KB is thousands of transitions -- far more than anyone reads -- while being
   small enough that a crash-loop cannot grow it without limit.

   BOUNDING BY SIMPLE ROTATE, chosen over a line-count cap or an in-place truncate:
   after an append pushes the live file past the cap, it is renamed to `<file>.1`
   (replacing any older rotation) and the next line starts a fresh file. This is
   the one approach here that is both cheap (no read-rewrite of the whole file per
   line) and correct under a crash (rename is atomic, so a death mid-rotate leaves
   either the old file or the rotated one, never a half-written splice). The newest
   lines are always in the live file, and at most ~2 * MAX_BYTES ever sits on disk
   (the live file just under the cap, plus one rotated segment). */
const MAX_BYTES = 256 * 1024;

function logDir() { return path.join(store.ROOT, 'win32-logs'); }
/* The same key the rest of the store uses (state, pipe, token, profile, avatar),
   so this agent's log can never be filed under a second spelling of its name. */
function logPath(name) { return path.join(logDir(), store.safeKey(name) + '.log'); }

/**
 * Scrub the high-confidence credential shapes out of a line before it is written.
 *
 * 🔑 A CONSERVATIVE, SECRET-ONLY REDACTOR, ON PURPOSE. `engine/feedbacksend.js`
 * carries a `scrub()` with the same provider-prefix and labelled-assignment shapes
 * used below -- but it ALSO redacts home paths, install names and the OS account
 * name, which for a feedback report are noise but for a SUPERVISOR LOG are the
 * diagnostic content (a path in an error, the agent's own name on every line). It
 * is also not exported. So rather than reuse a scrubber that would gut the very
 * information this log exists to keep, this ports only its credential arms, each
 * anchored on a fixed high-entropy prefix or an explicit `label = value` shape so
 * ordinary supervisor prose (an agent name, a session id, a folder) is never
 * touched. Over-redaction of a credential-shaped token is the safe direction; a
 * real key surviving is not.
 *
 * Every quantifier is BOUNDED so a pathological line cannot drive V8's regex into
 * a stack overflow, the same rule feedbacksend follows for the board event loop.
 */
const SECRET_PATTERNS = [
  /(?<![A-Za-z0-9])sk-(?:ant-)?[A-Za-z0-9_-]{16,}/g,            // OpenAI / Anthropic keys
  /(?<![A-Za-z0-9])[sr]k_(?:live|test)_[A-Za-z0-9]{10,}/g,      // Stripe secret / restricted keys
  /(?<![A-Za-z0-9])gh[posru]_[A-Za-z0-9]{20,}/g,               // GitHub classic tokens (ghp/gho/ghs/ghr/ghu)
  /(?<![A-Za-z0-9])github_pat_[A-Za-z0-9_]{20,}/g,             // GitHub fine-grained PAT
  /(?<![A-Za-z0-9])npm_[A-Za-z0-9]{20,}/g,                      // npm access token
  /(?<![A-Za-z0-9])AKIA[0-9A-Z]{16}/g,                          // AWS access key id
  /(?<![A-Za-z0-9])ASIA[0-9A-Z]{16}/g,                          // AWS temporary access key id
  /(?<![A-Za-z0-9])AIza[A-Za-z0-9_-]{16,}/g,                    // Google API key
  /(?<![A-Za-z0-9])ya29\.[A-Za-z0-9_-]{20,}/g,                  // Google OAuth access token
  /(?<![A-Za-z0-9])xox[baprs]-[A-Za-z0-9-]{10,}/gi,            // Slack bot/user/app tokens
  /(?<![A-Za-z0-9])xapp-[A-Za-z0-9-]{10,}/gi,                   // Slack app-level token
  /(?<![A-Za-z0-9])eyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g, // three-segment JWT
];

function redactSecrets(text) {
  if (text == null) return '';
  let out = String(text);
  for (const re of SECRET_PATTERNS) out = out.replace(re, '[redacted-secret]');
  // A credential in a URL's userinfo: `scheme://user:PASSWORD@host`. Keep the
  // scheme and user, redact the password. The user part is optional so
  // `redis://:pass@host` is covered. Bounded, so a long no-`@` run cannot stall.
  out = out.replace(/([a-z][a-z0-9+.-]{0,31}:\/\/[^\s:@/]{0,200}:)[^\s:@/]{1,200}@/gi, '$1[redacted-secret]@');
  // HTTP auth headers: keep the scheme word, redact the credential.
  out = out.replace(/(?<![A-Za-z0-9])(Bearer\s+)[A-Za-z0-9._~+/=-]{15,}[A-Za-z0-9_~+/=]/gi, '$1[redacted-secret]');
  out = out.replace(/(?<![A-Za-z0-9])(Basic\s+)[A-Za-z0-9+/]{15,}={0,2}/gi, '$1[redacted-secret]');
  // A labelled assignment `<label> = <value>`: keep the label and separator,
  // redact a >=8-char no-space value that looks like a credential (must carry a
  // digit or base64 symbol, so a diagnostic word after the label is left alone).
  // The lookbehind is `(?<![A-Za-z0-9])` not `\b` so snake_case labels
  // (`client_secret=`, `access_token:`) anchor on their trailing word.
  out = out.replace(/(?<![A-Za-z0-9])(api[_-]?key|secret|token|password|passwd|key)(["']?\s*[:=]\s*["']?)(?=[^\s'"&,;]{8})(?=[^\s'"&,;]{0,512}[0-9~=+\/])([^\s'"&,;]{0,512}[^\s'"&,;.:!?()\[\]{}<>])/gi, '$1$2[redacted-secret]');
  return out;
}

/**
 * A persisted-log writer for one agent. `line(text)` appends one redacted line to
 * the agent's log file, rotating when it passes the cap. It never throws.
 *
 * `opts.maxBytes` is injectable so a test can drive the rotation without writing
 * a quarter-megabyte; production always uses `MAX_BYTES`.
 */
function logger(name, opts) {
  const o = opts || {};
  const cap = Number.isInteger(o.maxBytes) && o.maxBytes > 0 ? o.maxBytes : MAX_BYTES;
  const file = logPath(name);
  return {
    line(text) {
      try {
        fs.mkdirSync(logDir(), { recursive: true });
        // One entry per line: collapse any embedded newline so a multi-line error
        // tail cannot split one event across several log lines.
        const clean = redactSecrets(String(text == null ? '' : text)).replace(/\r?\n/g, ' ');
        fs.appendFileSync(file, clean + '\n');
        let size = 0;
        try { size = fs.statSync(file).size; } catch { size = 0; }
        if (size > cap) {
          // Atomic rotate: the just-written newest lines move to `<file>.1`
          // (replacing any older rotation) and the next line opens a fresh file.
          try { fs.renameSync(file, file + '.1'); } catch { /* best effort */ }
        }
      } catch { /* a failed log write must never take down the supervisor */ }
    },
  };
}

module.exports = { logger, redactSecrets, logDir, logPath, MAX_BYTES };
