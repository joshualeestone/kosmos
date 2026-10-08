'use strict';
/**
 * #5534 (Enterprise E0.5): the company policy an enrolled board applies. Design on the card (agreed with the E0.1 and
 * E0.2 owners): the coordinator signs each org's policy as a KST1 token of `typ: org_policy` with its own key, the
 * key every Kosmos+ Mac already pins; the tunnel fetches it on its Mac-signed org-status call and writes it to
 * `org_policy.kst` in its state folder; this module verifies it AGAIN (the file is on disk, so it is not trusted),
 * refuses a lower version than the one applied (no rollback by replaying an old bundle), and keeps the last good one
 * in force when a new one is refused. Nothing here stops a running agent: a disallowed provider or model is refused
 * when an agent is CREATED or LAUNCHED, and what is out of policy is reported, never bricked.
 *
 * Payload (v1): { typ: 'org_policy', v: 1, org, version, issued_at, exp, policy: { providers_allowed, models_allowed,
 * backup: { required, max_age_hours }, telemetry: { required }, ai_policy: { name, text } } }. A null list means "not
 * restricted". Providers are named by the board's own ids (anthropic, openai, google, xai, antigravity, meta), the
 * ones create.js uses, and models by their Kosmos key or full id (opus or claude-opus-...); either matches.
 * Enforced when an agent is created, switched to another provider or switched to another model. An agent already
 * on a provider or model the policy later drops keeps running and keeps relaunching (the card: nothing is
 * bricked); showing it as out of policy is the console's job (E0.4). Gating on enrollment, reporting the applied
 * version and the AI policy text follow once E0.2 and E0.3 land.
 */
const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');
const kst1 = require('./kst1');

const TYP = 'org_policy';
// The tunnel's state folder, derived exactly as engine/remote.js does (one derivation of the data root).
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
  if (applied && applied.org === p.org) {
    if (p.version < applied.version) return { applied, refused: `an older policy (version ${p.version}) than the one in force (${applied.version})` };
    if (p.version === applied.version) {
      // Same version, same words: nothing to do. Same version, other words: the coordinator never does that.
      return JSON.stringify(p.policy) === JSON.stringify(applied.policy)
        ? { applied, refused: null }
        : { applied, refused: `a different policy under the same version (${p.version})` };
    }
  }
  const rec = { org: p.org, version: p.version, issued_at: p.issued_at, applied_at: Math.floor(Date.now() / 1000), policy: p.policy };
  try { writeApplied(rec); } catch (e) { return { applied, refused: 'the policy could not be saved: ' + ((e && e.message) || e) }; }
  return { applied: rec, refused: null };
}

/** The policy in force, or null when there is none. */
function current() {
  const a = readApplied();
  return a ? a.policy : null;
}

/**
 * Whether a new agent may run on this provider and model under the policy in force. No policy: allowed.
 * { ok: true } | { ok: false, because } (the sentence a person reads).
 */
function allows({ provider, model } = {}, policy = current()) {
  if (!policy) return { ok: true };
  // A model may come as several names for one model (its Kosmos key and its full id); any one listed allows it.
  const names = (Array.isArray(model) ? model : [model]).filter((x) => typeof x === 'string' && x !== '');
  const providers = policy.providers_allowed;
  if (Array.isArray(providers) && !providers.includes(provider)) {
    return { ok: false, because: `your company's policy does not allow ${provider || 'this provider'} for new agents` };
  }
  const models = policy.models_allowed && policy.models_allowed[provider];
  if (Array.isArray(models) && names.length && !names.some((n) => models.includes(n))) {
    return { ok: false, because: `your company's policy does not allow the model ${names[0]} on ${provider}` };
  }
  return { ok: true };
}

module.exports = { refresh, current, allows, TYP, BUNDLE, PINNED, APPLIED };
