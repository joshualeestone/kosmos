'use strict';
/**
 * kosmos#5358: an environment name on Windows is case-insensitive, a JS env object is not, and Node on Windows sorts
 * the names it passes a child and keeps the first case-insensitive match. So `delete env.CLAUDE_CONFIG_DIR` leaves an
 * inherited `Claude_Config_Dir` in place, and setting `env.X` beside an inherited `x` gives the child two, of which
 * the sorted-first wins. Every Windows launch path that removes or sets a name goes through these two.
 * engine/win32-kosmos-shell-5358.test.js pins both.
 */

/** Remove `name` in every spelling. */
function envDelete(env, name) {
  for (const k of Object.keys(env)) if (k.toUpperCase() === String(name).toUpperCase()) delete env[k];
  return env;
}

/** Set `name` to `value` as ONE key, spelled as given: every inherited spelling goes first. The canonical spelling,
    not the inherited one, because code later in the launch reads these names back by their usual spelling
    (win32keyed reads env.GEMINI_API_KEY to decide NO_BROWSER and the key pin). */
function envSet(env, name, value) {
  envDelete(env, name);
  env[name] = value;
  return env;
}

/** Move an inherited `name`, in whatever spelling, to the spelling given, so code that reads it back by that spelling
    sees it (win32keyed reads env.GEMINI_API_KEY and env.GEMINI_CLI_HOME). Nothing inherited: nothing is set. */
function envCanon(env, name) {
  const k = Object.keys(env).find((x) => x.toUpperCase() === String(name).toUpperCase());
  if (k !== undefined) envSet(env, name, env[k]);
  return env;
}

module.exports = { envDelete, envSet, envCanon };
