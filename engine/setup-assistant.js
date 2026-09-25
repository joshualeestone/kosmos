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
 *   found by listedModels() + usable() through create's own accountConnectable gate. Josh: runs
 *   on the user's own model, quota-burn accepted. An OpenAI-only person gets a
 *   guide on OpenAI (the v1 limitation, Claude only, is gone).
 * - CONNECTED-MODEL GATE (the correctness crux). A created agent launches under
 *   launchd KeepAlive, so an agent with no model would respawn and fail on a loop.
 *   So nothing is created until a model is connected; before that the bubble runs
 *   on the hosted model (#3660). seedSetupAssistant()'s own `hasConnectedAccount`
 *   check (Claude-only by default) is kept for direct callers; ensureGuide bypasses
 *   it because usable() has already answered it, more strictly.
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
 * create leaves no flag. Returns whether it stuck. A failed write would let a later
 * try create a SECOND guide (the seed falls back to "Josh AI" when "Josh" is taken),
 * so ensureGuide also keeps an in-process latch; across a restart with an unwritable
 * store, the flag cannot be trusted and nothing here can do better. */
function markSetupAssistantSeeded(meta) {
  try {
    fs.writeFileSync(flagPath(),
      JSON.stringify({ at: new Date().toISOString(), ...(meta || {}) }) + '\n', 'utf8');
    return true;
  } catch { return false; }
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
 * completion (Giddy Up) ARMS it: at Giddy Up if a model is already connected, or later,
 * the first time one is. Since #3760 (Josh, 2026-09-25) an install that finished first run
 * before the guide existed is ALSO armed, once, at board start (armExistingInstall below),
 * so existing installs get the guide too, under the same off switch as a new user.
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

/*
 * #3760, Josh 2026-09-25 11:07 (0.6.94): "anybody that has a current install won't have the helper agent. Is
 * there a way to activate that for existing users and then allow them the ability to turn it off, like we
 * normally would let new users turn it off". So an install that finished first run BEFORE the guide existed
 * is armed once, at board start after the update, exactly as Giddy Up arms a new one. Everything after
 * arming is the new-user path unchanged: ensureGuide still creates at most one guide ever (the seeded flag),
 * never while the person has turned setup assistance off, and never without a model.
 * - Only a FINISHED first run arms here. A fresh install still in onboarding is left to Giddy Up, so it is
 *   unchanged. `firstRunSeen` is firstrun.seen(); a flag we could not read (known: false) does NOT arm:
 *   first run treats it as done so onboarding is not shown over a working board, but creating an agent
 *   on a guess is the other direction.
 * - Already armed is a no-op, so this runs once per install, and a guide someone removed is not re-created
 *   (the seeded flag is once-ever; the arm file never grants a second).
 * Returns { armed: true } when it armed now, else { armed: false, reason }. Never throws.
 */
function armExistingInstall({ firstRunSeen } = {}) {
  try {
    if (isArmed()) return { armed: false, reason: 'already armed' };
    const seen = typeof firstRunSeen === 'function' ? firstRunSeen() : null;
    if (!seen || seen.known !== true || seen.done !== true) return { armed: false, reason: 'first run not finished' };
    fs.writeFileSync(armPath(), JSON.stringify({ at: new Date().toISOString(), via: 'update' }) + '\n', 'utf8');
    return { armed: true };
  } catch (err) {
    return { armed: false, reason: 'could not arm: ' + String((err && err.message) || err) };
  }
}

/* The providers, in the order the person sees them (Josh 17:05, #3651), each with the
   module that lists its accounts. Only a LISTED account counts as connected. */
const MODEL_PROVIDERS = Object.freeze([
  ['anthropic', './accounts'],
  ['openai', './openaiaccounts'],
  ['google', './geminiaccounts'],
  ['xai', './grokaccounts'],
]);

/* A DEFAULT Gemini or Grok key is the one account create's gate lets through unchecked
   (it cannot see the launch environment's key door, so it fails open for a default row).
   The guide is created only on a model that can run, so for those two it also asks the
   provider's own live check, and a key the provider positively rejects is refused. A
   default Grok SUBSCRIPTION is already live-checked by the gate, so it is not asked twice. */
const LIVE_CHECK_DEFAULT = new Set(['google', 'xai']);
const defaultLive = async (mod, dir) => {
  const m = require(mod);
  const live = await m.checkLive(dir);
  return !(live && live.state === m.STATE.NONE);
};

/* Every listed account, in provider order, and a fingerprint of the set. Cheap: the four
   list() calls read config, never the network. */
function listedModels({ listFor = (mod) => require(mod).list() } = {}) {
  const rows = [];
  let failed = false;   // a provider that could not be read: nothing is known about it (#3660 reads this)
  for (const [provider, mod] of MODEL_PROVIDERS) {
    let got;
    try { got = listFor(mod); } catch { got = []; failed = true; }
    if (!Array.isArray(got)) continue;
    for (const row of got) {
      if (!row || typeof row.dir !== 'string') continue;
      rows.push({ provider, mod, dir: row.dir, account: row.isDefault ? null : row.dir, authMode: row.authMode || null,
        who: [row.email || '', row.keyTail || ''].join('/') });
    }
  }
  /* WHO is in the fingerprint, not just WHERE: a new key or a different sign-in in the same
     folder is a new connection (review round 6). Two changes are invisible here, and the
     one-hour cap below bounds both: re-signing in to the SAME account in place, and a new
     key pasted over a Claude API-key account (Claude rows carry no key suffix, and the
     listing should not start exposing one for this). */
  return { rows, failed, fingerprint: rows.map((r) => `${r.provider}:${r.dir}:${r.authMode || ''}:${r.who}`).join('|') };
}

/* #3660: the guide agent's card, read as "their model cannot answer right now": the three states #3723
   surfaces (a usage limit or no credits, a rejected login, the provider unreachable after its retries).
   { problem, runner } or null. Josh, 2026-09-25 07:22: then the bubble falls back to the hosted assistant
   for that chat, and goes back to their model once it answers. */
function guideFailure(card) {
  const { STATE } = require('./status');   // lazy: status requires create, which the seed uses
  if (!card || ![STATE.RATE_LIMITED, STATE.AUTH_FAILED, STATE.CONNECTION_LOST].includes(card.state)) return null;
  return { problem: card.state, runner: typeof card.runner === 'string' && card.runner ? card.runner : null };
}

/* #3660: whether the bubble may use the hosted assistant (Kosmos's own model) here. Before the person has any
   model of their own; and, once they have one, only while their guide cannot answer (`failing`, from
   guideFailure; Josh 2026-09-25 07:22). An install that has a working model, or a model and no guide, does not
   spend the shared allowance on Kosmos's key. And only where a connector is at a real path
   (remote.hostedAvailable), so a source checkout or a check sandbox never offers it. */
function hostedConnector(available = () => require('./remote').hostedAvailable()) {
  try { return available() === true; } catch { return false; }
}
function hostedWhy({ available = undefined, listed = () => listedModels(), failing = () => null } = {}) {
  if (!hostedConnector(available)) return { ok: false, why: 'no_connector' };
  /* A guide that cannot answer is on a model they connected (the seed creates a guide only once a model is
     connected, and setupGuideNow checks its marker), so the listing is not needed to know it. `failing`
     THROWS when the guide's card could not be read: that is not known, so 'unchecked' (a retryable 503 on
     the hosted route), never 'own_model', which would end a fallback chat over a board hiccup. */
  let f = null;
  try { f = failing(); } catch { return { ok: false, why: 'unchecked' }; }
  if (f) return { ok: true, why: 'own_model_failing' };
  let got;
  try { got = listed(); } catch { return { ok: false, why: 'unchecked' }; }
  /* A provider that could not be read may be the one they connected: not known, so not offered, and not said to be theirs. */
  if (!got || got.failed === true) return { ok: false, why: 'unchecked' };
  const rows = got.rows;
  return rows.length === 0 ? { ok: true, why: null } : { ok: false, why: 'own_model' };
}
function hostedOffered(deps) { return hostedWhy(deps).ok; }

/* #3734: an existing guide was born told it never creates agents. Replace that paragraph, once, with the
   current hands-off and make-agents lines, in the marked guide folder only. The running guide reads its
   new instructions from its next session. { changed: boolean } */
function refreshGuideRole({ name = guideName(), isGuide = isGuideFolder } = {}) {
  if (!name || !isGuide(name)) return { changed: false };
  const roles = require('./roles');
  const instructions = require('./instructions');
  let cur;
  try { cur = instructions.read(name); } catch { return { changed: false }; }
  const old = roles.HANDS_OFF_LINES_BEFORE_3734.join('\n');
  if (!cur || !cur.exists || typeof cur.text !== 'string' || !cur.text.includes(old)) return { changed: false };
  const now = [...(roles.SETUP_HANDS_OFF ? roles.HANDS_OFF_LINES : []), ...(roles.SETUP_MAKES_AGENTS ? roles.MAKE_AGENTS_LINES : [])].join('\n');
  try {
    instructions.write(name, cur.text.replace(old, () => now), cur.version, undefined, { who: 'kosmos', because: 'Kosmos let the setup guide make agents for you' });
    return { changed: true };
  } catch { return { changed: false }; }
}

/* Could a guide run on this listed account? create's own gate, plus the default-key check
   above. A live check that errors is uncertainty, not a refusal (create's own rule). */
async function usable(row, { connectable = (q) => create.accountConnectable(q), liveDefault = defaultLive } = {}) {
  let gate;
  try { gate = await connectable({ provider: row.provider, accountDir: row.account }); }
  catch (err) {
    /* create's gate returns a state for every environmental case, so a throw is a bug in
       our own code. Same rule as create (#1916): fail OPEN, and say so loudly, rather than
       silently calling every model unusable and retrying forever with no trail. */
    console.error('#3660: setup guide account check errored (failing open):', (err && err.stack) || err);
    gate = { ok: true };
  }
  if (!(gate && gate.ok)) return false;
  if (row.account === null && LIVE_CHECK_DEFAULT.has(row.provider) && row.authMode !== 'subscription') {
    let alive;
    try { alive = await liveDefault(row.mod, row.dir); } catch { alive = true; }
    if (!alive) return false;
  }
  return true;
}

/* After a try that reached a live check and did not create (a dead sign-in, a rejected
   key, a refused create), the next try waits: 10 minutes, doubling each time, at most a
   HOUR. The check can be a live `claude -p` (a real request on their account) and the
   sweep runs every minute, so a failure that never clears costs one check an hour. A
   change in what is listed or who is signed in (they just connected something) skips the
   wait and resets it, and Giddy Up never waits: the guide is created the moment a model is
   connected (reviews 4 and 6). The hour, not a day, bounds the one change nobody can see
   from here: signing in again to the same account in the same place. */
const RETRY_AFTER_MS = 10 * 60 * 1000;
const RETRY_MAX_MS = 60 * 60 * 1000;
let inFlight = null;
let lastFailedAt = 0;
let failures = 0;
let failedFingerprint = null;
/* Set once a guide is created in this process, whatever happened to the flag write, so a
   failed write (full disk) cannot let the next sweep tick create a second guide. */
let createdHere = false;
/* Both guide names already taken by other agents: that does not clear by itself, so it is
   final for this process rather than an hourly live check plus refused creates forever
   (review round 8). A board restart tries once more. */
let namesTaken = false;

function retryWaitMs() {
  return Math.min(RETRY_MAX_MS, RETRY_AFTER_MS * Math.pow(2, Math.max(0, failures - 1)));
}

/**
 * Create the guide if, and only if: the automatic path is on, this install is armed,
 * it has never been seeded, and a model is connected. Tries each connected model in
 * order until one creates (a refused create on the first does not strand a working
 * second). Idempotent and single-flight: a Giddy Up and a sweep tick arriving together
 * create at most one. Never throws. Resolves { seeded, name?, reason? }.
 * `deps` is TESTS ONLY: listFor / connectable / liveDefault (the account seams),
 * enabled / settings (the switches) and avatarDir. Production passes none.
 */
function ensureGuide({ createAgent, via = 'model-connected', now = Date.now(), deps = {} } = {}) {
  if (inFlight) return inFlight;
  /* Test servers run with AGENT_WORKFORCE_DRY_RUN=1, and with a signed-in sandbox account
     they would each create a guide nobody asserts (review round 2, measured). So under dry
     run it is off unless a test turns it on with AGENT_WORKFORCE_SETUP_GUIDE=on. */
  const dryRun = process.env.AGENT_WORKFORCE_DRY_RUN === '1' && process.env.AGENT_WORKFORCE_SETUP_GUIDE !== 'on';
  const enabled = deps.enabled !== undefined ? deps.enabled : (FIRSTRUN_AUTOCREATE_ENABLED && !dryRun);
  if (!enabled) return Promise.resolve({ seeded: false, reason: 'the automatic setup guide is switched off' });
  /* The cheap, permanent answers first: on an existing (unarmed) or already-seeded install
     the sweep then costs one stat a minute. */
  if (!isArmed()) return Promise.resolve({ seeded: false, reason: 'not armed (first run is not finished)' });
  if (createdHere || setupAssistantSeeded()) return Promise.resolve({ seeded: false, reason: 'already seeded' });
  if (namesTaken) return Promise.resolve({ seeded: false, reason: 'both guide names are taken by other agents' });
  /* "Don't show this again" (the bubble's switch) also means: no guide agent later. */
  let wanted = true;
  try { wanted = settingFrom(deps.settings !== undefined ? deps.settings : store.readSettings()).on; } catch { wanted = true; }
  if (!wanted) return Promise.resolve({ seeded: false, reason: 'the person turned setup assistance off' });
  const listed = listedModels(deps);
  if (!listed.rows.length) return Promise.resolve({ seeded: false, reason: 'no model connected yet' });
  const changed = failedFingerprint !== null && listed.fingerprint !== failedFingerprint;
  if (changed) { lastFailedAt = 0; failures = 0; }
  if (via !== 'first-run' && lastFailedAt && now - lastFailedAt < retryWaitMs()) return Promise.resolve({ seeded: false, reason: 'waiting before trying again' });
  inFlight = (async () => {
    const fail = (reason) => { lastFailedAt = now; failures += 1; failedFingerprint = listed.fingerprint; return { seeded: false, reason }; };
    try {
      let last = null;
      for (const row of listed.rows) {
        if (!(await usable(row, deps))) continue;
        const model = { provider: row.provider, account: row.account };
        /* hasConnectedAccount is already answered, more strictly, by usable() (any
           provider, create's own gate); the seed's default check is Claude-only and would
           refuse an OpenAI-only person, so it is bypassed here on purpose. */
        const seed = seedSetupAssistant({ createAgent, hasConnectedAccount: () => true, avatarDir: deps.avatarDir, model });
        if (seed && seed.seeded) {
          createdHere = true;
          markSetupAssistantSeeded({ name: seed.name, via, provider: model.provider });
          lastFailedAt = 0;
          failures = 0;
          failedFingerprint = null;
          return seed;
        }
        last = seed;
        /* Both names taken: that is about the NAME, not the model, so the next model would
           be refused the same way after paying for its live check. Stop here. */
        if (/already an agent called/.test(String((seed && seed.reason) || ''))) { namesTaken = true; break; }
        /* Refused on this model (its runner missing, say): try the next one. */
      }
      return fail(last ? ('not created: ' + (last.reason || 'refused')) : 'a model is listed but none could run yet');
    } catch (err) {
      return fail('ensureGuide failed: ' + String((err && err.message) || err));
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/* Test seam: forget the backoff between cases. */
function resetEnsureGuideForTests() { inFlight = null; lastFailedAt = 0; failures = 0; failedFingerprint = null; createdHere = false; namesTaken = false; }

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
  armSetupAssistant,
  armExistingInstall,
  listedModels,
  hostedOffered,
  hostedWhy,
  guideFailure,
  hostedConnector,
  refreshGuideRole,
  usable,
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
