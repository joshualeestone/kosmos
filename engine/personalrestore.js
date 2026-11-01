'use strict';
/**
 * kosmos#7404 slice D: a personal backup's files back on this computer, into a new Kosmos of their own. No screen yet,
 * and nothing turns it on: it needs a personal backup on this computer, and the routes need the switch on Kosmos+.
 *
 *   listBackups()          the person's snapshots, newest first, from POST /v1/org/backup/mine/manifests
 *   restoreFiles(pick)     one snapshot, by its manifest key: a new world (engine/restoreworld.js), a private sink
 *                          (engine/restoresink.js), read grants from mine/read (engine/restorefetch.js) and the run
 *                          itself (engine/restorerun.js) under the member proof, then the files moved into the world.
 *
 * The member key stays on this computer. A manifest proves itself to it (backupformat.openManifestByProof), so Kosmos+
 * can hide a snapshot from the list and cannot supply one. `trust: 'member-proof'` is set here and only here, for the
 * org personalbackup.js holds; a company's manifest given this trust carries no proof and is refused.
 *
 * One restore at a time in this process. Restored agents stay stopped: nothing here enables one, and restoreworld's
 * review is what offers them. Never throws: { ok: true, ... } or { ok: false, because, code? }.
 *
 * Not here: a screen and its routes; running this off the board's event loop, which the route must do (the sink's writes
 * and restoreworld's finish are synchronous, so restoreFiles belongs in a child process); carrying on a restore that
 * stopped part way (the sink keeps its record, so a later slice can); and a snapshot sealed under another epoch's key for
 * some of its chunks (refused by restorefetch).
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const { openManifestByProof } = require('./backupformat');

const MANIFESTS_ROUTE = '/v1/org/backup/mine/manifests';
const READ_ROUTE = '/v1/org/backup/mine/read';
// mac-request carries 64 KiB (kosmos-relay crates/tunnel/src/coordinator.rs): about 400 keys at the ids Kosmos+ makes,
// fewer at longer ones, so the batch comes from the key's length. Room is left for the body's own fields and a key.
const MAC_BODY_BYTES = 64 * 1024;
const batchFor = (key) => Math.min(400, Math.floor((MAC_BODY_BYTES - key.length - 64) / (key.length + 3)));
// Room left on the disk after a restore, so a large one cannot fill it.
const DISK_MARGIN_BYTES = 2 * 1024 * 1024 * 1024;

const deps = (opts) => ({
  personalbackup: opts.personalbackup || require('./personalbackup'),
  personalbackupkey: opts.personalbackupkey || require('./personalbackupkey'),
  restorerun: opts.restorerun || require('./restorerun'),
  restorefetch: opts.restorefetch || require('./restorefetch'),
  restoreworld: opts.restoreworld || require('./restoreworld'),
  restoresink: opts.restoresink || require('./restoresink'),
  worlds: opts.worlds || require('./worlds'),
  macRequest: opts.macRequest || ((m, r, b) => require('./remote').macRequest(m, r, b)),
});
const refused = (because, code) => (code ? { ok: false, because, code } : { ok: false, because });
/* A refusal in this module's own words: remote's `because` can be a raw line from the tunnel. */
function wordsFor(got) {
  const r = got && got.refusal;
  if (r && r.status === 429) return 'Kosmos+ has handed over as much as an hour allows, so this restore stopped here.';
  if (r && r.code === 'personal_backup_key_pending') return 'Personal backup is not available from Kosmos+ just now.';
  if (r && r.status === 403) return 'Kosmos+ says this computer is not the one holding this backup.';
  return r ? 'Kosmos+ refused to hand over this backup.' : 'Kosmos+ could not be reached.';
}

/* The list across every epoch this computer holds, newest first. listSnapshots says why a row cannot be restored. */
async function listAll(d, keys) {
  const rows = [];
  let more = false;
  for (const { epoch } of [...keys.epochs].sort((a, b) => b.epoch - a.epoch)) {
    const got = await d.macRequest('POST', MANIFESTS_ROUTE, { epoch });
    if (!got || !got.ok) return refused(wordsFor(got), got && got.refusal && got.refusal.code);
    const data = got.data;
    if (!data || !Array.isArray(data.manifests) || data.member !== keys.member) return refused('Kosmos+ answered for another backup');
    if (data.more === true) more = true;
    for (const m of data.manifests) rows.push({ epoch, record: m });
  }
  const listed = d.restorerun.listSnapshots(rows.map((r) => r.record));
  const byKey = new Map(rows.map((r) => [r.record && r.record.key, r]));
  // Newest first, and a row with no readable time last: listSnapshots already sorts those to the end.
  const dated = listed.filter((l) => l.claimedAt !== null).reverse();
  // listSnapshots keeps the first of a very long list, which is the newest here: the rest are as cut as Kosmos+'s own.
  if (listed.length < rows.length) more = true;
  return { ok: true, more, rows: dated.concat(listed.filter((l) => l.claimedAt === null)).map((l) => Object.assign({}, l, byKey.get(l.key))) };
}

/* This computer's keys for the record's org, or a refusal. withSecrets asks for the member keys themselves. */
async function keysFor(d, opts, withSecrets) {
  const { state, rec, codeWaiting } = d.personalbackup.restoreRecord(opts);
  if (codeWaiting) return refused('Press Finish setting up first: your recovery code is still waiting to be saved.', 'code_waiting');
  if (state === 'needs-key') return refused('Enter your recovery code on this computer first, then restore your files.', 'no_keys');
  if (state !== 'on' || !rec) return refused('Turn on personal backup on this computer first.', 'not_on');
  const keys = await d.personalbackupkey.personalRestoreKeys(rec.org.id, { macRequest: d.macRequest, withSecrets });
  return keys && keys.ok ? Object.assign({ rec }, keys) : (keys || refused('the backup key could not be read on this computer'));
}

/** The person's snapshots, newest first: { ok: true, more, keyMissing, backups: [{ key, epoch, takenAt, problem }] }.
    takenAt is the time inside the id, in Unix seconds, as the backup claims it until it is opened. more: older ones were
    left out. keyMissing: Kosmos+ has backups under a key this computer does not hold, so they are not listed, and those
    may be the newest. */
async function listBackups(opts = {}) {
  try {
    const d = deps(opts);
    const keys = await keysFor(d, opts, false);
    if (!keys.ok) return keys;
    const all = await listAll(d, keys);
    if (!all.ok) return all;
    return { ok: true, more: all.more, keyMissing: keys.missing.length > 0, backups: all.rows.map((r) => ({ key: r.key, epoch: r.epoch, takenAt: r.claimedAt, problem: r.problem })) };
  } catch { return refused('the backups could not be listed on this computer'); }
}

/* How much restore may write: the free space, less a margin. */
function diskBudget(dir, opts) {
  if (Number.isSafeInteger(opts.maxTotalBytes)) return opts.maxTotalBytes;
  const st = fs.statfsSync(dir);
  return Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Number(st.bavail) * Number(st.bsize) - DISK_MARGIN_BYTES));
}

/* A read grant, as restorefetch wants it: a refusal stops the restore, and anything that may pass is thrown. mine/read
   takes the member from the signature, so restorefetch's `member` is not sent. */
function grantOf(d) {
  return async ({ epoch, manifest, keys }) => {
    const got = await d.macRequest('POST', READ_ROUTE, { epoch, manifest, keys });
    if (got && got.ok) return { ok: true, answer: got.data };
    const status = got && got.refusal && got.refusal.status;
    if (Number.isSafeInteger(status) && status >= 400 && status < 500) {
      return { ok: false, because: wordsFor(got) };
    }
    throw new Error('not reached');
  };
}

let running = false;

/** Restore one snapshot: pick { key }, a manifest key from listBackups. opts.memberName is the shown name for the new
    Kosmos. { ok: true, world, restored, failed, moved, kept, heldBack, fetchProblems, details } or { ok: false, because,
    code?, world?, partial?, restored?, details? }: a run that stopped part way keeps its world and its files, and says
    so. details: { failed: [{ path, why }], leftOutAtBackup, fetchProblems } from the run, each path the backup's own
    text, for the screen to escape. ⚠️ A route builds opts by hand, never from a request: they replace this module's calls. */
async function restoreFiles(pick, opts = {}) {
  if (typeof (pick && pick.key) !== 'string') return refused('That backup is not on Kosmos+ any more.', 'no_such_backup');
  if (running) return refused('A restore is already running on this computer.', 'restore_running');
  running = true;
  try { return await restoreNow(pick, opts); } catch { return refused('the restore failed on this computer'); } finally { running = false; }
}

/* The worlds' own base: on a board running a named Kosmos, the data root is that world's, and a world made there would
   never reach the list the switcher reads. */
function baseOf(d, opts) {
  if (opts.base) return opts.base;
  return require('./worldenv').bootedBaseDir() || d.worlds.baseRoot(d.worlds.preWorldEnv(process.env));
}

async function restoreNow(pick, opts) {
  const d = deps(opts);
  const keys = await keysFor(d, opts, true);
  if (!keys.ok) return keys;
  try { return await withKeys(d, keys, pick, opts); } finally { for (const e of keys.epochs) e.sk.fill(0); }
}

async function withKeys(d, keys, pick, opts) {
  const all = await listAll(d, keys);
  if (!all.ok) return all;
  const row = all.rows.find((r) => r.key === pick.key);
  if (!row) return all.more ? refused('That backup is older than the ones Kosmos+ lists.', 'no_such_backup') : refused('That backup is not on Kosmos+ any more.', 'no_such_backup');
  if (row.problem) return refused(row.problem);
  if (d.restorefetch.keyProblem(row.record.key, { org: keys.org, member: keys.member, epoch: String(row.epoch), period: row.record.period })) return refused('this backup names a file Kosmos+ could not have stored');
  // Before a Kosmos is made: a refusal, an outage or a failed proof must not spend one of the day's restored names.
  const why = await provenManifest(d, keys, row, opts);
  if (why) return refused(why);
  const base = baseOf(d, opts);
  const made = d.restoreworld.prepareRestoreWorld(base, { member: opts.memberName || 'Personal backup', memberId: keys.member });
  if (!made.ok) return made;
  const out = await runInto(d, keys, row, made, base, opts);
  // Nothing landed: the empty Kosmos goes off the list, or every try would add another.
  if (!out.ok && !out.partial) {
    let hidden = false;
    try { d.worlds.hideWorld(base, made.world.id); hidden = true; } catch { /* named below, so the person can remove it */ }
    if (hidden) delete out.world;
    else out.because = `${out.because}. An empty Kosmos named "${made.world.name}" is left on your list; you can remove it`;
  }
  return out;
}

const FILES_NAMED = 200;   // failed files named to the person; the count covers the rest
const detailsOf = (r) => {
  const res = r && r.result;
  return { failed: (res && Array.isArray(res.failed) ? res.failed : []).slice(0, FILES_NAMED), leftOutAtBackup: res && Array.isArray(res.skippedAtBackup) ? res.skippedAtBackup.length : 0,
    fetchProblems: r && Array.isArray(r.fetchProblems) ? r.fetchProblems : [] };
};

const MANIFEST_GET_MS = 10 * 60 * 1000;   // a top plan's manifest is about 130 MiB; about 230 KB/s fetches it (kosmos#7404)
const fetcherOf = (d, keys, row, opts) => d.restorefetch.readGrantFetcher({ manifestTimeoutMs: MANIFEST_GET_MS, grant: grantOf(d), org: keys.org, member: keys.member, epoch: row.epoch, manifest: row.record,
  grantKeys: batchFor(row.record.key), fetch: opts.fetch });

/* Why this manifest will not open, or null. The run checks it all again: this only stops a doomed one early. */
async function provenManifest(d, keys, row, opts) {
  const fetcher = fetcherOf(d, keys, row, opts);
  const bytes = await fetcher.fetchObject(row.record.key, { maxBytes: d.restorerun.MAX_MANIFEST_OBJECT });
  if (!bytes) {
    const p = fetcher.planned() || {};
    return p.because || (Array.isArray(p.unreadableBecause) && p.unreadableBecause[0]) || 'this backup could not be fetched';
  }
  const ctx = { org: keys.org, member: keys.member, epoch: String(row.epoch), period: row.record.period, snapshot: row.record.snapshot };
  const sk = keys.epochs.find((e) => e.epoch === row.epoch).sk;
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== row.record.sha256) return 'the backup\'s manifest is not the one Kosmos+ recorded';
  return openManifestByProof(sk, ctx, bytes) ? null : 'this backup could not be proved to be yours with this key, so it was not restored';
}

async function runInto(d, keys, row, made, base, opts) {
  const stopped = (because, extra) => Object.assign({ ok: false, because, world: made.world }, extra);
  let budget, sink;
  try { budget = diskBudget(made.restoreDir, opts); } catch { return stopped('the free space on this computer could not be read, so nothing was restored'); }
  try { sink = d.restoresink.createRestoreSink(made.restoreDir, { record: true, snapshot: `${row.record.snapshot}:${row.record.sha256}` }); } catch {
    return stopped('the folder for this restore could not be used, so nothing was restored');
  }
  let result;
  try {
    const fetcher = fetcherOf(d, keys, row, opts);
    result = await d.restorerun.runRestore({ org: keys.org, member: keys.member, epoch: row.epoch, manifest: row.record, trust: 'member-proof',
      memberSk: keys.epochs.find((e) => e.epoch === row.epoch).sk,
      fetchObject: fetcher.fetchObject, plan: fetcher.plan, planned: fetcher.planned, sink, maxTotalBytes: budget });
  } catch { result = { ok: false, because: 'the restore failed on this computer' }; }
  // close throws when its temp folder cannot go: never in a finally, and never over the run's own answer.
  let closed = true;
  // The record stays only for files worth carrying on from: an empty Kosmos about to be hidden keeps none.
  const landed = !!(result.result && Array.isArray(result.result.restored) && result.result.restored.length);
  try { sink.close({ keepRecord: result.ok !== true && (result.partial === true || landed) }); } catch { closed = false; }
  if (!result.ok) return stopped(result.because, { partial: result.partial === true || landed, restored: landed ? result.result.restored.length : 0, details: detailsOf(result) });
  if (!closed) return stopped('your files were restored, but this computer could not finish tidying them up, so they were not moved into the new Kosmos', { partial: true });
  let fin;
  try { fin = d.restoreworld.finishRestoreWorld({ base, world: made.world, restoreDir: made.restoreDir, result }); } catch {
    return stopped('your files were restored, but they could not be moved into the new Kosmos', { partial: true });
  }
  return Object.assign({ ok: fin.ok === true, world: made.world, restored: result.result.restored.length, failed: fin.failedFiles,
    moved: fin.moved, kept: fin.kept, heldBack: fin.heldBack, fetchProblems: fin.fetchProblems, details: detailsOf(result) }, fin.ok ? {} : { because: fin.because, partial: true });
}

module.exports = { listBackups, restoreFiles, batchFor };
