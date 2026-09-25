'use strict';

/*
 * #3034: the default Kosmos setup-assistant agent.
 *
 * Josh, 2026-09-14: "After the install process, when we hit Giddy Up ... create
 * an agent that is a Kosmos setup assistant ... named after the user ... give it
 * my avatar ... a set of instructions on how to set up and get the most out of
 * Kosmos." And, resolving the open questions: "It would be a LIVE agent that
 * would run on one of their models. It would burn through their user quota but
 * that's fine because they're giving us access to one of their models."
 *
 * This seeds exactly one such agent, ONCE EVER, the moment the first model is
 * connected on an install that has been through first-run since #3660 (Splinter,
 * 2026-09-24 19:06): ensureGuide(), below, at Giddy Up or from the board's sweep.
 * The design is deliberately conservative and reversible (a normal deletable agent,
 * additive, one flag file), and every branch fails toward NOT disrupting
 * onboarding -- see the decisions below.
 *
 * DECISIONS (mine, per Josh's make-your-best-call ruling; adjust freely):
 * - NAME and AVATAR are JOSH'S, not the user's. Josh, 2026-09-24 16:05: "I think
 *   i want to use my avatar and play off the fact that I built it and will help
 *   them." The first version (#3153) read the 09-14 note ("give it my avatar")
 *   as the USER'S picture and name; his 09-24 ruling settles it the other way. So
 *   the guide is GUIDE_NAME, carries GUIDE_TAG so nobody mistakes it for him
 *   typing live, and wears the bundled picture at GUIDE_AVATAR_BASE when one is
 *   shipped (no picture -> the initials avatar; never fatal). The role's own text
 *   (engine/roles.js, `setup`) says the same, so the words and the face agree.
 *   A saved user name is therefore no longer needed to seed.
 * - MODEL/ACCOUNT = the first connected model, on ITS provider (Claude, OpenAI,
 *   Gemini, Grok, in that order; a named account by its dir, a default as none),
 *   found by findModel() through create's own accountConnectable gate. Josh: runs
 *   on the user's own model, quota-burn accepted. An OpenAI-only person gets a
 *   guide on OpenAI (the v1 limitation, Claude only, is gone).
 * - CONNECTED-MODEL GATE (the correctness crux). A created agent launches under
 *   launchd KeepAlive, so an agent with no model would respawn and fail on a loop.
 *   So nothing is created until a model is connected; before that the bubble runs
 *   on the hosted model (#3660). seedSetupAssistant()'s own `hasConnectedAccount`
 *   check (Claude-only by default) is kept for direct callers; ensureGuide bypasses
 *   it because findModel has already answered it, more strictly.
 * - ROLE = the `setup` role (engine/roles.js, menu:false so it is never in the
 *   normal create flow).
 * - The help-BUBBLE Josh floated is explicitly phase 2 and NOT built here.
 *
 * `createAgent` and `hasConnectedAccount` are injected so this is testable
 * without launching a real agent or depending on real account config.
 */

const fs = require('fs');
const path = require('path');
const store = require('./store');
const accounts = require('./accounts');
const create = require('./create');

const SETUP_ROLE_KEY = 'setup';

/* The guide's name, and the words that say it is an AI (#3034, Josh 2026-09-24).
   GUIDE_TAG is for every surface that shows the guide's name, so the label
   travels with it; the role's label says the same. */
const GUIDE_NAME = 'Josh';
const GUIDE_TAG = require('./roles').GUIDE_TAG;
/* Tried only when GUIDE_NAME is taken (Josh running his own build most likely has an
   agent called Josh already): the seed runs once, so a refused name would otherwise mean
   no guide ever, with nothing saying why. */
const GUIDE_FALLBACK_NAME = 'Josh AI';

/* A file the seed drops in the guide's own folder. The page route writes only where it
   finds this, so a guide whose folder was deleted never has its page reports land in a
   later, unrelated agent that happens to take the same name. A plain REMOVE deletes
   nothing on disk, so the marker survives it; the route checks the removed list for that. */
const GUIDE_MARKER = '.kosmos-setup-guide';

/* Where the bundled picture of Josh lives: web/icons/setup-guide-avatar.<ext>,
   inside web/ so the app bundle ships it (tools/build-kosmos-bundle.sh copies web/
   whole). Absent until the photo is chosen; the seed then uses the initials. */
const GUIDE_AVATAR_DIR = path.join(__dirname, '..', 'web', 'icons');
const GUIDE_AVATAR_BASE = 'setup-guide-avatar';

/* #3034/#3660: the setup guide is created automatically, but WHEN is the point.
 * History: gated off 2026-09-16 (Josh: "I haven't given direction on it"). Direction
 * since: Josh 2026-09-24 16:05 (his avatar, speaks as the builder) and 18:07 (the
 * hosted assistant until they connect a model, #3660); Splinter's call 19:06 on #3660:
 * create the guide THE MOMENT THE FIRST MODEL IS CONNECTED, during setup or later,
 * never at Giddy Up without a model (it could not run and would sit broken on the
 * board). So this switch arms ensureGuide(), below, rather than creating at Giddy Up.
 * Reversible: false turns every automatic path off again; seedSetupAssistant() still
 * works when called directly. */
const FIRSTRUN_AUTOCREATE_ENABLED = true;

/* Once-ever flag, same shape/rationale as projects.js welcome-seed: an empty
 * store cannot tell "never seeded" from "the user deleted the assistant", so the
 * flag is what separates them -- we must not re-create one the user removed. */
function flagPath() { return path.join(store.ROOT, 'setup-assistant.json'); }

function setupAssistantSeeded() {
  try { return fs.existsSync(flagPath()); }
  catch { return false; }
}

/* Written by the caller only AFTER a successful create, so a refused/skipped
 * create leaves no flag. Best-effort: a failed flag write just risks a second
 * attempt on a later completion POST, which the name-collision refusal in
 * createAgent then catches -- belt and braces, not the primary guard. */
function markSetupAssistantSeeded(meta) {
  try {
    fs.writeFileSync(flagPath(),
      JSON.stringify({ at: new Date().toISOString(), ...(meta || {}) }) + '\n', 'utf8');
  } catch { /* the collision refusal still guards the common double-POST case */ }
}

/* Fast, config-based "is a Claude account connected" (accounts.list() reads the
 * account dirs' oauthAccount, no live probe). Fails toward "not connected" so a
 * read error never causes a churning dead agent to be created. */
function defaultHasConnectedAccount() {
  try { return accounts.list().length > 0; }
  catch { return false; }
}

const MIME_BY_EXT = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp',
};

/* The bundled picture of Josh, or null when none is shipped. `dir` is injectable
   so a test can point it at a sandbox. */
function guideAvatarPath(dir = GUIDE_AVATAR_DIR) {
  for (const ext of Object.keys(MIME_BY_EXT)) {
    const f = path.join(dir, GUIDE_AVATAR_BASE + ext);
    try { if (fs.statSync(f).isFile()) return f; } catch { /* not this one */ }
  }
  return null;
}

/* Copy the guide's picture onto the freshly-created agent. Best-effort and
 * fully isolated: any failure leaves the agent with its default avatar and never
 * affects the create outcome or onboarding. store.saveAvatar sniffs the bytes, so
 * a mislabelled file is refused there rather than trusted by its extension. */
function copyGuideAvatar(agentName, dir) {
  try {
    const pic = guideAvatarPath(dir);
    if (!pic) return false;
    const type = MIME_BY_EXT[path.extname(pic).toLowerCase()];
    if (!type) return false;
    store.saveAvatar(agentName, type, fs.readFileSync(pic));
    return true;
  } catch { return false; }
}

function guideFolder(agentName) {
  try {
    const file = require('./instructions').fileFor(agentName);
    return typeof file === 'string' && file ? path.dirname(file) : null;
  } catch { return null; }
}

/* Mark the freshly-created guide's folder. Best-effort: without it the page route
   answers 409 rather than write somewhere it cannot vouch for. */
function markGuideFolder(agentName) {
  const dir = guideFolder(agentName);
  if (!dir) return false;
  try { fs.writeFileSync(path.join(dir, GUIDE_MARKER), `${agentName}\n`, { flag: 'w' }); return true; }
  catch { return false; }
}

/* Is this agent's folder the one the seed made for the guide? */
function isGuideFolder(agentName) {
  const dir = guideFolder(agentName);
  if (!dir) return false;
  try { return fs.lstatSync(path.join(dir, GUIDE_MARKER)).isFile(); } catch { return false; }
}

/* The guide's agent name as recorded when it was seeded, or null (never seeded,
 * or a flag we cannot read). The page-context route writes only for this agent. */
function guideName() {
  try {
    const rec = JSON.parse(fs.readFileSync(flagPath(), 'utf8'));
    return rec && typeof rec.name === 'string' && rec.name ? rec.name : null;
  } catch { return null; }
}

/*
 * Seed the setup assistant if it has never been seeded. Returns:
 *   { seeded: true, name, avatarCopied, marked } -- created
 *   { seeded: false, reason: '<why>' }            -- did not create (all benign)
 *
 * `model` ({ provider, account }) picks what it runs on; ensureGuide passes the
 * first connected one. NEVER throws: its automatic caller (ensureGuide) runs at
 * Giddy Up, which has already succeeded, and from a sweep; a helper is a nicety
 * that must not turn either into an error. The caller writes the once-ever flag
 * on `seeded: true`.
 */
function seedSetupAssistant({ createAgent, hasConnectedAccount = defaultHasConnectedAccount, avatarDir, model } = {}) {
  if (typeof createAgent !== 'function') return { seeded: false, reason: 'no createAgent provided' };
  if (setupAssistantSeeded()) return { seeded: false, reason: 'already seeded' };


  // A live agent needs a model. Gate on a connected account rather than create a
  // KeepAlive agent that would loop on auth failure (see the header note).
  let connected;
  try { connected = !!hasConnectedAccount(); } catch { connected = false; }
  if (!connected) return { seeded: false, reason: 'no connected account to run the assistant on' };

  let out;
  let name;
  for (const candidate of [GUIDE_NAME, GUIDE_FALLBACK_NAME]) {
    name = candidate;
    try {
      out = createAgent({
        name,
        role: SETUP_ROLE_KEY,
        createdBy: 'kosmos',
        purpose: `default Kosmos setup guide, ${GUIDE_TAG} (auto-created when a model was connected, #3034/#3660)`,
        /* The model that was connected, so an OpenAI-only (or Gemini, Grok) person gets a
           guide that can run; absent, createAgent's own default (Claude) applies. */
        ...(model && model.provider ? { provider: model.provider } : {}),
        ...(model && model.account ? { account: model.account } : {}),
      });
    } catch (err) {
      // createAgent is not expected to throw (it returns a refusal outcome), but
      // if it does, swallow it -- onboarding has already completed.
      return { seeded: false, reason: 'create threw: ' + String((err && err.message) || err) };
    }
    /* Only a TAKEN name moves on to the fallback; any other refusal (no runner) would
       refuse the fallback the same way. The sentence is create.js's own. */
    const taken = out && out.outcome !== create.OUTCOME.CREATED && /already an agent called/.test(String(out.because || ''));
    if (!taken) break;
  }

  if (!out || out.outcome !== create.OUTCOME.CREATED) {
    // Benign remaining case: createAgent refuses because the Claude runner is not
    // installed (its actual account/model refusal path). No flag is written.
    return { seeded: false, reason: 'not created: ' + ((out && out.because) || (out && out.outcome) || 'unknown') };
  }

  const avatarCopied = copyGuideAvatar(out.name || name, avatarDir);
  const marked = markGuideFolder(out.name || name);
  return { seeded: true, name: out.name || name, avatarCopied, marked };
}

/*
 * WHEN the guide is created (#3660, Splinter 19:06): the first time a model is connected
 * on an install that has been through setup since this shipped.
 *
 * 🔑 ARMED, NOT MERELY "A MODEL IS CONNECTED". Every install that predates this has
 * models connected and no seed flag, so a bare "connected and not seeded" check would
 * put an agent called Josh on every existing board the moment this ships. First-run
 * completion (Giddy Up) ARMS it, so only an install set up from now on gets a guide:
 * at Giddy Up if a model is already connected, or later, the first time one is.
 */
function armPath() { return path.join(store.ROOT, 'setup-assistant-armed.json'); }

function isArmed() {
  try { return fs.existsSync(armPath()); } catch { return false; }
}

/* Written at first-run completion. Best-effort: an unarmed install simply never gets
   an automatic guide, which is the safe direction. */
function armSetupAssistant() {
  try {
    if (!fs.existsSync(armPath())) fs.writeFileSync(armPath(), JSON.stringify({ at: new Date().toISOString() }) + '\n', 'utf8');
    return true;
  } catch { return false; }
}

/* The providers, in the order the person sees them (Josh 17:05, #3651), each with the
   module that lists its accounts. Only a LISTED account counts as connected. */
const MODEL_PROVIDERS = Object.freeze([
  ['anthropic', './accounts'],
  ['openai', './openaiaccounts'],
  ['google', './geminiaccounts'],
  ['xai', './grokaccounts'],
]);

/**
 * The first connected model a guide could run on: { provider, account } (account null
 * for a provider's default), or null. A listed account must also pass create's own
 * gate (accountConnectable), so a positively dead sign-in is skipped, not used.
 * `listFor` and `connectable` are injectable for tests.
 */
async function findModel({
  listFor = (mod) => require(mod).list(),
  connectable = (q) => create.accountConnectable(q),
} = {}) {
  let refused = false;
  for (const [provider, mod] of MODEL_PROVIDERS) {
    let rows;
    try { rows = listFor(mod); } catch { rows = []; }
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (!row || typeof row.dir !== 'string') continue;
      const account = row.isDefault ? null : row.dir;
      let gate;
      try { gate = await connectable({ provider, accountDir: account }); } catch { gate = { ok: false }; }
      if (gate && gate.ok) return { model: { provider, account }, refused };
      refused = true;
    }
  }
  /* refused: an account WAS listed and every one failed the gate (a dead sign-in, a
     rejected key). That check can be a live probe, so the caller backs off on it. */
  return { model: null, refused };
}

async function firstConnectedModel(deps) {
  return (await findModel(deps)).model;
}

/* After a try that reached a live check and did not create (a dead sign-in, a rejected
   key, a refused create), the next try waits: 10 minutes, doubling each time, at most a
   day. The check can be a live `claude -p` (a real request on their account) and the
   sweep runs every minute, so a failure that never clears costs one check a day. */
const RETRY_AFTER_MS = 10 * 60 * 1000;
const RETRY_MAX_MS = 24 * 60 * 60 * 1000;
let inFlight = null;
let lastFailedAt = 0;
let failures = 0;

function retryWaitMs() {
  return Math.min(RETRY_MAX_MS, RETRY_AFTER_MS * Math.pow(2, Math.max(0, failures - 1)));
}

/**
 * Create the guide if, and only if: the automatic path is on, this install is armed,
 * it has never been seeded, and a model is connected. Idempotent and single-flight:
 * a Giddy Up and a sweep tick arriving together create at most one. Never throws.
 * Resolves { seeded, name?, reason? }. `deps` is for tests.
 */
function ensureGuide({ createAgent, via = 'model-connected', now = Date.now(), deps = {} } = {}) {
  if (inFlight) return inFlight;
  /* Test servers run with AGENT_WORKFORCE_DRY_RUN=1, and with a signed-in sandbox account
     they would each create a guide nobody asserts (review round 2, measured). So under dry
     run it is off unless a test turns it on with AGENT_WORKFORCE_SETUP_GUIDE=on. */
  const dryRun = process.env.AGENT_WORKFORCE_DRY_RUN === '1' && process.env.AGENT_WORKFORCE_SETUP_GUIDE !== 'on';
  const enabled = deps.enabled !== undefined ? deps.enabled : (FIRSTRUN_AUTOCREATE_ENABLED && !dryRun);
  if (!enabled) return Promise.resolve({ seeded: false, reason: 'the automatic setup guide is switched off' });
  /* "Don't show this again" (the bubble's switch) also means: no guide agent later. */
  let wanted = true;
  try { wanted = settingFrom(deps.settings !== undefined ? deps.settings : store.readSettings()).on; } catch { wanted = true; }
  if (!wanted) return Promise.resolve({ seeded: false, reason: 'the person turned setup assistance off' });
  if (!isArmed()) return Promise.resolve({ seeded: false, reason: 'not armed (this install was set up before the guide existed)' });
  if (setupAssistantSeeded()) return Promise.resolve({ seeded: false, reason: 'already seeded' });
  if (lastFailedAt && now - lastFailedAt < retryWaitMs()) return Promise.resolve({ seeded: false, reason: 'waiting before trying again' });
  inFlight = (async () => {
    try {
      const found = await findModel(deps);
      const model = found.model;
      if (!model) {
        if (found.refused) { lastFailedAt = now; failures += 1; }
        return { seeded: false, reason: found.refused ? 'a model is listed but none could run yet' : 'no model connected yet' };
      }
      /* hasConnectedAccount is already answered, more strictly, by findModel (any provider,
         create's own gate); the seed's default check is Claude-only and would refuse an
         OpenAI-only person, so it is bypassed here on purpose. */
      const seed = seedSetupAssistant({ createAgent, hasConnectedAccount: () => true, avatarDir: deps.avatarDir, model });
      if (seed && seed.seeded) {
        markSetupAssistantSeeded({ name: seed.name, via, provider: model.provider });
        lastFailedAt = 0;
        failures = 0;
        return seed;
      }
      lastFailedAt = now;
      failures += 1;
      return seed || { seeded: false, reason: 'not created' };
    } catch (err) {
      lastFailedAt = now;
      failures += 1;
      return { seeded: false, reason: 'ensureGuide failed: ' + String((err && err.message) || err) };
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/* Test seam: forget the backoff between cases. */
function resetEnsureGuideForTests() { inFlight = null; lastFailedAt = 0; failures = 0; }

/*
 * The person's switch for the setup assistant bubble (#3034; Josh, 2026-09-24 18:02:
 * "the first time they hit the X to say close or like a close this forever function
 * ... a switch in settings somewhere for setup assistance that we tell them where it
 * is if they want to reactivate it").
 *
 * Stored in the board's settings (/api/settings), not the page's storage, for the
 * reason the tips switch (#3574) gives: page storage can come back empty, and then a
 * bubble somebody closed forever would come back.
 *   on     the Settings switch. false = "Don't show this again": no bubble at all.
 *   asked  the first-X choice (Close for now / Don't show this again) has been offered,
 *          so later closes just close.
 * The bubble, the X dialog and the Settings row are Mona's; this is only the state.
 */
const SETTING_DEFAULT = Object.freeze({ on: true, asked: false });
const SETTING_KEYS = Object.keys(SETTING_DEFAULT);

/** The stored setting with defaults filled in; anything malformed reads as the default. */
function settingFrom(stored) {
  const a = (stored && typeof stored.setupAssistant === 'object' && stored.setupAssistant) || {};
  const out = {};
  for (const k of SETTING_KEYS) out[k] = typeof a[k] === 'boolean' ? a[k] : SETTING_DEFAULT[k];
  return out;
}

/** Why a POSTed patch is refused, or null. A patch sets one or both keys, booleans only. */
function settingPatchProblem(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return 'that is not a valid setup assistant setting';
  const keys = Object.keys(patch);
  if (!keys.length) return 'that is not a valid setup assistant setting';
  for (const k of keys) {
    if (!SETTING_KEYS.includes(k)) return 'that is not a valid setup assistant setting';
    if (typeof patch[k] !== 'boolean') return 'that is not a valid setup assistant setting';
  }
  return null;
}

/** The whole setting after a valid patch, so a write of one key never drops the other. */
function mergeSetting(stored, patch) {
  const next = settingFrom(stored);
  for (const k of SETTING_KEYS) if (k in patch) next[k] = patch[k];
  return next;
}

module.exports = {
  SETUP_ROLE_KEY,
  armPath,
  isArmed,
  armSetupAssistant,
  MODEL_PROVIDERS,
  firstConnectedModel,
  RETRY_AFTER_MS,
  RETRY_MAX_MS,
  ensureGuide,
  resetEnsureGuideForTests,
  SETTING_DEFAULT,
  settingFrom,
  settingPatchProblem,
  mergeSetting,
  GUIDE_NAME,
  GUIDE_FALLBACK_NAME,
  GUIDE_TAG,
  GUIDE_MARKER,
  isGuideFolder,
  GUIDE_AVATAR_BASE,
  guideAvatarPath,
  guideName,
  FIRSTRUN_AUTOCREATE_ENABLED,
  flagPath,
  setupAssistantSeeded,
  markSetupAssistantSeeded,
  defaultHasConnectedAccount,
  seedSetupAssistant,
};
