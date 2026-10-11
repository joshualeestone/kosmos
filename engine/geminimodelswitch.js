'use strict';

/**
 * #5804 (Liu Kang, 0.7.38): a Gemini agent launched on gemini-2.5-flash showed "Gemini 3.5 Flash" on its card. The card
 * names the model the Gemini CLI recorded on its newest reply (engine/geminisession.js), and the CLI falls back to
 * another model on a failure (its fallback/handler.ts; in 0.61.0 its base Flash is gemini-3.5-flash), so the card was
 * most likely right. What was missing is any word that the model changed. This decides when to say so.
 *
 * `settingModelName(name)` is the display name of the model the agent is SET to (the job's own model, or the launcher's
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

/* A model id without the suffixes that name the same model. Review 4: the suffix grammar engine/status.js's
   GEMINI_WINDOWS already uses for "the same model" (preview, latest, high/medium/low, a numeric revision, a date),
   repeated as many times as they appear, plus -exp... . */
const SAME_MODEL_SUFFIX = /(?:-(?:preview|latest|high|medium|low|exp|\d{3}|\d{2}-\d{2}|\d{2}-\d{4}))+$/;
function canonicalId(id) {
  return String(id == null ? '' : id).toLowerCase().trim().replace(SAME_MODEL_SUFFIX, '');
}

/* Everything it reads, injectable. #5811: deps may be PARTIAL, the given ones overriding the real ones, so server.js
   passes the planned model and the session from the snapshot it already read and keeps the rest. A key left out is
   read for real, so a test that must not touch the machine passes all four. Each real read requires its module only
   when it runs, so a caller that injects all four loads neither. */
function realDeps() {
  const create = () => require('./create');
  const status = () => require('./status');
  return {
    planned: (name) => create().plannedModelOf(name),
    session: (name) => status().readGeminiSession(name),   // review 2: the one reader (its own account's home), not a copy
    startedAt: (name) => status().sessionStartedAtFromTmux(name),
    display: (id) => status().modelDisplayName(id),
  };
}

function settingModelName(name, deps) {
  const d = { ...realDeps(), ...(deps || {}) };
  let planned; let sess; let startedAt;
  try { planned = d.planned(name); } catch { return null; }
  // An alias picks a model by design, so there is no switch to report: a versionless one (auto, flash, pro) and, review 5,
  // an auto-routing one that carries a version (auto-gemini-2.5).
  if (!planned || typeof planned.id !== 'string' || !/\d/.test(planned.id) || /^auto(?:-|$)/i.test(planned.id.trim())) return null;
  try { sess = d.session(name); } catch { return null; }
  if (!sess || !sess.found || typeof sess.model !== 'string' || !sess.model || !Number.isFinite(sess.modelAt)) return null;
  try { startedAt = d.startedAt(name); } catch { return null; }
  // Review 4: tmux gives the run start in whole seconds, so a reply in that same second could be from just before it.
  if (!Number.isFinite(startedAt) || sess.modelAt < startedAt + 1000) return null;   // the reply is from an earlier run
  if (canonicalId(planned.id) === canonicalId(sess.model)) return null;       // the same model, however spelled
  let started;
  try { started = d.display(planned.id); } catch { return null; }
  return started || null;
}

/* #5811: the decision for one snapshot row (engine/status.js), from what that tick's ONE session read already put on it:
   the row's `geminiSeen` ({ model, modelAt, planned }), passed as `seen` because server.js takes it off the row before
   the page gets it. No job read and no session read here. No `seen`
   means the snapshot could not read the session, so there is nothing to say. `deps` reaches only the run start and the
   display name: the planned model and the session always come from the row. */
function settingModelNameOfRow(a, seen, deps) {
  if (!a || !seen) return null;
  return settingModelName(a.sessionName, {
    ...(deps || {}),
    planned: () => seen.planned,
    session: () => ({ found: true, model: seen.model, modelAt: seen.modelAt }),
  });
}

module.exports = { settingModelName, settingModelNameOfRow, canonicalId };
