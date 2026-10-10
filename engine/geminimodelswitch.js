'use strict';

/**
 * #5804 (Liu Kang, 0.7.38): a Gemini agent launched on gemini-2.5-flash showed "Gemini 3.5 Flash" on its card. The card
 * names the model the Gemini CLI recorded on its newest reply (engine/geminisession.js), and the CLI falls back to
 * another model on a failure (its fallback/handler.ts; in 0.61.0 its base Flash is gemini-3.5-flash), so the card was
 * most likely right. What was missing is any word that the model changed. This decides when to say so.
 *
 * `startedModelName(name)` is the display name of the model the agent is SET to (the job's own model, or the launcher's
 * default), or null when there is nothing to say. The card words it "(set to X)", which stays true even when a model
 * change saved X but the restart did not happen (review 3): the setting is X whatever the process is running. Mac and
 * Linux only: the run start comes from tmux, which Windows does not have, so there it is always null (fails safe).
 * Null when:
 *   - the started model is not a concrete versioned id ("auto", "flash", "pro" are the CLI's own aliases, which pick a
 *     model by design: there is no switch to report);
 *   - the newest reply was written before this run began (after a model change and restart, the newest reply is still
 *     the previous run's until the agent answers again);
 *   - the reply came from the same model, by canonical id (review 3: "gemini-2.5-flash-001", "-latest", "-preview..."
 *     are the same model as "gemini-2.5-flash"), or anything could not be read.
 */

/* A model id without the suffixes that name the same model: a numeric revision, -latest, -preview..., -exp.... */
function canonicalId(id) {
  return String(id == null ? '' : id).toLowerCase().trim()
    .replace(/-(?:preview|exp)(?:-[a-z0-9.-]*)?$/, '')
    .replace(/-latest$/, '')
    .replace(/-\d{3}$/, '');
}

/* Everything it reads, injectable for tests; production passes nothing. */
function realDeps() {
  const create = require('./create');
  const status = require('./status');
  return {
    planned: (name) => create.plannedModelOf(name),
    session: (name) => status.readGeminiSession(name),   // review 2: the one reader (its own account's home), not a copy
    startedAt: (name) => status.sessionStartedAtFromTmux(name),
    display: (id) => status.modelDisplayName(id),
  };
}

function startedModelName(name, deps) {
  const d = deps || realDeps();
  let planned; let sess; let startedAt;
  try { planned = d.planned(name); } catch { return null; }
  if (!planned || typeof planned.id !== 'string' || !/\d/.test(planned.id)) return null;   // an alias picks by design
  try { sess = d.session(name); } catch { return null; }
  if (!sess || !sess.found || typeof sess.model !== 'string' || !sess.model || !Number.isFinite(sess.modelAt)) return null;
  try { startedAt = d.startedAt(name); } catch { return null; }
  if (!Number.isFinite(startedAt) || sess.modelAt < startedAt) return null;   // the reply is from an earlier run
  if (canonicalId(planned.id) === canonicalId(sess.model)) return null;       // the same model, however spelled
  let started;
  try { started = d.display(planned.id); } catch { return null; }
  return started || null;
}

module.exports = { startedModelName, canonicalId };
