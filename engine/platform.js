'use strict';

/**
 * kosmos: the macOS-only gate (Option A of the cross-platform analysis,
 * 2026-09-01). Kosmos's agent substrate is macOS launchd end to end -- 45
 * `launchctl` call sites, `process.getuid()`, `.plist` job definitions across
 * create.js/remove.js/machine.js/register.js/delete-leftover.js -- plus the
 * `darwin-` binary downloads and the `/bin/sh` `curl|sh` installer. On any other
 * OS those operations cannot work. This module is the single source of truth for
 * "does this platform run Kosmos", so a board on an unsupported OS refuses
 * HONESTLY (it does not arm live execution, so the Mac-only operations fail
 * closed through the existing live-execution gate) rather than attempting a
 * Mac-only action on the wrong OS and half-succeeding.
 *
 * 🔑 PURE, and it takes the platform as a parameter (default `process.platform`),
 * exactly like `store.dataRootFor(platform, ...)`. `process.platform` cannot be
 * set, so a module that hard-reads it is untestable on this Mac; a parameter is
 * testable for every platform without needing a Windows box.
 *
 * 📌 SCOPE: this is the MECHANISM only. The user-facing copy for an unsupported
 * platform ("Kosmos runs on macOS", the screen it shows on) is a product-copy
 * decision that belongs to the operator and is deliberately NOT built here -- see
 * the PR. This module reports `{ platform, supported }` (machine facts, no copy)
 * so that screen can be wired later without changing this gate.
 */

// The platforms whose substrate actually works today. macOS only. Adding one is
// a real port (a scheduler abstraction for the launchctl substrate, per the
// cross-platform analysis), not an entry here.
const SUPPORTED = Object.freeze(['darwin']);

/** True only on a platform whose agent substrate runs. Defaults to this process.
 *  ⚠️ Only the DEFAULT (called with no argument, or explicit `undefined`) reads the
 *  process. Every real platform VALUE fails closed: `null`, `''`, and any unknown
 *  string return false. Callers pass either nothing or a real platform string, so
 *  the default-parameter asymmetry never surfaces a false positive in practice. */
function isSupported(platform = process.platform) {
  return SUPPORTED.includes(platform);
}

/** Machine facts for the API / a future gate screen. No user-facing copy. */
function describe(platform = process.platform) {
  return { platform, supported: isSupported(platform) };
}

module.exports = { SUPPORTED, isSupported, describe };
