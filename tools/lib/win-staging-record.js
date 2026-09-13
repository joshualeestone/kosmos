'use strict';
/**
 * win-staging-record.js -- THE one spec of the Windows staging verification record.
 *
 * Two sides read this file and nothing else for the record's format:
 *   - the WRITER, tools/win-staging-verify.js, run on the Windows box after it verifies a staged
 *     build (it builds the record with buildRecord and writes it at recordPath);
 *   - the READER, tools/win-staging-verified.sh, the gate promote-channel.sh --family win runs
 *     (it finds the record at recordPath and judges it with validateRecord).
 * One module, so the writer can never produce a record the gate reads differently (CLAUDE.md
 * convention 5). tools.win-staging-verify.test.js round-trips a written record through the real
 * gate.
 *
 * The record is the TECHNICAL half of a Windows promote; Josh's go (--approval-ref) is the other.
 * It must never claim a check that did not happen, so:
 *   - every required check is listed with WHO performed it: `automated` (the writer ran it in
 *     that run) or `operator` (a person ran it and attested the answer with --attest);
 *   - a check nobody ran is `not-run`, and `result` is derived here, never passed in: `pass` only
 *     when every required check passed;
 *   - the reader re-derives `result` from the checks, so a record hand-edited to "pass" over a
 *     failed or missing check is AMBIGUOUS (refused), not a pass.
 */
const os = require('node:os');
const path = require('node:path');

/** The checks a staged Windows build must pass before it can be promoted, in the order they run.
    `by` is fixed per check: an automated check can never be attested, and an operator check can
    never be recorded as automated. The operator checks are the ones that verified 0.6.55 on the
    Windows box (KOSMOS-HANDOFF.md, 2026-09-11): the Explorer unpack, Z0-Z6 (kosmos-scripts\e2e-zip.js),
    the multiline check and the msg check. */
const REQUIRED_CHECKS = Object.freeze([
  Object.freeze({ id: 'sha', by: 'automated',
    label: 'V1 the staged zip hashes to the staging pointer sha256 and to its .sha256 sidecar' }),
  Object.freeze({ id: 'manifest', by: 'automated',
    label: 'V1 the zip manifest.json names the pointer version and a clean source commit' }),
  Object.freeze({ id: 'install', by: 'operator',
    label: 'V2 unpacked through Explorer (Mark of the Web set) into a scratch folder; Kosmos.exe ran and the board serves this version' }),
  Object.freeze({ id: 'z-checks', by: 'operator',
    label: 'V2 Z0-Z6 pass (e2e-zip.js: board, sign-in, create, talk, restart, remove, restore + talk), answers on the board' }),
  Object.freeze({ id: 'multiline', by: 'operator',
    label: "V2 multiline-check.js: the agent's two-line answer lands on the board intact" }),
  Object.freeze({ id: 'msg', by: 'operator',
    label: 'V2 msg-check.js: an agent-to-agent message is delivered' }),
]);
const CHECK_RESULTS = Object.freeze(['pass', 'fail', 'not-run']);
const CHECK_PERFORMERS = Object.freeze(['automated', 'operator']);
const RECORD_RESULTS = Object.freeze(['pass', 'fail']);
/** A staged build's sha256 becomes part of the record's file name, so it must be exactly this. */
const RECORD_SHA256 = /^[0-9a-f]{64}$/;
/** manifest.json source_sha as build-kosmos-windows.sh writes it (`git rev-parse HEAD`). The writer
    passes the manifest check only on such a commit, so a pass record naming anything else was not
    written by it. */
const SOURCE_COMMIT = /^[0-9a-f]{40}$/;

/** Where records live on this box. KOSMOS_WIN_VERIFY_DIR (tests, or a record copied to the
    promoting box) wins; on Windows it is beside the Kosmos anchor (%LOCALAPPDATA%\Kosmos); on any
    other OS (the Mac release box a record is copied to) it is the XDG-style state dir. */
function recordDirectory(env = process.env) {
  if (env.KOSMOS_WIN_VERIFY_DIR) return env.KOSMOS_WIN_VERIFY_DIR;
  if (env.LOCALAPPDATA) return path.join(env.LOCALAPPDATA, 'Kosmos', 'release-verify');
  return path.join(env.HOME || os.homedir(), '.local', 'state', 'kosmos', 'release-verify');
}
/** One file per sha, so a record for an older build can never be read as this one's. */
function recordFileName(sha256) {
  if (!RECORD_SHA256.test(String(sha256))) throw new Error(`not a sha256: ${JSON.stringify(sha256)}`);
  return `win-staging-${sha256}.json`;
}
function recordPath(env, sha256) { return path.join(recordDirectory(env), recordFileName(sha256)); }

/** `pass` only when every required check is present and passed; anything else is `fail`. */
function deriveRecordResult(checks) {
  const byId = new Map((Array.isArray(checks) ? checks : []).map((check) => [check && check.id, check]));
  return REQUIRED_CHECKS.every((required) => byId.get(required.id) && byId.get(required.id).result === 'pass') ? 'pass' : 'fail';
}

/**
 * The record for one staged build. `checkResults` maps a required check id to {result, detail};
 * a check it does not name is recorded `not-run`. `by` and `label` always come from
 * REQUIRED_CHECKS, never from the caller.
 */
function buildRecord({ version, sha256, sourceSha, checkResults, at }) {
  const checks = REQUIRED_CHECKS.map((required) => {
    const given = (checkResults && checkResults[required.id]) || {};
    const result = CHECK_RESULTS.includes(given.result) ? given.result : 'not-run';
    const check = { id: required.id, label: required.label, by: required.by, result };
    if (given.detail) check.detail = String(given.detail);
    return check;
  });
  return { version, sha256, source_sha: sourceSha, checks, at, result: deriveRecordResult(checks) };
}

/**
 * The gate's judgement of a parsed record against the staging pointer's version and sha256.
 * Returns {problems} (non-empty = ambiguous, refuse) and, when there are none, {verdict}, the
 * record's own `result`. The reader maps these to its exit codes.
 */
function validateRecord(record, { version, sha256 }) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return { problems: ['the record is not a JSON object'] };
  const problems = [];
  if (record.sha256 !== sha256) problems.push(`its sha256 (${record.sha256}) is not the pointer sha256`);
  if (record.version !== version) problems.push(`its version (${record.version}) is not the pointer version ${version}`);
  if (typeof record.source_sha !== 'string' || !record.source_sha) problems.push('it names no source_sha');
  else if (record.result === 'pass' && !SOURCE_COMMIT.test(record.source_sha)) problems.push(`it says pass, but its source_sha ${JSON.stringify(record.source_sha)} is not a commit`);
  if (typeof record.at !== 'string' || !record.at) problems.push('it names no time (at)');
  if (!RECORD_RESULTS.includes(record.result)) problems.push(`its result is ${JSON.stringify(record.result)}, not pass or fail`);
  if (!Array.isArray(record.checks) || record.checks.length === 0) {
    problems.push('it lists no checks');
    return { problems };
  }
  const seen = new Set();
  for (const check of record.checks) {
    const id = check && typeof check === 'object' ? check.id : undefined;
    const required = REQUIRED_CHECKS.find((candidate) => candidate.id === id);
    if (!required) { problems.push(`it lists an unknown check ${JSON.stringify(id === undefined ? check : id)}`); continue; }
    if (seen.has(id)) problems.push(`it lists the check ${id} twice`);
    seen.add(id);
    if (!CHECK_RESULTS.includes(check.result)) problems.push(`its check ${id} has result ${JSON.stringify(check.result)}`);
    if (check.by !== required.by) problems.push(`its check ${id} says by ${JSON.stringify(check.by)}, but that check is ${required.by}`);
  }
  for (const required of REQUIRED_CHECKS) if (!seen.has(required.id)) problems.push(`it does not list the required check ${required.id}`);
  if (!problems.length && record.result !== deriveRecordResult(record.checks)) {
    problems.push(`its result ${JSON.stringify(record.result)} disagrees with its checks (which make it ${deriveRecordResult(record.checks)})`);
  }
  return problems.length ? { problems } : { problems, verdict: record.result };
}

/** One line per check for the gate's messages, e.g. "sha=pass(automated) install=not-run(operator)". */
function summarizeChecks(checks) {
  return (Array.isArray(checks) ? checks : []).map((check) => `${check && check.id}=${check && check.result}(${check && check.by})`).join(' ');
}

module.exports = {
  REQUIRED_CHECKS, CHECK_RESULTS, CHECK_PERFORMERS, RECORD_SHA256, SOURCE_COMMIT,
  recordDirectory, recordFileName, recordPath, deriveRecordResult, buildRecord, validateRecord, summarizeChecks,
};
