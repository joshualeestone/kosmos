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
const path = require('node:path');
const status = require('./status');
const codexsession = require('./codexsession');
const store = require('./store');

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
const dismissFile = () => path.join(store.ROOT, 'found-agents-dismissed.json');

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

const declinedFile = () => path.join(store.ROOT, 'found-agents-declined.json');

function declined() {
  try {
    const raw = JSON.parse(fs.readFileSync(declinedFile(), 'utf8'));
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
    fs.mkdirSync(path.dirname(declinedFile()), { recursive: true });
    const tmp = declinedFile() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ dirs }) + '\n');
    fs.renameSync(tmp, declinedFile());
  } catch { return { ok: false, because: 'we could not remember that' }; }
  return { ok: true, declined: given };
}

/** Undo one decline, because the screen offers an Undo and it must do something. */
function undecline(dir) {
  const given = String(dir == null ? '' : dir);
  const dirs = declined().filter((d) => d !== given);
  try {
    fs.mkdirSync(path.dirname(declinedFile()), { recursive: true });
    const tmp = declinedFile() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ dirs }) + '\n');
    fs.renameSync(tmp, declinedFile());
  } catch { return { ok: false, because: 'we could not remember that' }; }
  return { ok: true, restored: given };
}

function dismissed() {
  try { fs.statSync(dismissFile()); return true; } catch (err) {
    return !(err && err.code === 'ENOENT');
  }
}

function dismiss() {
  fs.mkdirSync(path.dirname(dismissFile()), { recursive: true });
  const tmp = dismissFile() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ dismissedAt: new Date().toISOString() }) + '\n');
  fs.renameSync(tmp, dismissFile());
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

  /* Stable and human: by the name a person would look for. */
  const agents = [...byDir.values()].sort((a, b) => a.name.localeCompare(b.name));
    return {
    ok: true,
    agents,
    unreadable: unreadable + codex.unreadable,
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
  if (!id || !id.displayName) {
    return { ok: false, because: 'those instructions do not say who the agent is, so we cannot bring it in' };
  }

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
  try { store.writeProfile(name, { dir: given, displayName: id.displayName, ...(runner === 'codex' ? { provider: 'openai' } : {}) }); }
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

  return { ok: true, name, displayName: id.displayName, dir: given, started: job.started === true };
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
  codexIdentity,
  runningUnderName, found, connect, disconnect, dismissed, dismiss, get DISMISS_FILE() { return dismissFile(); },
  declined, decline, undecline, get DECLINED_FILE() { return declinedFile(); } };
