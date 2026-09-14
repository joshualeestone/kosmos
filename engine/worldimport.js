'use strict';

/**
 * Bringing agents from one Kosmos into another (#2563, #1704 PR4; plan
 * world-import-agents-1704).
 *
 * Josh: "when I'm creating the new KOSMOS, I can add agents to it that are my
 * existing agents from another KOSMOS right there when I create it. Or I can just
 * skip and not add any. I can always get back to that pane if I go to the little
 * settings cog next to that particular KOSMOS."
 *
 * 🔑 ONE AGENT AT A TIME, AND EACH ONE IS A COMPLETE COPY. For every agent picked:
 * its profile (with a fresh identity and WITHOUT its working `dir`), its avatar,
 * and its brief (CLAUDE.md, or AGENTS.md for a codex agent) land in the target
 * Kosmos's own store and in a new folder of its own there. The source is only ever
 * read. The copy is a separate agent: it mints its own id on its first profile
 * write, and its launch identity is keyed by the target world
 * (launchidentity.launchKey), so it can never share a task, label or session with
 * the agent it was copied from.
 *
 * 🔑 ALL OR NOTHING, PER AGENT. The folder, the brief, the avatar and the profile
 * are written in that order, and the start record last. A failure at any step takes
 * back out what THIS import wrote for that agent and refuses it with a sentence.
 * An agent is never half copied, and never copied with nothing set to start it.
 *
 * 🔑 IT STARTS WHEN ITS KOSMOS OPENS, THROUGH engine/worldstarts. This module only
 * RECORDS the start (with the runner, model and account read from the source's own
 * job, because the target has no job to read them from). The route then starts it
 * at once if the target is the open Kosmos, or leaves it for that Kosmos's boot --
 * both through worldstarts.
 * Nothing here starts, trusts or touches a job.
 *
 * ⚠️ NOT IN worlds.js, ON PURPOSE. worlds.js is required by engine/worldenv before
 * any world's roots are applied, and this module needs create/remove/worldstarts,
 * which freeze store.ROOT at require. server.js requires this after worldenv.
 */

const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');
const worlds = require('./worlds');
const create = require('./create');
const remove = require('./remove');
const worldstarts = require('./worldstarts');
const projects = require('./projects');   // the managed projects section's own remover
const reports = require('./reports');     // the "Who you report to" section's own body

/* The most agents one request may add (review round 1). The copy runs inside the
   request, one agent after another, so this bounds one request's work. A person's
   Kosmos holds a few dozen agents at most; 100 leaves room for that and refuses a
   runaway list with a sentence rather than grinding through it. */
const MAX_IMPORT_PICKS = 100;
function tooManyBecause() { return `add at most ${MAX_IMPORT_PICKS} agents at a time`; }

/* ── what can be offered ─────────────────────────────────────────────────── */

/* The sentence for an agent whose name cannot become a job in another Kosmos. */
function badNameBecause() { return 'its name cannot be used to start it in another Kosmos'; }

/**
 * The agents of `world` a person can pick, `[{name, displayName, because}]`, one
 * per profile in its store. `because` is null for an agent that can be added and
 * the plain reason otherwise (the picker shows it, disabled). Agents the person
 * REMOVED from that Kosmos are left out entirely: to them those agents are gone,
 * and offering them would bring back what removal promised was gone. A removed
 * list that cannot be read hides nothing (the board's own posture); the import
 * itself refuses on it.
 */
function importableAgents(base, world) {
  const removed = remove.removedNamesIn(worlds.worldStoreRoot(base, world));
  const gone = new Set(removed.ok ? removed.names : []);
  const out = [];
  for (const name of worlds.worldProfileNames(base, world)) {
    if (gone.has(name)) continue;
    let prof = null;
    try { prof = JSON.parse(fs.readFileSync(path.join(worlds.worldProfilesDir(base, world), store.profileFileName(name)), 'utf8')); }
    catch { prof = null; }
    const shown = prof && typeof prof.displayName === 'string' && prof.displayName.trim() ? prof.displayName.trim() : name;
    let because = null;
    if (!prof || typeof prof !== 'object') because = 'we could not read it';
    else if (!create.NAME_RE.test(name)) because = badNameBecause();
    out.push({ name, displayName: shown, because });
  }
  return out;
}

/**
 * Every Kosmos, with the agents a person can pick from it and the agents waiting
 * to start in it: what the New Kosmos step and the settings pane both draw from.
 * `agentCount` is the number of agents SHOWN, so the "Client work (2 agents)"
 * label and the boxes beneath it can never disagree.
 */
function listForPicker(base) {
  return worlds.listWorlds(base).map((w) => {
    const agents = importableAgents(base, w);
    /* A waiting agent's profile is already in this Kosmos, so its display name is
       too: the pane speaks it rather than the machine name. */
    const shown = new Map(agents.map((a) => [a.name, a.displayName]));
    return {
      id: w.id,
      name: w.name,
      agentCount: agents.length,
      agents,
      waiting: worldstarts.importsWaitingIn(worlds.worldStoreRoot(base, w))
        .map((x) => ({ ...x, displayName: shown.get(x.name) || x.name })),
    };
  });
}

/* ── the request ─────────────────────────────────────────────────────────── */

/**
 * The picks a request asks for, validated. `importAgents: [{from, name}]` is the
 * form: one entry per agent. `importAgentsFrom: [worldId]` is the form a page
 * loaded before this change sends (a whole Kosmos per id), and it means every
 * agent that Kosmos holds (removed ones excepted). EVERY one becomes a pick, the
 * unofferable ones included, so copyOne refuses those with their sentence rather
 * than their dropping out unmentioned (review round 1); `legacy: true` tells the
 * route to answer in the counts that page reads. Neither present is no import.
 * More than MAX_IMPORT_PICKS picks is refused. Returns `{ok: true, picks,
 * legacy?}` or `{ok: false, because}`.
 */
function picksFromBody(base, body) {
  const b = body || {};
  if (b.importAgents !== undefined) {
    const list = b.importAgents;
    const wellFormed = Array.isArray(list) && list.every((p) => p && typeof p.from === 'string' && p.from.trim()
      && typeof p.name === 'string' && p.name.trim());
    if (!wellFormed) return { ok: false, because: 'say which agents to add, each as the Kosmos it is in and its name' };
    if (list.length > MAX_IMPORT_PICKS) return { ok: false, because: tooManyBecause() };
    return { ok: true, picks: list.map((p) => ({ from: p.from.trim(), name: p.name.trim() })) };
  }
  if (b.importAgentsFrom !== undefined) {
    const ids = b.importAgentsFrom;
    if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string')) {
      return { ok: false, because: 'say which Kosmoses to add agents from' };
    }
    const known = worlds.listWorlds(base);
    const picks = [];
    for (const id of new Set(ids)) {
      const w = known.find((x) => x.id === id);
      if (!w) { picks.push({ from: id, name: null }); continue; }   // refused below, as an unknown Kosmos
      for (const a of importableAgents(base, w)) picks.push({ from: id, name: a.name });
    }
    if (picks.length > MAX_IMPORT_PICKS) return { ok: false, because: tooManyBecause() };
    return { ok: true, picks, legacy: true };
  }
  return { ok: true, picks: [] };
}

/* ── the copy ────────────────────────────────────────────────────────────── */

/**
 * The runner, model and account the source agent starts with, read from its own
 * job in ITS Kosmos (the target has none yet). A readable job decides the runner,
 * as it decides the model and the account: the job is what actually starts the
 * agent, so it outranks the profile's record (create.recordedRunner's own order).
 * With no readable job, the profile's `provider` is the fallback for the runner --
 * the answer register.repair uses -- and model and account stay unset, which
 * installJob then says out loud (its `guessed`) rather than inventing.
 */
function launchSpecOf(name, sourceWorldId, profile, platform) {
  /* ONE read for both platforms (win32-agent-job-read): create.readJob follows the
     injected platform, a plist on the Mac and the Scheduled Task on Windows, keyed
     by the source world either way. This used to carry its own taskSpec arm, and
     its Mac arm dropped `platform`, so a Mac import driven from a Windows host read
     that host's Task Scheduler. */
  const job = create.readJob(name, sourceWorldId, platform);
  if (job) {
    return { runner: job.runner === 'codex' ? 'codex' : 'claude', model: job.model || null, configDir: job.configDir || null };
  }
  return { runner: profile && profile.provider === 'openai' ? 'codex' : 'claude', model: null, configDir: null };
}

/* Review round 3 (5): one stderr line for a refusal that came from an ERROR -- not
   an ordinary refusal such as a name already taken -- with which import, which step,
   the error code and the path it concerned, so it can be traced from the log alone.
   Never the brief's words, the picture's bytes, or the account folder a job carries. */
function logImportError(ctx, step, err, where) {
  process.stderr.write(`Kosmos import refused: source=${ctx.src.id} target=${ctx.dst.id} name=${ctx.name} step=${step}`
    + ` code=${(err && err.code) || 'unknown'}${where ? ` path=${where}` : ''}\n`);
}

/* Take back out what this import wrote for one agent, newest first. Only paths it
   created are ever listed, so this can never remove something that was there. A
   removal that fails (on Windows, an antivirus or indexer holding the file: EBUSY,
   EPERM) is SAID, with the path, never swallowed: what it leaves behind holds the
   name, and the next try refuses naming that path (review round 3, item 3). */
function undo(made, ctx) {
  for (const p of made.slice().reverse()) {
    try { fs.rmSync(p.path, { recursive: p.dir === true, force: true }); }
    catch (err) { logImportError(ctx, 'rollback', err, p.path); }
  }
}

/**
 * Copy one agent from `src` into `dst`, completely, or refuse. Returns
 * `{ok: true, displayName}` or `{ok: false, because}`.
 */
function copyOne(base, src, dst, name, opts) {
  const env = opts.env || process.env;
  const platform = opts.platform || process.platform;
  if (!create.NAME_RE.test(name)) return { ok: false, because: badNameBecause() };

  const ctx = { src, dst, name };
  const removed = remove.removedNamesIn(worlds.worldStoreRoot(base, src));
  if (!removed.ok) {
    logImportError(ctx, 'source-removed-list', null, worlds.worldStoreRoot(base, src));
    return { ok: false, because: `we could not check whether it was removed from ${src.name}` };
  }
  if (removed.names.includes(name)) return { ok: false, because: `it was removed from ${src.name}` };

  const fileName = store.profileFileName(name);
  const sourceProfile = path.join(worlds.worldProfilesDir(base, src), fileName);
  let profile;
  try {
    profile = JSON.parse(fs.readFileSync(sourceProfile, 'utf8'));
  } catch (err) {
    if (err && err.code === 'ENOENT') return { ok: false, because: `we could not find it in ${src.name}` };
    logImportError(ctx, 'source-profile', err, sourceProfile);
    return { ok: false, because: `we could not read it in ${src.name}` };
  }
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return { ok: false, because: `we could not read it in ${src.name}` };

  const spec = launchSpecOf(name, src.id, profile, platform);
  const briefName = create.briefFilename(spec.runner);
  const sourceFolder = create.usableRecordedDir(profile.dir) || path.join(worlds.worldWorkersDir(base, src, env), name);
  const sourceBrief = path.join(sourceFolder, briefName);
  let brief;
  try {
    /* Review round 3 (1): the Kosmos-managed PROJECTS section does not come along.
       It lists the SOURCE Kosmos's project folders and `kosmos post/task` ids the
       target does not have, so the copy would work in, and post to, another
       Kosmos's projects. projects.removeBlock is that section's own remover; the
       target's project sync writes it again once the copy joins a project there. */
    brief = projects.removeBlock(fs.readFileSync(sourceBrief, 'utf8'));
  } catch (err) {
    logImportError(ctx, 'source-brief', err, sourceBrief);
    return { ok: false, because: `we could not read its instructions in ${src.name}` };
  }
  const sourceAvatar = store.avatarPathIn(worlds.worldAvatarsDir(base, src), name);

  /* Nothing is overwritten, ever: a profile, a folder or a picture under this name
     in the target means the name is taken there. */
  const profilesDir = worlds.worldProfilesDir(base, dst);
  const avatarsDir = worlds.worldAvatarsDir(base, dst);
  const folder = path.join(worlds.worldWorkersDir(base, dst, env), name);
  const profileFile = path.join(profilesDir, fileName);
  const taken = `${dst.name} already has an agent called ${name}`;
  if (fs.existsSync(profileFile) || store.avatarPathIn(avatarsDir, name)) return { ok: false, because: taken };
  if (fs.existsSync(folder)) {
    /* Review round 3 (3): a folder with no agent behind it -- most often what an
       earlier import's rollback could not remove. Said as what it is, and where, so
       the person can see why the name is held and clear it. */
    return { ok: false, because: `${dst.name} already has a folder called ${name} (${folder}) with no agent behind it; if an earlier import left it there, remove it and try again` };
  }
  /* Review round 1 (A): a name the person REMOVED from the target is taken there
     too, profile or not. Copied in, the start would find it on the removed list,
     clear it and start nothing, and the copy would sit hidden behind an "Added". */
  const removedThere = remove.removedNamesIn(worlds.worldStoreRoot(base, dst));
  if (!removedThere.ok) {
    logImportError(ctx, 'target-removed-list', null, worlds.worldStoreRoot(base, dst));
    return { ok: false, because: `we could not check whether ${dst.name} has a removed agent called ${name}` };
  }
  if (removedThere.names.includes(name)) {
    return { ok: false, because: `${dst.name} has a removed agent called ${name}; restore that one there instead` };
  }
  /* Review round 1 (B): so is a name the target already has a launch job for,
     under the target's own world key. The start would find that job and run it --
     its old folder, model and account -- instead of the copy. Asked through
     create.jobPresence, the one answer to "does this name have a job", in the
     target's world; an answer it could not get refuses rather than guesses. */
  const job = create.jobPresence(name, platform, dst.id);
  if (job === 'unknown') {
    logImportError(ctx, 'target-job', null, null);
    return { ok: false, because: `we could not check whether anything is already set to start as ${name} in ${dst.name}` };
  }
  /* Review round 3 (B): and whatever else main's ONE rule for "which jobs does
     this name have" (remove.jobFor) finds in the target's world: the legacy
     `com.<name>.discord` job, which it offers in the default Kosmos only. Asked of
     that rule rather than re-stated here, so the two can never disagree. */
  if (job === 'yes' || remove.jobFor(name, platform, dst.id)) {
    return { ok: false, because: `${dst.name} already has something set to start as ${name}` };
  }

  const made = [];
  try {
    fs.mkdirSync(path.dirname(folder), { recursive: true });
    fs.mkdirSync(folder);   // not recursive: it fails if the folder appeared meanwhile
    made.push({ path: folder, dir: true });
    fs.writeFileSync(path.join(folder, briefName), brief, { flag: 'wx' });
    if (sourceAvatar) {
      fs.mkdirSync(avatarsDir, { recursive: true });
      const avatarCopy = path.join(avatarsDir, path.basename(sourceAvatar));
      try {
        fs.copyFileSync(sourceAvatar, avatarCopy, fs.constants.COPYFILE_EXCL);
      } catch (err) {
        /* Review round 3 (4): a copy that failed partway may have left a partial
           picture, which is OURS to take back out. EEXIST means the file at that
           path is someone else's, and it stays. */
        if (!err || err.code !== 'EEXIST') made.push({ path: avatarCopy });
        throw err;
      }
      made.push({ path: avatarCopy });
    }
    /* A separate agent: store.stripIdentity drops exactly the fields writeProfile
       mints (store owns that set), and `dir` goes because it points at the SOURCE
       agent's folder -- kept, the copy would work in the other agent's folder. */
    const copy = store.stripIdentity({ ...profile });
    delete copy.dir;
    /* Review round 3: where it came from, by the SOURCE's own identity (its profile
       `id`, read before the strip above, which works on a copy of the object).
       The only link a later import has back to this agent -- see store.IMPORTED_FROM_KEY. */
    copy[store.IMPORTED_FROM_KEY] = { kosmos: src.id, id: typeof profile.id === 'string' && profile.id ? profile.id : null };
    fs.mkdirSync(profilesDir, { recursive: true });
    const tmp = `${profileFile}.${process.pid}.tmp`;
    made.push({ path: tmp });
    fs.writeFileSync(tmp, JSON.stringify(copy, null, 2));
    if (fs.existsSync(profileFile)) { const e = new Error('taken'); e.code = 'EEXIST'; throw e; }
    fs.renameSync(tmp, profileFile);
    made.push({ path: profileFile });
  } catch (err) {
    undo(made, ctx);
    if (err && err.code === 'EEXIST') return { ok: false, because: taken };
    logImportError(ctx, 'copy', err, err && err.path);
    return { ok: false, because: `we could not copy it into ${dst.name} (${(err && err.code) || 'unknown'})` };
  }

  const recordAt = worlds.worldStoreRoot(base, dst);
  const noted = worldstarts.recordImport(recordAt, {
    name, from: src.id, runner: spec.runner, model: spec.model, configDir: spec.configDir,
  });
  if (!noted.ok) {
    undo(made, ctx);
    logImportError(ctx, 'record', noted, worldstarts.recordFileIn(recordAt));
    return { ok: false, because: `${noted.because}, so it was not added` };
  }
  return {
    ok: true,
    displayName: typeof profile.displayName === 'string' && profile.displayName.trim() ? profile.displayName.trim() : name,
    // For settleManagers, after every pick is in.
    profileFile, briefFile: path.join(folder, briefName), reportsTo: profile.reportsTo,
  };
}

/* The one key a provenance pair is matched by: which Kosmos, and which agent there. */
function originKey(kosmos, id) { return `${kosmos} ${id}`; }

/* Point one copy's `reportsTo` at `managerHere` (a name in the target, or null for
   the person), and write its "Who you report to" section again from that record. */
function rewriteManager(c, managerHere) {
  const profile = JSON.parse(fs.readFileSync(c.profileFile, 'utf8'));
  profile.reportsTo = managerHere;
  const tmp = `${c.profileFile}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(profile, null, 2));
  fs.renameSync(tmp, c.profileFile);
  const text = fs.readFileSync(c.briefFile, 'utf8');
  if (text.includes(reports.START)) {
    fs.writeFileSync(c.briefFile, projects.spliceBlock(text, reports.blockBody(profile), reports.START, reports.END), 'utf8');
  }
}

/**
 * Review round 3 (2), made exact: a copy keeps its manager when that manager is in
 * the target AS THE SAME AGENT, and only then. `reportsTo` holds the manager's
 * machine name in the SOURCE Kosmos, and a bare name proves nothing in another one
 * (a different agent may share it). So the match is by the manager's source
 * identity -- its profile `id` -- which every copy records as `importedFrom`:
 *   (a) the manager was copied in this same request, from the same Kosmos: kept;
 *   (b) the target already holds a copy whose `importedFrom` is {that Kosmos, that
 *       id} and which is not removed there (Mara imported yesterday, Rook today):
 *       pointed at that copy's name;
 *   (c) otherwise cleared (`reportsTo: null`) and the section rewritten, so it names
 *       the person. A same-name agent with no matching provenance stays a stranger.
 * ONE function, reached by both the create route and the settings route through
 * importAgents. A failure here is logged; the copy stands.
 */
function resolveManagers(base, known, dst, copiedHere) {
  if (!copiedHere.some((c) => typeof c.reportsTo === 'string' && c.reportsTo.trim())) return;
  const removed = remove.removedNamesIn(worlds.worldStoreRoot(base, dst));
  const gone = new Set(removed.ok ? removed.names : []);
  /* Every target agent per provenance pair -- ALL of them, not the last one read
     (review round 4): two copies claiming the same source agent (made by hand, or
     by a tool outside Kosmos) leave no way to tell which one is that manager, so
     such a match is AMBIGUOUS and resolves like no match at all (rule c), rather
     than by whichever name happened to sort last. */
  const hereByOrigin = new Map();
  for (const name of worlds.worldProfileNames(base, dst)) {
    if (gone.has(name)) continue;
    let p = null;
    try { p = JSON.parse(fs.readFileSync(path.join(worlds.worldProfilesDir(base, dst), store.profileFileName(name)), 'utf8')); }
    catch { p = null; }
    const from = p && p[store.IMPORTED_FROM_KEY];
    if (from && typeof from.kosmos === 'string' && typeof from.id === 'string' && from.id) {
      const key = originKey(from.kosmos, from.id);
      hereByOrigin.set(key, (hereByOrigin.get(key) || []).concat([name]));
    }
  }
  for (const c of copiedHere) {
    const managerName = typeof c.reportsTo === 'string' ? c.reportsTo.trim() : '';
    if (!managerName) continue;
    /* (a) Came along in this request. Provenance (b) would find such a manager too
       when its source profile has an `id` -- but one written without the store
       (never minted) has none, and then only this request's own knowledge can keep
       the line. */
    if (copiedHere.some((x) => x.from === c.from && x.name === managerName)) continue;   // (a)
    const src = known.find((w) => w.id === c.from);
    let managerId = null;
    try {
      const mp = JSON.parse(fs.readFileSync(path.join(worlds.worldProfilesDir(base, src), store.profileFileName(managerName)), 'utf8'));
      managerId = mp && typeof mp.id === 'string' && mp.id ? mp.id : null;
    } catch { managerId = null; }
    const matches = managerId ? (hereByOrigin.get(originKey(c.from, managerId)) || []) : [];
    const managerHere = matches.length === 1 ? matches[0] : null;   // (b); none or ambiguous -> (c)
    if (managerHere === managerName) continue;
    try { rewriteManager(c, managerHere); }                                                            // (c), or (b) renamed
    catch (err) { logImportError({ src: { id: c.from }, dst, name: c.name }, 'manager', err, c.profileFile); }
  }
}

/**
 * Copy the picked agents into the Kosmos `targetId`. Every pick is copied or
 * refused with a sentence; one refusal never stops the others.
 * Returns `{ok: false, code: 'ENOWORLD'}` for a target that does not exist, or
 * `{ok: true, world, copied: [{from, name, displayName}], refused: [{from, name, because}],
 * unknownSources}` (how many refusals were for a Kosmos that does not exist, which
 * the legacy answer counts apart). Starting them is the caller's (see the header).
 */
function importAgents(base, targetId, picks, opts = {}) {
  const known = worlds.listWorlds(base);
  const world = known.find((w) => w.id === targetId);
  if (!world) return { ok: false, code: 'ENOWORLD' };
  const copied = [];
  const refused = [];
  const claimed = new Set();
  const copiedHere = [];
  let unknownSources = 0;
  for (const pick of picks || []) {
    const from = pick && pick.from;
    const name = pick && pick.name;
    const src = known.find((w) => w.id === from);
    if (!src) {
      unknownSources += 1;
      refused.push({ from, name, because: 'there is no Kosmos with that id on this machine' });
      continue;
    }
    if (src.id === world.id) { refused.push({ from, name, because: `it is already in ${world.name}` }); continue; }
    if (claimed.has(name)) {
      refused.push({ from, name, because: `another agent called ${name} is already being added to ${world.name}` });
      continue;
    }
    const r = copyOne(base, src, world, String(name), opts);
    if (!r.ok) { refused.push({ from, name, because: r.because }); continue; }
    claimed.add(name);
    copied.push({ from, name, displayName: r.displayName });
    copiedHere.push({ from, name, profileFile: r.profileFile, briefFile: r.briefFile, reportsTo: r.reportsTo });
  }
  resolveManagers(base, known, world, copiedHere);
  return { ok: true, world, copied, refused, unknownSources };
}

module.exports = { MAX_IMPORT_PICKS, importableAgents, listForPicker, picksFromBody, importAgents };
