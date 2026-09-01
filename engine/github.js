'use strict';
/** GitHub, connected (#529): the spec behind the door. See devicedoor.js. */
const path = require('node:path');
const { makeDoor, PHASE } = require('./devicedoor');

/* THE gh ROAD, SINGLE SOURCE. `githubdevice` requires the FUNCTION, not this array,
   so the authority is expressed in code rather than asserted by a comment.
   ⚠️ GH-ONLY, DELIBERATELY. `AGENT_WORKFORCE_*_BIN` is a per-door convention every
   door has; `AGENT_WORKFORCE_GH_CANDIDATES` is this door alone. The sibling door in
   `engine/vercel.js` keeps a bare literal, so a reader who learns the switch here will
   assume it exists there and be wrong. Not generalised in this branch: that is a second
   product surface and belongs to whoever wants it. */
const GH_CANDIDATES = Object.freeze(['/opt/homebrew/bin/gh', '/usr/local/bin/gh', '/usr/bin/gh']);

/** Where gh lives. EXPORTED, and there is ONE rule: anything that is not a
 * non-empty string means "unset" and yields the defaults. Paths are separated by
 * `path.delimiter`, so the spellings below are the POSIX ones and are ';' on Windows.
 *
 *    ghCandidateList()                     unset -> the 3 defaults
 *    AGENT_WORKFORCE_GH_CANDIDATES=''            -> the 3 defaults  ('' is unset, both ways)
 *    ghCandidateList('')                         -> the 3 defaults
 *    ghCandidateList(path.delimiter)             -> []   ask for NONE explicitly
 *    ghCandidateList('/a:/b')                    -> ['/a','/b']
 *
 * 🛑 THE DELIMITER ALONE IS HOW A CALLER ASKS FOR NONE, NOT ''. An earlier revision
 * gave '' two opposite meanings by arrival path, so the natural call for an exported
 * function, `ghCandidateList(process.env.AGENT_WORKFORCE_GH_CANDIDATES)`, returned the
 * OPPOSITE of what production does with the same value. Measured: production 3 paths,
 * that call []. The delimiter alone already yields [] through
 * `.split(path.delimiter).filter(Boolean)`, so '' never needed a second meaning.
 * 📌 The measurements that forced each step are on kosmos#1606 and #1730. */
function ghCandidateList(override = process.env.AGENT_WORKFORCE_GH_CANDIDATES) {
  /* One rule. '' is unset whichever way it arrives, which is what `export FOO=$UNSET`
     produces and what a caller passing the env value expects. */
  if (typeof override !== 'string' || override === '') return GH_CANDIDATES;
  /* 🛑 `path.delimiter`, NOT a hardcoded ':'. This repo is win32-aware (store.js
     branches on process.platform), and on Windows a real override reads
     `C:\\tools\\gh.exe;D:\\alt\\gh.exe`. Splitting THAT on ':' yields three
     bogus fragments, every one fails `isRunnable`, and the door plus `ghPresent`
     both report gh missing with no diagnostic. Measured: the ':' form returns
     ['C', '\\tools\\gh.exe;D', '\\alt\\gh.exe'].
     📌 No behaviour change on POSIX, where `path.delimiter` IS ':'. */
  return override.split(path.delimiter).filter(Boolean);
}

module.exports = Object.assign(makeDoor({
  serviceName: 'GitHub',
  toolName: 'the GitHub tool (gh)',
  binEnv: 'AGENT_WORKFORCE_GH_BIN',
  /* 🛑 A GETTER, SO THE DOOR AND `ghPresent` CANNOT DISAGREE ABOUT WHERE gh IS.
     `makeDoor` reads `spec.candidates` at CALL time (devicedoor.js, inside `ghBin`), so
     this is re-evaluated per call and honours AGENT_WORKFORCE_GH_CANDIDATES exactly as
     `githubdevice.ghPresent` does. As a bare array it shipped a HALF-SCOPED SWITCH:
     setting the override made `state().gh` say `missing` while this door still resolved
     and could exec a real gh.
     ✅ AND IT CALLS A LOCAL FUNCTION, NOT `require('./githubdevice')`. The lazy-require
     form gave `door.state()` a reject path, because `devicedoor.status()` calls `ghBin()`
     inside the promise executor and devicedoor's `state()` docblock promises "Never
     rejects". A local call cannot fail to load. */
  get candidates() { return ghCandidateList(); },
  configEnv: 'AGENT_WORKFORCE_GH_CONFIG_DIR', configVar: 'GH_CONFIG_DIR', configArg: null,
  statusArgs: ['auth', 'status', '--hostname', 'github.com'],
  loginRe: /Logged in to github\.com account (\S+)/,
  loginArgs: ['auth', 'login', '--web', '--hostname', 'github.com', '--git-protocol', 'https', '--skip-ssh-key'],
  codeRe: /one-time code:\s*([A-Z0-9]{4}-[A-Z0-9]{4})/i,
  urlRe: /(https:\/\/github\.com\/login\/device\S*)/,
  deviceUrl: 'https://github.com/login/device',
}), { PHASE, ghCandidateList });
/* 📌 `GH_CANDIDATES` is deliberately NOT exported. It had zero consumers outside
   this file, and `githubdevice.js` named that export as the residual divergence
   hazard the branch had chosen not to close ("separately referenceable, so
   somebody could scan it a second way"). Removing the identifier closes it at zero
   cost, which is better than the documented caveat it replaces. */
