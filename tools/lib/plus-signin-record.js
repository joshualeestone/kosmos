'use strict';
/**
 * kosmos#2036 / #1591: the FIRST KOSMOS+ SIGN-IN record, defined ONCE for its writer
 * (tools/plus-signin-fresh.js) and its gate (tools/plus-signin-verified.sh).
 *
 * WHY A RECORD. The two other Mac promote gates prove a fresh browser reaches the board
 * (#2063) and a fresh agent comes online (#2150). Neither touches Kosmos+, and tonight's
 * #3827 parseSaid bug broke exactly the FIRST in-app Kosmos+ sign-in while every check
 * ran from a Mac already signed in. A first sign-in needs the emailed code, and the only
 * readable seed inbox is behind the Gmail connector, which only an agent can use; so the
 * sign-in is run by an agent (plus-signin-fresh.js) and leaves a record, sha-bound, that
 * the promote reads.
 *
 * WHERE: <dir>/plus-signin-<sha256>.json, one file per artifact sha (a record for an older
 * build can never be read as this one's), where <dir> is
 *   $KOSMOS_PLUS_VERIFY_DIR                     when set (tests, or a copied record);
 *   $HOME/.local/state/kosmos/release-verify    otherwise (beside the Windows records).
 *
 * SHAPE: { version, sha256, board, at, seed, placement, steps: [{ id, result, detail? }], result }
 *   board:     the answering board's identity header (x-kosmos-board, "<version>@<world>"), whose
 *              version must be the pointer's: the record is about the board that was driven;
 *   placement: where the code email landed in the seed inbox, as Gmail labels it:
 *              'INBOX', 'SPAM', or 'OTHER' (#1591's question, answered each cut);
 *   steps:     every id in STEPS once, in any order, each 'pass' or 'fail';
 *   result:    'pass' only when every step passed.
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

/* The first sign-in, in order. `enrolled` is the identity on disk; `up` is the switch on and the
   tunnel connected (#3827 was enrolled with the switch left off: enrolled alone cannot see it).
   `forget` retires the throwaway registration again. */
const STEPS = ['fresh', 'start', 'code', 'verify', 'second', 'register', 'enrolled', 'up', 'forget'];
/* NONE: no code email was sent (signin-start failed), so there is no placement to report. */
const PLACEMENTS = ['INBOX', 'SPAM', 'OTHER', 'NONE'];
const SHA = /^[0-9a-f]{64}$/;

/** The version part of a board identity header ("0.6.97@world" or, on Windows, "0.6.97+sha@world"). */
function boardVersion(identity) {
  if (typeof identity !== 'string' || !identity) return null;
  return identity.split('@')[0].split('+')[0] || null;
}

function recordDir(env = process.env) {
  if (typeof env.KOSMOS_PLUS_VERIFY_DIR === 'string' && env.KOSMOS_PLUS_VERIFY_DIR) return env.KOSMOS_PLUS_VERIFY_DIR;
  return path.join(env.HOME || os.homedir(), '.local', 'state', 'kosmos', 'release-verify');
}
function recordPath(sha, env = process.env) {
  if (!SHA.test(String(sha))) throw new Error('not a sha256: ' + sha);
  return path.join(recordDir(env), 'plus-signin-' + sha + '.json');
}

/** { ok: true } or { ok: false, why } for a record against the pointer's version and sha. */
function validate(rec, { version, sha256 }) {
  if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return { ok: false, why: 'the record is not an object' };
  if (rec.sha256 !== sha256) return { ok: false, why: 'the record names sha256 ' + rec.sha256 + ', not ' + sha256 };
  if (rec.version !== version) return { ok: false, why: 'the record names version ' + rec.version + ', not ' + version };
  if (typeof rec.at !== 'string' || Number.isNaN(Date.parse(rec.at))) return { ok: false, why: 'the record has no time' };
  if (boardVersion(rec.board) !== version) return { ok: false, why: 'the record was made on a board reporting ' + JSON.stringify(rec.board) + ', not version ' + version };
  if (!PLACEMENTS.includes(rec.placement)) return { ok: false, why: 'the record names no placement for the code email' };
  if (!Array.isArray(rec.steps)) return { ok: false, why: 'the record has no steps' };
  const seen = new Map();
  for (const s of rec.steps) {
    if (!s || !STEPS.includes(s.id)) return { ok: false, why: 'the record has an unknown step: ' + JSON.stringify(s && s.id) };
    if (seen.has(s.id)) return { ok: false, why: 'the record lists step ' + s.id + ' twice' };
    if (s.result !== 'pass' && s.result !== 'fail') return { ok: false, why: 'step ' + s.id + ' has no pass/fail result' };
    seen.set(s.id, s.result);
  }
  const missing = STEPS.filter((id) => !seen.has(id));
  if (missing.length) return { ok: false, why: 'the record is missing step(s): ' + missing.join(', ') };
  const allPass = STEPS.every((id) => seen.get(id) === 'pass');
  if (rec.result === 'pass' && !allPass) return { ok: false, why: 'the record says pass but a step failed' };
  if (rec.result !== 'pass' && rec.result !== 'fail') return { ok: false, why: 'the record result is ' + JSON.stringify(rec.result) };
  return { ok: true };
}

function write(rec, env = process.env) {
  const f = recordPath(rec.sha256, env);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = f + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(rec, null, 2) + '\n');
  fs.renameSync(tmp, f);
  return f;
}

module.exports = { STEPS, PLACEMENTS, boardVersion, recordDir, recordPath, validate, write };

/* CLI for the gate: `node plus-signin-record.js check <version> <sha256>` prints one line and
   exits 0 (pass) / 1 (fail or ambiguous) / 2 (no record). */
if (require.main === module) {
  const [cmd, version, sha256] = process.argv.slice(2);
  if (cmd !== 'check' || !version || !SHA.test(String(sha256))) { console.log('plus-signin-verified: bad arguments - cannot tell'); process.exit(2); }
  const f = recordPath(sha256);
  // An attempt in flight (start ran, finish has not): its result is not known yet. A standing FAIL
  // still refuses (a new attempt must not turn a refusal into a "cannot tell"); anything else exits 2,
  // which the promote now warns about and proceeds past (#3940).
  const inFlight = fs.existsSync(f.replace(/\.json$/, '.progress.json'));
  let raw;
  try { raw = fs.readFileSync(f, 'utf8'); } catch { console.log('plus-signin-verified: no record for ' + sha256 + ' at ' + f + (inFlight ? ' (an attempt is in flight)' : '') + ' - not verified (to verify, run tools/plus-signin-fresh.js against the fresh staging board)'); process.exit(2); }
  let rec;
  try { rec = JSON.parse(raw); } catch { console.log('plus-signin-verified: the record at ' + f + ' is not JSON - refusing'); process.exit(1); }
  const v = validate(rec, { version, sha256 });
  if (!v.ok) { console.log('plus-signin-verified: ambiguous record (' + v.why + ') at ' + f + ' - refusing'); process.exit(1); }
  if (rec.result !== 'pass') {
    const failed = rec.steps.filter((s) => s.result !== 'pass').map((s) => s.id + (s.detail ? ' (' + s.detail + ')' : ''));
    console.log('plus-signin-verified: the first Kosmos+ sign-in FAILED on ' + version + ': ' + failed.join('; ') + ' - refusing');
    process.exit(1);
  }
  if (inFlight) { console.log('plus-signin-verified: a new attempt for ' + version + ' is in flight (start ran, finish has not) - not verified yet'); process.exit(2); }
  console.log('plus-signin-verified: the first Kosmos+ sign-in PASSED on ' + version + ' (code email in ' + rec.placement + ', ' + rec.at + ')');
  process.exit(0);
}
