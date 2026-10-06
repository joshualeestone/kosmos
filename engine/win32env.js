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

/** Set `name` to `value` as ONE key: the inherited spelling if there was one, else `name` as given. */
function envSet(env, name, value) {
  const variants = Object.keys(env).filter((k) => k.toUpperCase() === String(name).toUpperCase());
  for (const k of variants.slice(1)) delete env[k];
  env[variants[0] || name] = value;
  return env;
}

module.exports = { envDelete, envSet };
