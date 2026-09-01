'use strict';

/**
 * An agent as ONE PORTABLE FILE, so a person can keep it, move it, or hand it
 * to somebody else (#1652).
 *
 * Josh: *"we should add a fourth option on the create an agent for 'import my
 * existing agent'... they could also upload or share agents that way."*
 *
 * 🔑 THE BODY IS THE AGENT. Functionally an agent IS its instructions;
 * everything else in a profile is where-it-lives on one machine. That is why
 * this is shareable at all, and why the file is the instructions with a small
 * header rather than a new container wrapped around them.
 *
 * 🛑 NOT A NEW FORMAT, AND THAT IS DELIBERATE. Markdown with `---` frontmatter
 * is the shape `engine/skills.js:readMeta` already parses, and its own comment
 * records that convention as *"read from a real skill on this machine"* - it is
 * Claude Code's, not ours. A second definition of "a described thing in a file"
 * is the defect this codebase keeps paying for, so this adds none.
 *
 * 🛑 WHAT DOES NOT TRAVEL, and the first two are not about privacy:
 *   id, idInstall   `store.writeProfile` mints the id ONCE and never rewrites
 *                   it: *"an anchor that survives renames"*. If it travelled,
 *                   two people who import the same file would BE the same
 *                   agent. An import must mint a new one.
 *   dir             a path on somebody else's machine, meaningless here.
 *   updatedAt, instructionsWrite, doctrineVersion
 *                   bookkeeping about one install.
 *   credentials     the card asks for this to default safe, and it is free:
 *                   measured across all 27 profiles on this machine, there is
 *                   no credential-shaped field to strip. They live elsewhere
 *                   and were never part of what describes an agent.
 *
 * 📌 THE DISPLAY NAME IS NOT IN THE HEADER ON PURPOSE. It is already in the
 * body ("You are **Angel**") and `status.identityFromText` already parses it -
 * the same call adoption uses. Putting it in the frontmatter too would be two
 * copies of one fact, and they would drift the first time somebody edited the
 * instructions.
 */

const MARK = 'kosmos';
const KIND = 'agent';

/**
 * The contract an importer must enforce. Stated here, beside the writer, so
 * whoever builds the import half is not inferring it from examples.
 *
 * A file is a Kosmos agent file ONLY if:
 *   1. it opens with a `---` frontmatter block, and
 *   2. that block carries `kosmos: agent`, and
 *   3. `name:` is present and usable as an agent name, and
 *   4. the body names somebody (`status.identityFromText` finds a displayName).
 *
 * ⚠️ ANY OTHER FILE MUST BE REFUSED WHOLE, not half-applied. This surface takes
 * input from outside the machine: a file that parses half way is the one that
 * leaves an agent with somebody else's instructions and no name.
 */
const IMPORT_CONTRACT = Object.freeze({
  marker: `${MARK}: ${KIND}`,
  required: Object.freeze(['kosmos', 'name']),
  bodyMustName: true,
});

function safeValue(v) {
  const s = String(v == null ? '' : v).trim();
  /* A frontmatter value is ONE LINE OF CLEAN TEXT. A newline ends the block
     early; a tab or any other control character, or a bidi override (U+202E and
     its kin), is never a legitimate agent name or provider, and on this import
     surface a file from outside the machine could carry one to spoof a displayed
     name or break the block. Refuse rather than escape: there is no valid value
     with one in it, and refusing invents no syntax nobody else parses. (This
     also guards the export side, whose names are already clean, so it trips
     nothing there.) */
  if (!s || /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(s)) return null;
  return s;
}

/**
 * Build the portable file for one agent.
 *
 * @param {string} name the agent's name on this machine
 * @param {{store: object, instructions: object}} deps injected, so a test
 *   drives real code against a sandbox rather than a mock of the thing itself
 * @returns {{ok: boolean, text?: string, filename?: string, because?: string}}
 */
function exportAgent(name, deps) {
  const store = deps && deps.store;
  const instructions = deps && deps.instructions;
  if (!store || !instructions) return { ok: false, because: 'export needs the store and instructions modules' };

  const agentName = safeValue(name);
  if (!agentName) return { ok: false, because: 'that is not a usable agent name' };

  let current;
  try { current = instructions.read(agentName); } catch (err) {
    return { ok: false, because: 'we could not read that agent’s instructions: ' + ((err && err.message) || 'unknown') };
  }
  /* 🛑 NO INSTRUCTIONS, NO FILE. The body IS the agent, so exporting an agent
     with nothing to say would produce a file that imports as an empty one.
     Refusing is the honest answer; a header with no body is not an agent. */
  if (!current || !current.exists) {
    return { ok: false, because: 'that agent has no instructions file, so there is nothing to share' };
  }
  const body = String(current.text || '');
  if (!body.trim()) {
    return { ok: false, because: 'that agent’s instructions are empty, so there is nothing to share' };
  }

  let profile = {};
  try { profile = store.readProfile(agentName) || {}; } catch { profile = {}; }

  const lines = [`${MARK}: ${KIND}`, `name: ${agentName}`];
  const provider = safeValue(profile.provider);
  /* A HINT, NOT A REQUIREMENT. The person receiving this may not have that
     provider connected, and an import that refuses on it would make a file
     unopenable for a reason the sender cannot see. Import should say what the
     file wants and let them choose. */
  if (provider) lines.push(`provider: ${provider}`);

  const text = `---\n${lines.join('\n')}\n---\n\n${body.replace(/^﻿/, '')}`;
  return { ok: true, text, filename: `${agentName}.agent.md` };
}

/**
 * Read a portable agent file into the material a creator needs (#1652).
 *
 * The inverse of `exportAgent` at the FORMAT level: `exportAgent` BUILDS the file
 * from the machine, this READS and VALIDATES the file. It does NOT create the
 * agent. The fourth create-an-agent option hands the returned material to the
 * SAME `createAgent` path the other three options use, so import reuses all of
 * create's correctness -- a fresh `id` above all -- rather than half-applying it.
 * `engine/create.js` is the one canonical creation path; a parser that also
 * created would be a second, thinner one, which is the defect this file avoids.
 *
 * 🛑 REFUSES ANY OTHER FILE WHOLE, per IMPORT_CONTRACT. This surface takes input
 * from OUTSIDE the machine: a file that parses half way is the one that leaves an
 * agent with somebody else's instructions and no name. Every failure returns
 * `{ok:false}` with a reason, never a partial result.
 *
 * 🔑 THE IDENTITY ANCHOR CANNOT ENTER. This returns only name/displayName/
 * provider/body; an `id:` a hostile file might carry is never read, and the
 * create flow's `store.writeProfile` mints a fresh id anyway -- so two people who
 * import one file become two separate agents, the same guarantee the export side
 * proves by absence.
 *
 * 📌 THE NAME GUARANTEE IS PATH-SAFETY AND CLEAN TEXT, NOT the full agent-name
 * policy. This refuses a name unsafe as a path/session/label (`create.nameUsable`)
 * and one carrying a control or bidi character (`safeValue`). The fuller rules --
 * length, character set, reserved names like `-discord` -- are `create.nameProblem`'s,
 * applied when this material flows through `createAgent`. So a caller MUST route
 * the material through `createAgent` and must NOT treat `ok:true` as a
 * fully-validated agent name. That is the whole reason import does not create.
 *
 * @param {string} text the file contents
 * @param {{identityFromText: (s: string) => object|null, nameUsable: (s: string) => boolean}} deps
 *   injected so this module stays dependency-free (it requires nothing) and cannot
 *   form a require cycle with status.js/create.js, where these live. Pass the real
 *   functions: `status.identityFromText` and `create.nameUsable`.
 * @returns {{ok: boolean, name?: string, displayName?: string, provider?: string|null, body?: string, because?: string}}
 */
function importAgent(text, deps) {
  const identityFromText = deps && deps.identityFromText;
  const nameUsable = deps && deps.nameUsable;
  if (typeof identityFromText !== 'function' || typeof nameUsable !== 'function') {
    return { ok: false, because: 'import needs the identity parser and the name check' };
  }
  /* Input hygiene, NOT a new format: a file that travelled by email or chat can
     pick up a leading BOM or CRLF line endings. Strip/normalise them before
     parsing so a valid agent file is not refused for surviving the trip. The
     format itself is still the LF `---` frontmatter `skills.readMeta` reads. */
  const src = String(text == null ? '' : text).replace(/^﻿/, '').replace(/\r\n/g, '\n');
  if (!src.trim()) return { ok: false, because: 'that file is empty' };

  // (1) the `---` frontmatter block, the same shape `skills.readMeta` reads.
  const m = src.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { ok: false, because: 'this is not a Kosmos agent file: it has no header' };
  const head = m[1];
  const field = (key) => {
    const f = head.match(new RegExp('^' + key + ':\\s*(.+)$', 'm'));
    return f ? safeValue(f[1]) : null;
  };

  // (2) the self-identifying marker. Anything else is not ours; refuse whole.
  if (field('kosmos') !== KIND) {
    return { ok: false, because: 'this file is not a Kosmos agent file' };
  }
  // (3) a name present and usable.
  const name = field('name');
  if (!name) return { ok: false, because: 'the agent file has no usable name' };
  /* 🛑 PATH-SAFETY IS THIS SURFACE'S JOB, and it is where the collision concern
     and the safety concern part ways. A NAME COLLISION with a running agent is
     machine state the create flow decides; PATH-SAFETY is a pure property of the
     string itself (`..`, a slash, a NUL would become a folder, a tmux session
     and a launchd label), so a file carrying one is a hostile file and is
     refused WHOLE here rather than passed downstream trusting create to catch
     it. Injected so there is ONE answer (create.nameUsable), never a second copy
     that guards less -- the exact defect that file's own comment warns about. */
  if (!nameUsable(name)) {
    return { ok: false, because: 'the agent file’s name is not a usable agent name' };
  }

  // (4) the body must name somebody, the same call adoption uses.
  const body = src.slice(m[0].length);
  if (!body.trim()) return { ok: false, because: 'the agent file has no instructions' };
  // identityFromText returns `{displayName, role}` or null -- the same parser
  // adoption uses. The contract is that the body NAMES somebody, so a display
  // name is what must be present.
  const identity = identityFromText(body);
  if (!identity || !identity.displayName) {
    return { ok: false, because: 'the agent file’s instructions do not name an agent (expected a line like “You are X”)' };
  }

  // A HINT, never a gate: the receiver may not have this provider connected, so
  // import states what the file wants and lets the create flow choose.
  const provider = field('provider');

  return { ok: true, name, displayName: identity.displayName, provider: provider || null, body };
}

module.exports = { exportAgent, importAgent, IMPORT_CONTRACT, MARK, KIND };
