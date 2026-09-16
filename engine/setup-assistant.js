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
 * - NAME = the user's own name (Josh: "we would name it My Name (Josh)"). If the
 *   About-you step was skipped so there is no saved name, we SKIP the assistant
 *   rather than invent a name -- a nameless helper is worse than none.
 * - AVATAR = the user's own picture, copied onto the agent, best-effort. No
 *   picture -> the agent keeps the default initials avatar. Never fatal.
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
const you = require('./you');
const store = require('./store');
const accounts = require('./accounts');
const create = require('./create');

const SETUP_ROLE_KEY = 'setup';

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

/* Copy the user's own picture onto the freshly-created agent. Best-effort and
 * fully isolated: any failure leaves the agent with its default avatar and never
 * affects the create outcome or onboarding. */
function copyUserAvatar(agentName) {
  try {
    const pic = you.picturePath();           // null when the user has no picture
    if (!pic) return false;
    const type = MIME_BY_EXT[path.extname(pic).toLowerCase()];
    if (!type) return false;                 // an extension we do not serve -> skip
    const buf = fs.readFileSync(pic);
    store.saveAvatar(agentName, type, buf);
    return true;
  } catch { return false; }
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
function seedSetupAssistant({ createAgent, hasConnectedAccount = defaultHasConnectedAccount } = {}) {
  if (typeof createAgent !== 'function') return { seeded: false, reason: 'no createAgent provided' };
  if (setupAssistantSeeded()) return { seeded: false, reason: 'already seeded' };

  // Name after the user; skip (do not invent a name) if there is none saved.
  let name;
  try {
    const rec = you.read();
    name = rec && rec.state === 'saved' && rec.you && typeof rec.you.name === 'string'
      ? rec.you.name.trim() : '';
  } catch { name = ''; }
  if (!name) return { seeded: false, reason: 'no saved user name to name the assistant after' };

  // A live agent needs a model. Gate on a connected account rather than create a
  // KeepAlive agent that would loop on auth failure (see the header note).
  let connected;
  try { connected = !!hasConnectedAccount(); } catch { connected = false; }
  if (!connected) return { seeded: false, reason: 'no connected account to run the assistant on' };

  let out;
  try {
    out = createAgent({
      name,
      role: SETUP_ROLE_KEY,
      createdBy: 'kosmos',
      purpose: 'default Kosmos setup assistant (auto-created on first-run, #3034)',
    });
  } catch (err) {
    // createAgent is not expected to throw (it returns a refusal outcome), but
    // if it does, swallow it -- onboarding has already completed.
    return { seeded: false, reason: 'create threw: ' + String((err && err.message) || err) };
  }

  if (!out || out.outcome !== create.OUTCOME.CREATED) {
    // Benign remaining case: createAgent refuses because the Claude runner is not
    // installed (its actual account/model refusal path). No flag is written.
    return { seeded: false, reason: 'not created: ' + ((out && out.because) || (out && out.outcome) || 'unknown') };
  }

  const avatarCopied = copyUserAvatar(out.name || name);
  return { seeded: true, name: out.name || name, avatarCopied };
}

module.exports = {
  SETUP_ROLE_KEY,
  flagPath,
  setupAssistantSeeded,
  markSetupAssistantSeeded,
  defaultHasConnectedAccount,
  seedSetupAssistant,
};
