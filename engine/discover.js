'use strict';

/**
 * Agents that already exist on this computer, whether or not they are running.
 *
 * 🛑 WHY THIS EXISTS, IN JOSH'S WORDS (2026-08-22, after the first install by
 * somebody outside this team): *"if people already have agents anywhere, we need
 * to be able to find them and bring them into the Kosmos platform... It's the
 * most catastrophic flaw in the entire system."*
 *
 * Until now "your agents" meant `status.paneRoster()`, which is tmux, which is
 * PROCESSES RUNNING RIGHT NOW. A person means the agents they have made. Those
 * two are the same set only on a machine where nothing has ever been closed --
 * which describes every Mac this project has been tested on, because on all of
 * them Kosmos created the agents itself. The case has never been run.
 *
 * 🔑 SO THIS READS THE DISK INSTEAD. Claude keeps one folder per working
 * directory under `~/.claude/projects`; each holds that directory's session
 * transcripts, and a transcript records the real `cwd` it ran in. A directory
 * with a `CLAUDE.md` that introduces an agent IS an agent, running or not.
 *
 * ⚠️ THE FOLDER NAME IS NOT THE PATH, and reading it as one is the obvious
 * shortcut. `~/work/workers/angel` is filed as `-Users-agent1-work-workers-angel`
 * -- every non-alphanumeric becomes a dash, so a path with a dash in it and one
 * with a slash arrive identical and there is no way back. The transcript's own
 * `cwd` is the only reliable answer, which is why this opens a file per folder
 * rather than parsing a name.
 *
 * ⚠️ READ-ONLY, AND NOTHING HERE STARTS OR TOUCHES AN AGENT. Finding is a
 * separate act from connecting, and this module does only the first.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const status = require('./status');
const codexsession = require('./codexsession');
const geminisession = require('./geminisession');
const store = require('./store');
// #8: the SAME best-effort H1-name extraction the import parse uses, so the
// found-files list and the import form agree on a role-first-under-`# Name` file
// (agentfile requires no engine module, so this is a clean one-way dependency).
const agentfile = require('./agentfile');
// #3/#2125: nativePresent() (a11y-status freshness) tells defaultTccScan whether a native app is
// there to answer the hatch request. No circular require -- promptrequest pulls a11ystatus, not this.
const promptrequest = require('./promptrequest');

/* "Dismiss this forever" (Josh, 2026-08-24 17:06): the board's found-agents
   block can be sent away for good. The flag lives on disk beside the app's
   other remembered answers (seen-version.json, first-run.json), not in the
   browser, because "forever" has to survive a new browser, a new port and
   the next version. A missing file is the only "not dismissed"; a file we
   cannot read is one that exists, so the person's answer stands.
   ⚠️ `store.ROOT` ALONE, #891: `store.ROOT` already resolves
   AGENT_WORKFORCE_DATA (it joins the env var with the app's own
   'AgentWorkforce' subfolder when set). `process.env.AGENT_WORKFORCE_DATA
   || store.ROOT` looked like the identical fallback but short-circuits
   PAST that join whenever the env var is set, landing this file one
   directory above every sibling it is meant to sit beside -- unnoticed
   with the env var unset (every real install), exactly wrong under a
   sandboxed gate that sets it. */
const DISMISS_FILE = path.join(store.ROOT, 'found-agents-dismissed.json');

/**
 * Folders the person has said are NOT an agent (#1531).
 *
 * 🛑 SEPARATE FROM `dismiss`, WHICH IS THE WHOLE BLOCK. Josh's word for that one was
 * "forever" and it hides everything. This is one folder, said no to once, and
 * conflating them would make a single decline switch off the whole offer.
 *
 * ⭐ IT HAS TO PERSIST OR THE COPY IS A LIE. The button says "This isn't an agent"
 * and the confirmation says we will not ask about this folder again. A
 * session-only hide would bring it back on the next load, which is the screen
 * telling somebody something untrue about itself.
 *
 * ⚠️ A LIST, NOT A FLAG, and unreadable reads as EMPTY rather than as everything.
 * The failure that matters is a corrupt file hiding folders somebody never
 * declined, so the safe direction is to offer a folder twice rather than never.
 */
/**
 * Does this instruction file ADDRESS somebody, whether or not we can name them?
 *
 * 🔑 The whole discriminator for #1527, and it is deliberately crude. "You are ..."
 * at the start of a line is what an agent's instruction file says and what a
 * project's README does not. It cannot tell "You are lilnacho" from "You are an
 * expert Python developer", and it does not try: the first is an agent we failed to
 * name, the second is a template, and ONE CLICK separates them on a screen that
 * asks rather than asserts.
 */
const INTRODUCES = /^[ \t]*(?:#+[ \t]*)?You are\s/mi;

const DECLINED_FILE = path.join(store.ROOT, 'found-agents-declined.json');

function declined() {
  try {
    const raw = JSON.parse(fs.readFileSync(DECLINED_FILE, 'utf8'));
    return Array.isArray(raw && raw.dirs) ? raw.dirs.filter((d) => typeof d === 'string') : [];
  } catch { return []; }
}

function decline(dir) {
  const given = String(dir == null ? '' : dir);
  if (!given || !path.isAbsolute(given)) {
    return { ok: false, because: 'that is not a folder on this computer' };
  }
  const dirs = declined();
  if (!dirs.includes(given)) dirs.push(given);
  try {
    fs.mkdirSync(path.dirname(DECLINED_FILE), { recursive: true });
    const tmp = DECLINED_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ dirs }) + '\n');
    fs.renameSync(tmp, DECLINED_FILE);
  } catch { return { ok: false, because: 'we could not remember that' }; }
  return { ok: true, declined: given };
}

/** Undo one decline, because the screen offers an Undo and it must do something. */
function undecline(dir) {
  const given = String(dir == null ? '' : dir);
  const dirs = declined().filter((d) => d !== given);
  try {
    fs.mkdirSync(path.dirname(DECLINED_FILE), { recursive: true });
    const tmp = DECLINED_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ dirs }) + '\n');
    fs.renameSync(tmp, DECLINED_FILE);
  } catch { return { ok: false, because: 'we could not remember that' }; }
  return { ok: true, restored: given };
}

function dismissed() {
  try { fs.statSync(DISMISS_FILE); return true; } catch (err) {
    return !(err && err.code === 'ENOENT');
  }
}

function dismiss() {
  fs.mkdirSync(path.dirname(DISMISS_FILE), { recursive: true });
  const tmp = DISMISS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ dismissedAt: new Date().toISOString() }) + '\n');
  fs.renameSync(tmp, DISMISS_FILE);
}

/**
 * Is this folder's agent already one Kosmos looks after?
 *
 * ⚠️ NEVER THROWS AND FAILS TOWARDS "NO". A wrong `false` re-offers an agent
 * somebody already has, and the add refuses with a sentence saying so. A wrong
 * `true` hides an agent from the one screen that exists to surface it, silently,
 * which is the defect this whole module was written after.
 */
/**
 * Whether a pane is running under this name right now, whatever started it.
 *
 * 🛑 THE THIRD WAY OF BEING KNOWN (#362). An agent launched by hand, under a
 * session named for it, is on the board (the status engine names it) and yet
 * had no Kosmos job and no recorded folder, so this file offered it as "not
 * in Kosmos" while the board counted it, and pressing Add would have written
 * a job for a folder that already had a running Claude: two in one worker
 * folder, fighting over the hand-written plist. Measured on the dev fleet
 * (every <name>-discord session); reachable on any machine where a session is
 * named for a folder Kosmos did not make.
 *
 * Returns the roster entry, null when nothing runs under the name, and
 * `undefined` when the roster could not be read at all, which callers must
 * treat as "do not know", never as "not running".
 */
function runningUnderName(name, roster) {
  let list = roster;
  if (!Array.isArray(list)) {
    try { list = status.paneRoster(); } catch { return undefined; }
  }
  return list.find((a) => a && a.sessionName === name) || null;
}

/**
 * ONE DEFINITION OF "IN KOSMOS", for the found list and for connect alike
 * (#362): a Kosmos job under the name, a folder recorded against the name, or
 * a pane already running under the name. The list and the Add button used to
 * answer with two of the three and disagree with the board, which used the
 * third.
 */
function alreadyIn(dir, roster) {
  const create = require('./create');
  const store = require('./store');
  const name = path.basename(String(dir || ''));
  if (!name || !create.nameUsable(name)) return false;
  try { if (create.hasJob(name)) return true; } catch { /* ask the other one */ }
  try {
    const p = store.readProfile(name);
    if (p && p.dir && p.dir === dir) return true;
  } catch { /* no record is not a reason to hide it */ }
  if (runningUnderName(name, roster)) return true;
  return false;
}

/** The newest transcript in a project folder, or null. */
function newestTranscript(dir) {
  let names;
  try { names = fs.readdirSync(dir); } catch { return null; }
  let best = null;
  let bestAt = 0;
  for (const n of names) {
    if (!n.endsWith('.jsonl')) continue;
    const full = path.join(dir, n);
    let at = 0;
    try { at = fs.statSync(full).mtimeMs; } catch { continue; }
    if (at > bestAt) { bestAt = at; best = full; }
  }
  return best;
}

/**
 * Every agent this computer has on disk.
 *
 * ⚠️ NEVER THROWS, and answers `ok:false` rather than an empty list when it
 * could not look. "We found none" and "we could not look" are different
 * sentences and this codebase exists because they were once the same one.
 */
/**
 * The identity of a Codex session, from its rollout.
 *
 * 🔑 TWO ROUTES, AND THE SECOND HAS NO CLAUDE-SIDE EQUIVALENT (#1159).
 *
 *   1. `<cwd>/AGENTS.md` on disk -- the exact analogue of `<cwd>/CLAUDE.md`.
 *   2. THE `<INSTRUCTIONS>` BLOCK INSIDE THE ROLLOUT ITSELF.
 *
 * Codex embeds the project's AGENTS.md into the transcript, so an agent stays
 * identifiable after its folder is deleted. The Claude path cannot do this: it
 * needs the file to still exist. Measured on this Mac 2026-08-28, and it is not
 * a small difference -- 24 of 41 Claude project records could not produce an
 * identity because the directory or the file was gone.
 *
 * ⚠️ DISK FIRST, ROLLOUT SECOND, and that order matters. The file is what the
 * agent reads TODAY; the rollout is what it read at the time. A renamed agent
 * should come back under its new name, so a stale embedded copy must never win
 * over a live file.
 */
function codexIdentity(meta, file) {
  const cwd = meta && meta.cwd;
  if (cwd) {
    try {
      const onDisk = fs.readFileSync(path.join(cwd, 'AGENTS.md'), 'utf8').slice(0, 4000);
      const id = status.identityFromText(onDisk);
      if (id && id.displayName) return { id, instructions: path.join(cwd, 'AGENTS.md'), from: 'disk' };
    } catch { /* fall through to the rollout */ }
  }
  /* ⚠️ BOUNDED READ. A rollout grows without limit, and the instructions block is
     written near the start, so this reads a head rather than a whole transcript. */
  let head = '';
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const buf = Buffer.alloc(256 * 1024);
      const n = fs.readSync(fd, buf, 0, buf.length, 0);
      head = buf.slice(0, n).toString('utf8');
    } finally { try { fs.closeSync(fd); } catch { /* already gone */ } }
  } catch { return null; }
  const m = head.match(/<INSTRUCTIONS>([\s\S]{0,4000})/);
  if (!m) return null;
  const id = status.identityFromText(m[1].replace(/\\n/g, '\n'));
  if (!id || !id.displayName) return null;
  return { id, instructions: file, from: 'rollout' };
}

/**
 * Codex agents already on this computer.
 *
 * 🛑 WITHOUT THIS, A CODEX USER INSTALLS KOSMOS AND SEES AN EMPTY SCREEN (#1159).
 * Discovery walked only `~/.claude/projects`, so a whole population of people
 * already running agents got silence -- and not even the count-not-a-list from
 * #1078, because that only fires for folders reached through Claude's records.
 *
 * ⚠️ SAME RETURN SHAPE AS `found()` and the same rules: keyed on the launch
 * folder, deduped by it, an identity-less session COUNTED rather than dropped.
 */
function foundCodex(roster) {
  const byDir = new Map();
  const unreadableDirs = new Set();
  let unreadable = 0;
  /* 🛑 THE SANDBOX REFUSAL, WHICH THIS WALK USED TO GO AROUND (#1500).
     `configRoots` refuses to read the operator's real machine when a process
     has declared itself a fixture, and that refusal exists BY ITS OWN COMMENT
     "for every harness anyone writes next, including the one that does not exist
     yet and will forget". This walk was that harness: it reaches `~/.codex`
     through `codexupdate.defaultHome()` and never calls `configRoots`, so
     `AGENT_WORKFORCE_CONFIG_ROOT` sandboxed the Claude half and left this half
     reading the real Mac.

     ⇒ Measured: a fully sandboxed `found()` returned a REAL agent out of another
     agent's scratchpad, and this machine's `unreadable` count rather than the
     fixture's.

     ⚠️ SAME SHAPE AS THE EMPTY ANSWER `configRoots` GIVES, and for the reason
     that comment records: a fixture gets the answer a fixture should get,
     nothing, rather than a throw that would turn one exposure into a wall of
     identical reds nobody reads.

     📌 SCOPE, SO NOBODY READS IT AS MORE: this covers `found()`, which is where
     the defect was reported. A caller reaching `codexsession` DIRECTLY is still
     unsandboxed; today `discover.js` is the only such caller outside the module
     itself, checked rather than assumed. */
  if (status.sandboxIsInconsistent()) return { agents: [], unreadable: 0 };

  let files;
  try { files = codexsession.rollouts(); } catch { return { agents: [], unreadable: 0 }; }

  for (const file of files) {
    const meta = codexsession.metaOf(file);
    if (!meta) continue;
    const cwd = meta.cwd;
    /* No launch folder is not an agent we can offer: connecting records a folder,
       so there would be nothing to record. */
    if (!cwd || byDir.has(cwd)) continue;

    const hit = codexIdentity(meta, file);
    if (!hit) {
      if (!unreadableDirs.has(cwd)) { unreadableDirs.add(cwd); unreadable += 1; }
      continue;
    }
    byDir.set(cwd, {
      dir: cwd,
      name: hit.id.displayName,
      role: hit.id.role,
      instructions: hit.instructions,
      /* 🔑 SO THE SCREEN CAN SAY WHICH PROVIDER, and so a Codex row is never
         silently offered as if it were a Claude one. */
      runner: 'codex',
      already: alreadyIn(cwd, roster),
    });
  }

  /* 🛑 A MOVED AGENT WAS LISTED TWICE, and the rollout fallback is what caused it.
     Its OLD sessions still resolve -- from the embedded copy, under the old path
     -- while its new ones resolve from disk under the new one, and the de-dupe
     above is keyed on the folder, so both survived. Measured 2026-08-28, twenty
     minutes after the fallback merged: one agent, two rows, same name.

     ⚠️ COLLAPSED ONLY WHEN THE LOSER'S FOLDER IS GONE. Two agents that genuinely
     share a display name and both still exist are two agents, and merging them
     would be a worse bug than the one this fixes. A row whose directory no longer
     exists is a GHOST: it cannot be connected to, because connecting records a
     folder. So the test is not "same name" but "same name AND nothing there".

     Newest-first from `rollouts()` means the live row is already ahead of the
     ghost when the names match, so the first-seen wins.

     🛑 KNOWN LIMITATION, STATED RATHER THAN BURIED (#1133). Two DIFFERENT agents
     that share a display name, one of whose folders is gone, ARE merged here. The
     ghost is absorbed by an unrelated namesake. This is the "identity asserted by
     name" class, and `dir` cannot rescue it: the folder differs in BOTH cases --
     a moved agent has an old dir and a new one, and two agents have two dirs -- so
     the field separates the ROWS while saying nothing about the HOLDERS.

     ⚠️ THE TRADE-OFF IS DELIBERATE AND THE TWO ERRORS ARE NOT SYMMETRIC. Merging
     loses a GHOST row, which cannot be connected to at all because connecting
     records a folder and it is gone. Failing to merge puts a LIVE agent on the
     setup screen twice. The unactionable loss is the better error.

     📌 Comparing the embedded instruction TEXT was considered and rejected: a
     moved agent that has since edited its instructions stops matching and
     duplicates again, which is the visible bug returning. A heuristic on identity
     is what produces this class. */
  const live = new Set();
  for (const a of byDir.values()) { try { if (fs.statSync(a.dir).isDirectory()) live.add(a.name); } catch { /* ghost */ } }
  const kept = [];
  for (const a of byDir.values()) {
    let here = false;
    try { here = fs.statSync(a.dir).isDirectory(); } catch { here = false; }
    if (!here && live.has(a.name)) continue;   // the same agent, at a folder it has left
    kept.push(a);
  }
  return { agents: kept, unreadable };
}

/* #2243: Gemini agents already on this computer, the third provider path and the
   analogue of foundCodex. Gemini keeps its project cwds in a JSON MAP at
   <GEMINI_CLI_HOME>/projects.json, and a project's instructions live in
   <cwd>/GEMINI.md, the disk sibling of CLAUDE.md and AGENTS.md. So a directory
   listed in projects.json whose GEMINI.md INTRODUCES somebody ("You are
   <name>...") IS a discoverable Gemini agent, read with the same identityFromText
   the CLAUDE.md arm uses. The ~/.gemini resolution and the projects.json read
   live in geminisession, the way foundCodex delegates to codexsession (which also
   keeps found() out of check-frozen-roots' #1432 resolver set).

   🛑 SAME SANDBOX REFUSAL AS foundCodex (#1500): geminisession reaches ~/.gemini
   directly, OUTSIDE configRoots, so a fixture that sandboxed the Claude half would
   otherwise read the operator's real machine here. sandboxIsInconsistent() gives a
   fixture the empty answer a fixture should get, and geminisession.HOME honours
   AGENT_WORKFORCE_GEMINI_HOME so a test can point it at a sandbox.

   ⚠️ SAME RETURN SHAPE and rules as found()/foundCodex. Claude then Codex WIN a
   dir collision (they merge first in found()): a folder reachable more than one
   way is one agent, and connect already knows how to act on the Claude/Codex
   record. No ghost-collapse is needed here (unlike foundCodex): projects.json is
   a current map, so a moved agent's old cwd simply fails the GEMINI.md read rather
   than surviving as a second row. #2243 part 3 added a SECOND cwd source in
   geminisession.projects(), <home>/history/<name>/.project_root, which is NOT a
   current map and may retain a stale cwd -- the same read-fails-and-skips reasoning
   still holds (a stale history cwd whose GEMINI.md is gone is skipped, not offered),
   so no ghost-collapse is needed for it either. */
function foundGemini(roster) {
  if (status.sandboxIsInconsistent()) return { agents: [], unreadable: 0 };

  const byDir = new Map();
  let unreadable = 0;
  for (const cwd of geminisession.projects()) {
    if (byDir.has(cwd)) continue;
    let text;
    /* No GEMINI.md is NOT an unreadable agent: it is a Gemini project that is not
       an agent (the common case, a plain repo Gemini ran in once, like a node
       package with no GEMINI.md). Skip it silently, exactly as found() skips a
       folder with no CLAUDE.md; do not count it. */
    try { text = fs.readFileSync(path.join(cwd, 'GEMINI.md'), 'utf8').slice(0, 4000); }
    catch { continue; }
    const id = status.identityFromText(text);
    if (!id || !id.displayName) {
      /* A GEMINI.md that INTRODUCES somebody ("You are ...") but names nobody the
         parser can read is an agent we could not NAME, not a non-agent: count it
         unreadable so the board surfaces the skip rather than silently dropping an
         agent (#1527), exactly as foundCodex counts an unreadable rollout. A file
         that introduces nobody ("You are an expert in Rust", or no such line at
         all) is genuinely not an agent and is skipped silently: the same split
         found() makes, and the same rule as the CLAUDE.md arm, never guess a name. */
      if (INTRODUCES.test(text)) unreadable += 1;
      continue;
    }
    byDir.set(cwd, {
      dir: cwd,
      name: id.displayName,
      role: id.role,
      instructions: path.join(cwd, 'GEMINI.md'),
      runner: 'gemini',
      already: alreadyIn(cwd, roster),
    });
  }
  return { agents: [...byDir.values()], unreadable };
}

function found() {
  let roots;
  try { roots = status.configRoots(); } catch (err) {
    return { ok: false, agents: [], unreadable: 0, because: 'we could not work out where Claude keeps its records' };
  }

  const byDir = new Map();
  let looked = 0;
  /* Folders that have an instruction file we could not read an identity out of
     (kosmos#1078). Counted per FOLDER, like `byDir`, so two session families
     pointing at one directory cannot count it twice. */
  let unreadable = 0;
  /* 🛑 ITS OWN SET, AND THE FIRST VERSION OF THIS WAS WRONG IN A WAY ITS OWN
     COMMENT DENIED. `byDir` only ever holds folders that RESOLVED to an agent,
     and the de-dupe above tests `byDir.has(cwd)` -- so an unreadable directory
     reached through two session families was never in `byDir`, passed the
     de-dupe twice, and counted twice. The comment said "cannot count it twice"
     while the code did. Caught by writing the test for the sentence. */
  const unreadableDirs = new Set();
  /* 🛑 THE THREE SILENT DROPS (#1493). #1078 made the FOURTH honest by counting a
     folder whose instruction file names nobody. Its counting begins AFTER the
     CLAUDE.md read succeeds, so the three misses above it stayed invisible: no
     transcript, a transcript naming no working folder, and a working folder with
     no CLAUDE.md at all.

     ⚠️ THE LAST IS NOT AN EDGE CASE. It is what an ordinary folder somebody once
     ran Claude in looks like, and a new install has mostly those. Measured on
     this fleet's own machine, where discovery WORKS: 44 project folders, 17
     listed, and 17 dropped through that door without entering any number.

     ⇒ The first outside user saw an empty screen with ten session files on disk.
     `found()` knew four different things and could report one. Counted per
     FOLDER, like `unreadable`, so two session families pointing at one directory
     cannot count it twice. */
  const noTranscriptDirs = new Set();
  const noCwdDirs = new Set();
  const noInstructionsDirs = new Set();
  /* 🛑 THE SAME BUCKET HOLDS TWO DIFFERENT SITUATIONS AND ONLY ONE IS ACTIONABLE
     (#1493). Measured on this machine: of 17 folders that fail the CLAUDE.md
     read, 4 have a working directory that STILL EXISTS and 13 point at one that
     is GONE.

       FOLDER GONE     a deleted agent. Nothing to recover. Correct to drop.
       FOLDER PRESENT  possibly a REAL AGENT WE ARE FAILING TO SEE. Actionable.

     ⇒ When somebody sends us their projects directory because their agents did
     not appear, this split says in ONE LOOK whether it is our bug or their
     deleted folders. Without it the file arrives and we still cannot tell.

     ⚠️ AND IT CORRECTS A SENTENCE I WROTE IN THIS FILE. The comment below says a
     no-CLAUDE.md folder "is what an ordinary folder somebody once ran Claude in
     looks like". On this machine that is 4 of 17. I asserted the character of a
     population I had only counted.

     📌 DIAGNOSTIC ONLY. `noInstructions` keeps its meaning and its value, and
     nothing about what the screen says changes: what a person should be told is
     the product question this card is parked on. These two are for us. */
  const declinedDirs = declined();
  /* Folders whose instruction file addresses somebody but names nobody (#1527). */
  const unnamedIntroDirs = new Set();
  const noInstructionsGoneDirs = new Set();
  const noInstructionsPresentDirs = new Set();
  /* One look at what is running, for every folder below (#362). An unreadable
     roster reads as undefined, and alreadyIn then treats "running" as unknown
     rather than as no. */
  let roster;
  try { roster = status.paneRoster(); } catch { roster = undefined; }

  for (const root of roots) {
    const projects = path.join(root, 'projects');
    let dirs;
    try { dirs = fs.readdirSync(projects); } catch { continue; }
    looked += 1;
    for (const d of dirs) {
      const folder = path.join(projects, d);
      let st;
      try { st = fs.statSync(folder); } catch { continue; }
      if (!st.isDirectory()) continue;

      const transcript = newestTranscript(folder);
      if (!transcript) { noTranscriptDirs.add(folder); continue; }
      let cwd = null;
      try { cwd = status.transcriptCwd(transcript); } catch { cwd = null; }
      if (!cwd) { noCwdDirs.add(folder); continue; }
      if (byDir.has(cwd)) continue;

      /* The instruction file is what makes a working directory an AGENT rather
         than a folder somebody once ran Claude in. Most of these are the
         second thing. */
      const file = path.join(cwd, 'CLAUDE.md');
      let text;
      try { text = fs.readFileSync(file, 'utf8').slice(0, 4000); }
      catch {
        noInstructionsDirs.add(cwd);
        /* ⚠️ THE EXISTENCE CHECK IS ITS OWN try, because it must never be the
           reason a folder stops being counted at all. A drop that vanished while
           we were describing drops would be this card's own defect. */
        let there = false;
        try { there = fs.statSync(cwd).isDirectory(); } catch { there = false; }
        (there ? noInstructionsPresentDirs : noInstructionsGoneDirs).add(cwd);
        continue;
      }

      const id = status.identityFromText(text);
      /* ⚠️ A `CLAUDE.md` THAT DOES NOT INTRODUCE ANYBODY IS NOT AN AGENT. Every
         repo in this org has one and they are project instructions; listing
         them as agents would bury the real ones in a list nobody trusts. */
      if (!id || !id.displayName) {
        /* 🛑 COUNTED RATHER THAN DROPPED (kosmos#1078). This `continue` threw
           away a fact the screen needs: we reached a folder, it HAS an
           instruction file, and we could not read who it belongs to. Three
           situations end on the same empty screen -- you have no agents, you
           have some that never ran, you have some we could not read -- and only
           this one is knowable here. The other two are not: a folder is reached
           through Claude's own records, so an agent that has never run is
           invisible before this line, and "none at all" cannot be distinguished
           from it.
           ⚠️ IT IS A COUNT, NOT A LIST, DELIBERATELY. We have no name for these
           -- that is the whole problem -- so a list would be rows of paths, and
           a path is the noise this module already refuses to show when it is not
           the story. A number plus what to do about it is the honest shape.
           ⚠️ AND IT DOES NOT WIDEN WHAT COUNTS AS AN AGENT. Loosening
           `identityFromText` was the other option and it is the dangerous one:
           "You are an expert in Rust" and "You are talking to a person running a
           business" both live in real instruction files, and a parser that took
           them would put project folders in a list of people. A wrong list is
           used; an empty one is questioned. */
        if (!unreadableDirs.has(cwd)) { unreadableDirs.add(cwd); unreadable += 1; }
        /* 🛑 A FILE THAT SAYS "YOU ARE ..." IS CLAIMING TO INTRODUCE SOMEBODY, EVEN
           WHEN WE CANNOT READ THE NAME (#1527). Measured on a real machine: a
           `CLAUDE.md` reading `You are lilnacho, a project manager.` names nobody,
           because the prose arm needs a capital or bold markers. So her agent was
           LESS discoverable than a folder with NO file at all, which is offered.

           ⇒ Offered here instead, with an EMPTY name field, which is the design
           Josh already ruled: never guess a name, ask for one. We saw the intent
           and could not read the name, and that is exactly what the adoption
           screen is for.

           ⚠️ THE COMMENT ABOVE REJECTED WIDENING `identityFromText` AND IT WAS
           RIGHT; THIS IS NOT THAT. Widening fabricates a NAME on the board, which
           is an assertion. Offering fabricates a QUESTION, which costs one click
           to decline and the decline persists.

           ⚠️ THE COST, MEASURED RATHER THAN GUESSED, on 85 real instruction files
           here: 18 are named, 63 contain no "You are" line and stay silent, and
           THREE become offers that should not be. All three read "You are an
           expert <language> developer", template repos rather than agents. So the
           price is three declines against an agent being invisible.

           📌 AND A TIGHTER TEST WAS TRIED AND FAILED. Distinguishing a NAME from a
           NOUN PHRASE is what fabricated "a Project Manager" out of prose earlier
           (#1527's first attempt), so the honest answer is to ask rather than to
           be cleverer about guessing. */
        if (INTRODUCES.test(text)) unnamedIntroDirs.add(cwd);
        continue;
      }

      byDir.set(cwd, {
        dir: cwd,
        name: id.displayName,
        role: id.role,
        instructions: file,
        /* 🔑 WHETHER KOSMOS ALREADY HAS THIS ONE, so a screen outside setup can
           offer only what is missing. Answered here rather than by the page,
           which would need the fleet list and the folder record and would get a
           different answer from whichever it happened to have.
           ⚠️ TWO WAYS TO BE IN, and either counts: Kosmos made it (a job under
           its name) or somebody connected it (a folder recorded against its
           name). Asking only the first would re-offer every connected agent the
           moment its job was ever removed by hand. */
        already: alreadyIn(cwd, roster),
      });
    }
  }

  if (!looked) {
    return { ok: false, agents: [], unreadable: 0, because: 'we could not read where Claude keeps its records' };
  }
    /* 🛑 CODEX AGENTS ARE MERGED HERE RATHER THAN EXPORTED FOR SOMEBODY ELSE TO
       CALL (#1159). An exported walk that nothing invokes is a merged-but-inert
       fix, which this codebase has shipped repeatedly and which reads as done
       from every angle except the user's screen.
       ⚠️ THE CLAUDE SIDE WINS A COLLISION, deliberately: a folder reachable both
       ways is one agent, and the Claude record is the one `connect` already
       knows how to act on. */
    const codex = foundCodex(roster);
    for (const a of codex.agents) if (!byDir.has(a.dir)) byDir.set(a.dir, a);
    /* #2243: Gemini agents last, so a folder Claude or Codex already knows wins the
       collision (connect acts on that record); a Gemini-only folder is added. */
    const gemini = foundGemini(roster);
    for (const a of gemini.agents) if (!byDir.has(a.dir)) byDir.set(a.dir, a);

  /* Stable and human: by the name a person would look for. */
  const agents = [...byDir.values()].sort((a, b) => a.name.localeCompare(b.name));
    return {
    ok: true,
    agents,
    unreadable: unreadable + codex.unreadable + gemini.unreadable,
    /* Named rather than summed: the three mean different things to a person and
       the remedy differs by bucket. One "we skipped 17" would be the same shape
       of unhelpful as the empty screen it replaces. */
    skipped: {
      noTranscript: noTranscriptDirs.size,
      noWorkingFolder: noCwdDirs.size,
      noInstructions: noInstructionsDirs.size,
      /* Subsets of `noInstructions`, and they sum to it. Two counts rather than
         one plus a subtraction, so neither is derived from the other and a test
         can assert the sum. */
      noInstructionsFolderGone: noInstructionsGoneDirs.size,
      noInstructionsFolderPresent: noInstructionsPresentDirs.size,
    },
    /**
     * The folders a person could ADOPT: Claude has run there, the directory is
     * still on disk, and there is no instruction file naming anybody (#1531).
     *
     * 🛑 THE COUNT WAS ALREADY HERE AND THE COUNT IS NOT ENOUGH. `found()` computed
     * exactly these paths in order to tally `noInstructionsFolderPresent` and then
     * threw them away, so a screen could learn that ONE folder qualified and never
     * which one. **You cannot offer a count for adoption.**
     *
     * ⭐ NO NAME IS GUESSED AND THAT IS DELIBERATE, not an omission. Extraction was
     * measured on a real machine and no name is cleanly pullable from a transcript,
     * so the screen asks rather than guesses, and this field carries nothing it
     * would have to guess. `path.basename(dir)` was the obvious thing to add here
     * and it is exactly the wrong thing: it looks like knowledge and is a guess.
     *
     * ⚠️ PRESENT ONLY, NEVER GONE. A folder whose directory has been deleted cannot
     * be adopted, so offering it would be an action that must fail. The gone/present
     * split exists precisely so this list can be the actionable half.
     *
     * 📌 The route needs no change: `/api/found-agents` spreads this return, so the
     * field reaches the board by existing here.
     */
    /* Folders the person has already said no to are not offered again (#1531).
       ⭐ TWO SOURCES, ONE LIST (#1527): a folder with NO instruction file, and one
       whose file says "You are ..." and names nobody. Both are "Claude ran here and
       we cannot say who", both are answered by the same empty name field, and a
       person cannot tell the two apart from the outside. A second list would be a
       second screen for one question. */
    adoptable: [...new Set([...noInstructionsPresentDirs, ...unnamedIntroDirs])]
      .filter((dir) => !declinedDirs.includes(dir))
      .map((dir) => ({ dir })),
    because: null,
  };
}

/* ── #1938: the DISK SCAN, a complementary population to found() ─────────────
 *
 * 🛑 WHY THIS EXISTS, AND WHY IT IS NOT `found()`. `found()` walks
 * `configRoots()/projects/*` -- the folders CLAUDE'S OWN RECORDS say it has run
 * in. An agent whose folder is not in those records (a fresh machine, cleared
 * records, a folder created under a different account) is invisible to `found()`
 * and to every offer downstream of it. Josh reached the "Create your first agent"
 * empty state on a machine that HAD an agent, because the agent's folder was not
 * in Claude's records. That is the gap #1938 names.
 *
 * 🔑 SO THIS READS THE FILESYSTEM DIRECTLY. It walks a fixed, bounded set of
 * sensible roots looking for `CLAUDE.md` files that introduce somebody, and offers
 * the ones `found()` cannot reach. It is COMPLEMENTARY: `found()` still owns every
 * folder Claude has a record of (it can read who the agent is from the transcript),
 * and this owns the rest.
 *
 * 🛑 IT IS THE LARGEST NEW SURFACE IN THIS CLUSTER: it reads files off somebody's
 * disk and hands their contents to a screen. Every bound below is a WALL, not a
 * hint -- a fixed root set (never the whole disk), a per-root depth cap, a
 * directory-visit cap, a candidate cap, a per-file byte cap, no symlink escape,
 * and the same sandbox refusal `configRoots` applies so a fixture never walks the
 * operator's real home.
 */
const SCAN = Object.freeze({
  /* The first READ_CAP BYTES of a CLAUDE.md -- the same 4000 `found()` caps identity
     at, but read as a BYTE window rather than `found()`'s `readFileSync(...).slice(0,
     4000)` CHARACTER slice. The difference is deliberate: a scan reads MANY files, some
     large, so it must never allocate a whole file the way `readFileSync` would; a fixed
     byte read is bounded regardless of file size. The identity signal ("You are ..." at
     the top) is ASCII and well inside the window, so byte-vs-char is immaterial there;
     the only effect is that a preview truncated mid-multibyte shows one replacement char
     at its tail, which is cosmetic. */
  READ_CAP: 4000,
  /* Directories we will read before stopping the whole scan. A wall against a
     pathological tree; on a normal machine the scan finishes far below it. */
  MAX_DIRS: 6000,
  /* Candidates we will return before stopping. A person cannot act on hundreds of
     rows, and an offer that never ends is its own defect. */
  MAX_CANDIDATES: 100,
  /* $HOME itself is scanned SHALLOW: its direct children and grandchildren, enough
     to reach `~/<name>/CLAUDE.md` and `~/<name>/<sub>/CLAUDE.md` without wading
     into the deep noise a home directory holds. */
  HOME_DEPTH: 2,
  /* The curated project parents are scanned DEEP, enough for nested worktrees. */
  DEEP_DEPTH: 5,
  /* #1652: loose importable agent FILES (an agent .md a person downloaded or was
     sent, to bring in via the import flow), distinct from the CLAUDE.md agent
     FOLDERS above. A person cannot act on hundreds, so the returned list is capped
     like MAX_CANDIDATES. */
  MAX_IMPORTABLE: 60,
  /* Loose `.md` files we will READ the head of per folder. A folder with a wall of
     markdown (a docs tree) cannot make the scan open all of them. This is a
     read-budget wall, NOT a "the agent file is in here somewhere" guarantee: the cap
     is applied over `readdirSync` order, which is arbitrary and OS-dependent, so a
     folder with more than MAX_MD_PER_DIR `.md` files could sort a real agent file
     past the cap. When that happens `bounded.importable` is set, so the screen says
     "there may be more" rather than silently dropping it. A person's imported agent
     file normally sits in a folder with a handful of files, well under the cap. */
  MAX_MD_PER_DIR: 40,
  /* Total loose `.md` head-reads across the whole walk. The connect scan is bounded
     by directory visits (MAX_DIRS); importable collection reads FILES, so it needs
     its own wall against a machine with thousands of markdown files. */
  MAX_MD_READS: 3000,
  /* Shallow depth for the download/save locations (Downloads, Desktop): a shared
     agent file lands at the top, not nested deep. #2125: used only on the
     user-triggered import scan (defaultScanRoots({importScan:true})); the auto
     first-run scan omits these roots so it never fires a TCC prompt. */
  DROP_DEPTH: 1,
});

/* Folder NAMES never descended. Every dotdir is skipped by rule below, so this is
   only the non-dotted trees a scan of $HOME would otherwise wade through: build and
   vendor output, and the standard macOS home directories that never hold an agent. */
const SCAN_SKIP = new Set([
  'node_modules', 'target', 'vendor', 'dist', 'build',
  'Library', 'Applications', 'Music', 'Movies', 'Pictures', 'Downloads',
  // #2125: Documents is skipped by the shallow $HOME walk too (HOME_DEPTH would
  // otherwise descend into it), not just dropped from SCAN_DEEP_NAMES -- entering
  // ~/Documents at all fires the macOS Documents-access prompt on a fresh install.
  'Public', 'Desktop', 'Documents', 'Photos Library.photoslibrary',
]);

/* The curated project parents under $HOME, scanned deep. Names only; only those
   that actually exist become roots. This is the "sensible roots" set, and it is
   deliberately NOT the whole disk. Josh's call to widen; a wrong root is a
   candidate the person Skips in one click, because the screen SHOWS the file. */
// 🛑 #2125: the TCC-protected home folders (Documents, Downloads, Desktop) are
// NOT scanned. Deep-walking ~/Documents fired a macOS "would like to access your
// Documents folder" prompt on a fresh install (and denying it BROKE the first-run
// scan), which is the regression Josh reported: "I've always been able to go to
// this screen, not get prompted." Standard agent/code folders (work, projects,
// dev, src, code, repos, Developer) are all still scanned; only the prompt-
// triggering, non-standard-for-agents TCC roots are dropped. Discovery inside
// those folders can return as an explicit user-triggered rescan later (#2125
// follow-up) rather than an auto-fired scan that prompts a brand-new user.
const SCAN_DEEP_NAMES = Object.freeze([
  'work', 'projects', 'Projects', 'Developer', 'dev', 'src', 'code', 'repos', 'Kosmos', 'kosmos',
]);

/**
 * The roots the disk scan walks, each with its own depth cap.
 *
 * ⚠️ AN OVERRIDE FOR TESTS, exactly as `configRoots` carries one. Without it the
 * only way to point the scan at a sandbox would be to walk the operator's real
 * home, which is the thing this must never do under a fixture.
 * `AGENT_WORKFORCE_SCAN_ROOTS` is a `path.delimiter`-separated list;
 * `AGENT_WORKFORCE_SCAN_DEPTH` caps them (default DEEP_DEPTH). A test that sets the
 * roots has declared where to look on purpose, so it is exempt from the sandbox
 * refusal below, the same way a CONFIG_ROOT override is.
 */
function scanRootsFromEnv() {
  const raw = process.env.AGENT_WORKFORCE_SCAN_ROOTS;
  if (!raw) return null;
  const depth = Number(process.env.AGENT_WORKFORCE_SCAN_DEPTH);
  const maxDepth = Number.isFinite(depth) && depth >= 0 ? depth : SCAN.DEEP_DEPTH;
  /* 🛑 path.delimiter, NOT a literal ':' (#1732). A hardcoded ':' is a Windows-hostile
     coupling: the platform path-list separator is ';' there, so a Windows override
     would split into broken fragments. path.delimiter is ':' on POSIX and ';' on
     Windows, invisible to every macOS arm otherwise. */
  const roots = raw.split(path.delimiter).map((d) => d.trim()).filter(Boolean).map((dir) => ({ dir, maxDepth }));
  return roots.length ? roots : null;
}

function defaultScanRoots(opts) {
  const importScan = !!(opts && opts.importScan);
  const home = os.homedir();
  /* 🔑 THE DEEP CURATED PARENTS FIRST, `$HOME` LAST. Agents live under `work`,
     `projects` and the like; `$HOME` is a shallow catch-all. Ordering them first,
     plus the shared visited-set in `scan()`, means the directory-visit budget is
     spent where agents actually are before the shallow home walk (which re-reaches
     those same parents) can consume it. */
  const roots = [];
  for (const name of SCAN_DEEP_NAMES) roots.push({ dir: path.join(home, name), maxDepth: SCAN.DEEP_DEPTH });
  roots.push({ dir: home, maxDepth: SCAN.HOME_DEPTH });
  /* 🛑 #2125: the TCC-protected home folders are reached ONLY under importScan.
     The AUTO first-run scan (discover.scan() with no importScan) never names them,
     so a brand-new user is not bombarded with macOS Documents/Downloads/Desktop
     prompts before doing anything (and denying the Documents one no longer breaks
     the scan). The USER-TRIGGERED import scan (Renet's #1652 GET /api/scan-import,
     calling scan({importScan:true})) DOES add them: a TCC prompt is expected and
     contextual there because the person just asked to find their agent files. This
     re-adds exactly the roots #1938 (Documents, deep) and #1652 (Downloads/Desktop,
     import-only) contributed, but gated behind the explicit action.
     ⚠️ ~/Documents is added as an explicit ROOT even though it is in SCAN_SKIP:
     SCAN_SKIP filters CHILDREN during descent, so it keeps ~/Documents out of the
     $HOME walk (path 2), but a root is its own walk start and is not self-skipped.
     Downloads/Desktop are import-only (loose FILES only; nobody RUNS an agent
     there), which is why they carry importOnly + the shallow DROP_DEPTH. */
  if (importScan) {
    // #3/#2125: these three are the TCC-protected roots. `tcc: true` marks them so scan()
    // routes their walk through the app-identity hatch (--kosmos-app-scan) instead of walking
    // them in the engine (a different TCC subject, which re-prompts). The in-engine walk seeds
    // its stack from the NON-tcc roots only; the tcc roots are handled by the hatch merge.
    roots.push({ dir: path.join(home, 'Documents'), maxDepth: SCAN.DEEP_DEPTH, tcc: true });
    for (const name of ['Downloads', 'Desktop']) {
      roots.push({ dir: path.join(home, name), maxDepth: SCAN.DROP_DEPTH, importOnly: true, tcc: true });
    }
  }
  return roots;
}

/**
 * Read the head of one CLAUDE.md, bounded and symlink-safe.
 *
 * ⚠️ A REGULAR FILE ONLY. A symlinked `CLAUDE.md` could point outside the roots
 * (at `/etc/passwd`, at another user's file), so `lstat` decides and a link is
 * refused rather than followed. Only the first READ_CAP bytes are ever read, so
 * a huge file cannot be allocated whole. Returns null on any refusal.
 */
function readClaudeHead(file) {
  let lst;
  try { lst = fs.lstatSync(file); } catch { return null; }
  if (!lst.isFile()) return null;
  let fd;
  try { fd = fs.openSync(file, 'r'); } catch { return null; }
  try {
    const buf = Buffer.alloc(SCAN.READ_CAP);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    return buf.slice(0, n).toString('utf8');
  } catch { return null; }
  finally { try { fs.closeSync(fd); } catch { /* already gone */ } }
}

/**
 * Agents on disk that `found()` cannot reach (#1938).
 *
 * ⚠️ NEVER THROWS. A root that is missing, a directory it cannot read, a file it
 * cannot open: each is skipped and the scan goes on. The one hard stop is the
 * sandbox refusal, which returns an empty answer rather than walking a real home.
 *
 * @param {{roots?: Array<{dir:string,maxDepth:number}>, maxDirs?: number, maxCandidates?: number}} [opts]
 *   Tests pass explicit roots/bounds; the route calls it bare and gets the
 *   env-or-default roots and the SCAN bounds.
 * @returns {{ok: boolean, candidates: Array, bounded: object, because: string|null}}
 */
/* #3/#2125: default TCC-root scanner -- the file-based, NON-BLOCKING bridge to the app-identity
   hatch (native-app --kosmos-app-scan). scan() is synchronous and must never block the event loop
   polling, so this NEVER waits: it returns a fresh scan-result.json if the app has already produced
   one, else it drops a scan-request.json (so the app produces one) and returns null -- scan() then
   reports scanning:true and the caller retries /api/scan-import shortly. FRESHNESS, not a nonce,
   matches result->request: only one find-agents scan runs at a time (one user, one screen), so a
   scan-result.json newer than TCC_RESULT_FRESH_MS is the answer to the current session's request;
   it is consumed on read so a later unrelated session cannot pick up a stale answer. Best-effort
   throughout -- any fs failure yields null (scanning:true), never a throw. Overridable via
   opts.tccScan for tests. */
const TCC_RESULT_FRESH_MS = 30 * 1000;
const TCC_REQUEST_PENDING_MS = 15 * 1000;   // MUST stay >= TCC_GIVE_UP_MS: the give-up check runs
                                            // first, so a request older than GIVE_UP_MS never reaches
                                            // the pending/re-drop block anyway.
/* #3/#2125: the "never hangs" bound. If the native app is present but our request goes unanswered
   this long (a crashed/failed hatch), give up and COMPLETE the scan without TCC rows rather than
   report scanning:true forever. The plan required a give-up; this is it. */
const TCC_GIVE_UP_MS = 12 * 1000;
// A resolved-but-empty TCC result: the scan is COMPLETE (scanning:false) with no TCC rows. Used
// when no native app can answer (headless/browser) or when the app never answered in time.
const TCC_UNAVAILABLE = Object.freeze({ dirs: [], loose: [], bounded: { tccUnavailable: true } });
/* #3/#2125: the nonce + time of the last scan-request THIS process dropped. A result is accepted
   only when it echoes this nonce -- so two overlapping find-agents sessions cannot cross results
   (freshness alone could not tell them apart). Module-scoped: the engine is one process; a restart
   forgets it and simply drops a fresh request, which the app answers with a new nonce. */
let tccPendingReq = null;
function defaultTccScan(tccRoots, budgets) {
  // No native app to answer means the hatch cannot run (a headless `kosmos start` board opened in
  // a plain browser, or the app not running). We must NOT hang on scanning:true, and must NOT walk
  // the TCC roots in-engine (that is the re-prompt this whole change removes). So COMPLETE the scan
  // with no TCC rows: a resolved-empty result -> scanning:false. (nativePresent = a11y-status is
  // fresh, i.e. the app is maintaining its status writer.)
  let nativeUp = false;
  try { nativeUp = promptrequest.nativePresent(); } catch { nativeUp = false; }
  if (!nativeUp) return TCC_UNAVAILABLE;

  let reqPath, resPath;
  try {
    reqPath = path.join(store.ROOT, 'scan-request.json');
    resPath = path.join(store.ROOT, 'scan-result.json');
  } catch {
    // Resolve failure -> COMPLETE the scan empty, never null: a null here returns before
    // tccPendingReq is set, so the give-up branch could never fire and scanning:true would persist
    // across every retry. Resolved-empty preserves the never-hangs guarantee.
    return TCC_UNAVAILABLE;
  }

  // A fresh result that answers OUR request (nonce match), consumed on read so a later unrelated
  // session cannot pick up a stale answer.
  let res = null;
  try {
    const st = fs.statSync(resPath);
    if (Date.now() - st.mtimeMs < TCC_RESULT_FRESH_MS) {
      const parsed = JSON.parse(fs.readFileSync(resPath, 'utf8'));
      if (parsed && parsed.ok && tccPendingReq && parsed.req === tccPendingReq.nonce) {
        res = parsed;
        try { fs.unlinkSync(resPath); } catch { /* best effort */ }
        tccPendingReq = null;
      }
    }
  } catch { /* no result yet */ }
  if (res) return { dirs: res.dirs || [], loose: res.loose || [], bounded: res.bounded || {} };

  // GIVE UP: the app is present but our request has gone unanswered too long (a crashed/failed
  // hatch). Stop reporting scanning:true forever -- complete the scan without TCC rows. getImportScan
  // then caches this complete result, so the front-end's retry stops rather than polling endlessly.
  // The threshold is overridable (read at call time) so a test can reach this branch without a
  // 12s wait; an empty/absent value keeps the real bound.
  const rawGiveUp = process.env.AGENT_WORKFORCE_TCC_GIVEUP_MS;
  const giveUpMs = rawGiveUp !== undefined && rawGiveUp !== '' ? Number(rawGiveUp) : TCC_GIVE_UP_MS;
  if (tccPendingReq && (Date.now() - tccPendingReq.at) > giveUpMs) {
    tccPendingReq = null;
    return TCC_UNAVAILABLE;
  }

  // No matching result. Drop a request so the app produces one, unless ours is still pending.
  const pending = tccPendingReq && (Date.now() - tccPendingReq.at < TCC_REQUEST_PENDING_MS);
  if (!pending) {
    const nonce = String(Date.now()) + '-' + Math.random().toString(16).slice(2);
    try {
      // Write tmp+rename so a reader (the app watcher) never sees a torn request (parity with the
      // store's other writers). rename is atomic within the same dir.
      const tmp = reqPath + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({
        roots: tccRoots.map((r) => ({ dir: r.dir, maxDepth: r.maxDepth, importOnly: r.importOnly === true })),
        budgets,
        req: nonce,
      }));
      fs.renameSync(tmp, reqPath);
      tccPendingReq = { nonce, at: Date.now() };
    } catch { /* best effort; the retry re-attempts */ }
  }
  return null;
}

/* #3/#2125: single-sourced detection + row construction, called by BOTH the in-engine walk and
   the app-identity hatch merge, so a folder/loose row is built the SAME way regardless of which
   process read the head bytes. The walk keeps its own counter/cap logic; these are pure. The
   content gate is the exact `found()` signal: names somebody (identityFromText) OR addresses
   somebody without a readable name (INTRODUCES) -- a template ("You are an expert in Rust") stays
   out. Returns the row or null. */
function folderRow(dir, text) {
  if (text == null) return null;
  const id = status.identityFromText(text);
  if (!((id && id.displayName) || INTRODUCES.test(text))) return null;
  return { dir, name: (id && id.displayName) || '', role: (id && id.role) || null, preview: text };
}
function looseRow(file, text) {
  if (text == null) return null;
  const id = status.identityFromText(text);
  if (!((id && id.displayName) || INTRODUCES.test(text))) return null;
  // #8: fall back to the H1 heading when the intro names nobody the parser can read, so the row
  // shows the same name the import form prepopulates.
  return { file, name: (id && id.displayName) || agentfile.headingName(text) || '', role: (id && id.role) || null, preview: text };
}

function scan(opts) {
  const o = opts || {};
  const explicit = Array.isArray(o.roots) ? o.roots : scanRootsFromEnv();
  /* 🛑 A FIXTURE MUST NOT WALK THE OPERATOR'S REAL HOME. The same refusal
     `configRoots` applies, honoured here because this walk reaches `os.homedir()`
     directly and never touches `configRoots`. An explicit root set (a test, or the
     env override) has declared where to look on purpose and is exempt, exactly as
     a CONFIG_ROOT override is. */
  if (!explicit && status.sandboxIsInconsistent()) {
    /* Same shape as the normal return, so a consumer never has to tell an empty
       object from a fully-shaped one: nothing was walked, so both lists are empty,
       every bounded flag (including #1652's `importable`) is false, and the visit
       count is zero. */
    return { ok: true, candidates: [], importable: [], bounded: { depth: false, dirs: false, count: false, visited: 0, importable: false }, because: null };
  }
  const roots = explicit || defaultScanRoots(o);   // #2125: o.importScan re-adds the TCC roots (on-demand import only)
  const maxDirs = Number.isFinite(o.maxDirs) && o.maxDirs > 0 ? o.maxDirs : SCAN.MAX_DIRS;
  const maxCandidates = Number.isFinite(o.maxCandidates) && o.maxCandidates > 0 ? o.maxCandidates : SCAN.MAX_CANDIDATES;
  /* #1652: the whole-walk loose-file read budget, overridable like maxDirs/maxCandidates
     so a test can exercise the wall without writing thousands of files. */
  const maxMdReads = Number.isFinite(o.maxMdReads) && o.maxMdReads > 0 ? o.maxMdReads : SCAN.MAX_MD_READS;

  /* 🔑 EVERYTHING `found()` ALREADY KNOWS IS EXCLUDED, so the scan offers only the
     complementary population. A folder Claude has a record of is BETTER found by
     `found()` (it can read who the agent is from the transcript), so a scan row for
     it would be a worse duplicate of a better offer. Declined folders are excluded
     too, and a folder Kosmos already looks after (`alreadyIn`) never becomes a row. */
  const known = new Set();
  let roster;
  try { roster = status.paneRoster(); } catch { roster = undefined; }
  try {
    const f = found();
    if (f && Array.isArray(f.agents)) for (const a of f.agents) known.add(a.dir);
    if (f && Array.isArray(f.adoptable)) for (const a of f.adoptable) known.add(a.dir);
  } catch { /* the scan is still worth running when found() could not look */ }
  for (const d of declined()) known.add(d);

  const byDir = new Map();
  /* Directories already read, across ALL roots, keyed by PHYSICAL-DIRECTORY IDENTITY
     (`st.dev + ':' + st.ino`) rather than any path string. Three different aliases
     resolve to one physical directory and must not be walked twice:
       - `$HOME` (walked last, shallow) re-reaches the curated parents (walked first,
         deep) that live directly under it;
       - on a CASE-INSENSITIVE filesystem (the macOS default, and the target), the two
         case variants in the root set (`projects`/`Projects`, `Kosmos`/`kosmos`) are the
         SAME directory, reached as two differently-cased paths;
       - a symlinked root (now followed) can point at a place another root also reaches.
     🛑 #2408: this was keyed on `fs.realpathSync(dir)` and a comment here CLAIMED that
     "realpathSync collapses" the case variants. It does NOT: `realpathSync` on macOS
     resolves symlinks but PRESERVES the input path's case, so `realpathSync('~/projects')`
     and `realpathSync('~/Projects')` return two differently-cased strings and the case
     variants were emitted as two rows (measured: one agent, two candidates). The device+
     inode pair IS the physical identity: it collapses case variants AND symlink aliases on
     a case-insensitive fs, and correctly keeps `~/projects` and `~/Projects` DISTINCT on a
     case-sensitive fs (where they genuinely are two directories). `fs.statSync` follows the
     symlink to the target's inode (same collapse `realpathSync` gave for links); a dir
     hardlink is forbidden by the OS, so dev+ino is unique per directory. If statSync throws
     (TOCTOU, the dir just vanished), the dir is skipped -- it cannot be walked anyway. */
  const seenDirs = new Set();
  let visited = 0;
  let hitDirs = false;
  let hitCount = false;
  let hitDepth = false;

  /* #1652: loose importable agent FILES, keyed by canonical realpath so the same file
     reached through two aliased roots is offered once. #2408: kept on realpath (NOT switched
     to dev+ino like seenDirs), for two reasons. (1) The CASE-variant alias is already
     collapsed upstream by seenDirs (dev+ino), which skips the re-walk of a case-variant root
     entirely, so a loose file under it is never re-collected. (2) realpath here is
     load-bearing in its own right: it collapses a SYMLINKED loose .md reached via two paths.
     The only alias realpath misses that dev+ino would catch is a HARDLINKED .md across two
     distinct real dirs, which is not a shape agent files occur in. Bounded by MAX_IMPORTABLE
     (rows) and MAX_MD_READS (total head-reads), independent of the connect scan's dir budget. */
  const byFile = new Map();
  const seenFiles = new Set();
  let mdReads = 0;
  let hitImportable = false;

  /* #3/#2125: the TCC-protected roots (Documents/Downloads/Desktop, marked tcc:true by
     defaultScanRoots under importScan) are walked by the app-identity hatch, NOT the engine --
     an engine walk of them is a different TCC subject and re-prompts. Partition them out of the
     in-engine walk and merge them from the hatch after the walk. */
  const tccRoots = roots.filter((r) => r && r.tcc === true);

  outer:
  for (const root of roots) {
    if (root && root.tcc === true) continue;   // #3/#2125: handled by the hatch merge below
    let rootStat;
    /* 🔑 `stat`, NOT `lstat`, FOR THE ROOT: a scan root is a CURATED, TRUSTED location
       (the fixed set under $HOME, or an explicit test override), and a person whose
       `~/work` is a symlink to an external volume keeps their agents there on purpose --
       dropping a symlinked root would hide that whole population and reintroduce the
       "Create your first agent" defect this card exists to fix. So the root symlink is
       FOLLOWED once, to enter the place the person chose.
       ⚠️ THE NO-ESCAPE GUARD IS ON THE DESCENDED CHILDREN, NOT THE ROOT. Every child
       below is `lstat`ed and a symlink is refused, so the walk never follows a link OUT
       of the root's real tree -- the escape this module family has shipped six times.
       Following the root once (a location the operator picked) and refusing every
       symlink inside it (untrusted tree contents) is the correct split. */
    try { rootStat = fs.statSync(root.dir); } catch { continue; }
    if (!rootStat.isDirectory()) continue;
    const maxDepth = Number.isFinite(root.maxDepth) && root.maxDepth >= 0 ? root.maxDepth : SCAN.DEEP_DEPTH;

    /* Iterative, with an explicit stack: depth is a real bound and a deep tree
       cannot recurse the process to death. */
    const stack = [{ dir: root.dir, depth: 0, importOnly: root.importOnly === true }];
    while (stack.length) {
      if (byDir.size >= maxCandidates) { hitCount = true; break outer; }
      if (visited >= maxDirs) { hitDirs = true; break outer; }
      const cur = stack.pop();
      /* #2408: key on the physical-directory identity (dev+ino), NOT realpathSync -- see
         the seenDirs comment. statSync follows a symlinked dir to its target's inode; a
         dir that just vanished (TOCTOU) throws and is skipped (it cannot be walked).
         `bigint:true` so dev/ino are exact 64-bit values: a de-dup key that lost precision
         (a numeric ino past 2^53) could stringify-collide and mis-collapse two DISTINCT
         directories -- the exact mis-dedup class this card removes. */
      let idkey;
      try { const st = fs.statSync(cur.dir, { bigint: true }); idkey = st.dev.toString() + ':' + st.ino.toString(); } catch { continue; }
      if (seenDirs.has(idkey)) continue;   // already read via an earlier root, a case variant, or a symlink alias
      seenDirs.add(idkey);
      visited += 1;

      let names;
      try { names = fs.readdirSync(cur.dir); } catch { continue; }

      /* The CLAUDE.md in THIS folder, read BEFORE descending so a folder that IS an
         agent still counts even when it sits exactly at the depth cap.
         #1652: skipped on an importOnly root (Downloads/Desktop) -- nobody RUNS an agent
         there, so a folder-connect row would be wrong; only loose importable FILES below
         are collected from those locations. */
      if (!cur.importOnly && !byDir.has(cur.dir) && !known.has(cur.dir)) {
        /* folderRow is THE EXACT SIGNAL `found()` uses (names somebody OR INTRODUCES), the
           row built identically here and in the hatch merge below (#3/#2125). `preview` is
           the bytes the screen SHOWS -- a list that ASSERTS is the defect discover.js warns
           about; a list that SHOWS the file moves the judgement to the person. `name` is
           empty when the file introduces somebody but names nobody: the screen asks. */
        const row = folderRow(cur.dir, readClaudeHead(path.join(cur.dir, 'CLAUDE.md')));
        if (row) {
          if (!alreadyIn(cur.dir, roster)) byDir.set(cur.dir, row);
          else known.add(cur.dir);
        }
      }

      /* #1652: loose importable agent FILES in THIS folder. A person's "import my
         existing agent" file is a loose `.md` (downloaded or shared), NOT a folder with a
         `CLAUDE.md` -- so `foo.md` / `susan.agent.md` with the same "You are ..." head is
         invisible to the connect scan above and must be found here. Excludes CLAUDE.md and
         AGENTS.md, which are folder-agent markers the connect scan (and foundCodex) own.
         Same content gate as the connect scan -- identity OR INTRODUCES -- so a template or
         a README stays out; the row SHOWS the preview so a wrong offer is a one-click skip.
         Bounded three ways: MAX_MD_PER_DIR per folder, MAX_MD_READS across the walk, and
         MAX_IMPORTABLE rows returned. Runs on BOTH normal and importOnly roots. */
      if (byFile.size >= SCAN.MAX_IMPORTABLE || mdReads >= maxMdReads) {
        /* Already at a global cap and there is still a folder to walk: we will collect
           no more importable files even if they exist here, so say so honestly. This is
           the "filled the list on an earlier folder" case the in-loop breaks below cannot
           see (they only fire when a break happens INSIDE a folder's read). */
        hitImportable = true;
      } else {
        let perDir = 0;
        for (const name of names) {
          if (byFile.size >= SCAN.MAX_IMPORTABLE) { hitImportable = true; break; }
          if (mdReads >= maxMdReads) { hitImportable = true; break; }
          if (perDir >= SCAN.MAX_MD_PER_DIR) { hitImportable = true; break; }  // read this folder short: there may be more
          const lower = name.toLowerCase();
          if (!lower.endsWith('.md') && !lower.endsWith('.markdown')) continue;
          if (lower === 'claude.md' || lower === 'agents.md') continue;  // folder-agent markers, not import files
          const file = path.join(cur.dir, name);
          let freal;
          try { freal = fs.realpathSync(file); } catch { freal = file; }
          if (seenFiles.has(freal)) continue;
          seenFiles.add(freal);
          perDir += 1;
          mdReads += 1;
          // regular-file + symlink-safe + byte-bounded, same as CLAUDE.md; looseRow applies
          // the identical detection + row shape the hatch merge uses (#3/#2125, #8).
          const row = looseRow(file, readClaudeHead(file));
          if (row) byFile.set(freal, row);
        }
      }

      /* Do not descend past the cap. The CLAUDE.md above was still read, so a
         folder at the cap is offered; only its children are out of reach. */
      if (cur.depth >= maxDepth) { hitDepth = true; continue; }

      for (const name of names) {
        if (name.startsWith('.')) continue;   // every dotdir: .git, .Trash, .config, .cache…
        if (SCAN_SKIP.has(name)) continue;     // build/vendor output + macOS home noise
        const child = path.join(cur.dir, name);
        let cst;
        /* `lstat`: a symlinked directory reports isDirectory()===false here, so it
           is never descended -- the no-symlink-escape rule, enforced by the stat
           kind rather than by resolving and comparing paths. */
        try { cst = fs.lstatSync(child); } catch { continue; }
        if (!cst.isDirectory()) continue;
        stack.push({ dir: child, depth: cur.depth + 1, importOnly: cur.importOnly });
      }
    }
  }

  /* #3/#2125: merge the TCC roots the app-identity hatch walked (--kosmos-app-scan), so those
     folders are scanned WITHOUT the engine touching them. `tccScan` is injectable (tests pass a
     stub); the default drops the request and reads a ready result NON-BLOCKING (scan() is sync and
     must never block the event loop polling). A null return means the hatch result is not ready
     yet -> `scanning:true`, and the caller retries /api/scan-import shortly. Rows are built by the
     SAME folderRow/looseRow the walk uses, so the hatch path cannot diverge from the engine path.
     Dedup: skip a dir/file already found by the walk, found(), alreadyIn or declined (known). */
  let scanning = false;
  let tccUnavailable = false;   // #3/#2125: the TCC roots could not be scanned (no app / hatch gave up)
  if (tccRoots.length) {
    const tccScan = typeof o.tccScan === 'function' ? o.tccScan : defaultTccScan;
    let hatch = null;
    try {
      // The hatch emission is bounded by the READ budgets (maxDirs folder reads, maxMdReads loose
      // reads) -- the same bound the engine walk uses -- NOT by the DETECTED-row caps: capping raw
      // emission on a detected-equivalent would drop real agents enumerated after non-agent files.
      // The DETECTED-row caps (maxCandidates/MAX_IMPORTABLE) are applied HERE, on the merge, below.
      hatch = tccScan(tccRoots, { maxDirs, maxMdPerDir: SCAN.MAX_MD_PER_DIR, maxMdReads, readCap: SCAN.READ_CAP });
    } catch { hatch = null; }
    if (!hatch) {
      scanning = true;
    } else {
      for (const d of (hatch.dirs || [])) {
        // Same row caps the in-engine walk enforces (#1652): a huge Documents tree must not push
        // candidates past maxCandidates without the screen saying "there may be more".
        if (byDir.size >= maxCandidates) { hitCount = true; break; }
        if (!d || !d.dir || byDir.has(d.dir) || known.has(d.dir)) continue;
        const row = folderRow(d.dir, d.instr && d.instr.head);
        if (row) { if (!alreadyIn(d.dir, roster)) byDir.set(d.dir, row); else known.add(d.dir); }
      }
      for (const l of (hatch.loose || [])) {
        if (byFile.size >= SCAN.MAX_IMPORTABLE) { hitImportable = true; break; }
        // 🔑 Keyed on the LITERAL l.file, not a canonical realpath like the in-engine walk's byFile.
        // This is correct ONLY because the tcc:true roots are partitioned OUT of the in-engine walk
        // (above), so the hatch population and the walk population never overlap -- there is no
        // realpath alias to collide. Do NOT realpath l.file here: it is a path under a TCC folder
        // the ENGINE is not granted, so resolving it could itself touch/prompt (the whole reason the
        // hatch does the reading). The hatch already realpath-dedups its own walk. If that partition
        // invariant ever changes, revisit this dedup basis.
        if (!l || !l.file || byFile.has(l.file)) continue;
        const row = looseRow(l.file, l.head);
        if (row) byFile.set(l.file, row);
      }
      if (hatch.bounded) {
        if (hatch.bounded.dirs) hitDirs = true;
        if (hatch.bounded.importable) hitImportable = true;
        // The TCC roots could not be scanned (no native app, or the hatch never answered). Surface
        // it so the screen can say "we couldn't scan your Documents/Downloads/Desktop" rather than
        // present a TCC-less list as complete (which, cached for SCAN_CACHE_MS, would silently hide
        // those agents on a transient failure).
        if (hatch.bounded.tccUnavailable) tccUnavailable = true;
        if (Number.isFinite(hatch.bounded.visited)) visited += hatch.bounded.visited;
      }
    }
  }

  /* #2410: the Gemini CLI's custom-agent DEFINITION files (<gemini-home>/agents/*.md).
     They sit under a dotdir the walk above skips (`name.startsWith('.')`), and their
     identity is in YAML front-matter, not a "You are <Name>" line -- so the walk both
     never reaches them and, if it did, would offer them with an EMPTY name.
     geminisession.agentFiles() reads the known location DIRECTLY (as foundGemini reads
     ~/.gemini/projects.json), so the dotdir skip does not apply; agentfile.geminiIdentity
     names them from the front-matter. Merged into the loose importable list because a
     Gemini agent is a FILE (imported by-file through the create form -> createAgent), not
     a work FOLDER. Keyed by realpath into the same byFile map, honoring the same
     MAX_IMPORTABLE / maxMdReads budgets as the walk. Runs only where the walk itself
     would: the `!explicit && sandboxIsInconsistent()` early-return above already gives a
     fixture-inconsistent machine an empty answer before this point, and a test points
     AGENT_WORKFORCE_GEMINI_HOME at a sandbox exactly as the foundGemini tests do. A file
     whose front-matter is not the Gemini shape falls back to the generic looseRow. */
  /* 🛑 ONLY REACH THE GEMINI HOME ON THE REAL SCAN PATH, OR WHEN A TEST HAS EXPLICITLY
     POINTED IT AT A SANDBOX. The scan's sandbox early-return only guards `!explicit`, so
     an EXPLICIT-roots caller (every scan test) would otherwise read the operator's real
     ~/.gemini/agents here -- which both breaks those tests' importable counts on a machine
     that has Gemini agents and falsifies discover.import-1652's "os.homedir() is never
     walked" contract. Guarding on sandboxIsInconsistent() alone is wrong in the other
     direction: it is TRUE in a tmp-sandbox test that legitimately points the Gemini home
     at a fixture (AGENT_WORKFORCE_DATA under /tmp), so it would skip the very merge such a
     test exercises. The correct signal is: the REAL run passes no explicit roots, and a
     test that means to exercise this merge sets one of the Gemini-home overrides (the same
     ones geminisession.HOME() honours). An explicit-roots test that set neither is not
     testing Gemini and must not read a real home. */
  const geminiHomeOverridden = !!(process.env.AGENT_WORKFORCE_GEMINI_HOME
    || process.env.GEMINI_CLI_HOME || process.env.AGENT_WORKFORCE_HOME);
  let geminiAgentFiles = [];
  if (!explicit || geminiHomeOverridden) {
    try { geminiAgentFiles = geminisession.agentFiles(); } catch { geminiAgentFiles = []; }
  }
  for (const file of geminiAgentFiles) {
    if (byFile.size >= SCAN.MAX_IMPORTABLE) { hitImportable = true; break; }
    if (mdReads >= maxMdReads) { hitImportable = true; break; }
    let freal;
    try { freal = fs.realpathSync(file); } catch { freal = file; }
    if (seenFiles.has(freal)) continue;   // already collected by the walk (an aliased root reached it)
    seenFiles.add(freal);
    mdReads += 1;
    const head = readClaudeHead(file);
    if (head == null) continue;   // unreadable, or not a regular file (a symlinked dir)
    const g = agentfile.geminiIdentity(head);
    const row = g
      ? { file, name: g.displayName, role: g.role || null, preview: head }
      : looseRow(file, head);
    if (row) byFile.set(freal, row);
  }

  const candidates = [...byDir.values()].sort((a, b) => String(a.name || a.dir).localeCompare(String(b.name || b.dir)));
  /* #1652: loose importable agent files, sorted like the connect candidates (name, then
     path) so the two lists read the same way. A DISTINCT array from `candidates`: an
     importable row carries a `file` and its action is IMPORT (parse -> pre-fill create),
     never `discover.connect(dir)`, which is for a work FOLDER. Kept separate so a consumer
     that only knows the connect list is unaffected, and so connect can never be handed a
     loose file's parent directory. */
  /* #1652: the shared dir/count caps (`break outer`) stop the WHOLE walk, so loose-file
     collection was cut short too even though no importable-specific cap was hit. Fold
     them into hitImportable so a consumer keying only on `bounded.importable` does not
     under-report -- the connect note keys on count||dirs, but a PR2 importable list may
     not. */
  if (hitCount || hitDirs) hitImportable = true;
  const importable = [...byFile.values()].sort((a, b) => String(a.name || a.file).localeCompare(String(b.name || b.file)));
  return {
    ok: true,
    candidates,
    importable,
    /* Says whether the walk stopped early and why, so the screen can add "and there
       may be more" honestly rather than presenting a truncated list as complete.
       ⚠️ THE SCREEN SURFACES `count` AND `dirs`, NOT `depth`, DELIBERATELY. Hitting the
       candidate cap or the directory-visit cap means the scan genuinely gave up before
       the disk was exhausted -- rare, and worth telling the person. Hitting the DEPTH
       cap is the normal case: almost every machine has some folder deeper than the cap,
       so surfacing it would show "there may be more" nearly always and train the person
       to ignore it. `depth` is still reported here for a caller that wants it; the note
       is gated on the two that signal a real early stop. `importable` is the #1652
       loose-file-read wall, surfaced like the others so the screen can say "and there may
       be more files". */
    bounded: { depth: hitDepth, dirs: hitDirs, count: hitCount, visited, importable: hitImportable, tccUnavailable },
    /* #3/#2125: true only when a TCC-root hatch result is not ready yet -- the caller (the
       /api/scan-import route + getImportScan cache) treats a scanning:true result as PARTIAL
       (non-TCC rows only) and does NOT cache it, so a retry shortly after picks up the TCC rows
       the hatch has since written. Absent/false on the auto scan (no TCC roots) and once merged. */
    scanning,
    because: null,
  };
}

/**
 * Bring an agent Kosmos did not create under its management.
 *
 * 🔑 NOTHING IS MOVED, COPIED OR RE-CREATED, and that is the whole design. The
 * agent already exists: a folder with a CLAUDE.md in it. Connecting records
 * where that folder is and installs the launch job that starts an agent THERE,
 * so from that moment its instructions are read from their file, its restart is
 * the same one click as any other agent's, and it comes back at login.
 *
 * ⚠️ SO CONNECTING AND RESTARTING ARE THE SAME OPERATION, which is the insight
 * that made this small (Splinter, 2026-08-22): Kosmos never has to take over a
 * running process. It starts a fresh session in that folder, and every managed
 * behaviour follows from having started it.
 *
 * ⚠️ AND IT REFUSES RATHER THAN GUESSES. A folder with no readable identity, a
 * name that cannot become a session, or a name already taken all stop here with
 * a sentence. The one thing this must never do is half-connect: a recorded
 * folder for an agent with no job is an agent the board believes in and launchd
 * has never heard of, so the record is rolled back if the job cannot be written.
 */
/**
 * Adopt a folder that holds no instructions file: record it, show it, start nothing.
 *
 * 🛑 THIS DELIBERATELY DOES LESS THAN `connect`'s MAIN PATH, and the omissions are the
 * feature rather than an unfinished edge. No `installJob`, so no launchd job is
 * written for somebody's home directory. No instruction-file write, so nothing of
 * ours lands in a folder they wrote. No project splice, for the same reason.
 *
 * ⭐ IT STILL RUNS EVERY REFUSAL THE MAIN PATH RUNS, which is the half that matters:
 * an unusable name, a name Kosmos already looks after, a name something is already
 * running under, and a profile pointing somewhere else all refuse here exactly as
 * they do there. Doing less work is not the same as doing less checking, and a
 * shorter path that skipped the guards would be the actual danger.
 */
function registerOnly(given, name, { create, store }) {
  if (!create.nameUsable(name)) {
    return { ok: false, because: 'that name cannot be used as an agent name' };
  }
  if (create.hasJob(name)) {
    return { ok: false, because: 'Kosmos already looks after an agent by that name' };
  }
  const running = runningUnderName(name);
  if (running === undefined) {
    return { ok: false, because: 'we could not check what is running on this computer, so we did not add it' };
  }
  if (running) {
    return { ok: false, because: 'an agent is already running under that name, started some other way' };
  }
  let before = {};
  try { before = store.readProfile(name); } catch { before = {}; }
  if (before && before.dir && before.dir !== given) {
    return { ok: false, because: 'an agent by that name is already connected to a different folder' };
  }
  /* The display name is the name they typed. There is no file to disagree with it,
     which is the whole reason this path exists. */
  try { store.writeProfile(name, { dir: given, displayName: name }); }
  catch { return { ok: false, because: 'we could not record where that agent lives' }; }
  return { ok: true, name, dir: given, displayName: name, registered: true, started: false };
}

function connect(dir, opts) {
  const create = require('./create');
  const store = require('./store');

  /* Trimmed once, here, so every check below tests the same string the profile will
     carry. A name that is only whitespace is no name at all. */
  const supplied = opts && opts.name != null ? String(opts.name).trim() : '';

  const given = String(dir == null ? '' : dir);
  if (!given || !path.isAbsolute(given)) {
    return { ok: false, because: 'that is not a folder on this computer' };
  }
  let st;
  /* `lstat`, so a link is refused rather than followed -- the escape this module
     family has shipped six times. */
  try { st = fs.lstatSync(given); } catch { return { ok: false, because: 'that folder is not there any more' }; }
  if (!st.isDirectory()) return { ok: false, because: 'that is not a folder' };

  /* 🛑 EITHER INSTRUCTIONS FILE, BECAUSE DISCOVERY ALREADY ACCEPTS BOTH (#1159).
     `foundCodex` reads `AGENTS.md`; this read `CLAUDE.md` only. So a Codex agent
     was LISTED on the setup screen and then REFUSED when somebody clicked it,
     with "that folder has no instructions in it" -- which was FALSE: it had
     AGENTS.md. Measured with both arms, and the Claude control got PAST this
     check and failed later on a missing binary, which is what made it evidence.

     ⚠️ AND THE FILE DECIDES THE RUNNER. A folder with AGENTS.md is a Codex agent,
     and adopting it as a Claude one would start the wrong program in somebody's
     project. CLAUDE.md wins when both exist: a person who has both has a Claude
     agent that also carries codex notes. */
  let text;
  let runner = null;
  let instructionsFile = null;
  for (const [file, which] of [['CLAUDE.md', null], ['AGENTS.md', 'codex']]) {
    try {
      text = fs.readFileSync(path.join(given, file), 'utf8').slice(0, 4000);
      runner = which;
      instructionsFile = file;
      break;
    } catch { /* try the next one */ }
  }
  /**
   * 🔑 A FOLDER WITH NO INSTRUCTIONS FILE IS STILL SOMEBODY'S AGENT (#1531).
   * Josh's ruling, 2026-08-29: **adopt means REGISTER AND SHOW**, and **the typed
   * name wins**.
   *
   * Discovery already offers these folders (`found().adoptable`): Claude has run
   * there and no file says who. Refusing them here is what made the offer a lie, and
   * it is the same defect this function's own #1159 comment records, a row LISTED on
   * the setup screen and REFUSED when somebody clicked it.
   *
   * 🛑 NOTHING IS WRITTEN INTO THE PERSON'S FOLDER AND NO JOB IS INSTALLED. That is
   * the ruling and it is not an implementation convenience. The adoptable folder on
   * the machine that prompted this is a HOME DIRECTORY, so composing an instruction
   * file there for our own bookkeeping would put Kosmos files in somebody's home and
   * could collide with something of theirs. The name lives in OUR profile store,
   * which is where the board already reads a card's name from.
   *
   * ⚠️ SO AN ADOPTED FOLDER IS A CARD, NOT A RUNNING AGENT, and that is honest
   * rather than partial: nothing was running under our management before, and
   * starting one would be inventing an agent rather than recognising one. The person
   * can start it the same way they start any other.
   */
  if (instructionsFile === null) {
    if (!supplied) {
      return { ok: false, because: 'that folder has no instructions in it, so there is no agent to connect' };
    }
    return registerOnly(given, supplied, { create, store });
  }
  const id = status.identityFromText(text);
  /* 🛑 A SUPPLIED NAME WINS WHEN THE FILE INTRODUCES SOMEBODY BUT NAMES NOBODY (#1938,
     completing #1531's ruling 2(a)). The file says "You are ..." but the parser could
     not read a name out of it (a lowercase name, an odd phrasing). The screen already
     asked the person for one, and Josh's ruling is that the typed name wins; refusing
     here made that name field a lie. So the refusal now stands DOWN only when a name was
     typed AND the file actually introduces somebody.
     🛑 THE `INTRODUCES` RE-CHECK IS LOAD-BEARING, not belt-and-suspenders. `connect()` is
     a shared public entry point, and without it a supplied name would adopt-and-START a
     NON-introducing file too -- a project's build-notes `CLAUDE.md` plus a typed name
     would install a launchd job and start Claude in somebody's repo, which is the exact
     thing connect-agent.test.js's "instructions that never say who it is are refused"
     forbids. The UI only offers a name field for introducing / no-file folders, so the
     hole is reachable only by a direct API call -- but the engine must enforce what the
     comment promises rather than trust the caller. The no-name refusal is unchanged.
     The display name is then the one the person typed, since the file has none to offer. */
  const introduces = INTRODUCES.test(text);
  if ((!id || !id.displayName) && !(supplied && introduces)) {
    return { ok: false, because: 'those instructions do not say who the agent is, so we cannot bring it in' };
  }
  const displayName = (id && id.displayName) || supplied;

  /* 🔑 THE FOLDER'S OWN NAME IS THE AGENT'S NAME WHEN NOBODY SUPPLIES ONE, not the
     display name from the file. It is what tmux and launchd will carry, it is
     already unique on this machine by virtue of being a directory, and it is what
     its owner has been calling it. A display name like "Casey Jones" is not a
     session name and inventing a slug from it would give the same agent two names
     on day one.

     🛑 A SUPPLIED NAME NOW WINS (#1531, Josh's ruling 2(a)). The rule above is right
     exactly when the folder IS the agent's own, which is the case it was written
     for. It has no answer for a folder holding SEVERAL agents, or for a folder that
     is a person rather than a project: `/Users/caseywinner` would name an agent
     after its owner. When somebody types a name, that is a better answer than any
     path, and it is still one name rather than two because it is the name the job
     and the profile both take. */
  const name = supplied || path.basename(given);
  if (!create.nameUsable(name)) {
    return { ok: false, because: 'that folder\u2019s name cannot be used as an agent name' };
  }

  if (create.hasJob(name)) {
    return { ok: false, because: 'Kosmos already looks after an agent by that name' };
  }
  /* 🛑 AND NOT WHEN SOMETHING IS ALREADY RUNNING UNDER THAT NAME (#362). The
     add installs a job and starts it; on a folder whose agent is already up,
     started some other way, that is a second Claude in the same worker folder.
     Same test the found list uses, so the two cannot disagree. A roster we
     could not read refuses too: starting blind is the failure, not the
     refusal. */
  const running = runningUnderName(name);
  if (running === undefined) {
    return { ok: false, because: 'we could not check what is running on this computer, so we did not start it' };
  }
  if (running) {
    return { ok: false, because: 'an agent is already running under that name, started some other way. Kosmos will not start a second one' };
  }

  /* ⚠️ THE RECORD GOES FIRST, because `installJob` resolves the folder through
     it -- without it the job would be written for `<workers>/<name>`, which is
     not where this agent lives. */
  let before = {};
  try { before = store.readProfile(name); } catch { before = {}; }
  if (before && before.dir && before.dir !== given) {
    return { ok: false, because: 'an agent by that name is already connected to a different folder' };
  }
  /* 🛑 THE PROVIDER GOES IN THE PROFILE TOO, NOT ONLY THE JOB (#1159). #1347 made
     adoption write a codex JOB; the profile still said nothing, and
     `server.js` derives a card's runner from `profile.provider` whenever the
     pane is not the source. Measured: an adopted Codex agent came back
     `provider: undefined`, so the board called it `claude`.

     ⚠️ AND THAT IS NOT COSMETIC. `chat.js` pauses before Enter ONLY for a card
     whose runner is codex (#571), because codex swallows an Enter that rides the
     paste burst. A codex agent labelled claude would be sent a message that sits
     in its composer unsent -- which looks exactly like an agent ignoring you. */
  try { store.writeProfile(name, { dir: given, displayName, ...(runner === 'codex' ? { provider: 'openai' } : {}) }); }
  catch { return { ok: false, because: 'we could not record where that agent lives' }; }

  /* The runner rides along, or an adopted Codex agent starts Claude in its own
     folder. `installJob` also does that runner's first-run setup. */
  /* 🔑 THE PROJECT BLOCK GOES IN BEFORE THE SESSION STARTS (#1349, the #732 rule).
     An imported agent joined nothing, so a person whose first agents are IMPORTED
     landed on an empty Projects tab -- the first screen after the thing that just
     worked.

     ⚠️ AND THE ORDER IS THE WHOLE POINT. `installJob` below STARTS the agent. Join
     it afterwards and the block reaches its instructions through the later sync,
     seconds after the session is up, so it is born reading "Kosmos put it on
     Getting started. Restart it so it knows" -- which is #732 exactly, the bug I
     fixed for CREATION on 2026-08-24 and would have reintroduced here.

     ⚠️ IT WRITES INTO A FILE THE PERSON WROTE, and that is deliberate rather than
     casual: `projects.syncAgent` already splices this same delimited block into an
     adopted agent's instructions when it later joins a project. Doing it here is
     the SAME write at a better moment, not a new liberty.

     📌 Non-gating, same rule as creation: an unreadable projects file must not
     cost somebody their agent. If this fails, the later sync still does it the
     old way. */
  /* 🔑 AN IMPORTED AGENT GETS THE RULES AND THE CONNECTOR WORDS TOO (#1363).
     Josh, watching the import path work on a wiped machine: "it would be helpful
     if we added to their file all the rules we've made up for them working. More
     important than that is adding the information so they know how to connect to
     the connectors that we have in settings."

     ⚠️ THE ASYMMETRY HE SPOTTED, MEASURED: `create.js` composes both of these
     before an agent is born. `discover.js` mentioned `defaults` ZERO times, so an
     imported agent got neither -- it would only ever receive them if somebody
     noticed a banner and clicked it.

     ⚠️ BEFORE `installJob`, for the same reason as the projects block below: it
     STARTS the agent, and rules that arrive afterwards are rules it was not born
     with. Same #732 ordering.

     ⚠️ IT WRITES INTO A FILE THE PERSON WROTE. Both blocks are constant words with
     no machine state, both go under their own headings so the seam between their
     words and ours stays visible, and `appendTo` refuses to add itself twice. The
     doctrine refresh already offers these same sections to agents that exist; this
     is the same write at a better moment.

     📌 Non-gating, and the byte cap DROPS THE BLOCK rather than refusing the
     agent -- the rule creation keeps. An import that lands without the rules is
     worse than one that lands with them and far better than none at all. */
  try {
    const file = path.join(given, instructionsFile);
    const { MAX_BYTES } = require('./instructions');
    let text = fs.readFileSync(file, 'utf8');
    let changed = false;
    try {
      const withDefaults = require('./defaults').appendTo(text);
      if (Buffer.byteLength(withDefaults, 'utf8') <= MAX_BYTES && withDefaults !== text) {
        text = withDefaults; changed = true;
      }
    } catch { /* imported without the rules rather than not imported */ }
    try {
      const connMod = require('./connections');
      const projectsMod = require('./projects');
      const spliced = projectsMod.spliceBlock(text, connMod.blockBody(), connMod.START, connMod.END);
      if (Buffer.byteLength(spliced, 'utf8') <= MAX_BYTES && spliced !== text) {
        text = spliced; changed = true;
      }
    } catch { /* same posture */ }
    if (changed) fs.writeFileSync(file, text, 'utf8');
  } catch { /* the doctrine banner still offers them, the old way */ }

  const wantProjects = (opts && Array.isArray(opts.projects))
    ? opts.projects.map((x) => String(x || '').trim()).filter(Boolean) : [];
  if (wantProjects.length) {
    try {
      const projectsMod = require('./projects');
      const recs = projectsMod.readAll().filter((p) => wantProjects.includes(p.id));
      if (recs.length) {
        const file = path.join(given, instructionsFile);
        const current = fs.readFileSync(file, 'utf8');
        const spliced = projectsMod.spliceBlock(current, projectsMod.blockBody(recs, name));
        const { MAX_BYTES } = require('./instructions');
        if (Buffer.byteLength(spliced, 'utf8') <= MAX_BYTES) fs.writeFileSync(file, spliced, 'utf8');
      }
    } catch { /* the sync after the session is up still does it, the old way */ }
  }
  const job = create.installJob(name, runner ? { runner } : {});
  if (!job.ok) {
    /* Rolled back to what was there before, so a failed connect leaves nothing
       claiming an agent exists.

       🛑 THE PROVIDER HAS TO BE NAMED, BECAUSE A MERGE CANNOT CLEAR A KEY BY
       OMITTING IT (#1401). `writeProfile` is `{ ...had, ...patch }`
       (engine/store.js:180), so listing two keys rolled back two keys and left
       `provider: 'openai'` behind. Measured: after this rollback the profile still
       read `provider: "openai"` with a null dir and a null displayName.

       ⇒ `server.js` derives a card's runner from `profile.provider`, so a REFUSED
       adoption could leave the board describing an agent that was never adopted,
       has no job, and will never start, as an OpenAI one. The comment above says
       this rollback exists so nothing is left claiming an agent exists - and it
       was leaving exactly that.

       ⚠️ RESTORED, NOT BLANKED. `before.provider` is what was there beforehand, so
       a retry on an agent that legitimately had one keeps it; only the stamp this
       call added goes. `null` clears it, measured. */
    try {
      store.writeProfile(name, {
        dir: before.dir || null,
        displayName: before.displayName || null,
        provider: before.provider || null,
      });
    }
    catch { /* the job is the thing that matters and it was not written */ }
    return { ok: false, because: job.because || 'we could not set it up to run' };
  }

  return { ok: true, name, displayName, dir: given, started: job.started === true };
}

/**
 * Undo a connect.
 *
 * 🛑 IT REFUSES ANYTHING KOSMOS MADE ITSELF, and that guard is the whole reason
 * this is a separate verb. "Undo" on a row somebody just pressed and "remove the
 * agent I built here" are the same machine operation and completely different
 * acts, and the only thing telling them apart is whether the agent's folder was
 * recorded -- which only a connect does.
 *
 * 🔑 THE TEARDOWN IS `removal.remove`, NOT A COPY OF IT. That path already boots
 * the job out in the right order, refuses to kill a session it cannot prove is
 * ours, re-checks that the session really went, and never touches the folder.
 * Six of the defects this codebase has paid for were a second copy of a guarded
 * sequence with fewer guards; this is not going to be the seventh.
 *
 * ⚠️ WHAT IT LEAVES BEHIND, said rather than discovered: the agent lands on the
 * removed list, because that is what `remove` records. For an undone misclick
 * that is slightly more ceremony than the act deserved, and it is the honest
 * trade against reimplementing the teardown. Their folder, their instructions
 * and anything they had running before are untouched.
 */
function disconnect(name) {
  const create = require('./create');
  const store = require('./store');
  const removal = require('./remove');

  const key = String(name == null ? '' : name);
  if (!create.nameUsable(key)) return { ok: false, because: 'that is not an agent we can act on' };

  let profile = {};
  try { profile = store.readProfile(key) || {}; } catch { profile = {}; }
  if (!profile.dir) {
    /* ⚠️ TWO DIFFERENT REFUSALS, because they send a person to two different
       places. An agent Kosmos built has a page with a Remove on it. A name we
       have no record of adding has nothing to undo, and telling somebody it was
       "made in Kosmos" about an agent they made themselves is a false sentence
       in the one message meant to explain what happened. */
    if (create.hasJob(key)) {
      return { ok: false,
        because: 'that agent was made in Kosmos, so this is not an undo. Remove it from its own page.' };
    }
    return { ok: false,
      because: 'we have no record of adding that agent, so there is nothing to undo' };
  }

  /* Captured BEFORE the teardown, because whether the file was one Kosmos wrote
     is the thing that decides if this may delete it. */
  let job = null;
  try { job = removal.jobFor(key); } catch { job = null; }

  let out;
  try { out = removal.remove(key); }
  catch { return { ok: false, because: 'we could not undo that' }; }
  if (out && out.outcome === removal.OUTCOME.REFUSED) {
    return { ok: false, because: out.because || 'we could not undo that' };
  }
  const stopped = !(out && out.outcome === removal.OUTCOME.PARTIAL);

  /* 🛑 AND THE JOB FILE GOES, which `remove` deliberately leaves behind (its
     Restore button re-enables that label, so it needs the file). An undo has no
     Restore: the person is putting the machine back the way it was, and before
     the add there was no file. Leaving it would make the row un-re-addable --
     `connect` refuses a name that already has a job, so the next press would
     answer "Kosmos already looks after an agent by that name" about an agent
     they had just taken away.
     ⚠️ ONLY WHEN THE TEARDOWN FULLY LANDED, and only a file we wrote. Deleting
     the plist out from under a job launchd still has loaded leaves a live job
     with nothing on disk to disable, which is worse than the state it fixes. */
  if (stopped && job && job.ours && job.plist) {
    try { fs.rmSync(job.plist, { force: true }); } catch { /* best effort: the record and the profile are what matter */ }
  }

  /* 🛑 AND THE REMOVAL RECORD GOES TOO. `remove` files one, and the board hides
     every name on that list -- so without this, pressing Undo and then Add again
     succeeds at every step and produces no agent. Not `restore`, which would put
     back the launch job this just took away on purpose. */
  const cleared = removal.forget(key);

  /* ⚠️ THE FOLDER RECORD IS CLEARED LAST, and only after the job is gone.
     Clearing it first would leave `workerDir` pointing at the derived folder
     while a live launch job still names theirs -- an agent whose files and whose
     job disagree about where it lives. */
  try { store.writeProfile(key, { dir: null }); }
  catch { return { ok: false, because: 'we undid it, but could not forget where it lived' }; }

  const partial = !stopped || !cleared;
  return {
    ok: true,
    name: key,
    partial,
    /* Says which half fell short rather than one sentence for both: a session we
       could not stop and a list we could not edit need different actions. */
    because: !cleared
      ? 'we undid it, but could not take it off the removed list, so it may stay hidden'
      : (out && out.because) || '',
    /* Carried, not dropped: a dry run must not reach a screen looking like work.
       See `markDryRun` in the removal engine. */
    dryRun: out && out.dryRun === true,
  };
}

module.exports = { alreadyIn,
  foundCodex,
  foundGemini,
  codexIdentity,
  runningUnderName, found, scan, connect, disconnect, dismissed, dismiss, DISMISS_FILE,
  declined, decline, undecline, DECLINED_FILE,
  // #2125: exposed so a test can assert the AUTO scan roots exclude the
  // TCC-protected home folders (Documents/Downloads/Desktop) while the import
  // scan (defaultScanRoots({importScan:true})) includes them, without walking the
  // operator's real home. Building the list touches no filesystem.
  defaultScanRoots };
