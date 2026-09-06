'use strict';

/**
 * Reading a Gemini install's project list, the way codexsession reads a Codex
 * one and status.js reads a Claude one.
 *
 * #2243, the third provider path. Kosmos does not call an API: it launches a
 * terminal agent, keeps it alive, and reads what that agent's tool wrote to
 * disk. So a third provider is mostly a third reader.
 *
 * 📌 GEMINI RECORDS ITS PROJECT CWDS in a JSON MAP at
 * <GEMINI_CLI_HOME>/projects.json, shaped { "projects": { "<abs-cwd>": "<name>" } },
 * and a project's instructions live in <cwd>/GEMINI.md, the disk sibling of
 * CLAUDE.md and AGENTS.md. Measured from a real projects.json on this machine,
 * not taken from documentation.
 *
 * 🛑 THIS FILE OWNS THE ~/.gemini RESOLUTION so discover.js never reaches
 * os.homedir() for Gemini, the same separation codexsession keeps for Codex.
 * That is not only tidiness: a home resolver defined IN discover.js chains
 * found() into check-frozen-roots' resolver set (#1432), which then false-flags
 * an unrelated frozen const whose COMMENT merely mentions found(). Keeping the
 * resolver in this module keeps discover.js's found() out of that set.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/** Overridable so tests never read the operator's real Gemini home. An arrow
 *  const (lazy) so it resolves per call, never frozen at require time. */
const HOME = () => process.env.AGENT_WORKFORCE_GEMINI_HOME
  || process.env.GEMINI_CLI_HOME
  || path.join(process.env.AGENT_WORKFORCE_HOME || os.homedir(), '.gemini');

/**
 * The absolute project cwds Gemini has recorded, from <home>/projects.json,
 * de-duplicated and newest-key-order preserved. Returns [] on a missing or
 * malformed file and NEVER throws: the caller decides what a cwd without a
 * GEMINI.md means (a Gemini project is not an agent unless its GEMINI.md
 * introduces one).
 */
function projects() {
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(path.join(HOME(), 'projects.json'), 'utf8')); }
  catch { return []; }
  const map = parsed && parsed.projects;
  if (!map || typeof map !== 'object') return [];
  /* Keep only absolute keys: connect records a folder, so a relative or empty
     key is not a launch folder we could offer. */
  const seen = new Set();
  const out = [];
  for (const cwd of Object.keys(map)) {
    if (!cwd || !path.isAbsolute(cwd) || seen.has(cwd)) continue;
    seen.add(cwd);
    out.push(cwd);
  }
  return out;
}

module.exports = { HOME, projects };
