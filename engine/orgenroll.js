'use strict';
/**
 * kosmos#5531 (Enterprise E0.2, umbrella #5529): enroll ONE Kosmos (a world) on this computer into a company, with
 * the consent stated before anything binds. The coordinator side is #5530 (E0.1); its routes and shapes are contract
 * v1.2, agreed 2026-10-07 with the coordinator's owner (orgs-5530.md on kosmos-relay).
 *
 * 🔑 THE UNIT IS THE WORK KOSMOS, NOT THE PERSON (#5529 decision 1). Only the enrolled world ever reports or backs up;
 * the person's other Kosmoses on this computer never do. That holds three ways:
 *   - each world keeps its own data root (engine/worlds.js), so its id file and enrollment record live inside it and
 *     no other world can read or write them;
 *   - the world is named to the coordinator only by an OPAQUE id minted here (random, never the world's name, which
 *     can be personal), and only by the world being enrolled;
 *   - isEnrolledHere() is the gate every later sender (E0.3 telemetry, E0.6 backup) must pass: it is true only when
 *     this world's record names this world's id, and refresh() clears the record the moment the coordinator names a
 *     different world or says this account is no longer a member.
 *
 * 🔑 NOTHING BINDS BEFORE CONSENT. preview(code) asks the coordinator what the code is for and returns the consent
 * words it sends (so every board shows the same words, changed without an app release). It uses no code and makes no
 * membership. enroll(code, accepted) sends nothing at all unless `accepted === true`: declining is no request.
 *
 * Best-effort by contract: nothing here throws. Each call resolves to { ok: true, ... } or { ok: false, because }.
 * Signed through the tunnel's mac-request verb (engine/remote.js macRequest); the board holds no key.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROUTES = Object.freeze({
  redeem: '/v1/mac/org/redeem',
  enroll: '/v1/mac/org/enroll',
  leave: '/v1/mac/org/leave',
  status: '/v1/mac/org/status',   // a POST read with {}: the tunnel signs only POSTs with a JSON body (contract v1.2)
});
const WORLD_ID_FILE = 'org-world-id';
const ENROLLMENT_FILE = 'org-enrollment.json';
const WORLD_ID = /^[0-9a-f]{32}$/;
/* A code is typed or pasted by a person (or comes from the join link's #code=). Kept to a bounded, plain shape so
   nothing else is ever signed and sent in its place. */
const CODE = /^[A-Za-z0-9_-]{6,128}$/;

function storeRoot(opts) {
  if (opts && opts.root) return opts.root;
  return require('./store').ROOT;
}
function remoteFor(opts) {
  if (opts && opts.remote) return opts.remote;
  try { return require('./remote'); } catch { return null; }
}

/* This world's opaque id: read, or minted once and kept in this world's own data root. Written whole (temp, then
   rename) with owner-only permission. Null when the root cannot be written (then nothing is sent). */
function worldId(opts) {
  const root = storeRoot(opts);
  const file = path.join(root, WORLD_ID_FILE);
  try {
    const have = fs.readFileSync(file, 'utf8').trim();
    if (WORLD_ID.test(have)) return have;
  } catch { /* not minted yet */ }
  const id = crypto.randomBytes(16).toString('hex');
  try {
    fs.mkdirSync(root, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, id + '\n', { mode: 0o600 });
    fs.renameSync(tmp, file);
    return id;
  } catch { return null; }
}

/* The company this world is enrolled to, as last confirmed by the coordinator, or null. */
function readEnrollment(opts) {
  try {
    const rec = JSON.parse(fs.readFileSync(path.join(storeRoot(opts), ENROLLMENT_FILE), 'utf8'));
    if (!rec || typeof rec !== 'object' || !rec.org || typeof rec.org.id !== 'string' || !WORLD_ID.test(rec.world || '')) return null;
    return rec;
  } catch { return null; }
}
function writeEnrollment(rec, opts) {
  const file = path.join(storeRoot(opts), ENROLLMENT_FILE);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(rec) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, file);
}
function clearEnrollment(opts) {
  try { fs.rmSync(path.join(storeRoot(opts), ENROLLMENT_FILE), { force: true }); } catch { /* already gone */ }
}

/* 🛑 THE GATE for every later sender: true only for the world whose own record names its own id. */
function isEnrolledHere(opts) {
  const rec = readEnrollment(opts);
  if (!rec) return false;
  const id = worldId(opts);
  return !!id && rec.world === id;
}

/* The coordinator's answers are not trusted for shape: kept to what the page shows, and only plain strings. */
function cleanOrg(o) {
  if (!o || typeof o !== 'object' || typeof o.id !== 'string' || !o.id) return null;
  return { id: o.id, name: typeof o.name === 'string' ? o.name : '', slug: typeof o.slug === 'string' ? o.slug : '' };
}
function cleanList(a) { return Array.isArray(a) ? a.filter((s) => typeof s === 'string' && s.trim()).map((s) => s.trim()) : []; }
function cleanConsent(c) {
  if (!c || typeof c !== 'object') return null;
  const out = { reports: cleanList(c.reports), backsUp: cleanList(c.backsUp), readers: cleanList(c.readers), never: cleanList(c.never) };
  // A consent with nothing in it is no consent: the page must never offer Join on an empty statement.
  return (out.reports.length || out.backsUp.length) && out.readers.length ? out : null;
}
const ROLES = new Set(['member', 'recovery', 'admin']);
function cleanRole(r) { return ROLES.has(r) ? r : null; }

async function signed(method, route, body, opts) {
  const remote = remoteFor(opts);
  if (!remote || typeof remote.macRequest !== 'function') return { ok: false, because: 'Kosmos+ is not available here' };
  try {
    const r = await remote.macRequest(method, route, body);
    return r && typeof r === 'object' ? r : { ok: false, because: 'no answer' };
  } catch (e) { return { ok: false, because: String(e && e.message || e) }; }
}

/* What a code is for: the company, the role, and the consent words. Binds nothing. */
async function preview(code, opts) {
  if (typeof code !== 'string' || !CODE.test(code.trim())) return { ok: false, because: 'that is not a join code' };
  const r = await signed('POST', ROUTES.redeem, { code: code.trim() }, opts);
  if (!r.ok) return { ok: false, because: r.because || 'the code could not be checked' };
  const org = cleanOrg(r.data && r.data.org);
  const role = cleanRole(r.data && r.data.role);
  const consent = cleanConsent(r.data && r.data.consent);
  if (!org || !role || !consent) return { ok: false, because: 'the answer was not complete, so nothing was joined' };
  return { ok: true, org, role, consent };
}

/* Enroll THIS world. Sends nothing unless the person accepted. `code` is required for a first join and omitted when an
   existing member moves the enrollment to this world. */
async function enroll(code, accepted, opts) {
  if (accepted !== true) return { ok: false, declined: true, because: 'not accepted, so nothing was sent' };
  const world = worldId(opts);
  if (!world) return { ok: false, because: "this Kosmos's data folder cannot be written" };
  const body = { world, accepted: true };
  if (code != null) {
    if (typeof code !== 'string' || !CODE.test(code.trim())) return { ok: false, because: 'that is not a join code' };
    body.code = code.trim();
  }
  const r = await signed('POST', ROUTES.enroll, body, opts);
  if (!r.ok) return { ok: false, because: r.because || 'joining did not go through' };
  const org = cleanOrg(r.data && r.data.org);
  const role = cleanRole(r.data && r.data.role);
  const named = r.data && r.data.enrolled && r.data.enrolled.world;
  if (!org || !role || named !== world) return { ok: false, because: 'the company did not confirm this Kosmos, so it is not enrolled' };
  const rec = { org, role, world, enrolledAt: new Date().toISOString() };
  try { writeEnrollment(rec, opts); } catch { return { ok: false, because: 'joined, but this Kosmos could not record it; check again' }; }
  return { ok: true, ...rec };
}

/* Leave the company. The record is cleared first, so this world stops reporting even if the request fails. */
async function leave(opts) {
  clearEnrollment(opts);
  const r = await signed('POST', ROUTES.leave, {}, opts);
  return r.ok ? { ok: true } : { ok: false, because: r.because || 'leaving could not be confirmed; this Kosmos has already stopped reporting' };
}

/* On start and daily: ask the coordinator. member:false, or an enrollment naming another world, clears this world's
   record (removed, left, or moved elsewhere). An unreachable coordinator changes nothing. */
async function refresh(opts) {
  const before = readEnrollment(opts);
  const r = await signed('POST', ROUTES.status, {}, opts);
  if (!r.ok || !r.data || typeof r.data !== 'object') return { ok: false, because: (r && r.because) || 'not checked', enrolled: !!before };
  const d = r.data;
  const world = worldId(opts);
  const here = d.member === true && d.enrolled && world && d.enrolled.world === world;
  if (!here) {
    if (before) clearEnrollment(opts);
    return { ok: true, enrolled: false, member: d.member === true, stopped: !!before, org: d.member === true ? cleanOrg(d.org) : null };
  }
  const org = cleanOrg(d.org);
  const role = cleanRole(d.role);
  if (!org || !role) return { ok: false, because: 'the answer was not complete', enrolled: !!before };
  const rec = { org, role, world, enrolledAt: (before && before.enrolledAt) || new Date().toISOString() };
  try { writeEnrollment(rec, opts); } catch { /* keep the old record; the next refresh tries again */ }
  return { ok: true, enrolled: true, member: true, ...rec };
}

module.exports = {
  ROUTES, WORLD_ID_FILE, ENROLLMENT_FILE, CODE,
  worldId, readEnrollment, isEnrolledHere, cleanConsent, preview, enroll, leave, refresh,
};
