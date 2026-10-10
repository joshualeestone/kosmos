'use strict';

/**
 * #5804 (Liu Kang, 0.7.38): a Gemini agent launched on gemini-2.5-flash showed "Gemini 3.5 Flash" on its card. The card
 * names the model the Gemini CLI recorded on its newest reply (engine/geminisession.js), and the CLI falls back to
 * another model on a failure (its fallback/handler.ts; in 0.61.0 its base Flash is gemini-3.5-flash), so the card was
 * most likely right. What was missing is any word that the model changed. This decides when to say so.
 *
 * `startedModelName(name)` is the display name of the model Kosmos started the agent on (the job's own model, or the
 * launcher's default: both are what the agent was started on), or null when there is nothing to say:
 *   - the started model is not a concrete versioned id ("auto", "flash", "pro" are the CLI's own aliases, which pick a
 *     model by design: there is no switch to report);
 *   - the newest reply was written before this run began (after a model change and restart, the newest reply is still
 *     the previous run's until the agent answers again);
 *   - the reply came from the same model (case and spacing aside), or anything could not be read.
 */

const NONE = null;

function norm(s) { return String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim(); }

/* Everything it reads, injectable for tests; production passes nothing. */
function realDeps() {
  const create = require('./create');
  const status = require('./status');
  return {
    planned: (name) => create.plannedModelOf(name),
    session: (name) => {
      let dir; let job;
      try { dir = create.workerDir(name); job = create.readJob(name); } catch { return { found: false }; }
      if (!dir || !job || job.runner !== 'gemini') return { found: false };
      try { return require('./geminisession').read(dir, create.geminiStorageHome(job.configDir)); } catch { return { found: false }; }
    },
    startedAt: (name) => status.sessionStartedAtFromTmux(name),
    display: (id) => status.modelDisplayName(id),
  };
}

function startedModelName(name, deps) {
  const d = deps || realDeps();
  let planned; let sess; let startedAt;
  try { planned = d.planned(name); } catch { return NONE; }
  if (!planned || typeof planned.id !== 'string' || !/\d/.test(planned.id)) return NONE;   // an alias picks by design
  try { sess = d.session(name); } catch { return NONE; }
  if (!sess || !sess.found || typeof sess.model !== 'string' || !sess.model || !Number.isFinite(sess.modelAt)) return NONE;
  try { startedAt = d.startedAt(name); } catch { return NONE; }
  if (!Number.isFinite(startedAt) || sess.modelAt < startedAt) return NONE;   // the reply is from an earlier run
  let started; let answered;
  try { started = d.display(planned.id); answered = d.display(sess.model); } catch { return NONE; }
  if (!started || norm(started) === norm(answered)) return NONE;
  return started;
}

module.exports = { startedModelName };
