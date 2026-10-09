'use strict';

/*
 * #3034: the default Kosmos setup-assistant agent.
 *
 * Josh, 2026-09-14: "After the install process, when we hit Giddy Up ... create
 * an agent that is a Kosmos setup assistant ... named after the user ... give it
 * my avatar ... a set of instructions on how to set up and get the most out of
 * Kosmos." And, resolving the open questions: "It would be a LIVE agent that
 * would run on one of their models. It would burn through their user quota but
 * that's fine because they're giving us access to one of their models."
 *
 * This seeds exactly one such agent, ONCE EVER, the moment the first model is
 * connected on an install that has been through first-run since #3660 (Splinter,
 * 2026-09-24 19:06): ensureGuide(), below, at Giddy Up or from the board's sweep.
 * The design is deliberately conservative and reversible (a normal deletable agent,
 * additive, one flag file), and every branch fails toward NOT disrupting
 * onboarding -- see the decisions below.
 *
 * DECISIONS (mine, per Josh's make-your-best-call ruling; adjust freely):
 * - NAME and AVATAR are JOSH'S, not the user's. Josh, 2026-09-24 16:05: "I think
 *   i want to use my avatar and play off the fact that I built it and will help
 *   them." The first version (#3153) read the 09-14 note ("give it my avatar")
 *   as the USER'S picture and name; his 09-24 ruling settles it the other way. So
 *   the guide is GUIDE_NAME and wears the bundled picture at GUIDE_AVATAR_BASE
 *   when one is shipped (no picture -> the initials avatar; never fatal).
 *   A saved user name is therefore no longer needed to seed.
 * - MODEL/ACCOUNT = the first connected model, on ITS provider (Claude, OpenAI,
 *   Gemini, Grok, in that order; a named account by its dir, a default as none),
 *   found by listedModels() + usable() through create's own accountConnectable gate. Josh: runs
 *   on the user's own model, quota-burn accepted. An OpenAI-only person gets a
 *   guide on OpenAI (the v1 limitation, Claude only, is gone).
 * - CONNECTED-MODEL GATE (the correctness crux). A created agent launches under
 *   launchd KeepAlive, so an agent with no model would respawn and fail on a loop.
 *   So nothing is created until a model is connected; before that the bubble runs
 *   on the hosted model (#3660). seedSetupAssistant()'s own `hasConnectedAccount`
 *   check (Claude-only by default) is kept for direct callers; ensureGuide bypasses
 *   it because usable() has already answered it, more strictly.
 * - ROLE = the `setup` role (engine/roles.js, menu:false so it is never in the
 *   normal create flow).
 * - The help-BUBBLE Josh floated is explicitly phase 2 and NOT built here.
 *
 * `createAgent` and `hasConnectedAccount` are injected so this is testable
 * without launching a real agent or depending on real account config.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const store = require('./store');
const accounts = require('./accounts');
const create = require('./create');

const SETUP_ROLE_KEY = 'setup';
/* #4350: how the auto-created guide's birth is recognised (create.isAutoGuideBirth), so it is
   left out of the public agents-created count. ONE definition, used for the create below. */
const GUIDE_CREATED_BY = 'kosmos';
const GUIDE_PURPOSE_PREFIX = 'default Kosmos setup guide';
/* Every purpose a shipped guide was born with, for recognising older births: 0.6.70 (37213fca1,
   2026-09-15 to 09-16) wrote "default Kosmos setup assistant (auto-created on first-run, #3034)". */
const GUIDE_PURPOSE_PREFIXES = Object.freeze([GUIDE_PURPOSE_PREFIX, 'default Kosmos setup assistant (auto-created']);

/* The guide's name, and its short AI tag (#3034, Josh 2026-09-24), used in the guide's purpose line below. */
const GUIDE_NAME = 'Josh';
const GUIDE_TAG = require('./roles').GUIDE_TAG;
/* Tried only when GUIDE_NAME is taken (Josh running his own build most likely has an
   agent called Josh already): the seed runs once, so a refused name would otherwise mean
   no guide ever, with nothing saying why. */
const GUIDE_FALLBACK_NAME = 'Josh AI';

/* A file the seed drops in the guide's own folder. The page route writes only where it
   finds this, so a guide whose folder was deleted never has its page reports land in a
   later, unrelated agent that happens to take the same name. A plain REMOVE deletes
   nothing on disk, so the marker survives it; the route checks the removed list for that. */
const GUIDE_MARKER = '.kosmos-setup-guide';

/* Where the bundled picture of Josh lives: web/icons/setup-guide-avatar.<ext>,
   inside web/ so the app bundle ships it (tools/build-kosmos-bundle.sh copies web/
   whole). Absent until the photo is chosen; the seed then uses the initials. */
const GUIDE_AVATAR_DIR = path.join(__dirname, '..', 'web', 'icons');
const GUIDE_AVATAR_BASE = 'setup-guide-avatar';

/* #3034/#3660: the setup guide is created automatically, but WHEN is the point.
 * History: gated off 2026-09-16 (Josh: "I haven't given direction on it"). Direction
 * since: Josh 2026-09-24 16:05 (his avatar, speaks as the builder) and 18:07 (the
 * hosted assistant until they connect a model, #3660); Splinter's call 19:06 on #3660:
 * create the guide THE MOMENT THE FIRST MODEL IS CONNECTED, during setup or later,
 * never at Giddy Up without a model (it could not run and would sit broken on the
 * board). So this switch arms ensureGuide(), below, rather than creating at Giddy Up.
 * Reversible: false turns every automatic path off again; seedSetupAssistant() still
 * works when called directly. */
const FIRSTRUN_AUTOCREATE_ENABLED = true;

/* Once-ever flag, same shape/rationale as projects.js welcome-seed: an empty
 * store cannot tell "never seeded" from "the user deleted the assistant", so the
 * flag is what separates them -- we must not re-create one the user removed. */
function flagPath() { return path.join(store.ROOT, 'setup-assistant.json'); }

function setupAssistantSeeded() {
  try { return fs.existsSync(flagPath()); }
  catch { return false; }
}

/* Written by the caller only AFTER a successful create, so a refused/skipped
 * create leaves no flag. Returns whether it stuck. A failed write would let a later
 * try create a SECOND guide (the seed falls back to "Josh AI" when "Josh" is taken),
 * so ensureGuide also keeps an in-process latch; across a restart with an unwritable
 * store, the flag cannot be trusted and nothing here can do better. */
function markSetupAssistantSeeded(meta) {
  try {
    fs.writeFileSync(flagPath(),
      JSON.stringify({ at: new Date().toISOString(), ...(meta || {}) }) + '\n', 'utf8');
    return true;
  } catch { return false; }
}

/* Fast, config-based "is a Claude account connected" (accounts.list() reads the
 * account dirs' oauthAccount, no live probe). Fails toward "not connected" so a
 * read error never causes a churning dead agent to be created. */
function defaultHasConnectedAccount() {
  try { return accounts.list().length > 0; }
  catch { return false; }
}

const MIME_BY_EXT = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp',
};

/* The bundled picture of Josh, or null when none is shipped. `dir` is injectable
   so a test can point it at a sandbox. */
function guideAvatarPath(dir = GUIDE_AVATAR_DIR) {
  for (const ext of Object.keys(MIME_BY_EXT)) {
    const f = path.join(dir, GUIDE_AVATAR_BASE + ext);
    try { if (fs.statSync(f).isFile()) return f; } catch { /* not this one */ }
  }
  return null;
}

/* Copy the guide's picture onto the freshly-created agent. Best-effort and
 * fully isolated: any failure leaves the agent with its default avatar and never
 * affects the create outcome or onboarding. store.saveAvatar sniffs the bytes, so
 * a mislabelled file is refused there rather than trusted by its extension. */
function copyGuideAvatar(agentName, dir) {
  try {
    const pic = guideAvatarPath(dir);
    if (!pic) return false;
    const type = MIME_BY_EXT[path.extname(pic).toLowerCase()];
    if (!type) return false;
    store.saveAvatar(agentName, type, fs.readFileSync(pic));
    return true;
  } catch { return false; }
}

/* #4230 (Josh's new photo, 2026-09-27): a guide created before a photo change keeps the old
 * one, because copyGuideAvatar copied it at creation. On start, the guide's picture is
 * replaced only when it is byte-for-byte a retired bundled photo, so a picture the person
 * chose is never touched. Best-effort: any failure leaves the picture as it is. */
const RETIRED_GUIDE_AVATARS = new Set([
  '13237cdb0cb2ed39e422492810482ed847e9a78b2875a4aa431e58c33684efa9',   // web/icons/setup-guide-avatar.jpg before #4230
]);
function refreshGuideAvatar(dir = GUIDE_AVATAR_DIR, retired = RETIRED_GUIDE_AVATARS) {
  try {
    const name = guideName();
    if (!name || !isGuideFolder(name)) return false;
    const cur = store.avatarPath(name);
    if (!cur) return false;
    const sha = (b) => require('crypto').createHash('sha256').update(b).digest('hex');
    if (!retired.has(sha(fs.readFileSync(cur)))) return false;
    const pic = guideAvatarPath(dir);
    if (!pic) return false;
    const type = MIME_BY_EXT[path.extname(pic).toLowerCase()];
    if (!type) return false;
    const bytes = fs.readFileSync(pic);
    if (retired.has(sha(bytes))) return false;   // the bundle still holds a retired photo
    store.saveAvatar(name, type, bytes);
    return true;
  } catch { return false; }
}

function guideFolder(agentName) {
  try {
    const file = require('./instructions').fileFor(agentName);
    return typeof file === 'string' && file ? path.dirname(file) : null;
  } catch { return null; }
}

/* Mark the freshly-created guide's folder. Best-effort: without it the page route
   answers 409 rather than write somewhere it cannot vouch for. */
function markGuideFolder(agentName) {
  const dir = guideFolder(agentName);
  if (!dir) return false;
  try { fs.writeFileSync(path.join(dir, GUIDE_MARKER), `${agentName}\n`, { flag: 'w' }); return true; }
  catch { return false; }
}

/*
 * #3769 (Josh, 2026-09-25 11:54): the guide is kept away from passwords and keys by three layers, and
 * this is the second: what Kosmos lets it open. Deny rules in the guide's OWN project settings
 * (<its folder>/.claude/settings.json), which Claude Code applies even to a session started with
 * --dangerously-skip-permissions, as every Kosmos agent is. Its own folder, not the account's
 * settings.json, because an account is shared by every agent on it.
 * - Read covers Claude Code's file tools; the Bash rules stop the commands that print secrets by name.
 *   Where guardGuideFolder writes no sandbox, a shell can still reach a file some other way, and
 *   everywhere the rules reach only the paths they name, which is why the first layer (its instructions,
 *   roles.GUIDE_SECRET_LINES) and the third (engine/secretmask.js on everything it says) exist.
 * - Claude only: the file is written for every guide (create.js does not look at the provider), but
 *   only Claude Code reads it, so a Codex, Gemini or Grok guide relies on the other two layers.
 * - Kosmos's own data folder is denied whole: the guide's instructions and page file live in its
 *   worker folder. The `kosmos` command the guide runs reads board.token in that folder as its own
 *   process, and whether that read is refused differs by guide (#4728):
 *     a Claude guide on macOS          refused, by the sandbox guardGuideFolder adds (measured, with a
 *                                      stand-in for the command)
 *     a Claude guide anywhere else     not refused: no sandbox is written there (not measured)
 *     a Codex, Gemini or Grok guide    not refused: its runner does not read that settings file (not measured)
 *   Even in the first row the refusal reaches only the paths these rules name.
 * - #4752: the other stores are denied too: the older data folder, and, for a guide in a named world, the
 *   default world's store (entry by entry) and every world's store. Not the worlds' base whole: a named
 *   world's agents, the guide included, live under it.
 */
/* The same home accounts.js and create.js use (a named world or a test sets it). */
function kosmosHome() { return process.env.AGENT_WORKFORCE_HOME || require('os').homedir(); }
/* `worldsBase` and `legacyRoots` are for tests: left out, both are worked out from this process (as `dataRoot`'s
   default is), and production passes none of these. `home` reaches the older folder of this world (when
   AGENT_WORKFORCE_DATA is unset: dataRootFor ignores the home otherwise); the
   worlds' base comes from the environment the process was started with (`preWorldEnv`), whatever `home` says. */
// for inspection and tests only: twins of every `Read(//x/...)` rule, before the own-folder check (guardGuideFolder twins only the safe ones)
function guideDenyRules(opts = {}) { return withNativeTwins(guideDenyRulesFor(opts).rules); }
/* The rules, and the default world's store they name entry by entry (null when none is), so guardGuideFolder
   can drop earlier per-entry rules for that store instead of keeping one for every entry that ever existed. */
function guideDenyRulesFor({ home = kosmosHome(), dataRoot = store.ROOT, worldsBase, legacyRoots } = {}) {
  const rules = [
    'Read(~/.ssh/**)', 'Read(~/.aws/**)', 'Read(~/.config/**)', 'Read(~/.gnupg/**)', 'Read(~/.kube/**)',
    'Read(~/.docker/**)', 'Read(~/.azure/**)', 'Read(~/.netrc)', 'Read(~/.npmrc)', 'Read(~/.pypirc)',
    'Read(~/.git-credentials)', 'Read(~/.zsh_history)', 'Read(~/.bash_history)', 'Read(~/.claude.json)',
    'Read(~/.claude/**)', 'Read(~/.codex/**)', 'Read(~/.gemini/**)', 'Read(~/.grok/**)',
    /* Every account after the first lives in ~/.claude-<label>, ~/.codex-<label> (and the Gemini and
       Grok analogs), with a pasted Claude key in .kosmos-claude-apikey (review round 2). Measured: a
       wildcard in the folder name holds for the Read tool and for cat. */
    'Read(~/.claude-*/**)', 'Read(~/.codex-*/**)', 'Read(~/.gemini-*/**)', 'Read(~/.grok-*/**)',
    'Read(**/.kosmos-claude-apikey)', 'Read(**/.kosmos-gemini-apikey)', 'Read(**/.kosmos-grok-apikey)',
    'Read(**/.env)', 'Read(**/.env.*)', 'Read(**/*.pem)', 'Read(**/*.key)',
    'Bash(security find-generic-password:*)', 'Bash(security find-internet-password:*)',
    'Bash(security dump-keychain:*)', 'Bash(printenv:*)', 'Bash(printenv)', 'Bash(env)', 'Bash(history:*)',
    'Bash(set)', 'Bash(export)', 'Bash(export -p)',
    /* Its own guards and instructions (relative to its folder, where it runs). Measured: an Edit rule
       stops the Edit and Write tools AND a shell redirect into the path; a Write(...) rule is not a
       file rule at all, Claude Code says so and ignores it. Deleting the marker would hand the next
       session the tokens; removing the rule from CLAUDE.md is undone at the next board start. */
    'Edit(.claude/**)', 'Edit(.kosmos-setup-guide)', 'Edit(CLAUDE.md)',
  ];
  if (home && path.resolve(home) !== path.resolve(require('os').homedir())) {
    /* A Kosmos home that is not the login home (a named world, a test): its credential folders too. */
    for (const d of ['.ssh', '.aws', '.config', '.claude', '.codex', '.gemini', '.grok', '.claude-*', '.codex-*', '.gemini-*', '.grok-*']) rules.push(`Read(${ruleAbs(path.join(home, d))}/**)`);
    rules.push(`Read(${ruleAbs(path.join(home, '.claude.json'))})`);
  }
  if (dataRoot) rules.push(`Read(${ruleAbs(dataRoot)}/**)`);
  /* #4752: a board token (and the rest of a store: agent tokens, device secrets, conversations) can also sit in
     the older data folder and in another world's. `dataRoot` above is this guide's own world only, so those are
     named too. Not the worlds' base whole: in a named world the guide's own folder is under it
     (<base>/worlds/<id>/workers), and a rule on the base would cut it off from its own instructions. So in the
     base, which IS the default world's store, every entry is named except the worlds folder and its registry.
     The list is read when the rules are written (create.js when the guide is made, refreshGuideGuards at every
     board start); an entry made later is uncovered until the next start, except the token and its temporary
     copies, which are always named. */
  /* The same folder, spelt differently (case on a case-insensitive disk, a link) or not: real paths when both exist. */
  const same = (a, b) => !!a && !!b && (path.resolve(a) === path.resolve(b) || realOr(a) === realOr(b));
  /* A folder whose rule the syntax would misread (`* ? [ ] ( ) { } !`) gets no rule here: said, not guessed. Checked on
     what ruleAbs writes (its leading // taken off), so the check and the rule are one spelling (the platform's own
     separator is gone by then; an extended-length \\?\ path is checked after its `?` is gone). Nothing else is refused, on
     any platform, as on main: a share, a device form or a drive-relative path is written as it is. */
  const plain = (p) => {
    if (!ruleUnwritable(p)) return true;
    process.stderr.write(`#4752: no rule for ${p}: its path has a character the rule syntax reads as a pattern\n`);
    return false;
  };
  let extra = [];
  let entryBase = null;
  let listed = false;   // earlier per-entry rules are dropped only when this list is complete
  try {
    const more = [];
    for (const old of (legacyRoots !== undefined ? legacyRoots : guideLegacyRoots(home))) {
      if (old && !same(old, dataRoot) && plain(old)) more.push(`Read(${ruleAbs(old)}/**)`);
    }
    const base0 = worldsBase !== undefined ? worldsBase : guideWorldsBase();
    const apart = base0 && !same(base0, dataRoot);
    const base = apart && !plain(base0) ? null : base0;
    if (base && apart) {
      const worlds = require('./worlds');
      const tokenFile = require('./boardauth').TOKEN_FILE;
      more.push(`Read(${ruleAbs(path.join(base, tokenFile))})`);   // the default world's token
      more.push(`Read(${ruleAbs(path.join(base, '.' + tokenFile))}.*)`);   // and its temporary copy while it is rewritten
      const registry = path.basename(worlds.registryPath(base));
      more.push(`Read(${ruleAbs(path.join(base, '.*.tmp'))})`);   // the dot-named temporary files (the registry's, the token's, the boot guard's)
      let entries = [];
      try { entries = fs.readdirSync(base, { withFileTypes: true }); listed = true; } catch (e) {
        /* Only the entry list is lost: the rules above do not depend on it. A store that is not there (ENOENT)
           has no entries to name, but it may only be moving, so the last listing's rules are kept for it too. */
        if (e.code !== 'ENOENT') process.stderr.write(`#4752: the default world's store could not be listed, so its entries are not named one by one: ${e.message}\n`);
      }
      for (const d of entries) {
        if (!baseEntryToName(d.name, worlds.WORLDS_SUBDIR, registry, tokenFile)) continue;
        const at = ruleAbs(path.join(base, d.name));
        if (d.isFile()) more.push(`Read(${at})`);
        else more.push(`Read(${at})`, `Read(${at}/**)`);   // a folder, or a link that may be one: both forms
      }
      const worldsDir = path.join(base, worlds.WORLDS_SUBDIR);
      // every named world's store: a `*` in the middle of a path, measured refused on Claude Code 2.1.285 only (#4752).
      // On Windows ruleAbs writes the POSIX form Claude Code's docs say it matches (`//c/...`), so the `/*/` joins one form.
      for (const leaf of [store.APP, store.LEGACY_APP]) more.push(`Read(${ruleAbs(worldsDir)}/*/${leaf}/**)`);
    }
    rules.push(...more);
    extra = more;
    if (listed) entryBase = base;
  } catch (err) {
    /* The rules above still stand: a guide is never left with none because these could not be worked out. Said,
       so a guide written without them can be told apart from one written with them. */
    process.stderr.write(`#4752: the setup guide's rules for the older data folder and the other worlds' stores were left out: ${(err && err.message) || err}\n`);
  }
  return { rules, entryBase, extra };   // twins are added in guardGuideFolder, only to rules that pass the own-folder check
}
/* Whether `p` cannot be written as a rule: once written (ruleAbs), it has a character the rule syntax reads as a
   pattern. Nothing else is refused, on any platform, as on main: a share, a device form or an unusual Windows path is
   written as it is (an extra deny costs nothing; refusing one would leave that folder with no rule at all). ruleAbs
   never turns a bare drive-relative C: into the whole drive. Pure, the platform passed in. */
function ruleUnwritable(p, platform = process.platform) {
  return RULE_SYNTAX.test(ruleAbs(p, platform).slice(2));
}
/* The characters the rule syntax reads as a pattern or a bracket (and a backslash): a path with one gets no rule. */
const RULE_SYNTAX = /[*?[\](){}!\\]/;
/* A folder's real path when it can be read, else the path as given. */
function realOr(p) { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } }
/* #4491: canonicalize a path whose LEAF may not exist yet (a settings.json not written, a board.token
   not minted). First resolve the WHOLE path -- if the leaf exists, even as a symlink, Seatbelt checks
   the target, so the literal must be the target too. Only when that throws (the leaf is absent) fall
   back to resolving the deepest existing ancestor and rejoining the rest, so a symlinked PARENT
   (e.g. ~/.claude -> elsewhere) is still followed. */
function realOrLeaf(p) {
  const abs = path.resolve(p);
  try { return fs.realpathSync.native(abs); } catch { /* leaf absent: climb to the existing ancestor */ }
  let dir = path.dirname(abs);
  const tail = [path.basename(abs)];
  for (;;) {
    try { return path.join(fs.realpathSync.native(dir), ...tail); } catch { /* climb */ }
    const parent = path.dirname(dir);
    if (parent === dir) return abs;   // reached the root with nothing resolvable
    tail.unshift(path.basename(dir));
    dir = parent;
  }
}
/* A path as a Claude Code rule spells an absolute one: two slashes, then the path without its leading slashes.
   On Windows Claude Code matches a rule against the path in POSIX form (its permissions docs: C:\Users\alice
   becomes /c/Users/alice), so a drive path is written that way: C:\Users\x becomes //c/Users/x. The native
   spelling (//C:\Users\x) is not a form its docs say it matches (not measured on Windows here). The extended-length
   forms \\?\C:\ and \\?\UNC\host\share are written as their plain paths; the device form \\.\C:\ is written with its
   separators converted (//./C:/...), not refused (not a likely store). */
function ruleAbs(p, platform = process.platform) {
  let s = String(p);
  if (platform === 'win32') {
    s = s.replace(/^[\\/]{2}\?[\\/]UNC[\\/]/i, '//');   // \\?\UNC\host\share: the same share as \\host\share
    s = s.replace(/^[\\/]{2}\?[\\/]/, '');   // the extended-length prefix (\\?\C:\...): its `?` is a glob in a rule
    s = s.replace(/\\/g, '/');
    const drive = /^([A-Za-z]):\//.exec(s);   // only a drive WITH its separator: a bare C: is drive-relative, never the whole drive
    if (drive) s = drive[1].toLowerCase() + '/' + s.slice(drive[0].length);
  }
  // no trailing slash, so a drive root's folder rule is //d/** and not //d//**
  return '//' + s.replace(/^\/+/, '').replace(/\/+$/, '');
}
/* Every path a rule can stand for: rulePath's reading and, on Windows, for a rule that starts with one letter, the
   share that letter could also be the host of (\\s\share is written //s/share, the same as drive S:). */
function rulePaths(inner, platform = process.platform) {
  const out = [];
  const back = rulePath(inner, platform);
  if (back !== null) out.push(back);
  const t = String(inner);
  // for an ordinary drive rule (c/Users/x) this reading never matches: `own` is a drive path, compared as text
  // (the device form and a drive-relative C:foo are written too, as inert rules that match nothing)
  if (platform === 'win32' && /^[A-Za-z]\/[^/]+/.test(t)) out.push('\\\\' + t.replace(/\//g, '\\'));
  return out;
}
/* Whether any reading of a rule (rulePaths) holds the guide's own folder `own`. The first reading is resolved with
   `real` (realpath; case-sensitive is safe, since `own` is a realpath too and a missing folder cannot contain the
   guide), unless it is a share; every share reading is compared as TEXT, case-blind, and never resolved: resolving
   \\c\Users would send Windows to the network for a host named c on every drive rule. Pure, `real` and `sep` passed in. */
function readingsHoldGuide(backs, own, real, sep) {
  const under = (a, b) => a === b || a.startsWith(b.endsWith(sep) ? b : b + sep);
  const text = (t) => under(own.toLowerCase(), t.toLowerCase());
  if (!backs.length) return false;
  // returns the reading that holds the guide (truthy), so the refusal can say which, or false
  // a share reading (\\\\host\\...) is never resolved either: resolving it is a network lookup that can send this
  // person's Windows credentials to the host it names (Claude Code's permissions docs say so of UNC paths)
  const first = backs[0];
  if (/^[\\/]{2}/.test(first) ? text(first) : under(own, real(first))) return first;
  return backs.slice(1).find(text) || false;
}
/* The inverse, for code that reads a rule back as a path: what follows `Read(//` (without a trailing `/**`) to the
   path it names. On Windows `c/Users/x` is `C:\Users\x`; a rule in the older native form (`C:\Users\x`, written
   before this change) is read as it is. Elsewhere it is `/` plus the rest. A share's rule (host/share/...) reads back as
   its UNC path (\\host\share\...), so the own-folder check compares real paths; a one-letter host reads back as a drive
   (S:), the one form that cannot be told apart. */
function rulePath(inner, platform = process.platform) {
  const t = String(inner);
  if (platform === 'win32') {
    if (/^[A-Za-z]:/.test(t)) return t;   // native already, or a bare/drive-relative C: or c:foo (resolved as given)
    const d = /^([A-Za-z])(\/|$)/.exec(t);
    if (d) return d[1].toUpperCase() + ':\\' + t.slice(d[0].length).replace(/\//g, '\\');
    // no drive: a share (host/share/...) reads back as its UNC path, so the own-folder check compares real paths;
    // anything shorter is not a form ruleAbs writes, and is never resolved against the current drive
    if (/^[^/]+\/[^/]+/.test(t)) return '\\\\' + t.replace(/\//g, '\\');
    return null;
  }
  return '/' + t;
}
/* Before #4752's follow-up a Windows rule was written in the native form (`Read(//C:\...)`), which is not the form
   Claude Code documents as matched. For such a rule, the same rule in the form ruleAbs writes now (`Read(//c/...)`,
   same suffix), else null. migrateKept keeps an old rule beside its equivalent and drops it only when the
   equivalent is a per-entry rule for an entry that is gone; finalDeny leaves it out when its equivalent was refused.
   Uses the win32 conversion on any host. */
function legacyWinEquivalent(rule) {
  // A drive then a backslash or a slash (C:\..., C:/...), or a share in main's spelling (\\host\share\...), then the
  // suffix the writer adds (`/**`, `/*/...`, `.*`); the path may hold a `)`, so it is lazy and anchored on the known
  // suffix and the rule's last `)`. The path is converted alone, as ruleAbs converts it (a drive root maps to //c/**).
  const m = /^Read\(\/\/([A-Za-z]:[\\/].*?|\\\\[^\\/]+[\\/].*?)((?:\/\*\*|\/\*\/[^/]*\/\*\*|\/\*\/[^/]*|\.\*)?)\)$/.exec(String(rule));
  if (!m) return null;
  return `Read(${ruleAbs(m[1], 'win32')}${m[2]})`;
}
/* #4752: on Windows every absolute rule is ALSO written in the older native spelling, beside the //c/ form Claude
   Code's docs say it matches: these are deny rules, the new form is not measured on Windows here, and an extra deny
   costs nothing (a new install then has the same belt-and-braces an older one keeps through migrateKept). The twin
   is exactly what the writer before this change wrote, so migrateKept and finalDeny already treat it as the old form
   of its rule. Pure, with the platform passed in. */
function withNativeTwins(rules, platform = process.platform) {
  if (platform !== 'win32') return rules;
  const out = [];
  const seen = new Set(rules);
  for (const r of rules) {
    out.push(r);
    // The path is a drive (c, or c/...) or a share (host/share/... with a host longer than one letter; a one-letter
    // host is read as a drive, a small over-deny recorded in the plan), then the suffix the writer added. It may hold
    // a `)` (a folder like `Jo (work)`): lazy, anchored on the known suffix and the rule's last `)`. The twin is main's
    // spelling of the same path, so a new install keeps a fallback for a drive and for a share.
    const m = /^Read\(\/\/([a-z](?:\/.*?)??|[^/.][^/]+\/[^/].*?)((?:\/\*\*|\/\*\/[^/]*\/\*\*|\/\*\/[^/]*|\.\*)?)\)$/.exec(r);
    if (!m) continue;
    const native = rulePath(m[1], 'win32');
    if (native) { const twin = `Read(//${native}${m[2]})`; if (!seen.has(twin)) { seen.add(twin); out.push(twin); } }
  }
  return out;
}
/* #4752: is `rule` one this code writes for a single entry directly in `base` (either form), for a name
   baseEntryToName lets through? Built from ruleAbs over the platform's own join (the writer's on that platform), so it
   matches on Windows too. Case-sensitive: a rule spelt in another case is not recognised, and stays (the safe way). */
function wasEntryRule(rule, base, platform = process.platform) {
  const join = platform === 'win32' ? path.win32.join : path.join;
  const prefix = `Read(${ruleAbs(join(base, 'x'), platform).slice(0, -1)}`;   // the writer's own spelling, separator included
  if (!rule.startsWith(prefix) || !rule.endsWith(')')) return false;
  let name = rule.slice(prefix.length, -1);
  if (name.endsWith('/**')) name = name.slice(0, -3);
  // a backslash is refused on every platform: no POSIX rule ever held one (`plain` refuses them), so none is orphaned
  if (!name || name.includes('/') || name.includes('\\') || name.includes(path.sep)) return false;
  const worlds = require('./worlds');
  return baseEntryToName(name, worlds.WORLDS_SUBDIR, path.basename(worlds.registryPath(base)), require('./boardauth').TOKEN_FILE);
}
/* #4752: the deny list written: the kept earlier rules and the safe new ones, less every refused rule. On Windows an
   earlier rule in the older native form whose new-form equivalent was refused (it would take in the guide's own
   folder) is left out too: migrateKept keeps old rules beside their new form, so the refusal must reach both
   spellings or the old one would cut the guide off. Pure, with the platform passed in. */
function finalDeny(kept, safe, refused, platform = process.platform) {
  // on Windows a path's case does not matter, so an old rule spelt in another case still reaches its refused new form
  const refusedLower = new Set([...refused].map((x) => x.toLowerCase()));
  const earlier = new Set(kept);   // only an earlier rule is removed by case (its removal is said by the caller)
  return [...new Set([...kept, ...safe])].filter((r) => {
    if (refused.has(r)) return false;
    // a new-form path rule spelt in another case (Read rules only: a refusal is only ever a Read rule)
    if (platform === 'win32' && earlier.has(r) && r.startsWith('Read(') && refusedLower.has(r.toLowerCase())) return false;
    if (platform === 'win32') { const eq = legacyWinEquivalent(r); if (eq && refusedLower.has(eq.toLowerCase())) return false; }
    // two spellings of one rule (an old `//c:\` beside the `//C:\` twin) both stay: whether Claude Code matches case-
    // blind is not documented, and a duplicate deny costs nothing, while folding could drop a person's own rule
    return true;
  });
}
/* #4752: which of the rules already in the guide's settings stay, given the rules just made (`fresh`).
   - An earlier rule for one entry of the default world's store is dropped (wasEntryRule) unless just made again,
     so a deleted or renamed entry does not leave a rule for ever; any other rule stays.
   - On Windows, a rule in the older native form STAYS beside its new-form equivalent during migration: the new form is
     the one Claude Code's docs say it matches (trusted for new rules too), and keeping the old one beside it is a
     cheap belt-and-braces while that is unmeasured on Windows here (a duplicate deny costs nothing). It is dropped only when its equivalent is a
     per-entry rule for an entry gone from the store just listed in full: nothing is left to protect there.
   Pure, with the platform passed in, so the Windows answer is pinned from any host. */
function migrateKept(had, fresh, platform = process.platform) {
  const kept = fresh.entryBase ? had.filter((r) => fresh.rules.includes(r) || !wasEntryRule(r, fresh.entryBase, platform)) : had;
  if (platform !== 'win32') return kept;
  return kept.filter((r) => {
    const eq = legacyWinEquivalent(r);
    if (!eq || fresh.rules.includes(eq)) return true;   // not an old rule, or its path is still protected: keep both
    return !(fresh.entryBase && wasEntryRule(eq, fresh.entryBase, platform));   // an entry that is gone
  });
}
/* #4752: whether an entry directly in the worlds' base gets a rule of its own. Not the worlds folder or its
   registry (the guide's own folder is under the first), nor the token (it has its own rule), nor a dot-named
   temporary file (`.<name>.<process id>...tmp`) or the registry's lock: the `.board.token.*` and `.*.tmp`
   pattern rules cover those files, and the lock holds nothing. Not a name the rule syntax would misread (one
   of `* ? [ ] ( ) { } !`, a backslash, or a space at either end): its rule could deny more than the entry or
   not parse, so the name is left readable; Kosmos makes none. */
function baseEntryToName(name, worldsDir, registry, tokenFile) {
  if (name === worldsDir || name === registry || name === tokenFile) return false;   // the token has its own rule, always
  if (name.startsWith(`.${tokenFile}.`) || name === require('./worlds').registryLockName() || /^\..*\.tmp$/.test(name)) return false;
  return !RULE_SYNTAX.test(name) && name === name.trim();
}
/* #4752: the worlds' base (the default world's data folder), as it was before any world was applied to this
   process; null when it cannot be worked out. */
function guideWorldsBase() {
  const worlds = require('./worlds');
  return worlds.baseRoot(worlds.preWorldEnv(process.env));   // a throw reaches guideDenyRules, which says so
}
/* #4752: the older data folder (store.LEGACY_APP), for this world and for the default world. */
function guideLegacyRoots(home) {
  const worlds = require('./worlds');   // a throw reaches guideDenyRules, which says so
  const out = [];
  const pre = worlds.preWorldEnv(process.env);
  for (const [env, at] of [[process.env, home], [pre, pre.AGENT_WORKFORCE_HOME || require('os').homedir()]]) {
    const root = store.dataRootFor(process.platform, at, env, store.LEGACY_APP);
    if (root && !out.includes(root)) out.push(root);
  }
  return out;
}

/*
 * Write the guide's guards into its folder: the marker (bin/agent-supervisor.sh reads it to launch the
 * guide with none of the tokens Kosmos holds for the person) and the deny rules, merged into any
 * settings already there. create.js calls this BEFORE the guide can start; refreshGuideGuards calls it
 * again at board start, so a guide made before #3769 is guarded from its next session.
 * { ok: true } | { ok: false, because }. Never throws.
 */
function guardGuideFolder(dir, agentName, deps = {}) {
  try {
    if (!dir || !agentName) return { ok: false, because: 'no folder' };
    fs.writeFileSync(path.join(dir, GUIDE_MARKER), `${agentName}\n`, { flag: 'w' });
    const settingsDir = path.join(dir, '.claude');
    fs.mkdirSync(settingsDir, { recursive: true });
    const file = path.join(settingsDir, 'settings.json');
    let cur = {};
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) cur = parsed;
    } catch { cur = {}; }
    const perms = cur.permissions && typeof cur.permissions === 'object' && !Array.isArray(cur.permissions) ? cur.permissions : {};
    const had = Array.isArray(perms.deny) ? perms.deny.filter((r) => typeof r === 'string') : [];
    const fresh = guideDenyRulesFor(deps);
    /* #4752: an earlier rule for one entry of the default world's store is dropped and made again from the store
       as it is now, so an entry that was deleted or renamed (a dated backup, a rotated log) does not leave a rule
       behind for ever. Only a rule this code could have written for one entry is dropped (wasEntryRule); any
       other rule stays, a person's own rule for the registry or for a name this code leaves alone included. */
    const plat = process.platform;   // the platform the rules above were written for (ruleAbs uses the same)
    const kept = migrateKept(had, fresh, plat);
    /* #4752: none of THIS change's rules (fresh.extra) may take in the guide's own folder. An older folder or a
       linked entry a person made can resolve to an ancestor of it, and the sandbox follows links, so such a rule
       would cut the guide off from its own instructions: dropped, and said. What this checks, no more: a rule
       naming one folder or file, compared through every reading of the rule (rulePaths, readingsHoldGuide: a drive
       reading by real path, a share reading as text); a rule
       with a `*` is not checked, and an earlier rule removed for taking in this folder
       (equal to a refused rule in either spelling or case, by finalDeny) is said by the loop after it; migrateKept
       drops an earlier per-entry rule for a gone entry without a word, as on main. */
    const own = realOr(dir);
    const safe = fresh.rules.filter((r) => {
      if (!fresh.extra.includes(r)) return true;
      const m = /^Read\(\/\/([^*?]*?)(\/\*\*)?\)$/.exec(r);
      if (!m) return true;
      // every path the rule can stand for (a one-letter share host reads as a drive too): refused if ANY holds the guide
      const backs = rulePaths(m[1], plat);
      if (!backs.length) return true;      // not a form ruleAbs writes: nothing to compare
      const held = readingsHoldGuide(backs, own, realOr, path.sep);
      if (!held) return true;
      process.stderr.write(`#4752: a rule that would take in the guide's own folder was left out: ${r} (read as ${held})\n`);
      return false;
    });
    /* A refused rule is kept out of the earlier rules too, or a rule written on an earlier start would come back. */
    const refused = new Set(fresh.rules.filter((r) => !safe.includes(r)));
    // a twin is made only from a rule that passed the own-folder check, so a refused rule never gets one
    const deny = finalDeny(kept, withNativeTwins(safe, plat), refused, plat);
    // an earlier rule (the guide's, or a person's own) removed because it equals a refused one is said, never silent
    const written = new Set(deny);
    for (const r of new Set(kept)) if (!written.has(r)) process.stderr.write(`#4752: an earlier rule that would take in the guide's own folder was removed: ${r}\n`);
    const next = { ...cur, permissions: { ...perms, deny } };
    /* Sandboxed Bash (Ice Cream Kitty's review): the deny rules above bind Claude Code's own tools, and
       a shell command such as `node -e readFileSync('.env')` or `grep -r` is a subprocess they do not
       reach. The sandbox applies the same deny paths to EVERY subprocess at the operating system.
       Measured with real runs on this Mac: node read a denied file with EPERM and grep found nothing,
       where the unsandboxed control printed both. allowLocalBinding lets the shell reach the board on
       localhost, which the `kosmos` command needs (measured: without it curl to 127.0.0.1 fails); the
       guide's `kosmos reply` then reaches the board on its agent token, since the sandbox also keeps
       it from reading the board token (install/kosmos presents the agent token for that reason).
       macOS only: that is where it is measured, and where Claude Code's sandbox is Seatbelt. */
    if ((deps.platform || process.platform) === 'darwin') {
      const sb = cur.sandbox && typeof cur.sandbox === 'object' && !Array.isArray(cur.sandbox) ? cur.sandbox : {};
      const net = sb.network && typeof sb.network === 'object' && !Array.isArray(sb.network) ? sb.network : {};
      /* allowUnsandboxedCommands false: without it a refused command can simply be re-run with
         dangerouslyDisableSandbox, and every Kosmos agent runs with --dangerously-skip-permissions, so the
         retry is approved and the file is read. Measured: the retry printed the canary; with this set it
         did not (round 1 of this branch's review). */
      next.sandbox = { ...sb, enabled: true, autoAllowBashIfSandboxed: true, allowUnsandboxedCommands: false, network: { ...net, allowLocalBinding: true } };
    }
    const tmp = `${file}.${process.pid}.new`;
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n', 'utf8');
    fs.renameSync(tmp, file);
    return { ok: true };
  } catch (err) {
    return { ok: false, because: String((err && err.message) || err) };
  }
}

/*
 * #4491: every board.token root a token-only agent could read -- this store, plus the pre-#2439 legacy
 * roots and the default world's base, each of which carries its own board.token that is a valid token
 * for that board. Derived the way the guide does, but DEFENSIVELY: worlds resolution can throw, and a
 * throw here never throws out of this function. Review 22: it is NAMED in `missed`, and the token-only
 * guard then refuses (create then refuses that token-only agent) instead of reporting a guard with a
 * store's token left out; undo's set passes no `missed` and keeps the roots it found. Every named world that exists now is listed here, and
 * tokenOnlySettingsRules also writes the worlds-folder glob for a world made later.
 */
function tokenOnlyTokenRoots(dataRoot, home, deps = {}, missed = null) {
  const roots = [dataRoot];
  const add = (r) => { if (r && typeof r === 'string' && !roots.includes(r)) roots.push(r); };
  /* Review 22: a lookup that throws is NAMED in `missed` (when the caller passes it), so the token-only guard can
     refuse rather than report guarded with a store left out. The undo set (boardCredentialPaths) passes none. */
  const miss = (what) => { if (Array.isArray(missed)) missed.push(what); };
  try { const lr = deps.legacyRoots !== undefined ? deps.legacyRoots : guideLegacyRoots(home); if (Array.isArray(lr)) lr.forEach(add); } catch { miss('the older Kosmos stores'); }
  let base = null;
  try {
    base = deps.worldsBase !== undefined ? deps.worldsBase : guideWorldsBase();
    if (base && base !== dataRoot) add(base);   // the default world's base, when this agent is in a named world
  } catch { miss('the default world'); }
  // #4491 review: EVERY named world's store too, since the board accepts any world's token. Concrete paths
  // for the worlds that exist now; the
  // board-start refresh rewrites the guard, so a world made later is covered from the agent's next start.
  try {
    if (base) {
      const worlds = deps.worlds || require('./worlds');
      // Review 24: hidden worlds too (hiding is not revoking: the board keeps their tokens valid), and a miss names the id.
      const all = typeof worlds.readRegistry === 'function' ? worlds.readRegistry(base).worlds : worlds.listWorlds(base);
      for (const w of all) { try { add(worlds.worldStoreRoot(base, w)); } catch { miss('world ' + ((w && w.id) || '?')); } }
    }
  } catch { miss('the list of worlds'); }
  return roots;
}

/* #4491 (post-rebase review): what the token-only guard protects, plus the sender tokens, for a board-side copier or
   restorer (engine/undo.js) that must refuse it. files: board.token in every root and its temp copies there, the
   token-only list, the worlds registry and its temp and lock names that exist now, the account config homes'
   settings files. dirs: the sender tokens folder in every root (not read-denied by the guard, but another agent's
   token is never undo material), and each TOKEN-ONLY agent's own .claude folder (the guard write-denies that whole
   folder for those agents only; an ordinary agent's .claude stays ordinary). home, regDir and regBase let a caller
   also catch a temp, lock or account-home settings file made later, by name and place, as the guard's globs do.
   Throws when the token-only list exists but cannot be read: the caller must then say it could not check. */
function boardCredentialPaths(deps = {}) {
  const home = deps.home || kosmosHome();
  const dataRoot = deps.dataRoot || store.ROOT;
  const tokenFile = require('./boardauth').TOKEN_FILE;
  const sendertoken = require('./sendertoken');
  const roots = tokenOnlyTokenRoots(dataRoot, home, deps);
  const listFile = sendertoken.tokenOnlyFile();
  const files = [...roots.map((r) => path.join(r, tokenFile)), listFile, ...roots.map((r) => path.join(r, 'undo.json'))];   // undo's switch (review 19)
  const dotNamed = (dir, prefix) => { try { return fs.readdirSync(dir).filter((n) => n.startsWith(prefix)).map((n) => path.join(dir, n)); } catch { return []; } };
  for (const r of roots) files.push(...dotNamed(r, '.' + tokenFile + '.'));
  let regDir = null;
  let regBase = null;
  try {
    const base = deps.worldsBase !== undefined ? deps.worldsBase : guideWorldsBase();
    if (base) {
      const reg = (deps.worlds || require('./worlds')).registryPath(base);
      regDir = path.dirname(reg);
      regBase = path.basename(reg);
      files.push(reg, ...dotNamed(regDir, '.' + regBase + '.'));
    }
  } catch { /* the files above */ }
  for (const h of accountConfigHomes(home)) files.push(path.join(h, 'settings.json'), path.join(h, 'settings.local.json'));
  const dirs = [sendertoken.DIR, ...roots.map((r) => path.join(r, 'sendertokens'))];
  // The undo stores (the guard read- and write-denies them): a record must never move or replace undo's own files. By
  // place only: they hold no credential to match by identity, and undo-saved grows with every undo (review 8).
  const placeOnly = roots.flatMap((r) => [path.join(r, 'undo'), path.join(r, 'undo-saved')]);
  let raw = null;
  try { raw = fs.readFileSync(listFile, 'utf8'); } catch (err) { if (!err || err.code !== 'ENOENT') throw new Error('the token-only list could not be read'); }
  if (raw !== null) {
    const j = JSON.parse(raw);
    if (!j || !Array.isArray(j.agents)) throw new Error('the token-only list is not readable');
    const create = require('./create');
    for (const name of j.agents) { if (typeof name === 'string' && name) { try { dirs.push(path.join(create.workerDir(name), '.claude')); } catch { /* no folder */ } } }
  }
  return { files: [...new Set(files)], dirs: [...new Set(dirs)], placeOnly: [...new Set(placeOnly)], home, regDir, regBase };
}

/* #4491: ~/.claude plus every EXISTING ~/.claude-<label> (a CLAUDE_CONFIG_DIR account home). Enumerated
   the way guideDenyRulesFor enumerates store entries, so an agent's real account home gets concrete
   denies rather than only the glob. A readdir failure degrades to ~/.claude plus the glob. */
function accountConfigHomes(home) {
  const out = [path.join(home, '.claude')];
  try {
    for (const d of fs.readdirSync(home, { withFileTypes: true })) {
      if (/^\.claude-/.test(d.name) && (d.isDirectory() || d.isSymbolicLink())) out.push(path.join(home, d.name));
    }
  } catch { /* home unreadable: the permission-layer glob below still covers it */ }
  return out;
}

/* #4491 reviews 14 and 15: true when a rule's PATH has a character the rule syntax reads as a pattern (the guide's #4752
   RULE_SYNTAX). The separator is made '/' first, as the guide does, so a Windows path's backslashes are not read as
   pattern characters (review 15: without that every Windows rule was dropped); the globs this file adds itself are
   taken out before testing. */
function ruleHasPatternChar(rule, sep = path.sep) {
  const ownGlobs = String(rule).replace(/\/\*\*\)$/, ')').replace(/\.\*\)$/, ')').replace(/\/\*\//g, '/').replace(/\.claude-\*/g, '.claude-x');
  const inner = ownGlobs.replace(/^\w+\(/, '').replace(/\)$/, '').split(sep).join('/');
  return RULE_SYNTAX.test(inner.replace(/\*\*$/, '').replace(/\/\*$/, ''));
}

/* #5516: the guard denies the agent's file tools (Edit) and shell (denyWrite) any write to what the agent's next start
   runs or reads as instructions. Review 16 settled HOW WIDELY: a folder whose contents run by name is denied whole (the
   PATH folders, and the folders of what the supervisor starts by absolute path: this install's engine and bin, the
   installed supervisor's folder, node's, claude's and tmux's folders, the browser tool's tree); the launchd jobs
   folder and the launch-secrets folder likewise. A program's own FILE, where its link chain ends, is denied by name
   (not its folder, which can be a project or a package tree), and so are the --settings file and tmux's config files;
   each LINK TO A FILE on the way is named to the file tools. Sources: the pane PATH the supervisor passes
   (KOSMOS_GUARD_PANE_PATH), this process's own PATH, the plist's fixed folders, and KOSMOS_GUARD_RUN_DIRS and
   KOSMOS_GUARD_CONFIG_DIRS from the supervisor.
   Every path is followed one name at a time (review 9), so a link anywhere along it is seen; a link to a FOLDER on
   the way gets no rule (scanLaunch says why).
   NOT covered (the plan records why): code a covered program loads from beside it, interpreters and callees named
   inside scripts, what shell startup adds to PATH, a link held in an ancestor of the agent folder (such as /var in /),
   replacing an ancestor of a covered folder, and, as a later part of #5516: programs named in Claude's own config
   files (MCP servers, hooks, plugins, the status line), the code in shell startup files, and what a file the start
   reads can pull in or run in turn (tmux includes, run-shell and plugins; config other started programs read, such as
   git's). Program files are named to the file tools only (review 23: the sandbox profile has a size limit). Both layers match by
   PATH, so a hard link to a user-owned program made under another name is not covered either (as #4491 says of the
   token), nor is a soft link the agent makes itself in its own folder or in temp and then uses with the file tools
   (the file-tool layer rests on Claude Code resolving links before it matches; the sandbox layer matches resolved
   paths); and a rule is written in the disk's own letter case. A program repointed by an update between starts is
   covered at the next start, except claude's, tmux's and node's own folders, which are denied whole.
   Returned in `unsafe` (the guard then says it is not whole): an empty or relative pane entry; a folder that is the
   agent's own, inside it or above it; a program or link folder that resolves there; a folder that could not be listed;
   a folder past the scan cap; a link chain too long or unreadable; a launch input whose place could not be worked
   out; a folder whose contents run that is or holds a shared one; a link to a folder held in a temp folder (where the
   agent's shell can write); and, later, a rule the permission syntax cannot carry. */
const LAUNCH_PATH_FIXED = ['/opt/homebrew/bin', '/usr/local/bin'];
// Review 5: the folder the installed supervisor runs from (create.supervisorPath(), what launchd and the pane start), which
// also holds the engine pointer and the bridges. Not this source tree's bin, which nothing runs in an install.
function installedSupervisorDir() { try { return path.dirname(create.supervisorPath()); } catch { return null; } }
// Review 7: every claude pane starts with --mcp-config naming the browser tool's tree (its script, config and browser).
function browserToolDir() { try { return require('./agentbrowser').homeDir(); } catch { return null; } }
function permissionSettingsFile() { try { return require('./agentpermission').settingsPath(); } catch { return null; } }
const LINK_SCAN_MAX = 4000;
const LINK_HOPS_MAX = 40;
// Review 8: the folders of the claude and tmux programs the supervisor starts by absolute path (from the plist), which
// it passes here, so they are covered whether or not they are on the PATH.
function supervisorRunDirs() {
  const v = process.env.KOSMOS_GUARD_RUN_DIRS;
  // Only absolute folders: a bare program name's dirname is "." (review 13).
  return typeof v === 'string' && v ? v.split(path.delimiter) : [];
}
// Review 19: the programs themselves the supervisor starts by absolute path (claude, tmux, node).
function supervisorRunProgs() {
  const v = process.env.KOSMOS_GUARD_RUN_PROGS;
  return typeof v === 'string' && v ? v.split(path.delimiter) : [];
}
// Review 13: folders the supervisor reads instructions from at the next start (the launch-secrets folder).
function supervisorConfigDirs() {
  const v = process.env.KOSMOS_GUARD_CONFIG_DIRS;
  return typeof v === 'string' && v ? v.split(path.delimiter) : [];
}
function launchPathDirs(agentDir, deps = {}) {
  /* Review 12: not on Windows yet. A standard Windows PATH has folders whose names the rules read as patterns and a
     system folder past the scan cap, so the guard would never be whole there and every token-only agent would be
     refused. Windows coverage is measured and built in the Windows lane (#5516 later part); until then the Windows
     guard is what it was. */
  if ((deps.platform || process.platform) === 'win32') return { dirs: [], aliases: [], files: [], linkNames: [], unsafe: [] };
  const pane = deps.panePath !== undefined ? deps.panePath : process.env.KOSMOS_GUARD_PANE_PATH;
  const ownPath = deps.ownPath !== undefined ? deps.ownPath : process.env.PATH;
  const max = deps.linkScanMax || LINK_SCAN_MAX;
  const own = realOrLeaf(agentDir);
  const fixed = Array.isArray(deps.launchFixed) ? deps.launchFixed : LAUNCH_PATH_FIXED;
  // Review 9: a launch input whose place could not be worked out is said (the guard is then not whole), never dropped.
  const missed = [];
  const look = Object.assign({ installedSupervisorDir, browserToolDir, permissionSettingsFile }, deps.launchLookups);   // a test seam
  /* The supervisor's lists: a bare program name's "." (or an empty piece) is skipped; any other piece that is not a full
     path (a folder name with a ":" split in two, review 19) is said, so the guard is not whole rather than wrong. */
  const fromSupervisor = (list, what) => list.filter((d) => {
    if (path.isAbsolute(d)) return true;
    if (d !== '.' && d !== '') missed.push(`(${what}: "${d}" is not a full path)`);
    return false;
  });
  const need = (what, v) => { if (!v) missed.push(`(${what}: its place could not be worked out)`); return v; };
  const ownProgs = deps.ownProgramDirs || [__dirname, path.join(__dirname, '..', 'bin'), need('the installed supervisor', look.installedSupervisorDir()), path.dirname(process.execPath), need('the browser tool', look.browserToolDir()), ...fromSupervisor(supervisorRunDirs(), 'a folder the supervisor starts from')].filter(Boolean);
  /* Review 11: what the next start reads as instructions, beside what it runs: tmux's config (read when the supervisor
     starts a new tmux server) and the launchd jobs folder (each agent's job names the supervisor, claude and tmux). */
  const home = deps.home || kosmosHome();
  // Both tmux spellings: the board's XDG_CONFIG_HOME need not be the one the tmux server sees (review 12).
  const tmuxConf = [...new Set([path.join(home, '.tmux.conf'), path.join(home, '.config', 'tmux', 'tmux.conf'), ...(process.env.XDG_CONFIG_HOME ? [path.join(process.env.XDG_CONFIG_HOME, 'tmux', 'tmux.conf')] : [])])];
  const fileList = deps.launchFiles || [need('the permission settings file', look.permissionSettingsFile()), ...tmuxConf].filter(Boolean);
  const configDirs = deps.launchConfigDirs || [...((deps.platform || process.platform) === 'darwin' ? [path.join(home, 'Library', 'LaunchAgents')] : []), ...fromSupervisor(supervisorConfigDirs(), 'a folder the supervisor reads')];
  /* Review 13: folders too widely used to deny whole (the temp roots, the home folder and its everyday folders, the
     Kosmos data root). A program or link that leads straight into one makes the guard NOT whole, said, instead of
     silently denying the agent its temp folder or Downloads. Only these exact folders, not what is inside them. */
  // The temp roots are also where the agent's sandboxed shell can write, which matters for a link on the way (review 16).
  const temps = deps.launchTemps || [require('os').tmpdir(), '/tmp', '/private/tmp', '/var/tmp', '/private/var/tmp'];
  const shared = deps.launchShared || [...temps, home,
    ...['Desktop', 'Documents', 'Downloads'].map((d) => path.join(home, d)), deps.dataRoot || store.ROOT];
  const plat = deps.platform || process.platform;
  /* Review 2 and 8: refreshTokenOnlyGuards passes one Map for its whole pass. The SCAN (which folders, and the program
     each name resolves into) is the same for every agent, so it is cached without the agent folder and done once per
     pass; only the agent-folder check below runs per agent. */
  const cache = deps.launchCache instanceof Map ? deps.launchCache : null;
  const runProgs = deps.launchRunProgs || fromSupervisor(supervisorRunProgs(), 'a program the supervisor starts');
  const key = JSON.stringify([pane, ownPath, max, fixed, ownProgs, fileList, configDirs, shared, temps, runProgs]);
  let scan = cache ? cache.get(key) : undefined;
  if (!scan) { scan = scanLaunch({ pane, ownPath, max, fixed, ownProgs, fileList, configDirs, shared, temps, runProgs }); if (cache) cache.set(key, scan); }
  // A folder that is the agent's own, inside it, or ABOVE it (review 2: denying an ancestor would deny the agent's own
  // folder) cannot be covered. Review 7: compared without case on macOS and Windows, whose disks usually ignore it (a
  // not-yet entry keeps the case it was typed in); that only ever reports more as uncoverable.
  const fold = plat === 'darwin' || plat === 'win32' ? (x) => x.toLowerCase() : (x) => x;
  const ownF = fold(own);
  const rel = (r, o) => r === o || r.startsWith(o + path.sep) || o.startsWith(r === path.sep ? r : r + path.sep);
  const uncoverable = (real) => rel(fold(real), ownF);
  // A written spelling is compared with the agent folder as written too (/var against /private/var, review 11).
  const ownW = fold(path.resolve(agentDir));
  const aliasBad = (w) => rel(fold(w), ownF) || rel(fold(w), ownW);
  const inOwn = (r) => r === ownF || r.startsWith(ownF + path.sep);
  const dirs = [];
  const aliases = [];
  const linkNames = [];
  const patAliases = [];
  const unsafe = [...missed, ...scan.unsafe];
  for (const c of scan.cands) {
    if (c.kind === 'middle') {
      /* A link to a folder on the way: no rule (scanLaunch says why). Held inside the agent folder the agent can repoint
         it (review 9): not whole. Held in a temp folder, the sandboxed shell can: said. Held anywhere else, neither the
         file tools nor the shell can replace it. */
      const r = fold(c.real);
      if (inOwn(r)) unsafe.push(`${c.shown} (a link on its way is held in the agent's own folder)`);
      else if (c.inTemp && !rel(r, ownF)) unsafe.push(`${c.shown} (a link on its way is held in ${c.real}, a temp folder the agent's shell can write)`);
      continue;
    }
    if (c.kind === 'link') {
      // A link to a file, by its own name, to the file tools. In the agent folder it is the agent's: not whole. In a
      // temp folder the agent's shell could replace it (review 17): said, and still named.
      if (inOwn(fold(c.link))) { unsafe.push(c.shown); continue; }
      if (c.inTemp && !rel(fold(path.dirname(c.link)), ownF)) unsafe.push(`${c.shown} (a link on its way, ${c.link}, is in a temp folder the agent's shell can write)`);
      if (!linkNames.includes(c.link)) linkNames.push(c.link);
      continue;
    }
    if (c.kind === 'alias') {
      // A second spelling of a file or file link, to the file tools; never one in or above the agent folder.
      if (aliasBad(c.link)) continue;
      // Review 21: a name the rules cannot carry: its folder, by this spelling, as the file itself falls back to.
      const ad = path.dirname(c.link);
      // Decided after the files below: only when the real file's folder was denied whole (never a shared one).
      if (RULE_SYNTAX.test(path.basename(c.link))) { if (!RULE_SYNTAX.test(ad) && !aliasBad(ad)) patAliases.push(ad); continue; }
      if (!linkNames.includes(c.link)) linkNames.push(c.link);
      continue;
    }
    if (uncoverable(c.real)) { unsafe.push(c.shown); continue; }
    if (!dirs.includes(c.real)) dirs.push(c.real);
    // Review 11: an alias is checked like the folder (dropping one is safe: the real path is covered).
    if (c.written && c.written !== c.real && !aliasBad(c.written) && !aliases.includes(c.written)) aliases.push(c.written);
  }
  const files = [];
  for (const f of scan.files) {
    const r = fold(f.real);
    if (r === ownF || r.startsWith(ownF + path.sep)) { unsafe.push(f.shown); continue; }   // a file in the agent's own folder
    /* Review 21: a file whose own NAME has a character the rules read as a pattern (Homebrew's coreutils ships "g[")
       cannot be named in a file-tool rule. Its folder is denied whole instead, when that folder can be named and is not
       shared, above or the agent's own; otherwise the file stays (the shell layer keeps it; the file-tool rule is
       dropped and said). */
    const d = path.dirname(f.real);
    if (RULE_SYNTAX.test(path.basename(f.real)) && !RULE_SYNTAX.test(d) && !f.folderShared && !uncoverable(d)) {
      if (!dirs.includes(d)) dirs.push(d);
      continue;
    }
    /* Review 23 (MEASURED): a program's own file goes to the file tools only. The sandbox refuses a profile past 64 KB of
       data (5,000 file paths failed every command; 500 added about 40 ms to each), deny lists only grow with upgrades,
       and the sandboxed shell cannot write outside the agent folder and the temp folders anyway. A program file in a
       temp folder is therefore said. The files the start reads (few, fixed) keep both layers. */
    if (f.prog) {
      if (f.inTemp && !rel(fold(d), ownF)) unsafe.push(`${f.shown} (it ends in ${f.real}, in a temp folder the agent's shell can write)`);
      if (!linkNames.includes(f.real)) linkNames.push(f.real);
      continue;
    }
    if (!files.includes(f.real)) files.push(f.real);
  }
  for (const ad of patAliases) if (dirs.includes(realOrLeaf(ad)) && ad !== realOrLeaf(ad) && !aliases.includes(ad)) aliases.push(ad);
  // Review 10: one uncoverable folder can name every program in it; the reason is kept readable.
  const said = [...new Set(unsafe)];
  const UNSAFE_SHOWN = 40;
  if (said.length > UNSAFE_SHOWN) said.splice(UNSAFE_SHOWN, said.length - UNSAFE_SHOWN, `(and ${said.length - UNSAFE_SHOWN} more)`);
  return { dirs, aliases, files, linkNames, unsafe: said, paneKnown: typeof pane === 'string' && pane.split(path.delimiter).some((d) => path.isAbsolute(d)) };   // review 8: an empty PATH is not a launch's inputs
}
/* The agent-independent half of launchPathDirs: every candidate folder in order, as { real, shown, written }, and what
   cannot be covered whatever the agent (an empty or relative pane entry, an unlistable folder, the scan cap). */
function scanLaunch({ pane, ownPath, max, fixed, ownProgs, fileList, configDirs, shared, temps, runProgs = [] }) {
  const cands = [];
  const files = [];
  const unsafe = [];
  /* Review 9: a path is resolved one name at a time, so a link ANYWHERE along it (not only at its end) is seen: the
     folder holding that link decides where the path leads, so it is covered too (or, if it is the agent's own, the
     guard says it cannot cover it). `holders` keeps, for each path, the folders holding the links passed through.
     Review 8: memoized per path, so a folder scanned once is not walked again for each program in it. */
  const walked = new Map();
  const lst = new Map();
  const lstatOf = (q) => { if (!lst.has(q)) { let st = null; try { st = fs.lstatSync(q); } catch { /* not there */ } lst.set(q, st); } return lst.get(q); };
  /* Review 10: names are taken as written, never folded first. The system follows a link and THEN applies a later
     "..", to the link's target, so ".." here steps up from the folder already reached, and a link target is joined
     as text (path.resolve would fold "lnk/.." away before the link was followed). */
  const under = (base, t) => (path.isAbsolute(t) ? t : (base.endsWith(path.sep) ? base + t : base + path.sep + t));
  const walk = (q, depth) => {
    const abs = path.isAbsolute(q) ? q : path.resolve(q);
    if (walked.has(abs)) return walked.get(abs);
    let cur = path.parse(abs).root;
    const holders = [];
    let bad = null;
    for (const part of abs.slice(cur.length).split(path.sep).filter(Boolean)) {
      if (part === '.') continue;
      if (part === '..') { cur = path.dirname(cur); continue; }
      const nxt = path.join(cur, part);
      const st = lstatOf(nxt);
      if (st && st.isSymbolicLink()) {
        if (depth >= LINK_HOPS_MAX) { bad = 'a link chain too long to follow'; cur = nxt; continue; }
        // Review 15: each link on the way, by its own name as well as the folder holding it.
        { const d = realOrLeaf(cur); holders.push({ dir: d, link: path.join(d, part) }); }
        let t;
        try { t = fs.readlinkSync(nxt); } catch { bad = 'a link that could not be read'; cur = nxt; continue; }
        const w = walk(under(cur, t), depth + 1);
        holders.push(...w.holders);
        if (w.bad) bad = w.bad;
        cur = w.real;
      } else cur = nxt;
    }
    // Review 11: the disk's own spelling (letter case) once links are followed, as the sandbox matches it.
    const out = { real: realOrLeaf(cur), holders, bad };
    walked.set(abs, out);
    return out;
  };
  /* Review 16: WHAT is denied, and how widely.
     - A FOLDER whose contents run by name (a PATH folder, the folder of a program the supervisor starts by path, the
       launchd jobs folder): denied whole, in both layers.
     - A program's own FILE, where its link chain ends (or the exact name a dangling link points at): denied by name, in
       both layers. Not its folder: that can be a project the agent works in, or a package tree.
     - A LINK TO A FILE on that chain: denied by its own name, to the file tools only. Writing through the link writes
       the file it leads to, and how a rule on the link's own path is matched by the sandbox is not measured.
     - A LINK TO A FOLDER on the way (a "middle" link): no rule. A rule naming it would cover the whole folder it leads
       to (the rules read paths as gitignore does), the file tools cannot replace a link, and the sandboxed shell
       writes only in the agent folder and the temp folders. So a middle link held INSIDE the agent folder makes the
       guard not whole (review 9), and one held in a temp folder is said; elsewhere nothing is needed. */
  const middle = (w, shown) => { for (const h of w.holders) cands.push({ kind: 'middle', real: h.dir, link: h.link, shown }); };
  const push = (q, shown, written, noScan) => {
    const w = walk(q, 0);
    if (w.bad) unsafe.push(`${shown} (${w.bad})`);
    cands.push({ kind: 'dir', real: w.real, shown, written, noScan });
    middle(w, shown);
    return w.real;
  };
  const realDir = (d) => walk(d, 0).real;
  // The folder a name sits in, as the system reaches it, with its middle links checked.
  const folderOf = (q, shown) => {
    const w = walk(path.dirname(q), 0);
    if (w.bad) unsafe.push(`${shown} (${w.bad})`);
    middle(w, shown);
    return w.real;
  };
  /* Follow one name to where its chain ends: each file link by its own name, the final file by its name. `inCovered`:
     the name sits in a folder already denied whole, so it needs no rule of its own. */
  /* Review 17: a file or file link reached THROUGH a folder link has a second spelling (the one written through the
     link). It is named too, to the file tools only, as folders are (review 5), so the spellings that already exist do
     not depend on how Claude Code matches a linked path. A NEW spelling the agent makes itself (a soft link in its own
     folder or in temp) still does: the #4491 residual this card carries, recorded in the plan. Only a spelling with no
     . or .. names (path.resolve would fold them by text). */
  const alias = (p, real, shown) => {
    if (p === real || p.split(path.sep).some((x) => x === '.' || x === '..')) return;
    cands.push({ kind: 'alias', link: p, shown });
  };
  const follow = (p0, shown, inCovered, prog) => {
    let p = p0;
    for (let hop = 0; ; hop++) {
      const covered = hop === 0 && inCovered;
      let st;
      try { st = fs.lstatSync(p); } catch {   // dangling (review 13): what is later made at that exact name runs
        const at = folderOf(p, shown);
        if (!wholeDirs.has(at)) { files.push({ real: path.join(at, path.basename(p)), shown, prog }); alias(p, path.join(at, path.basename(p)), shown); }
        return;
      }
      if (st.isDirectory()) return;   // a folder, not a program (its own name is not run)
      const at = covered ? null : folderOf(p, shown);
      const named = at !== null && !wholeDirs.has(at);
      if (!st.isSymbolicLink()) { if (named) { files.push({ real: path.join(at, path.basename(p)), shown, prog }); alias(p, path.join(at, path.basename(p)), shown); } return; }
      /* Review 19: a link that leads to a FOLDER is never named, wherever it sits on the chain: a rule on its name would
         cover everything under it (a link to /tmp would deny the whole temp folder). It is a middle link: no rule, and
         said only where the agent can replace it. */
      let toFolder = false;
      try { toFolder = fs.statSync(p).isDirectory(); } catch { /* dangling or unreadable: followed below */ }
      if (toFolder) { if (at !== null) cands.push({ kind: 'middle', real: at, link: path.join(at, path.basename(p)), shown }); return; }
      if (named) { cands.push({ kind: 'link', link: path.join(at, path.basename(p)), shown }); alias(p, path.join(at, path.basename(p)), shown); }
      if (hop >= LINK_HOPS_MAX) { unsafe.push(`${shown} (a link chain too long to follow)`); return; }
      let t;
      try { t = fs.readlinkSync(p); } catch { unsafe.push(`${shown} (a link that could not be read)`); return; }
      p = under(realDir(path.dirname(p)), t);   // as text: a ".." in it applies after the link (review 10)
    }
  };
  // Review 5: each covered folder's spelling as written (a link, /var for /private/var), so the file-tool rules can name
  // both and do not depend on how Claude Code matches a linked path. The sandbox layer gets the resolved one.
  const add = (e, strict) => {
    if (!e || !path.isAbsolute(e)) { if (strict) unsafe.push(e === '' ? '(an empty entry)' : e); return; }
    // The written spelling is an alias only when it has no . or .. names (path.resolve would fold them by text).
    push(e, e, e.split(path.sep).some((x) => x === '.' || x === '..') ? undefined : path.resolve(e));
  };
  for (const e of fixed) add(e, true);
  /* Review 3 (W3b): what the supervisor starts by ABSOLUTE path from folders that may be off the pane PATH: the engine
     scripts and the supervisor itself (this install's engine and bin, and the installed supervisor's folder), node (this
     process's own binary), the browser tool's tree, and claude's and tmux's folders (review 8, passed by the
     supervisor). The guard runs from the same install, so most of these are its own folders. */
  for (const e of ownProgs) add(e, true);
  // The pane's PATH is held strictly. This process's own (review 2) skips empty and relative entries quietly; an absolute
  // one that cannot be covered is still reported.
  if (typeof pane === 'string') for (const e of pane.split(path.delimiter)) add(e, true);
  if (typeof ownPath === 'string') for (const e of ownPath.split(path.delimiter)) add(e, false);
  // Review 11: folders whose files the next start READS as instructions (the launchd jobs): covered, never scanned.
  for (const d of configDirs) push(d, d, undefined, true);
  // Each program in a scanned folder, followed to where it ends (review 7, 16). A name in a folder already denied whole
  // needs no rule of its own.
  const wholeDirs = new Set(cands.filter((c) => c.kind === 'dir').map((c) => c.real));
  const scanned = new Set();
  for (const { kind, real: d, noScan } of [...cands]) {
    if (kind !== 'dir' || noScan || scanned.has(d)) continue;
    scanned.add(d);
    let names = [];
    try { names = fs.readdirSync(d); } catch (e) {
      // Review 7: a folder that is missing has nothing to run; one that cannot be listed still runs its programs by name.
      // (A file named on PATH, ENOTDIR, runs nothing either.)
      if (!(e && (e.code === 'ENOENT' || e.code === 'ENOTDIR'))) unsafe.push(`${d} (could not be listed: ${(e && e.code) || e})`);
      continue;
    }
    if (names.length > max) { unsafe.push(`${d} (more than ${max} entries; the rest were not checked, and which ones is not known)`); names = names.slice(0, max); }
    for (const n of names) follow(path.join(d, n), path.join(d, n), true, true);
  }
  /* Review 19: the programs the supervisor starts by absolute path (claude, tmux, node) end their chains in a store of
     versions that an update repoints into mid-session; that folder is denied whole, so a version written there after
     the guard was written is covered too. A shared folder still is not (the filter below says so). */
  // (A link here that cannot be read, or a chain too long, ends this quietly: the same program is also scanned through
  // its folder in KOSMOS_GUARD_RUN_DIRS, where follow() says so.)
  for (const prog of runProgs) {
    let q = prog;
    for (let hop = 0; hop <= LINK_HOPS_MAX; hop++) {
      let st;
      try { st = fs.lstatSync(q); } catch { break; }
      if (!st.isSymbolicLink()) { if (st.isFile()) push(path.dirname(q), prog); break; }
      let t;
      try { t = fs.readlinkSync(q); } catch { break; }
      q = under(realDir(path.dirname(q)), t);
    }
  }
  // Review 12: a file the next start reads, followed the same way (a dotfile kept in another tree).
  for (const f of fileList) follow(f, f, false, false);
  /* Review 13 and 14: a shared folder (or one that holds one) is never denied whole; a folder whose contents run that
     leads into one is said. Each shared folder in every spelling: as given, resolved, and with only its parent
     resolved (a shared folder that is itself a link, as /tmp is, is reached by name through its resolved parent). */
  const sharedList = [...new Set((shared || []).filter(Boolean).flatMap((d) => [path.resolve(d), realOrLeaf(d), path.join(realOrLeaf(path.dirname(path.resolve(d))), path.basename(d))]))];
  const holds = (r) => sharedList.some((d) => d === r || d.startsWith(r === path.sep ? r : r + path.sep));
  const tempList = [...new Set((temps || []).filter(Boolean).flatMap((d) => [path.resolve(d), realOrLeaf(d)]))];
  const inTemp = (r) => tempList.some((t) => r === t || r.startsWith(t + path.sep));
  const kept = [];
  for (const c of cands) {
    if (c.kind === 'dir' && holds(c.real)) { unsafe.push(`${c.shown} (it leads into ${c.real}, which is or holds a shared folder that is not denied whole)`); continue; }
    // A middle link held in a temp folder (where the sandboxed shell CAN write): decided per agent.
    // Review 17: a file link held in a temp folder too (the shell could replace it; link names reach the file tools only).
    const tempHeld = (c.kind === 'middle' && inTemp(c.real)) || (c.kind === 'link' && inTemp(path.dirname(c.link)));
    kept.push(tempHeld ? Object.assign({}, c, { inTemp: true }) : c);
  }
  // Review 21: whether a file's folder is or holds a shared one, for the pattern-name fallback above.
  return { cands: kept, unsafe, files: files.map((f) => Object.assign({}, f, RULE_SYNTAX.test(path.basename(f.real)) ? { folderShared: holds(path.dirname(f.real)) } : {}, f.prog ? { inTemp: inTemp(path.dirname(f.real)) } : {})) };
}
/* #5663: the launch-rule record, and the sandbox layer's ceiling. */
const LAUNCH_RECORD_FILE = 'kosmos-launch-rules.json';
/* MEASURED (claude -p with a sandbox on, 2026-10-09): Claude Code puts the Edit and Read deny rules into the sandbox profile
   too, not only sandbox.filesystem (a shell write to an Edit-denied file was refused), and two limits then stop EVERY
   sandboxed command:
   - sandbox-exec refuses a profile past 65,535 bytes of compiled data. The compiled size follows the paths' distinct
     prefixes (paths sharing a long prefix cost little), not their raw bytes: every set that ran had at most 34,216
     distinct prefix characters (4,312 paths built from this machine's PATH had 33,636), every set that failed had at
     least 51,816 (which compiled to 65,766 bytes).
   - the profile is passed on a command line: 248,670 raw path bytes failed with E2BIG, 223,734 ran.
   The ceilings below sit under both with a margin; past either, the guard may still run, but Kosmos can no longer say
   it will. */
// FITTED to the measured sets above with a margin, not derived from how the profile is compiled (review 8).
const SANDBOX_DENY_PREFIX_MAX = 40 * 1024;
const SANDBOX_DENY_RAW_MAX = 160 * 1024;
// A rule's path, for the rule shapes this guard writes (a path with a pattern character is never written, #4491 review 14).
// Review 13: the wrapper is stripped here and the path read back by rulePath, the one inverse of ruleAbs.
// With a home, the person's '~/' spelling is read too (the size count); the guard itself writes only '//'.
function ruleTarget(r, platform = process.platform, home = null) {
  const m = /^(?:Edit|Read)\((\/\/|~\/)(.*?)(?:\/\*\*)?\)$/.exec(String(r));
  if (!m) return null;
  if (m[1] === '//') return rulePath(m[2], platform);
  return home ? path.join(home, m[2]) : null;
}
/* The paths THIS AGENT'S settings file sends to the profile, counted per clause as the profile is likely built (review 5).
   Review 11: the person's user-level settings files (~/.claude, ~/.claude-<label>) also reach it and are not counted
   here (which one an agent reads is its account's; the open card for it is #5668). Rule targets are the guard's '//abs' spelling
   and the person's '~/' one (against home); a person's other spellings (a relative or a match-anywhere pattern) are not counted, so the count
   can be low for them (review 15). The read clause (denyRead
   and the Read rule targets) and the write clause (denyWrite and the Edit rule targets), each path once within its
   clause, so a path in both is paid for twice. Per clause: their raw length, and their distinct prefixes (sorted, each
   path adds what it does not share with the one before it). Every measured set was one clause, so this counting is at
   least what was measured, never less. */
function sandboxDenySize(fsb, deny, home, platform = process.platform) {
  const rules = (deny || []).map(String);
  const at = home || kosmosHome();
  const targets = (kind) => rules.filter((r) => r.startsWith(kind + '(')).map((r) => ruleTarget(r, platform, at)).filter(Boolean);
  const clauses = [
    [...((fsb && fsb.denyRead) || []), ...targets('Read')],
    [...((fsb && fsb.denyWrite) || []), ...targets('Edit')],
  ];
  let count = 0;
  let raw = 0;
  let prefixes = 0;
  for (const clause of clauses) {
    const paths = [...new Set(clause.map(String))].sort();
    let prev = '';
    for (const x of paths) {
      let i = 0;
      while (i < x.length && i < prev.length && x[i] === prev[i]) i++;
      raw += x.length;
      prefixes += x.length - i;
      prev = x;
    }
    count += paths.length;
  }
  return { paths: count, raw, prefixes };
}
/* #5663 review 1: a refresh does not always have the launch inputs (the board's own start has no pane PATH), so "not a
   launch rule now" alone would let one caller prune what another wrote. A recorded entry is pruned only by a refresh
   that has them (an agent's launch), and only when it is not current AND its path no longer exists (an upgraded tool's
   removed version folder, or a removed version file in a folder that stays); a path that cannot be read is kept.
   Review 2: a folder only gone for now (an unmounted volume) is on the launching PATH if the agent runs from it, so it
   is current and kept. "Gone" is lstat ENOENT: a dangling link still exists, so its rule is kept (the safe direction). */
/* Review 13: one answer to "is this path there", for both recording (only 'present' is recorded) and pruning (only
   'gone' is pruned). Any other lstat error (EACCES on a parent, ELOOP) is 'unknown': neither recorded nor pruned. */
function launchPathState(p) {
  if (typeof p !== 'string' || !path.isAbsolute(p)) return 'unknown';
  try { fs.lstatSync(p); return 'present'; } catch (e) { return e && e.code === 'ENOENT' ? 'gone' : 'unknown'; }
}
function launchPathGone(p) { return launchPathState(p) === 'gone'; }
function launchPathPresent(p) { return launchPathState(p) === 'present'; }
function readLaunchRecord(file) {
  const none = { deny: [], denyWrite: [] };
  let buf;
  try { buf = fs.readFileSync(file); } catch (e) {
    if (e && e.code === 'ENOENT') return none;   // none yet (a guard from before #5663)
    /* Review 11: a record that exists and cannot be read is not replaced (that would forget it): nothing is pruned and
       it is not written this time, and the log says so. */
    process.stderr.write(`#5663: ${file} could not be read (${(e && e.code) || e}); nothing is pruned and it is left as it is\n`);
    return { ...none, keep: true };
  }
  let j;
  try { j = JSON.parse(buf.toString('utf8')); } catch { j = undefined; }
  if (!j || typeof j !== 'object' || Array.isArray(j)) {
    /* Review 10: a record that does not parse is read as none, which prunes nothing, and the next write replaces it;
       a dated copy is kept first (as the settings file does, #4491 review 18) so what it named is not lost unseen. */
    // Review 11: one copy per content, so a record that also cannot be written is not copied again at every refresh.
    let keep = null;
    try { keep = fs.readdirSync(path.dirname(file)).filter((f) => f.startsWith(path.basename(file) + '.unreadable-')).map((f) => path.join(path.dirname(file), f)).find((f) => { try { return fs.statSync(f).size === buf.length && fs.readFileSync(f).equals(buf); } catch { return false; } }) || null; } catch { keep = null; }
    if (!keep) {
      const at = `${file}.unreadable-${Date.now()}`;
      try { fs.writeFileSync(at, buf, { mode: 0o600 }); keep = at; } catch (e) {   // the bytes as they were (review 19)
        // Review 17: no copy, so the record is left as it is (as an unreadable one is), and the log says no copy.
        process.stderr.write(`#5663: ${file} could not be read, and no copy could be kept (${(e && e.code) || e}); nothing is pruned and it is left as it is\n`);
        return { ...none, keep: true };
      }
    }
    process.stderr.write(`#5663: ${file} could not be read; kept a copy at ${keep}; nothing is pruned this time\n`);
    return none;
  }
  const strings = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
  return { deny: strings(j.deny), denyWrite: strings(j.denyWrite) };
}
function writeLaunchRecord(file, rec) {
  try {
    const text = JSON.stringify(rec, null, 2) + '\n';
    let old = null;
    try { old = fs.readFileSync(file, 'utf8'); } catch { /* none yet */ }
    if (old === text) return true;
    const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.new`;   // review 6: two refreshes in one process
    fs.writeFileSync(tmp, text, { mode: 0o600 });
    try { fs.renameSync(tmp, file); } catch (e) { try { fs.unlinkSync(tmp); } catch { /* gone */ } throw e; }
    return true;
  } catch { return false; }
}

/*
 * #4491: the deny rules and sandbox filesystem paths for a TOKEN-ONLY agent (one listed in
 * sendertoken.tokenOnlyFile). Unlike the guide, a token-only agent is a normal working agent, so its
 * own data folder is NOT denied -- only:
 *  - board.token (Read), and its temp copy, in EVERY root tokenOnlyTokenRoots returns, so the shell
 *    cannot read the board token slice 9 (#4864) already stops it SENDING; this stops it READING;
 *  - the settings.json / settings.local.json it could plant to turn its own guard off (Edit): in its
 *    own folder, and in the per-account config homes the adversarial pass found -- ~/.claude AND the
 *    ~/.claude-* variants (CLAUDE_CONFIG_DIR, e.g. ~/.claude-account-f), which user settings can relax
 *    the sandbox from where the agent-folder's cannot. Every ~/.claude-* account home that EXISTS is
 *    enumerated and gets CONCRETE settings-file denies in BOTH layers (so a non-default-account agent's
 *    real config home is covered by a measured file-write deny, not only the glob). A trailing
 *    ~/.claude-* glob stays in the permission layer for a home created later. What is NOT measured is
 *    whether Seatbelt translates a permission Edit-GLOB to a subprocess write (the guide's measurement
 *    only proved a Read-glob -> subprocess read); that is why existing homes are made concrete, and the
 *    glob-only future-home case is the reasoned residual the plan records.
 * dataRoot/home are overridable for tests (guideDenyRulesFor does the same); production passes neither.
 */
function tokenOnlySettingsRules(dir, deps = {}) {
  const home = deps.home || kosmosHome();
  const dataRoot = deps.dataRoot || store.ROOT;
  const tokenFile = require('./boardauth').TOKEN_FILE;
  const settingsDir = path.join(dir, '.claude');
  const rootsMissed = [];
  const tokenRoots = tokenOnlyTokenRoots(dataRoot, home, deps, rootsMissed);
  const tokenPaths = tokenRoots.map((r) => path.join(r, tokenFile));
  const tokenTmps = tokenRoots.map((r) => path.join(r, '.' + tokenFile));
  // Concrete config homes get a denyWrite on their settings FILES (not the whole dir: a config home holds
  // Claude Code's own runtime state, so a dir-level denyWrite there would break normal operation).
  const concreteHomes = accountConfigHomes(home);
  const settingsFileDirs = [settingsDir, ...concreteHomes];
  const settingsFiles = settingsFileDirs.flatMap((d) => [path.join(d, 'settings.json'), path.join(d, 'settings.local.json')]);
  // Permission-layer Edit denies: the concrete homes above, plus a ~/.claude-* glob for a home made later.
  const editTargets = [...settingsFiles.map((p) => ({ f: p })), { f: path.join(home, '.claude-*', 'settings.json') }, { f: path.join(home, '.claude-*', 'settings.local.json') }];
  // #4491 review: the token paths, their temp copy and the token-only list are write-denied as well as
  // read-denied (Claude Code's Edit rule covers every file-writing tool), and in the sandbox denyWrite below (the
  // registry's own path there; its temp and lock names by the permission-layer .* glob only).
  const listFile = require('./sendertoken').tokenOnlyFile();
  const guardRecord = guardStateFile(deps);
  // #4491 re-review (independent): the gate's list of worlds comes from the worlds registry, so the
  // registry (and its temp and lock names) is write-denied too, and every world's store gets a glob, so a world
  // added after this was written is covered as well. The `*` mid-path is the guide's rule shape (#4752, measured
  // refused on Claude Code 2.1.285).
  const worldRules = [];
  const worldWrites = [];
  try {
    const base = deps.worldsBase !== undefined ? deps.worldsBase : guideWorldsBase();
    if (base) {
      const worlds = deps.worlds || require('./worlds');
      const reg = worlds.registryPath(base);
      worldRules.push(`Edit(${ruleAbs(reg)})`, `Edit(${ruleAbs(path.join(base, '.' + path.basename(reg)))}.*)`);
      worldWrites.push(reg);
      const worldsDir = path.join(base, worlds.WORLDS_SUBDIR);
      for (const leaf of [store.APP, store.LEGACY_APP]) {
        for (const verb of ['Read', 'Edit']) {
          worldRules.push(`${verb}(${ruleAbs(worldsDir)}/*/${leaf}/${tokenFile})`, `${verb}(${ruleAbs(worldsDir)}/*/${leaf}/.${tokenFile}.*)`);
        }
      }
    }
  } catch { rootsMissed.push('the worlds registry'); }
  // #4491 (post-rebase review): the undo copy store (engine/undo.js, #5153) holds copies of files the board read for an
  // agent, so it is read-denied (a copy there must not be readable by the agent's shell) and write-denied (restore
  // writes its records back out).
  const undoDirs = tokenRoots.flatMap((r) => [path.join(r, 'undo'), path.join(r, 'undo-saved')]);
  // Review 15: other agents' sender tokens (a token-only agent's own comes in its environment, KOSMOS_AGENT_TOKEN, and
  // only the board reads this folder), and undo's on/off switch file, which turning off deletes every kept copy.
  const tokenDirs = tokenRoots.map((r) => path.join(r, 'sendertokens'));
  const undoSwitches = tokenRoots.map((r) => path.join(r, 'undo.json'));
  // Review 11: whatever happens in the scan, the rest of the guard is still written, and the guard says it is not whole.
  let launch;
  try { launch = launchPathDirs(dir, deps); } catch (e) { launch = { dirs: [], aliases: [], files: [], linkNames: [], unsafe: ['(the launch folders could not be worked out: ' + ((e && e.message) || e) + ')'] }; }
  const deny = [
    ...tokenPaths.map((p) => `Read(${ruleAbs(p)})`),
    ...undoDirs.map((d) => `Read(${ruleAbs(d)}/**)`),
    ...undoDirs.map((d) => `Edit(${ruleAbs(d)}/**)`),   // review 2: a forged record there is what restore writes out
    ...tokenDirs.map((d) => `Read(${ruleAbs(d)}/**)`),
    ...tokenDirs.map((d) => `Edit(${ruleAbs(d)}/**)`),
    ...undoSwitches.map((f) => `Edit(${ruleAbs(f)})`),
    ...tokenTmps.map((p) => `Read(${ruleAbs(p)}.*)`),
    ...tokenPaths.map((p) => `Edit(${ruleAbs(p)})`),
    ...tokenTmps.map((p) => `Edit(${ruleAbs(p)}.*)`),
    `Edit(${ruleAbs(listFile)})`,
    `Edit(${ruleAbs(guardRecord)})`,   // #5668 review 1: the record the agent's page reads, so an agent cannot hide its notice
    ...worldRules,
    ...editTargets.map((t) => `Edit(${ruleAbs(t.f)})`),
  ];
  /* #5516 (review 3): the launch folders' file-tool rules are kept OUT of the filter below. A launch folder whose path
     has a rule-pattern character (an installed "App (Beta)") must not stop the WHOLE guard from being written: its rule
     is left out and the folder reported in launchUnsafe (the guard then says it is not whole), while the sandbox layer
     still carries its concrete path (launchDirs, below). */
  const launchRules = [];
  const launchUnsafe = [...launch.unsafe];   // a copy: launchPathDirs caches its answer for the whole refresh pass
  for (const d of [...launch.dirs, ...(launch.aliases || [])]) {
    const r = `Edit(${ruleAbs(d)}/**)`;
    if (ruleHasPatternChar(r)) launchUnsafe.push(`${d} (its path has a character the permission rules cannot carry)`);
    else launchRules.push(r);
  }
  // Review 15: links denied by their own name, to the file tools only (see launchPathDirs).
  for (const l of launch.linkNames || []) {
    const r = `Edit(${ruleAbs(l)})`;
    if (ruleHasPatternChar(r)) launchUnsafe.push(`${l} (its path has a character the permission rules cannot carry)`);
    else launchRules.push(r);
  }
  for (const f of launch.files || []) {
    const r = `Edit(${ruleAbs(f)})`;
    if (ruleHasPatternChar(r)) launchUnsafe.push(`${f} (its path has a character the permission rules cannot carry)`);
    else launchRules.push(r);
  }
  /* #4491 review 14: a path with a character the rule syntax reads as a pattern (the guide's #4752 RULE_SYNTAX) would
     misparse the rule, or make Claude Code reject the whole file. Such a rule is dropped and said on the board log; the
     sandbox layer still carries the concrete path. The globs this function adds itself are taken out before testing. */
  let tokenRuleDropped = false;
  const safeDeny = deny.filter((r) => {
    if (!ruleHasPatternChar(r)) return true;
    process.stderr.write(`#4491: no rule ${r}: its path has a character the rule syntax reads as a pattern\n`);
    tokenRuleDropped = true;   // reviews 16 and 17: ANY dropped rule leaves part of the guard out (a token read, or its own self-protection)
    return false;
  });
  safeDeny.push(...launchRules);
  /* #5663: the record of the launch rules this guard wrote at launches, so a launch can prune the ones whose paths are
     gone (deny lists only grew before: every upgrade added versioned paths for good). It sits in the agent's .claude
     folder, which the sandbox denies WRITES to, and the file tools are denied it here, so the agent cannot rewrite
     what gets pruned (reading it is harmless). */
  const launchRecord = path.join(settingsDir, LAUNCH_RECORD_FILE);
  const recordRule = `Edit(${ruleAbs(launchRecord)})`;
  if (!ruleHasPatternChar(recordRule)) safeDeny.push(recordRule);
  else tokenRuleDropped = true;   // #5663 review 4: its own self-protection, so not whole, as reviews 16 and 17 rule
  return { deny: safeDeny, tokenRuleDropped, rootsMissed, settingsDir, tokenPaths, tokenTmps, settingsFiles, listFile, guardRecord, worldWrites, undoDirs, tokenDirs, undoSwitches, launchDirs: launch.dirs, launchFiles: launch.files || [], launchUnsafe, launchRules, launchRecord, launchKnown: deps.atLaunch === true && !!launch.paneKnown };   // review 14: a launch says so (refreshTokenOnlyGuards({ only })); an inherited env var never makes one
}

/* #5668: the last guard run per agent, so the board can say on the agent's page when a token-only agent's guard is not
   whole or past the sandbox size. Written by every guard run (board start, each launch through the supervisor, a
   separate process, and creation); read by the board, never recomputed per request (a run scans the PATH). Two runs
   at once can lose one line; the next run writes it again. */
const GUARD_STATE_FILE = 'token-only-guard.json';
function guardStateFile(deps = {}) { return path.join(deps.dataRoot || store.ROOT, GUARD_STATE_FILE); }
function readGuardState(deps = {}) {
  try {
    const j = JSON.parse(fs.readFileSync(guardStateFile(deps), 'utf8'));
    return j && j.agents && typeof j.agents === 'object' && !Array.isArray(j.agents) ? j.agents : {};
  } catch { return {}; }
}
function writeGuardState(agents, deps) {
  const file = guardStateFile(deps);
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.new`;
  fs.writeFileSync(tmp, JSON.stringify({ agents }, null, 2) + '\n', { mode: 0o600 });
  try { fs.renameSync(tmp, file); } catch (e) { try { fs.unlinkSync(tmp); } catch { /* gone */ } throw e; }
}
function pruneGuardState(keepNames, deps = {}) {
  try {
    const agents = readGuardState(deps);
    const keep = new Set(keepNames);
    const gone = Object.keys(agents).filter((n) => !keep.has(n));
    if (!gone.length) return;
    for (const n of gone) delete agents[n];
    writeGuardState(agents, deps);
  } catch { /* best effort: a stale line names an agent no longer listed, and the route shows only listed agents */ }
}
function recordGuardState(agentName, r, deps = {}) {
  try {
    const agents = readGuardState(deps);
    agents[agentName] = { ok: !!(r && r.ok), ...(r && r.because ? { because: String(r.because) } : {}), ...(r && r.warning ? { warning: String(r.warning) } : {}), at: new Date().toISOString() };
    writeGuardState(agents, deps);
  } catch (e) { process.stderr.write(`#5668: the guard state for ${agentName} could not be recorded (${(e && e.code) || e})\n`); }
}
/* #5668 (Pete's step 3): the user-level settings file the agent's ACCOUNT reads also reaches its sandbox profile, so its
   deny lists join the size count. The account's config home is the one the caller names (creation passes the account
   it is creating the agent on: its launch job is not written yet), else the one the agent's launch job names
   (create.readJob), else the default account's file (trust.defaultAgentSettings, the one derivation of it). Claude Code
   reads one user-level file, settings.json (review 1). Read only; the person's file is never edited. */
function settingsLists(files) {
  const out = { deny: [], denyRead: [], denyWrite: [] };
  const strings = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
  for (const f of files) {
    let j;
    try { j = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { continue; }
    const perms = j && j.permissions && typeof j.permissions === 'object' ? j.permissions : {};
    const fsb = j && j.sandbox && j.sandbox.filesystem && typeof j.sandbox.filesystem === 'object' ? j.sandbox.filesystem : {};
    out.deny.push(...strings(perms.deny));
    out.denyRead.push(...strings(fsb.denyRead));
    out.denyWrite.push(...strings(fsb.denyWrite));
  }
  return out;
}
function accountSettingsFile(agentName, deps = {}) {
  let dir = deps.accountConfigDir;
  if (dir === undefined) { try { const job = create.readJob(agentName); dir = job && job.configDir; } catch { dir = null; } }
  if (dir) return path.join(dir, 'settings.json');
  if (deps.home) return path.join(deps.home, '.claude', 'settings.json');   // a test's home
  return require('./trust').defaultAgentSettings();
}
function guardTokenOnlyFolder(dir, agentName, deps = {}) {
  const r = guardTokenOnlyFolderNow(dir, agentName, deps);
  recordGuardState(agentName, r, deps);
  return r;
}
function guardTokenOnlyFolderNow(dir, agentName, deps = {}) {
  try {
    if (!dir || !agentName) return { ok: false, because: 'no folder' };
    // #4491 review WARNING 1: this guard is a Claude Code settings file. Codex runs with its approvals and
    // sandbox bypassed, and Gemini, Grok, Antigravity and Muse never read it, so writing it for them guarded
    // nothing while every caller reported it guarded. Say so instead. The caller names the runner; an
    // unknown one is not assumed to be Claude.
    const runner = deps.runner;
    if (runner !== 'claude') return { ok: false, unsupported: true, because: 'only Claude agents can be kept from reading the board token so far; this agent runs on ' + (runner || 'an unknown runner') };
    /* Review 24: on Windows Claude Code matches rules against a POSIX form of the path (//c/...), and the rules here
       are written with the native spelling, so a deny may never match. Not measured on Windows, so the guard says it
       cannot keep the token out there yet rather than reporting a guard that may hold nothing. */
    if ((deps.platform || process.platform) === 'win32') return { ok: false, unsupported: true, because: 'on Windows this guard has not been shown to hold yet, so Kosmos does not claim it' };
    const settingsDir = path.join(dir, '.claude');
    fs.mkdirSync(settingsDir, { recursive: true });
    const file = path.join(settingsDir, 'settings.json');
    let cur = {};
    let raw = null;
    try { raw = fs.readFileSync(file, 'utf8'); } catch { raw = null; }
    if (raw !== null) {
      let parsed;
      try { parsed = JSON.parse(raw); } catch { parsed = undefined; }
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) cur = parsed;
      else {
        /* Review 18: a file that does not parse is not silently replaced: a dated copy is kept beside it and the board
           log says so, then the guard is written (an unguarded agent is the worse outcome). */
        const keep = `${file}.unreadable-${Date.now()}`;
        try { fs.writeFileSync(keep, raw, { mode: 0o600 }); } catch { /* the log still says it */ }
        process.stderr.write(`#4491: ${file} could not be read as settings; kept a copy at ${keep} and wrote the guard\n`);
      }
    }
    const rules = tokenOnlySettingsRules(dir, deps);
    /* Reviews 16 and 17: a rule that could not be written leaves part of the guard out (the board.token read, or the
       Edit rules that keep the agent from editing its own guard away), so the guard is NOT in place: say so (create then
       refuses; the refresh lists the agent as unguarded). Rename or move the folder whose path holds the character. */
    // Review 22: as with a dropped rule, a store or registry that could not be worked out leaves a token place unguarded.
    if (rules.rootsMissed && rules.rootsMissed.length) return { ok: false, because: 'Kosmos could not work out where ' + rules.rootsMissed.join(', ') + ' keep the board token, so the guard cannot be written whole' };
    if (rules.tokenRuleDropped) return { ok: false, because: 'a folder path (the agent, its home or Kosmos) has a character the permission rules cannot carry, so the guard cannot be written whole' };
    // Review 16: off macOS no sandbox block is written: said at create time as well as at board start.
    if ((deps.platform || process.platform) !== 'darwin' && !deps.atLaunch) process.stderr.write('#4491 note: off macOS ' + agentName + ' gets permission rules only (its shell is not sandboxed)\n');
    const perms = cur.permissions && typeof cur.permissions === 'object' && !Array.isArray(cur.permissions) ? cur.permissions : {};
    /* #5663: at a launch, a recorded launch rule that is not current and whose path is gone is dropped (an upgraded tool's
       old versioned path); every other rule merges as before. A rule the person wrote that is the SAME string as a
       dropped one goes with it (review 6): it names a path that no longer exists. */
    const plat = deps.platform || process.platform;
    // Review 18: only a launch uses the record (to prune and to write it), so only a launch reads it.
    const prev = rules.launchKnown ? readLaunchRecord(rules.launchRecord) : { deny: [], denyWrite: [], keep: true };
    const launchDenyNow = new Set(rules.launchRules || []);
    const launchWritesNow = [...new Set([...(rules.launchDirs || []), ...(rules.launchFiles || [])])];
    const launchWritesNowSet = new Set(launchWritesNow);
    const stale = new Set(rules.launchKnown ? prev.deny.filter((r) => !launchDenyNow.has(r) && launchPathGone(ruleTarget(r, plat))) : []);
    const staleWrites = new Set(rules.launchKnown ? prev.denyWrite.filter((x) => !launchWritesNowSet.has(x) && launchPathGone(x)) : []);
    /* The record is a union: what was recorded and not pruned, and what THIS LAUNCH wrote. Review 7: only a launch adds to
       it. A board start builds its launch rules from its own inputs (its PATH, its XDG_CONFIG_HOME), which a launch need
       not share, and some name a path that is absent on purpose (what is later made there would run); recorded, the
       next launch would see it as not current and gone, and prune it. So a launch prunes only what a launch wrote.
       It is read and written without a lock, so two refreshes at once can lose an entry; that entry is then never pruned
       (kept, not dropped). */
    /* Review 9: and only a path that EXISTS now is recorded. The pane PATH is the tmux server's global PATH, which is not
       stable between launches, so a folder denied while absent on purpose (what is later made there would run) could
       leave one launch's PATH, be pruned, and be planted during that session. Never recorded, it is never pruned; a
       removed version existed when it was recorded, so the upgrade case is unchanged. */
    const recDeny = [...new Set([...prev.deny.filter((r) => !stale.has(r)), ...(rules.launchKnown ? [...launchDenyNow].filter((r) => launchPathPresent(ruleTarget(r, plat))) : [])])];
    const recWrites = [...new Set([...prev.denyWrite.filter((x) => !staleWrites.has(x)), ...(rules.launchKnown ? launchWritesNow.filter(launchPathPresent) : [])])];
    const had = Array.isArray(perms.deny) ? perms.deny.filter((r) => typeof r === 'string' && !stale.has(r)) : [];
    // Review 12: what a launch prunes is said (count only), so a dropped rule never goes unseen.
    if (stale.size || staleWrites.size) process.stderr.write(`#5663: ${agentName}: pruned ${stale.size} file-tool and ${staleWrites.size} sandbox launch rule(s) whose paths are gone\n`);
    const deny = [...new Set([...had, ...rules.deny])];
    /* Review 24: permissions.additionalDirectories widens where the sandboxed shell may write, as allowWrite does, so
       it goes too (Kosmos never writes it for an agent) and the board log says so. */
    const { additionalDirectories: _dropDirs, ...permsKept } = perms;
    if (_dropDirs !== undefined) console.error(`token-only guard: removed permissions.additionalDirectories from ${file}; a token-only agent's shell may not write outside its folder`);
    const next = { ...cur, permissions: { ...permsKept, deny } };
    if ((deps.platform || process.platform) === 'darwin') {
      const sb = cur.sandbox && typeof cur.sandbox === 'object' && !Array.isArray(cur.sandbox) ? cur.sandbox : {};
      const net = sb.network && typeof sb.network === 'object' && !Array.isArray(sb.network) ? sb.network : {};
      const fsb = sb.filesystem && typeof sb.filesystem === 'object' && !Array.isArray(sb.filesystem) ? sb.filesystem : {};
      const dr = Array.isArray(fsb.denyRead) ? fsb.denyRead.filter((x) => typeof x === 'string') : [];
      const dw = Array.isArray(fsb.denyWrite) ? fsb.denyWrite.filter((x) => typeof x === 'string' && !staleWrites.has(x)) : [];
      // Canonicalize the paths: Seatbelt matches resolved paths, so a symlinked data dir or
      // /var -> /private/var would otherwise slip a denyRead/denyWrite (the guide realOr's its own
      // folder for the same reason). The token files and the home settings files often do not exist
      // yet, so use realOrLeaf (resolves the existing parent, keeps the absent leaf) rather than realOr,
      // which would leave a symlinked parent un-followed. The agent's own .claude was just mkdir'd, so
      // realOr resolves it directly.
      const denyReadPaths = [...rules.tokenPaths.map(realOrLeaf), ...(rules.undoDirs || []).map(realOrLeaf), ...(rules.tokenDirs || []).map(realOrLeaf)];
      const denyWritePaths = [realOr(rules.settingsDir), ...rules.settingsFiles.map(realOrLeaf), ...rules.tokenPaths.map(realOrLeaf), realOrLeaf(rules.listFile), realOrLeaf(rules.guardRecord), ...rules.worldWrites.map(realOrLeaf), ...(rules.undoDirs || []).map(realOrLeaf), ...(rules.tokenDirs || []).map(realOrLeaf), ...(rules.undoSwitches || []).map(realOrLeaf), ...(rules.launchDirs || []), ...(rules.launchFiles || [])];
      // NEVER add an allowWrite for the Kosmos store, the worlds base or the home here (the independent re-review): the
      // shell's write scope is what covers a world created mid-session until the agent's next start, so a fix
      // for 'the sandbox limits normal work' must widen it somewhere else, never to those.
      /* #4491 whole-branch review: keys already in this file survive the merge, and some undo the guard: commands that
         run outside the sandbox (excludedCommands) and paths re-opened inside a deny (filesystem allowRead / allowWrite).
         A token-only agent's settings are Kosmos's, so those are dropped here, at every refresh. Review 22: so are the
         Unix-socket allowances, since a socket can reach a server outside the sandbox that runs commands for its
         caller (tmux, which every agent runs in, is one). */
      const { excludedCommands: _dropExcluded, ...sbKept } = sb;
      const { allowRead: _dropAllowRead, allowWrite: _dropAllowWrite, ...fsbKept } = fsb;
      const { allowUnixSockets: _dropSockets, allowAllUnixSockets: _dropAllSockets, ...netKept } = net;
      const dropped = [['sandbox.excludedCommands', _dropExcluded], ['sandbox.filesystem.allowRead', _dropAllowRead], ['sandbox.filesystem.allowWrite', _dropAllowWrite],
        ['sandbox.network.allowUnixSockets', _dropSockets], ['sandbox.network.allowAllUnixSockets', _dropAllSockets]]
        .filter(([, v]) => v !== undefined).map(([k]) => k);
      // Review 10: a dropped key may have been the person's own (a repo the agent wrote to): say so, never silently.
      if (dropped.length) console.error(`token-only guard: removed ${dropped.join(', ')} from ${file}; a token-only agent's shell may not run outside the sandbox or reopen a denied path`);
      next.sandbox = {
        ...sbKept, enabled: true, autoAllowBashIfSandboxed: true, allowUnsandboxedCommands: false,
        network: { ...netKept, allowLocalBinding: true },
        filesystem: {
          ...fsbKept,
          denyRead: [...new Set([...dr, ...denyReadPaths])],
          denyWrite: [...new Set([...dw, ...denyWritePaths])],
        },
      };
    }
    const text = JSON.stringify(next, null, 2) + '\n';
    if (text !== raw) {   // review 20: an unchanged guard is not rewritten at every board start
      const tmp = `${file}.${process.pid}.new`;
      fs.writeFileSync(tmp, text, 'utf8');
      try { fs.renameSync(tmp, file); } catch (e) { try { fs.unlinkSync(tmp); } catch { /* gone */ } throw e; }   // review 24
    }
    // #5663: what this refresh wrote for launch coverage, for the next refresh to replace. A record that cannot be
    // written leaves this refresh's rules in place (nothing is lost; the next refresh only cannot prune them): said.
    // Review 7: written before the local-settings clean, so a throw there cannot leave settings.json's rules unrecorded.
    // Review 15: only a launch writes it (only a launch changes it), so a board start cannot write back an older read
    // over a concurrent launch's entries.
    if (rules.launchKnown && !prev.keep && !writeLaunchRecord(rules.launchRecord, { deny: recDeny, denyWrite: recWrites })) process.stderr.write(`#5663: ${rules.launchRecord} could not be written; old launch rules will not be pruned until it can\n`);
    cleanLocalSettings(path.join(settingsDir, 'settings.local.json'));
    // #5516 review 1: the guard is written in full first; a PATH entry it could not cover only makes it NOT WHOLE (said),
    // never a reason to write nothing.
    /* #5663: the sandbox profile has size limits (SANDBOX_DENY_PREFIX_MAX). Past them the guard is still whole (the token
       is denied), but the agent's shell may not run, so it is said as a warning, never a refusal: the limits are fitted
       to measurements (review 4), and a refusal would stop an agent being created on an estimate. It is said beside
       an uncovered PATH entry, not instead of it. It is written to the logs (stderr) and recorded for the agent's page
       (#5668, recordGuardState). */
    let sz = null;
    if ((deps.platform || process.platform) === 'darwin') {
      /* #5668: the account's own file, and the agent folder's settings.local.json (cleanLocalSettings keeps its denies,
         review 1), reach the same profile. */
      const acct = settingsLists([accountSettingsFile(agentName, deps), path.join(rules.settingsDir, 'settings.local.json')]);
      const fsbNow = next.sandbox.filesystem;
      sz = sandboxDenySize({ denyRead: [...(fsbNow.denyRead || []), ...acct.denyRead], denyWrite: [...(fsbNow.denyWrite || []), ...acct.denyWrite] }, [...next.permissions.deny, ...acct.deny], deps.home, deps.platform || process.platform);
    }
    const warning = sz && (sz.prefixes > SANDBOX_DENY_PREFIX_MAX || sz.raw > SANDBOX_DENY_RAW_MAX)
      ? `its ${sz.paths} denied path entries across the read and write clauses (${sz.prefixes} distinct characters, ${sz.raw} in all) are past what Kosmos can say the sandbox will take (${SANDBOX_DENY_PREFIX_MAX} and ${SANDBOX_DENY_RAW_MAX}); the guard is written but may stop the agent's shell`
      : null;
    if (warning) process.stderr.write(`#5663: ${agentName}: ${warning}\n`);
    if (rules.launchUnsafe && rules.launchUnsafe.length) return { ok: false, because: 'the PATH this agent starts with has an entry Kosmos could not cover (' + rules.launchUnsafe.join(', ') + '); the rest of the guard is in place', ...(warning ? { warning } : {}) };
    return warning ? { ok: true, warning } : { ok: true };
  } catch (err) {
    return { ok: false, because: String((err && err.message) || err) };
  }
}

/* #4491: Claude Code's root-owned managed-settings file on macOS. With the right content (the sandbox on, unsandboxed
   commands off, the board.token deny), it makes the token-only guard durable: the agent's uid cannot write this path.
   Installing it is an admin step, parked on the card. This code only checks that the file EXISTS (review 15: not its
   content), so a missing warning means "a managed file is there", not "the guard is durable". */
const MANAGED_SETTINGS_PATH = '/Library/Application Support/ClaudeCode/managed-settings.json';
function managedSettingsPresent(platform = process.platform) {
  if (platform !== 'darwin') return false;   // managed-settings is a macOS/Seatbelt concept here
  try { return fs.existsSync(MANAGED_SETTINGS_PATH); } catch { return false; }
}

const STARTS_A_PROCESS = ['hooks', 'statusLine', 'apiKeyHelper', 'mcpServers', 'enableAllProjectMcpServers', 'enabledMcpjsonServers'];

/* #4491 review 11: settings.local.json in the agent's .claude takes precedence over settings.json, and a token-only
   agent may have written one before the guard existed. The keys that would undo the guard are removed from it too (a
   sandbox switched off, unsandboxed commands allowed, commands run outside it, paths reopened), logged, and the file
   rewritten only when something changed. A file that does not parse is left as it is. A failure to rewrite it
   throws on purpose (review 12): the guard then reports not ok, because keys left there could undo it. */
function cleanLocalSettings(file) {
  let cur;
  try { cur = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return; }
  if (!cur || typeof cur !== 'object') return;
  /* Review 22: keys that start a process when the agent next starts (outside the sandbox) are the person's call and
     #5516's scope; Kosmos never writes this file, so any here was put there by someone. Said, not removed. */
  const starts = STARTS_A_PROCESS.filter((k) => cur[k] !== undefined);
  if (starts.length) process.stderr.write(`#4491: ${file} has ${starts.join(', ')}, which start a process outside the sandbox when the agent starts; Kosmos left them\n`);
  const dropped = [];
  if (cur.permissions && typeof cur.permissions === 'object' && cur.permissions.additionalDirectories !== undefined) {
    delete cur.permissions.additionalDirectories; dropped.push('permissions.additionalDirectories');   // review 24
  }
  /* Review 23: an ALLOWLIST, not a list of known-bad keys and values: this file outranks the guard's settings.json,
     so a value of another type ("false", 0) or a sandbox key Claude Code adds later could still undo it. The guard
     writes the whole sandbox block in settings.json; all this file may add is more denies. */
  const sb = cur.sandbox === undefined ? undefined : cur.sandbox && typeof cur.sandbox === 'object' && !Array.isArray(cur.sandbox) ? cur.sandbox : null;
  if (sb === undefined) { /* no sandbox block */ } else if (!sb) { delete cur.sandbox; dropped.push('sandbox'); } else {
    for (const k of Object.keys(sb)) {
      if (k !== 'filesystem') { delete sb[k]; dropped.push('sandbox.' + k); continue; }
      const f = sb.filesystem;
      if (!f || typeof f !== 'object' || Array.isArray(f)) { delete sb.filesystem; dropped.push('sandbox.filesystem'); continue; }
      for (const fk of Object.keys(f)) {
        if ((fk === 'denyRead' || fk === 'denyWrite') && Array.isArray(f[fk])) continue;
        delete f[fk]; dropped.push('sandbox.filesystem.' + fk);
      }
    }
  }
  if (!dropped.length) return;
  const tmp = `${file}.${process.pid}.new`;
  fs.writeFileSync(tmp, JSON.stringify(cur, null, 2) + '\n', 'utf8');
  try { fs.renameSync(tmp, file); } catch (e) { try { fs.unlinkSync(tmp); } catch { /* gone */ } throw e; }   // review 24
  console.error(`token-only guard: removed ${dropped.join(', ')} from ${file}; they would undo the guard`);
}

/* #4491: at board start, guard every agent currently listed in agent-token-only.json, so a pilot listed
   before this shipped (echo) is guarded from its next session without a re-create. Warns (once per board
   start, no cross-start dedup) when the root-owned managed belt is absent (the durable close is the
   parked admin step). workerDir is overridable for tests. { guarded: [names], unguarded: [{ name, because }], managed: boolean }. Never throws. */
function refreshTokenOnlyGuards(deps = {}) {
  const platform = deps.platform || process.platform;
  const out = { guarded: [], unguarded: [], managed: managedSettingsPresent(platform) };
  let names;
  try { names = require('./sendertoken').tokenOnlyList(); } catch { return out; }   // the roster's own reader (#4491)
  // Review 22: the supervisor guards ONE listed agent at its launch (a name listed after board start), not them all.
  if (deps.only) { names = names.filter((n) => n === deps.only); deps = { ...deps, atLaunch: true }; }   // review 23: notes said at board start, not each launch
  if (!(deps.launchCache instanceof Map)) deps = { ...deps, launchCache: new Map() };   // #5516: one PATH scan per pass
  const toDir = deps.workerDir || create.workerDir;
  for (const name of names) {
    let dir = null;
    try { dir = toDir(name); } catch { dir = null; }
    let runner = null;
    try { runner = deps.runnerOf ? deps.runnerOf(name) : create.recordedRunner(name); } catch { runner = null; }
    /* Review 11: never CREATE a folder for a listed name. A name can be listed before its agent is made, or stay
       listed after removal; guarding would make <name>/.claude, and an existing folder refuses creating that name. */
    const exists = dir ? (() => { try { return fs.statSync(dir).isDirectory(); } catch { return false; } })() : false;
    const g = exists ? guardTokenOnlyFolder(dir, name, { ...deps, runner }) : { ok: false, because: 'no agent folder yet' };
    if (g.ok) out.guarded.push(name); else out.unguarded.push({ name, because: g.because });
  }
  // #5668 review 1: at board start (the whole list), lines for agents no longer listed leave the record.
  if (!deps.only) pruneGuardState(names, deps);
  /* Review 21: the person's own user settings (~/.claude, ~/.claude-<label>) also reach a token-only agent. They are
     the person's, so the guard never edits them; it says when one holds a key that weakens the sandbox. Board start
     only, not at each launch (review 22). */
  if (out.guarded.length && !deps.only) {
    for (const h of accountConfigHomes(deps.home || kosmosHome())) {
      for (const f of ['settings.json', 'settings.local.json']) {
        let j = null;
        try { j = JSON.parse(fs.readFileSync(path.join(h, f), 'utf8')); } catch { continue; }
        const sb = j && j.sandbox && typeof j.sandbox === 'object' ? j.sandbox : {};
        const weak = [];
        if (j && j.permissions && j.permissions.additionalDirectories !== undefined) weak.push('permissions.additionalDirectories');   // review 24
        // Review 22: only the list keys, which merge across files; enabled and allowUnsandboxedCommands are single values
        // the agent's own guard sets, and it outranks these files.
        if (sb.excludedCommands !== undefined) weak.push('excludedCommands');
        if (sb.network && (sb.network.allowUnixSockets !== undefined || sb.network.allowAllUnixSockets !== undefined)) weak.push('Unix-socket allowances');
        if (sb.filesystem && (sb.filesystem.allowRead !== undefined || sb.filesystem.allowWrite !== undefined)) weak.push('filesystem allowRead/allowWrite');
        if (weak.length) process.stderr.write(`#4491: ${path.join(h, f)} (your own Claude settings) has sandbox ${weak.join(', ')}, which also reaches token-only agents and can weaken their guard\n`);
      }
    }
  }
  /* Review 12: a listed name with no agent folder (not made yet, or removed and still listed) is a note, not a guard
     failure: nothing is running under that name to guard. */
  const failed = out.unguarded.filter((u) => u.because !== 'no agent folder yet');
  const noFolder = out.unguarded.filter((u) => u.because === 'no agent folder yet');
  if (failed.length) {
    process.stderr.write('#4491: ' + failed.length + ' token-only agent(s) NOT guarded from reading the board token: '
      + failed.map((u) => u.name + ' (' + u.because + ')').join('; ') + '\n');
  }
  if (noFolder.length) process.stderr.write('#4491 note: listed as token-only but no agent folder (nothing to guard yet): ' + noFolder.map((u) => u.name).join(', ') + '\n');
  // The managed-belt warning is a macOS-only concern: off darwin no sandbox block is written and
  // managed-settings does not apply, so warning there would be misleading.
  if (out.guarded.length && platform === 'darwin' && !out.managed && !deps.only) {   // board start only, not each launch (review 22)
    process.stderr.write('#4491: ' + out.guarded.length + ' token-only agent(s) guarded by per-agent settings only; the root-owned managed-settings belt is absent, so the guard is defense-in-depth (see card #4491).\n');
  }
  return out;
}

/* #3769, for a guide made before it: add the secrets section to its instructions if it has none (its
   heading is the marker), and write its folder's guards. Once at board start; the running guide reads
   its instructions and settings from its next session. { rule: boolean, guarded: boolean } */
function refreshGuideGuards({ name = guideName(), isGuide = isGuideFolder } = {}) {
  const out = { rule: false, guarded: false };
  if (!name || !isGuide(name)) return out;
  const dir = guideFolder(name);
  if (dir) out.guarded = guardGuideFolder(dir, name).ok;
  const roles = require('./roles');
  const instructions = require('./instructions');
  let cur;
  try { cur = instructions.read(name); } catch { return out; }
  if (!cur || !cur.exists || typeof cur.text !== 'string' || cur.text.includes(roles.GUIDE_SECRETS_HEADING)) return out;
  try {
    const text = cur.text.replace(/\n*$/, '\n\n') + roles.GUIDE_SECRET_LINES.join('\n') + '\n';
    instructions.write(name, text, cur.version, undefined, { who: 'kosmos', because: 'Kosmos told the setup guide never to share passwords or keys' });
    out.rule = true;
  } catch { /* the other two layers still stand */ }
  return out;
}

/* Is this agent's folder the one the seed made for the guide? */
function isGuideFolder(agentName) {
  const dir = guideFolder(agentName);
  if (!dir) return false;
  try { return fs.lstatSync(path.join(dir, GUIDE_MARKER)).isFile(); } catch { return false; }
}

/* The guide's agent name as recorded when it was seeded, or null (never seeded,
 * or a flag we cannot read). The page-context route writes only for this agent. */
function guideName() {
  try {
    const rec = JSON.parse(fs.readFileSync(flagPath(), 'utf8'));
    return rec && typeof rec.name === 'string' && rec.name ? rec.name : null;
  } catch { return null; }
}

/*
 * Seed the setup assistant if it has never been seeded. Returns:
 *   { seeded: true, name, avatarCopied, marked } -- created
 *   { seeded: false, reason: '<why>' }            -- did not create (all benign)
 *
 * `model` ({ provider, account }) picks what it runs on; ensureGuide passes the
 * first connected one. NEVER throws: its automatic caller (ensureGuide) runs at
 * Giddy Up, which has already succeeded, and from a sweep; a helper is a nicety
 * that must not turn either into an error. The caller writes the once-ever flag
 * on `seeded: true`.
 */
function seedSetupAssistant({ createAgent, hasConnectedAccount = defaultHasConnectedAccount, avatarDir, model } = {}) {
  if (typeof createAgent !== 'function') return { seeded: false, reason: 'no createAgent provided' };
  if (setupAssistantSeeded()) return { seeded: false, reason: 'already seeded' };


  // A live agent needs a model. Gate on a connected account rather than create a
  // KeepAlive agent that would loop on auth failure (see the header note).
  let connected;
  try { connected = !!hasConnectedAccount(); } catch { connected = false; }
  if (!connected) return { seeded: false, reason: 'no connected account to run the assistant on' };

  let out;
  let name;
  for (const candidate of [GUIDE_NAME, GUIDE_FALLBACK_NAME]) {
    name = candidate;
    try {
      /* #3894: this path sends no created-agent beacon, on purpose: the person made no
         choice here, and the create form's box is where that choice lives. #4350: the guide is
         also left OUT of the public count (create.isAutoGuideBirth), since the person did not
         create it; what happened here reaches the collector as the install ping's `guide`
         state instead. */
      out = createAgent({
        name,
        role: SETUP_ROLE_KEY,
        createdBy: GUIDE_CREATED_BY,
        purpose: `${GUIDE_PURPOSE_PREFIX}, ${GUIDE_TAG} (auto-created when a model was connected, #3034/#3660)`,
        /* The model that was connected, so an OpenAI-only (or Gemini, Grok) person gets a
           guide that can run; absent, createAgent's own default (Claude) applies. */
        ...(model && model.provider ? { provider: model.provider } : {}),
        ...(model && model.account ? { account: model.account } : {}),
      });
    } catch (err) {
      // createAgent is not expected to throw (it returns a refusal outcome), but
      // if it does, swallow it -- onboarding has already completed.
      return { seeded: false, reason: 'create threw: ' + String((err && err.message) || err) };
    }
    /* Only a TAKEN name moves on to the fallback; any other refusal (no runner) would
       refuse the fallback the same way. The sentence is create.js's own. */
    const taken = out && out.outcome !== create.OUTCOME.CREATED && /already an agent called/.test(String(out.because || ''));
    if (!taken) break;
  }

  if (!out || out.outcome !== create.OUTCOME.CREATED) {
    // Benign remaining case: createAgent refuses because the Claude runner is not
    // installed (its actual account/model refusal path). No flag is written.
    return { seeded: false, reason: 'not created: ' + ((out && out.because) || (out && out.outcome) || 'unknown') };
  }

  const avatarCopied = copyGuideAvatar(out.name || name, avatarDir);
  const marked = markGuideFolder(out.name || name);
  return { seeded: true, name: out.name || name, avatarCopied, marked };
}

/*
 * WHEN the guide is created (#3660, Splinter 19:06): the first time a model is connected
 * on an install that has been through setup since this shipped.
 *
 * 🔑 ARMED, NOT MERELY "A MODEL IS CONNECTED". Every install that predates this has
 * models connected and no seed flag, so a bare "connected and not seeded" check would
 * put an agent called Josh on every existing board the moment this ships. First-run
 * completion (Giddy Up) ARMS it: at Giddy Up if a model is already connected, or later,
 * the first time one is. Since #3760 (Josh, 2026-09-25) an install that finished first run
 * before the guide existed is ALSO armed, once, at board start (armExistingInstall below),
 * so existing installs get the guide too, under the same off switch as a new user.
 */
function armPath() { return path.join(store.ROOT, 'setup-assistant-armed.json'); }

function isArmed() {
  try { return fs.existsSync(armPath()); } catch { return false; }
}

/* Written at first-run completion. Best-effort: an unarmed install simply never gets
   an automatic guide, which is the safe direction. */
function armSetupAssistant() {
  try {
    if (!fs.existsSync(armPath())) fs.writeFileSync(armPath(), JSON.stringify({ at: new Date().toISOString() }) + '\n', 'utf8');
    return true;
  } catch { return false; }
}

/*
 * #3760, Josh 2026-09-25 11:07 (0.6.94): "anybody that has a current install won't have the helper agent. Is
 * there a way to activate that for existing users and then allow them the ability to turn it off, like we
 * normally would let new users turn it off". So an install that finished first run BEFORE the guide existed
 * is armed once, at board start after the update, exactly as Giddy Up arms a new one. Everything after
 * arming is the new-user path unchanged: ensureGuide still creates at most one guide ever (the seeded flag),
 * never while the person has turned setup assistance off, and never without a model.
 * - A fresh install KNOWN to be still in onboarding is left to Giddy Up, so it is unchanged.
 *   `firstRunSeen` is firstrun.seen(). #4405 (Josh 2026-09-28 14:53: "default that on so everybody gets
 *   it and has to turn it off"): a first-run flag we could not read (known: false) now ARMS too, as first
 *   run itself treats it as done; it used to leave such an install without a guide for good (a real user's state on 0.7.05).
 *   The person's switch still decides (ON by default, OFF only when they turned it off).
 * - Already armed is a no-op, so this runs once per install, and a guide someone removed is not re-created
 *   (the seeded flag is once-ever; the arm file never grants a second).
 * Returns { armed: true } when it armed now, else { armed: false, reason }. Never throws.
 */
function armExistingInstall({ firstRunSeen } = {}) {
  try {
    if (isArmed()) return { armed: false, reason: 'already armed' };
    const seen = typeof firstRunSeen === 'function' ? firstRunSeen() : null;
    if (!seen || (seen.known === true && seen.done !== true)) return { armed: false, reason: 'first run not finished' };
    fs.writeFileSync(armPath(), JSON.stringify({ at: new Date().toISOString(), via: 'update' }) + '\n', 'utf8');
    return { armed: true };
  } catch (err) {
    return { armed: false, reason: 'could not arm: ' + String((err && err.message) || err) };
  }
}

/* The providers, in the order the person sees them (Josh 17:05, #3651), each with the
   module that lists its accounts. Only a LISTED account counts as connected. */
const MODEL_PROVIDERS = Object.freeze([
  ['anthropic', './accounts'],
  ['openai', './openaiaccounts'],
  ['google', './geminiaccounts'],
  ['xai', './grokaccounts'],
]);

/* A DEFAULT Gemini or Grok key is the one account create's gate lets through unchecked
   (it cannot see the launch environment's key door, so it fails open for a default row).
   The guide is created only on a model that can run, so for those two it also asks the
   provider's own live check, and a key the provider positively rejects is refused. A
   default Grok SUBSCRIPTION is already live-checked by the gate, so it is not asked twice. */
const LIVE_CHECK_DEFAULT = new Set(['google', 'xai']);
const defaultLive = async (mod, dir) => {
  const m = require(mod);
  const live = await m.checkLive(dir);
  return !(live && live.state === m.STATE.NONE);
};

/* Every listed account, in provider order, and a fingerprint of the set. Cheap: the four
   list() calls read config, never the network. */
function listedModels({ listFor = (mod) => require(mod).list() } = {}) {
  const rows = [];
  let failed = false;   // a provider that could not be read: nothing is known about it (#3660 reads this)
  for (const [provider, mod] of MODEL_PROVIDERS) {
    let got;
    try { got = listFor(mod); } catch { got = []; failed = true; }
    if (!Array.isArray(got)) continue;
    for (const row of got) {
      if (!row || typeof row.dir !== 'string') continue;
      rows.push({ provider, mod, dir: row.dir, account: row.isDefault ? null : row.dir, authMode: row.authMode || null,
        who: [row.email || '', row.keyTail || ''].join('/') });
    }
  }
  /* WHO is in the fingerprint, not just WHERE: a new key or a different sign-in in the same
     folder is a new connection (review round 6). Two changes are invisible here, and the
     one-hour cap below bounds both: re-signing in to the SAME account in place, and a new
     key pasted over a Claude API-key account (Claude rows carry no key suffix, and the
     listing should not start exposing one for this). */
  return { rows, failed, fingerprint: rows.map((r) => `${r.provider}:${r.dir}:${r.authMode || ''}:${r.who}`).join('|') };
}

/* #3660: the guide agent's card, read as "their model cannot answer right now": the three states #3723
   surfaces (a usage limit or no credits, a rejected login, the provider unreachable after its retries).
   { problem, runner } or null. Josh, 2026-09-25 07:22: then the bubble falls back to the hosted assistant
   for that chat, and goes back to their model once it answers. */
function guideFailure(card) {
  const { STATE } = require('./status');   // lazy: status requires create, which the seed uses
  if (!card || ![STATE.RATE_LIMITED, STATE.AUTH_FAILED, STATE.CONNECTION_LOST].includes(card.state)) return null;
  return { problem: card.state, runner: typeof card.runner === 'string' && card.runner ? card.runner : null };
}

/* #3660: whether the bubble may use the hosted assistant (Kosmos's own model) here. Before the person has any
   model of their own; and, once they have one, only while their guide cannot answer (`failing`, from
   guideFailure; Josh 2026-09-25 07:22). An install that has a working model, or a model and no guide, does not
   spend the shared allowance on Kosmos's key. And only where a connector is at a real path
   (remote.hostedAvailable), so a source checkout or a check sandbox never offers it. */
function hostedConnector(available = () => require('./remote').hostedAvailable()) {
  try { return available() === true; } catch { return false; }
}
function hostedWhy({ available = undefined, listed = () => listedModels(), failing = () => null } = {}) {
  if (!hostedConnector(available)) return { ok: false, why: 'no_connector' };
  /* A guide that cannot answer is on a model they connected (the seed creates a guide only once a model is
     connected, and setupGuideNow checks its marker), so the listing is not needed to know it. `failing`
     THROWS when the guide's card could not be read: that is not known, so 'unchecked' (a retryable 503 on
     the hosted route), never 'own_model', which would end a fallback chat over a board hiccup. */
  let f = null;
  try { f = failing(); } catch { return { ok: false, why: 'unchecked' }; }
  if (f) return { ok: true, why: 'own_model_failing' };
  let got;
  try { got = listed(); } catch { return { ok: false, why: 'unchecked' }; }
  /* A provider that could not be read may be the one they connected: not known, so not offered, and not said to be theirs. */
  if (!got || got.failed === true) return { ok: false, why: 'unchecked' };
  const rows = got.rows;
  return rows.length === 0 ? { ok: true, why: null } : { ok: false, why: 'own_model' };
}
function hostedOffered(deps) { return hostedWhy(deps).ok; }

/* #3734: an existing guide was born told it never creates agents. Replace that paragraph, once, with the
   current hands-off and make-agents lines, in the marked guide folder only.
   #3947: likewise its "Who you are" paragraph, which told it to say it is an AI in its first answer; the
   greeting says that now. Each old paragraph is replaced only where it is still word for word, so a
   guide whose instructions the person reworded is left alone. The running guide reads its new
   instructions from its next session. { changed: boolean } */
function refreshGuideRole({ name = guideName(), isGuide = isGuideFolder } = {}) {
  if (!name || !isGuide(name)) return { changed: false };
  const roles = require('./roles');
  const instructions = require('./instructions');
  let cur;
  try { cur = instructions.read(name); } catch { return { changed: false }; }
  if (!cur || !cur.exists || typeof cur.text !== 'string') return { changed: false };
  const swaps = [
    { old: roles.HANDS_OFF_LINES_BEFORE_3734.join('\n'),
      now: [...(roles.SETUP_HANDS_OFF ? roles.HANDS_OFF_LINES : []), ...(roles.SETUP_MAKES_AGENTS ? roles.MAKE_AGENTS_LINES : [])].join('\n'),
      because: 'Kosmos let the setup guide make agents for you' },
    { old: roles.WHO_YOU_ARE_LINES_BEFORE_3947.join('\n'), now: roles.WHO_YOU_ARE_LINES.join('\n'),
      because: 'the setup guide\'s greeting now says it is an AI, so its answers go straight to helping' },
  ];
  let text = cur.text;
  const why = [];
  for (const s of swaps) {
    if (!text.includes(s.old)) continue;
    text = text.replace(s.old, () => s.now);
    why.push(s.because);
  }
  if (!why.length) return { changed: false };
  try {
    instructions.write(name, text, cur.version, undefined, { who: 'kosmos', because: why.join('; ') });
    return { changed: true };
  } catch { return { changed: false }; }
}

/* Could a guide run on this listed account? create's own gate, plus the default-key check
   above. A live check that errors is uncertainty, not a refusal (create's own rule). */
async function usable(row, { connectable = (q) => create.accountConnectable(q), liveDefault = defaultLive } = {}) {
  let gate;
  try { gate = await connectable({ provider: row.provider, accountDir: row.account }); }
  catch (err) {
    /* create's gate returns a state for every environmental case, so a throw is a bug in
       our own code. Same rule as create (#1916): fail OPEN, and say so loudly, rather than
       silently calling every model unusable and retrying forever with no trail. */
    console.error('#3660: setup guide account check errored (failing open):', (err && err.stack) || err);
    gate = { ok: true };
  }
  if (!(gate && gate.ok)) return false;
  if (row.account === null && LIVE_CHECK_DEFAULT.has(row.provider) && row.authMode !== 'subscription') {
    let alive;
    try { alive = await liveDefault(row.mod, row.dir); } catch { alive = true; }
    if (!alive) return false;
  }
  return true;
}

/* After a try that reached a live check and did not create (a dead sign-in, a rejected
   key, a refused create), the next try waits: 10 minutes, doubling each time, at most a
   HOUR. The check can be a live `claude -p` (a real request on their account) and the
   sweep runs every minute, so a failure that never clears costs one check an hour. A
   change in what is listed or who is signed in (they just connected something) skips the
   wait and resets it, and Giddy Up never waits: the guide is created the moment a model is
   connected (reviews 4 and 6). The hour, not a day, bounds the one change nobody can see
   from here: signing in again to the same account in the same place. */
const RETRY_AFTER_MS = 10 * 60 * 1000;
const RETRY_MAX_MS = 60 * 60 * 1000;
let inFlight = null;
let lastFailedAt = 0;
let failures = 0;
let failedFingerprint = null;
/* Set once a guide is created in this process, whatever happened to the flag write, so a
   failed write (full disk) cannot let the next sweep tick create a second guide. */
let createdHere = false;
/* Both guide names already taken by other agents: that does not clear by itself, so it is
   final for this process rather than an hourly live check plus refused creates forever
   (review round 8). A board restart tries once more. */
let namesTaken = false;

function retryWaitMs() {
  return Math.min(RETRY_MAX_MS, RETRY_AFTER_MS * Math.pow(2, Math.max(0, failures - 1)));
}

/**
 * Create the guide if, and only if: the automatic path is on, this install is armed,
 * it has never been seeded, and a model is connected (`explicit`, below, only arms and skips the retry wait). Tries each connected model in
 * order until one creates (a refused create on the first does not strand a working
 * second). Idempotent and single-flight: a Giddy Up and a sweep tick arriving together
 * create at most one. Never throws. Resolves { seeded, state?, name?, reason? }: `state` is one
 * of guidestate.STATES, absent only for a retry wait (which says nothing new; #4350).
 * `explicit` (#4405) is the PERSON switching the assistant on in Settings > Help on an install that has never
 * had a guide: it arms the install and skips the retry wait (a click deserves a real try; a dead sign-in costs
 * one live check per click). Every other gate stands, the never-seeded one included: a guide that was made and
 * then removed is RESTORED by the caller (/api/settings), never made a second time.
 * `deps` is TESTS ONLY: listFor / connectable / liveDefault (the account seams),
 * enabled / settings (the switches) and avatarDir. Production passes none.
 */
function ensureGuide({ createAgent, via = 'model-connected', now = Date.now(), deps = {}, explicit = false } = {}) {
  if (inFlight) return inFlight;
  /* Test servers run with AGENT_WORKFORCE_DRY_RUN=1, and with a signed-in sandbox account
     they would each create a guide nobody asserts (review round 2, measured). So under dry
     run it is off unless a test turns it on with AGENT_WORKFORCE_SETUP_GUIDE=on. */
  const dryRun = process.env.AGENT_WORKFORCE_DRY_RUN === '1' && process.env.AGENT_WORKFORCE_SETUP_GUIDE !== 'on';
  const enabled = deps.enabled !== undefined ? deps.enabled : (FIRSTRUN_AUTOCREATE_ENABLED && !dryRun);
  // 'disabled' is what a board under AGENT_WORKFORCE_DRY_RUN=1 records (the browser checks):
  // the board's sweep is gated on FIRSTRUN_AUTOCREATE_ENABLED only, and this check stops it here.
  if (!enabled) return Promise.resolve({ seeded: false, state: 'disabled', reason: 'the automatic setup guide is switched off' });
  /* The cheap, permanent answers first: on an existing (unarmed) or already-seeded install
     the sweep then costs one stat a minute. */
  if (!isArmed() && !explicit) return Promise.resolve({ seeded: false, state: 'not-armed', reason: 'not armed (first run is not finished)' });
  if (createdHere || setupAssistantSeeded()) return Promise.resolve({ seeded: false, state: 'seeded', reason: 'already seeded' });
  if (namesTaken) return Promise.resolve({ seeded: false, state: 'names-taken', reason: 'both guide names are taken by other agents' });
  /* "Close forever" (the bubble's switch) also means: no guide agent later. */
  let wanted = true;
  try { wanted = settingFrom(deps.settings !== undefined ? deps.settings : store.readSettings()).on; } catch { wanted = true; }
  if (!wanted) return Promise.resolve({ seeded: false, state: 'off', reason: 'the person turned setup assistance off' });
  /* #4405: the person asking for it (and not switched off) arms the install, so a model connected later still makes one. */
  if (explicit) armSetupAssistant();
  const listed = listedModels(deps);
  if (!listed.rows.length) return Promise.resolve({ seeded: false, state: 'no-model', reason: 'no model connected yet' });
  const changed = failedFingerprint !== null && listed.fingerprint !== failedFingerprint;
  if (changed) { lastFailedAt = 0; failures = 0; }
  if (!explicit && via !== 'first-run' && lastFailedAt && now - lastFailedAt < retryWaitMs()) return Promise.resolve({ seeded: false, reason: 'waiting before trying again' });
  inFlight = (async () => {
    const fail = (reason, state = 'refused') => { lastFailedAt = now; failures += 1; failedFingerprint = listed.fingerprint; return { seeded: false, state, reason }; };
    try {
      let last = null;
      for (const row of listed.rows) {
        if (!(await usable(row, deps))) continue;
        const model = { provider: row.provider, account: row.account };
        /* hasConnectedAccount is already answered, more strictly, by usable() (any
           provider, create's own gate); the seed's default check is Claude-only and would
           refuse an OpenAI-only person, so it is bypassed here on purpose. */
        const seed = seedSetupAssistant({ createAgent, hasConnectedAccount: () => true, avatarDir: deps.avatarDir, model });
        if (seed && seed.seeded) {
          createdHere = true;
          markSetupAssistantSeeded({ name: seed.name, via, provider: model.provider });
          lastFailedAt = 0;
          failures = 0;
          failedFingerprint = null;
          return { ...seed, state: 'seeded' };
        }
        last = seed;
        /* Both names taken: that is about the NAME, not the model, so the next model would
           be refused the same way after paying for its live check. Stop here. */
        if (/already an agent called/.test(String((seed && seed.reason) || ''))) { namesTaken = true; break; }
        /* Refused on this model (its runner missing, say): try the next one. */
      }
      // A model listed but none usable (a dead sign-in, a failed live check) is its own gate,
      // not a refusal: nothing was asked to create.
      return fail(last ? ('not created: ' + (last.reason || 'refused')) : 'a model is listed but none could run yet',
        namesTaken ? 'names-taken' : last ? 'refused' : 'no-usable-model');
    } catch (err) {
      // An internal failure reads 'refused' on /admin like a model refusal; the reason (kept
      // locally) tells them apart.
      return fail('ensureGuide failed: ' + String((err && err.message) || err));
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/* Test seam: forget the backoff between cases. */
function resetEnsureGuideForTests() { inFlight = null; lastFailedAt = 0; failures = 0; failedFingerprint = null; createdHere = false; namesTaken = false; }

/*
 * The person's switch for the setup assistant bubble (#3034; Josh, 2026-09-24 18:02:
 * "the first time they hit the X to say close or like a close this forever function
 * ... a switch in settings somewhere for setup assistance that we tell them where it
 * is if they want to reactivate it").
 *
 * Stored in the board's settings (/api/settings), not the page's storage, for the
 * reason the tips switch (#3574) gives: page storage can come back empty, and then a
 * bubble somebody closed forever would come back.
 *   on     the Settings switch. false = "Close forever": no bubble at all.
 *   asked  the first-X choice (Close for now / Close forever) has been offered,
 *          so later closes just close.
 * The bubble, the X dialog and the Settings row are Mona's; this is only the state.
 */
const SETTING_DEFAULT = Object.freeze({ on: true, asked: false });
const SETTING_KEYS = Object.keys(SETTING_DEFAULT);

/** The stored setting with defaults filled in; anything malformed reads as the default. */
function settingFrom(stored) {
  const a = (stored && typeof stored.setupAssistant === 'object' && stored.setupAssistant) || {};
  const out = {};
  for (const k of SETTING_KEYS) out[k] = typeof a[k] === 'boolean' ? a[k] : SETTING_DEFAULT[k];
  return out;
}

/** Why a POSTed patch is refused, or null. A patch sets one or both keys, booleans only. */
function settingPatchProblem(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return 'that is not a valid setup assistant setting';
  const keys = Object.keys(patch);
  if (!keys.length) return 'that is not a valid setup assistant setting';
  for (const k of keys) {
    if (!SETTING_KEYS.includes(k)) return 'that is not a valid setup assistant setting';
    if (typeof patch[k] !== 'boolean') return 'that is not a valid setup assistant setting';
  }
  return null;
}

/** The whole setting after a valid patch, so a write of one key never drops the other. */
function mergeSetting(stored, patch) {
  const next = settingFrom(stored);
  for (const k of SETTING_KEYS) if (k in patch) next[k] = patch[k];
  return next;
}

module.exports = {
  ruleAbs,   // #4752 follow-up: exported so the Windows form is pinned from any host
  rulePath,
  rulePaths,
  readingsHoldGuide,
  legacyWinEquivalent,
  withNativeTwins,
  ruleUnwritable,
  migrateKept,
  finalDeny,
  boardCredentialPaths,
  ruleHasPatternChar,
  SETUP_ROLE_KEY,
  GUIDE_CREATED_BY,
  GUIDE_PURPOSE_PREFIXES,
  armPath,
  armSetupAssistant,
  guideDenyRules,
  guardGuideFolder,
  guardTokenOnlyFolder,
  realOrLeaf,
  refreshTokenOnlyGuards,
  launchPathDirs,
  managedSettingsPresent,
  refreshGuideGuards,
  armExistingInstall,
  listedModels,
  hostedOffered,
  hostedWhy,
  guideFailure,
  hostedConnector,
  refreshGuideRole,
  usable,
  RETRY_AFTER_MS,
  RETRY_MAX_MS,
  ensureGuide,
  resetEnsureGuideForTests,
  SETTING_DEFAULT,
  settingFrom,
  settingPatchProblem,
  mergeSetting,
  GUIDE_NAME,
  GUIDE_FALLBACK_NAME,
  GUIDE_TAG,
  GUIDE_MARKER,
  isGuideFolder,
  GUIDE_AVATAR_BASE,
  guideAvatarPath,
  refreshGuideAvatar,
  RETIRED_GUIDE_AVATARS,
  guideName,
  FIRSTRUN_AUTOCREATE_ENABLED,
  flagPath,
  setupAssistantSeeded,
  markSetupAssistantSeeded,
  defaultHasConnectedAccount,
  seedSetupAssistant,
  readGuardState,
  GUARD_STATE_FILE,
  SANDBOX_DENY_PREFIX_MAX,
  SANDBOX_DENY_RAW_MAX,
  sandboxDenySize,
};
