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
 * This seeds exactly one such agent, ONCE EVER, at first-run completion. The
 * design is deliberately conservative and reversible (a normal deletable agent,
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
 * - MODEL/ACCOUNT = the user's default connected account (createAgent with no
 *   model/account). Josh: runs on the user's own model, quota-burn accepted.
 * - CONNECTED-ACCOUNT GATE (the correctness crux). The wizard's model step is
 *   SKIPPABLE, so a fresh user can reach Giddy Up with no account connected.
 *   createAgent does NOT refuse for that -- its account/model refusal only fires
 *   for an explicitly-passed unknown account, and we pass none; its own refusal
 *   is keyed on the runner BINARY (Claude Code) being installed. A created agent
 *   launches under launchd KeepAlive (ThrottleInterval 30), so an agent with no
 *   account to authenticate would respawn and fail auth on a loop. So we GATE on
 *   a connected Claude account (accounts.list(), a fast config read -- NOT the
 *   slow live `claude -p` probe) and seed nothing when there is none. A user who
 *   skipped account connection gets no assistant. Documented limitation: an
 *   OpenAI-only user also gets none in v1 (we default to the Claude provider); a
 *   follow-up could seed on the connected provider, or on first account-connect.
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
   finds this, so a guide that was deleted (its folder goes with it) never has its page
   reports land in a later, unrelated agent that happens to take the same name. */
const GUIDE_MARKER = '.kosmos-setup-guide';

/* Where the bundled picture of Josh lives: web/icons/setup-guide-avatar.<ext>,
   inside web/ so the app bundle ships it (tools/build-kosmos-bundle.sh copies web/
   whole). Absent until the photo is chosen; the seed then uses the initials. */
const GUIDE_AVATAR_DIR = path.join(__dirname, '..', 'web', 'icons');
const GUIDE_AVATAR_BASE = 'setup-guide-avatar';

/* #3034 (Josh, 2026-09-16): the first-run auto-create is GATED OFF. Josh's words:
 * "I don't know why this was set up as complete or indicated it was complete
 * because we haven't gone through this yet and I haven't given direction on it."
 * The auto-create shipped undirected (PR #3153) and is running in prod; this flag
 * removes it from the next build until Josh directs the design. The DESIGN below is
 * his to direct and is left fully intact -- this flag only controls whether
 * server.js WIRES the seed into first-run completion. Flip to true when he directs
 * it; nothing else changes, and seedSetupAssistant() still works when called
 * directly (its tests cover the design). Reversible in a commit, per Josh's
 * make-your-best-call ruling. The release-timing specifics (which cut shipped it,
 * which removes it) live in the plan and commit, not pinned here where a version
 * number would go stale. */
const FIRSTRUN_AUTOCREATE_ENABLED = false;

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
 *   { seeded: true, name, avatarCopied }        -- created
 *   { seeded: false, reason: '<why>' }           -- did not create (all benign)
 *
 * NEVER throws: the caller runs this in first-run completion, which has already
 * succeeded, and a helper is a nicety that must not turn a done onboarding into
 * an error. The caller writes the once-ever flag on `seeded: true`.
 */
function seedSetupAssistant({ createAgent, hasConnectedAccount = defaultHasConnectedAccount, avatarDir } = {}) {
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
        purpose: `default Kosmos setup guide, ${GUIDE_TAG} (auto-created on first-run, #3034)`,
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
