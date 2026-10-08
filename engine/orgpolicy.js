'use strict';
/**
 * #5534 (Enterprise E0.5): the company policy an enrolled board applies. Design on the card (agreed with the E0.1 and
 * E0.2 owners): the coordinator signs each org's policy as a KST1 token of `typ: org_policy` with its own key, the
 * key every Kosmos+ Mac already pins; the tunnel fetches it on its Mac-signed org-status call and writes it to
 * `org_policy.kst` in its state folder; this module verifies it AGAIN (the file is on disk, so it is not trusted) and
 * keeps the last good one in force when a new one is refused.
 *
 * Payload (v1): { typ: 'org_policy', v: 1, org, version, iat, exp, policy: { providers_allowed, models_allowed,
 * backup: { required, max_age_hours }, telemetry: { required }, ai_policy: { name, text } } }. A null list means "not
 * restricted". Providers are named by the board's own ids (anthropic, openai, google, xai, antigravity, meta), the
 * ones create.js uses, and models by their Kosmos key or full id (opus or claude-opus-...); either matches. When a
 * provider has a model list, a model must be named or be the provider's known default (create.policyAllows).
 *
 * Enforced when an agent is created (the create form, connecting a folder, importing from another Kosmos) or
 * switched to another provider or model. An agent already on something the policy later drops keeps running and
 * keeps relaunching: the card says nothing is bricked, and showing it as out of policy is the console's (E0.4).
 *
 * Rollback: the applied record keeps the highest version seen for each org, so an older bundle of an org is refused
 * even after a bundle of another org came in between.
 *
 * What this is NOT trusted for, until E0.2 binds a Mac to its org and E0.3 has the coordinator check the version each
 * board reports: the person whose Mac it is can write every file involved. They can put any validly signed, unexpired
 * bundle of ANOTHER org in place (it is not older under that org's own count), edit or delete the applied record
 * (it is not signed), or replace the pinned coordinator key in the tunnel's folder. This module keeps an honest board
 * from drifting and refuses forged or tampered bundles; it does not stop the Mac's own user.
 *
 * Not yet: gating on enrollment and leaving a company (E0.2; until then a policy stays in force once applied, and
 * only a bundle signed by the pinned coordinator key can set one), reporting the applied version (E0.3), the AI
 * policy text. The policy is per Kosmos on a Mac, as enrollment is: another Kosmos on the same Mac has its own.
 */
const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');
const kst1 = require('./kst1');

const TYP = 'org_policy';
// The tunnel's state folder: the same derivation as remote.js's STATE_DIR, read live rather than frozen at load (so a
// test can point it elsewhere); remote.js is not required for it because loading it starts that module's timers.
const stateDir = () => process.env.AGENT_WORKFORCE_TUNNEL_STATE || path.join(store.ROOT, 'remote');
const BUNDLE = () => path.join(stateDir(), 'org_policy.kst');
const PINNED = () => path.join(stateDir(), 'coordinator_pubkey');
const APPLIED = () => path.join(store.ROOT, 'org-policy-applied.json');

function readText(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch { return null; }
}

function readApplied() {
  const raw = readText(APPLIED());
  if (raw === null) return null;
  try {
    const j = JSON.parse(raw);
    return j && Number.isInteger(j.version) && j.policy && typeof j.policy === 'object' ? j : null;
  } catch { return null; }
}

function writeApplied(rec) {
  const file = APPLIED();
  const tmp = `${file}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(rec, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, file);
}

const list = (v) => (v === null || v === undefined ? null : Array.isArray(v) && v.every((x) => typeof x === 'string') ? v : undefined);

/** The policy object's shape is checked, so a signed but malformed bundle is refused rather than half-applied. */
function shapeOk(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return false;
  if (list(p.providers_allowed) === undefined) return false;
  const m = p.models_allowed;
  if (m !== null && m !== undefined) {
    if (typeof m !== 'object' || Array.isArray(m)) return false;
    if (!Object.values(m).every((v) => list(v) !== undefined && v !== null)) return false;
  }
  return true;
}

/**
 * Read the tunnel's bundle and apply it if it verifies. Never throws. Returns what is in force:
 * { applied: <record or null>, refused: <why or null> }. A missing bundle with nothing applied is "no policy".
 * `now` and `pinned` are for tests.
 */
function refresh({ now, pinned } = {}) {
  const applied = readApplied();
  const token = readText(BUNDLE());
  if (token === null) return { applied, refused: null };
  const key = pinned !== undefined ? pinned : readText(PINNED());
  const v = kst1.verify(token, key, TYP, now);
  if (!v.ok) return { applied, refused: v.why };
  const p = v.payload;
  if (p.v !== 1 || typeof p.org !== 'string' || !p.org || !Number.isInteger(p.version) || p.version < 1 || !shapeOk(p.policy)) {
    return { applied, refused: 'the policy bundle is not one this Kosmos understands' };
  }
  const marks = applied && applied.marks && typeof applied.marks === 'object' && !Array.isArray(applied.marks) ? applied.marks : {};
  const mark = Math.max(Number.isInteger(marks[p.org]) ? marks[p.org] : 0, applied && applied.org === p.org ? applied.version : 0);
  if (p.version < mark) return { applied, refused: `an older policy (version ${p.version}) than one already applied (${mark})` };
  if (applied && applied.org === p.org) {
    if (p.version === applied.version) {
      // Same version, same words: nothing to do. Same version, other words: the coordinator never does that.
      return JSON.stringify(p.policy) === JSON.stringify(applied.policy)
        ? { applied, refused: null }
        : { applied, refused: `a different policy under the same version (${p.version})` };
    }
  }
  const nextMarks = { ...marks, [p.org]: Math.max(mark, p.version) };
  if (applied && Number.isInteger(applied.version)) nextMarks[applied.org] = Math.max(nextMarks[applied.org] || 0, applied.version);
  const rec = { org: p.org, version: p.version, iat: p.iat, applied_at: Math.floor(Date.now() / 1000), policy: p.policy, marks: nextMarks };
  try { writeApplied(rec); } catch (e) { return { applied, refused: 'the policy could not be saved: ' + ((e && e.message) || e) }; }
  return { applied: rec, refused: null };
}

/** The policy in force, or null when there is none. */
function current() {
  const a = readApplied();
  return a ? a.policy : null;
}

/** The policy in force after applying whatever bundle the tunnel has written since (two small reads and one
 *  signature check, so it is asked fresh at every create and switch rather than on a timer). Never throws. */
function inForce() {
  try { const r = refresh(); return r.applied ? r.applied.policy : null; } catch { return current(); }
}

/**
 * Whether a new agent may run on this provider and model under the policy in force. No policy: allowed.
 * { ok: true } | { ok: false, because } (the sentence a person reads).
 */
function allows({ provider, model } = {}, policy = inForce()) {
  if (!policy) return { ok: true };
  // A model may come as several names for one model (its Kosmos key and its full id); any one listed allows it.
  const names = (Array.isArray(model) ? model : [model]).filter((x) => typeof x === 'string' && x !== '');
  const providers = policy.providers_allowed;
  if (Array.isArray(providers) && !providers.includes(provider)) {
    return { ok: false, because: `your company's policy does not allow ${provider || 'this provider'} for new agents` };
  }
  const models = policy.models_allowed && policy.models_allowed[provider];
  if (Array.isArray(models) && !names.length) {
    // No model named and none known for it (a vendor's own default): no list can name it, so it is not allowed.
    return { ok: false, because: `your company's policy allows only some models on ${provider}: choose one of them` };
  }
  if (Array.isArray(models) && !names.some((n) => models.includes(n))) {
    return { ok: false, because: `your company's policy does not allow the model ${names[0]} on ${provider}` };
  }
  return { ok: true };
}

module.exports = { refresh, current, inForce, allows, TYP, BUNDLE, PINNED, APPLIED };
