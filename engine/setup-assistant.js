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
function guideDenyRules(opts = {}) { return guideDenyRulesFor(opts).rules; }
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
  /* A folder whose path the rule syntax would misread (`* ? [ ] ( ) { } !`) gets no rule here: said, not guessed. */
  /* The platform's own separator is not the syntax, so it is taken out before the check. */
  const plain = (p) => { if (!RULE_SYNTAX.test(String(p).split(path.sep).join('/'))) return true; process.stderr.write(`#4752: no rule for ${p}: its path has a character the rule syntax reads as a pattern\n`); return false; };
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
      // On Windows this joins `/` onto a `\` path, as the data folder rule always has; not measured there.
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
  return { rules, entryBase, extra };
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
/* A path as a Claude Code rule spells an absolute one: two slashes, then the path without its leading slashes. */
function ruleAbs(p) { return '//' + String(p).replace(/^\/+/, ''); }
/* #4752: is `rule` one this code writes for a single entry directly in `base` (either form), for a name
   baseEntryToName lets through? Built from the same ruleAbs(path.join(...)) as the writer, so it matches on
   Windows too. */
function wasEntryRule(rule, base) {
  const prefix = `Read(${ruleAbs(path.join(base, 'x')).slice(0, -1)}`;   // the writer's own spelling, separator included
  if (!rule.startsWith(prefix) || !rule.endsWith(')')) return false;
  let name = rule.slice(prefix.length, -1);
  if (name.endsWith('/**')) name = name.slice(0, -3);
  if (!name || name.includes('/') || name.includes(path.sep)) return false;
  const worlds = require('./worlds');
  return baseEntryToName(name, worlds.WORLDS_SUBDIR, path.basename(worlds.registryPath(base)), require('./boardauth').TOKEN_FILE);
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
    const kept = fresh.entryBase ? had.filter((r) => fresh.rules.includes(r) || !wasEntryRule(r, fresh.entryBase)) : had;
    /* #4752: none of THIS change's rules (fresh.extra) may take in the guide's own folder. An older folder or a
       linked entry a person made can resolve to an ancestor of it, and the sandbox follows links, so such a rule
       would cut the guide off from its own instructions: dropped, and said. What this checks, no more: a rule
       naming one folder or file, compared by real path (a Windows rule is read with its drive letter); a rule
       with a `*` is not checked, and the rules from before #4752 are left as they were. */
    const own = realOr(dir);
    const safe = fresh.rules.filter((r) => {
      if (!fresh.extra.includes(r)) return true;
      const m = /^Read\(\/\/([^*?]*?)(\/\*\*)?\)$/.exec(r);
      if (!m) return true;
      const target = realOr(/^[A-Za-z]:/.test(m[1]) ? m[1] : '/' + m[1]);   // a Windows rule keeps its drive
      if (own !== target && !own.startsWith(target.endsWith(path.sep) ? target : target + path.sep)) return true;
      process.stderr.write(`#4752: a rule that would take in the guide's own folder was left out: ${r}\n`);
      return false;
    });
    /* A refused rule is kept out of the earlier rules too, or a rule written on an earlier start would come back. */
    const refused = new Set(fresh.rules.filter((r) => !safe.includes(r)));
    const deny = [...new Set([...kept, ...safe])].filter((r) => !refused.has(r));
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
 * throw here must degrade to current-store coverage, never fail the guard (which would fail agent
 * creation). The guide lets these throw because it denies the whole root; here the token is the point,
 * and partial coverage beats no agent. Concrete paths only -- the guide's version-dependent mid-path
 * glob for every named world's store (cross-world tokens) is NOT mirrored; that residual is in the plan.
 */
function tokenOnlyTokenRoots(dataRoot, home, deps = {}) {
  const roots = [dataRoot];
  const add = (r) => { if (r && typeof r === 'string' && !roots.includes(r)) roots.push(r); };
  try { const lr = deps.legacyRoots !== undefined ? deps.legacyRoots : guideLegacyRoots(home); if (Array.isArray(lr)) lr.forEach(add); } catch { /* current store only */ }
  try {
    const base = deps.worldsBase !== undefined ? deps.worldsBase : guideWorldsBase();
    if (base && base !== dataRoot) add(base);   // the default world's base, when this agent is in a named world
  } catch { /* current store only */ }
  return roots;
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
  const tokenRoots = tokenOnlyTokenRoots(dataRoot, home, deps);
  const tokenPaths = tokenRoots.map((r) => path.join(r, tokenFile));
  const tokenTmps = tokenRoots.map((r) => path.join(r, '.' + tokenFile));
  /* #4475: every agent's sender-token files. A token-only agent's own token comes in its environment
     (KOSMOS_AGENT_TOKEN, minted by the supervisor before launch); another agent's token read from this folder would
     let this agent act as that agent, including removing the agents that one made. ONE THING IT COSTS: the Mac CLI's
     outbox keep (a send made while another Kosmos is the one open, answered 421) resolves the sender by reading this
     folder (engine/outbox.js resolveKeepSender), so for a token-only agent that send is refused, not kept. */
  const senderTokenDirs = tokenRoots.map((r) => path.join(r, 'sendertokens'));
  /* And the supervisor's launch hand-off, where each agent's token waits in a file until its pane starts. The
     supervisor writes it under ${AGENT_WORKFORCE_DATA:-$_app}/launch-secrets, and an installed supervisor's $_app is
     the data root (create.supervisorPath is <data root>/bin/agent-supervisor.sh). The pane entry reads it before this
     agent's sandbox exists. NOT closed here: another agent's token in its process environment (`ps -E` as the same
     Mac user), and typing into another agent's tmux pane. */
  const appRoot = deps.appRoot || path.resolve(__dirname, '..');
  const launchSecretDirs = [...new Set([
    ...tokenRoots.map((r) => path.join(r, 'launch-secrets')),                  // the installed supervisor: its $_app is the data root
    ...tokenRoots.map((r) => path.join(path.dirname(r), 'launch-secrets')),    // AGENT_WORKFORCE_DATA (a named world)
    path.join(appRoot, 'launch-secrets'),                                      // a supervisor run from the app folder itself
  ])];
  /* #4475: and the records the board trusts about who made and who ended which agent, written only by the board and
     the supervisor (outside this sandbox): a token-only agent that could write them could forge a birth naming itself
     the creator, erase an ended identity, list itself token-only or not, or plant a token for another name. */
  const trustedFiles = tokenRoots.flatMap((r) => ['created.jsonl', 'ended-agents.jsonl', 'agent-token-only.json'].map((f) => path.join(r, f)));
  // Concrete config homes get a denyWrite on their settings FILES (not the whole dir: a config home holds
  // Claude Code's own runtime state, so a dir-level denyWrite there would break normal operation).
  const concreteHomes = accountConfigHomes(home);
  const settingsFileDirs = [settingsDir, ...concreteHomes];
  const settingsFiles = settingsFileDirs.flatMap((d) => [path.join(d, 'settings.json'), path.join(d, 'settings.local.json')]);
  // Permission-layer Edit denies: the concrete homes above, plus a ~/.claude-* glob for a home made later.
  const editTargets = [...settingsFiles.map((p) => ({ f: p })), { f: path.join(home, '.claude-*', 'settings.json') }, { f: path.join(home, '.claude-*', 'settings.local.json') }];
  const deny = [
    ...tokenPaths.map((p) => `Read(${ruleAbs(p)})`),
    ...tokenTmps.map((p) => `Read(${ruleAbs(p)}.*)`),
    ...senderTokenDirs.map((p) => `Read(${ruleAbs(p)}/**)`),
    ...launchSecretDirs.map((p) => `Read(${ruleAbs(p)}/**)`),
    ...senderTokenDirs.map((p) => `Edit(${ruleAbs(p)}/**)`),
    ...trustedFiles.map((p) => `Edit(${ruleAbs(p)})`),
    ...editTargets.map((t) => `Edit(${ruleAbs(t.f)})`),
  ];
  return { deny, settingsDir, tokenPaths, tokenTmps, senderTokenDirs, launchSecretDirs, trustedFiles, settingsFiles };
}

/*
 * #4491: write a token-only agent's <folder>/.claude/settings.json so a sandboxed shell in it cannot
 * read board.token and cannot turn its own guard off, while its normal work (its own data folder, the
 * loopback board, the network) still works. Mirrors guardGuideFolder's read-merge-write (preserve a
 * person's own rules, idempotent, never throw, tmp+rename). On macOS (where Claude Code's sandbox is
 * Seatbelt and this was measured) the sandbox block applies the same deny paths to every subprocess;
 * the filesystem.denyWrite is what stops a shell `printf > settings.json` that the permission Edit-deny
 * alone does not (measured, this branch's spike arm 3). It denies the AGENT's own .claude DIR (safe:
 * Claude Code writes no runtime state there) but only the specific settings FILES under the config home
 * ~/.claude (NOT the whole dir: that holds Claude Code's own session/config state, so a dir-level
 * denyWrite there would break normal operation). The board.token temp copy and the ~/.claude-* account
 * variants are covered by the permission-layer Read/Edit denies above, which Seatbelt translates to
 * subprocesses (measured for the guide: its permission Read-glob blocked a subprocess read with EPERM);
 * the sandbox filesystem list carries the concrete paths only. allowUnsandboxedCommands false stops a
 * refused command being re-run with dangerouslyDisableSandbox (every Kosmos agent runs
 * --dangerously-skip-permissions); allowLocalBinding true keeps the loopback board reachable.
 *
 * DEFENSE-IN-DEPTH, honestly: a fully durable lock needs this block in root-owned MANAGED settings (an
 * admin step, parked on the card as needs-operator); without it this raises the bar but a determined
 * agent on the same Mac user is not fully shut out (a hardlink of the token outside the denied path is
 * the residual). refreshTokenOnlyGuards warns when the managed belt is absent.
 * { ok: true } | { ok: false, because }. Never throws.
 */
function guardTokenOnlyFolder(dir, agentName, deps = {}) {
  try {
    if (!dir || !agentName) return { ok: false, because: 'no folder' };
    const settingsDir = path.join(dir, '.claude');
    fs.mkdirSync(settingsDir, { recursive: true });
    const file = path.join(settingsDir, 'settings.json');
    let cur = {};
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) cur = parsed;
    } catch { cur = {}; }
    const rules = tokenOnlySettingsRules(dir, deps);
    const perms = cur.permissions && typeof cur.permissions === 'object' && !Array.isArray(cur.permissions) ? cur.permissions : {};
    const had = Array.isArray(perms.deny) ? perms.deny.filter((r) => typeof r === 'string') : [];
    const deny = [...new Set([...had, ...rules.deny])];
    const next = { ...cur, permissions: { ...perms, deny } };
    if ((deps.platform || process.platform) === 'darwin') {
      const sb = cur.sandbox && typeof cur.sandbox === 'object' && !Array.isArray(cur.sandbox) ? cur.sandbox : {};
      const net = sb.network && typeof sb.network === 'object' && !Array.isArray(sb.network) ? sb.network : {};
      const fsb = sb.filesystem && typeof sb.filesystem === 'object' && !Array.isArray(sb.filesystem) ? sb.filesystem : {};
      const dr = Array.isArray(fsb.denyRead) ? fsb.denyRead.filter((x) => typeof x === 'string') : [];
      const dw = Array.isArray(fsb.denyWrite) ? fsb.denyWrite.filter((x) => typeof x === 'string') : [];
      // Canonicalize the paths: Seatbelt matches resolved paths, so a symlinked data dir or
      // /var -> /private/var would otherwise slip a denyRead/denyWrite (the guide realOr's its own
      // folder for the same reason). The token files and the home settings files often do not exist
      // yet, so use realOrLeaf (resolves the existing parent, keeps the absent leaf) rather than realOr,
      // which would leave a symlinked parent un-followed. The agent's own .claude was just mkdir'd, so
      // realOr resolves it directly.
      const denyReadPaths = [...rules.tokenPaths, ...rules.senderTokenDirs, ...rules.launchSecretDirs].map(realOrLeaf);
      const denyWritePaths = [realOr(rules.settingsDir), ...rules.settingsFiles.map(realOrLeaf), ...rules.senderTokenDirs.map(realOrLeaf), ...rules.trustedFiles.map(realOrLeaf)];
      next.sandbox = {
        ...sb, enabled: true, autoAllowBashIfSandboxed: true, allowUnsandboxedCommands: false,
        network: { ...net, allowLocalBinding: true },
        filesystem: {
          ...fsb,
          denyRead: [...new Set([...dr, ...denyReadPaths])],
          denyWrite: [...new Set([...dw, ...denyWritePaths])],
        },
      };
    }
    const tmp = `${file}.${process.pid}.new`;
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n', 'utf8');
    fs.renameSync(tmp, file);
    return { ok: true };
  } catch (err) {
    return { ok: false, because: String((err && err.message) || err) };
  }
}

/* #4491: Claude Code's root-owned managed-settings file on macOS. Its presence makes the token-only
   guard durable: only managed settings may relax the sandbox, and the agent's uid cannot write this
   path, so a listed agent cannot disable its own guard through it. Installing it is an admin step,
   parked on the card; this code only READS whether it is there, to warn when it is not. */
const MANAGED_SETTINGS_PATH = '/Library/Application Support/ClaudeCode/managed-settings.json';
function managedSettingsPresent(platform = process.platform) {
  if (platform !== 'darwin') return false;   // managed-settings is a macOS/Seatbelt concept here
  try { return fs.existsSync(MANAGED_SETTINGS_PATH); } catch { return false; }
}

/* #4491: at board start, guard every agent currently listed in agent-token-only.json, so a pilot listed
   before this shipped (echo) is guarded from its next session without a re-create. Warns (once per board
   start, no cross-start dedup) when the root-owned managed belt is absent (the durable close is the
   parked admin step). workerDir is overridable for tests. { guarded: [names], managed: boolean }. Never throws. */
function refreshTokenOnlyGuards(deps = {}) {
  const platform = deps.platform || process.platform;
  const out = { guarded: [], managed: managedSettingsPresent(platform) };
  let names;
  try { names = require('./sendertoken').tokenOnlyList(); } catch { return out; }   // one parse site (#4491)
  const toDir = deps.workerDir || create.workerDir;
  for (const name of names) {
    let dir = null;
    try { dir = toDir(name); } catch { dir = null; }
    if (dir && guardTokenOnlyFolder(dir, name, deps).ok) out.guarded.push(name);
  }
  // The managed-belt warning is a macOS-only concern: off darwin no sandbox block is written and
  // managed-settings does not apply, so warning there would be misleading.
  if (names.length && platform === 'darwin' && !out.managed) {
    process.stderr.write('#4491: ' + names.length + ' token-only agent(s) guarded by per-agent settings only; the root-owned managed-settings belt is absent, so the guard is defense-in-depth (see card #4491).\n');
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
};
