'use strict';
/**
 * #7575 (follow-up to #7420, Josh 10-29 11:40: the iPhone DM "jumping back and forth horizontal"): the iPhone app sends
 * one record per chat open in which the chat was shifted sideways, so an agent on this Mac can find the cause without
 * the person doing anything (Josh does not run diagnostics).
 *
 * Kept on the board (store.ROOT/phone-chat-shifts.json), the last MAX records, oldest dropped. A record holds only
 * numbers, versions and kind words: never message text, an agent's name or an address. Every field is checked against
 * its own shape and anything else is dropped, so a record cannot carry text the app did not mean to send.
 *
 * Never throws to a caller. A file that cannot be read reads as no records with ok false and is never overwritten from
 * that reading.
 */
const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');

const MAX = 50;
// The row kinds the app names (ChatShiftReport.Kind in ios/Kosmos/ChatShiftLogic.swift); anything else is dropped.
const KINDS = ['message', 'reactions', 'file', 'choice', 'working', 'day', 'other'];
const VERSION_RE = /^[0-9A-Za-z.()\- ]{1,32}$/;   // "1.4 (18)", "27.0", "iPhone17,1"
const MODEL_RE = /^[A-Za-z]{1,16}[0-9]{1,3},[0-9]{1,3}$/;

const file = () => path.join(store.ROOT, 'phone-chat-shifts.json');

const num = (v, max) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max ? Math.round(v * 10) / 10 : null);

/** The record as kept, or { refused } when it is not one. */
function clean(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { refused: 'not a record' };
  const shifts = num(body.shifts, 1e6);
  if (shifts === null || shifts < 1) return { refused: 'shifts must be a count of at least 1' };
  if (typeof body.app !== 'string' || !VERSION_RE.test(body.app)) return { refused: 'app must be a version' };
  if (typeof body.ios !== 'string' || !VERSION_RE.test(body.ios)) return { refused: 'ios must be a version' };
  const r = { app: body.app, ios: body.ios, shifts: Math.round(shifts) };
  if (typeof body.model === 'string' && MODEL_RE.test(body.model)) r.model = body.model;
  for (const k of ['largest', 'listWidth', 'contentWidth', 'openSeconds']) {
    const v = num(body[k], 1e5);
    if (v !== null) r[k] = v;
  }
  for (const k of ['whileDragging', 'keyboardUp']) if (typeof body[k] === 'boolean') r[k] = body[k];
  if (body.rows && typeof body.rows === 'object' && !Array.isArray(body.rows)) {
    const rows = {};
    for (const k of KINDS) { const v = num(body.rows[k], 1e4); if (v) rows[k] = Math.round(v); }
    if (Object.keys(rows).length) r.rows = rows;
  }
  return { record: r };
}

/** { records: [{ at, ...record }], ok }, oldest first. No file is no records. */
function read() {
  let raw;
  try { raw = fs.readFileSync(file(), 'utf8'); } catch (err) { return { records: [], ok: !err || err.code === 'ENOENT' }; }
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v && v.records) ? { records: v.records.slice(-MAX), ok: true } : { records: [], ok: false };
  } catch { return { records: [], ok: false }; }
}

/** Keeps one record (stamped with the board's own time). { ok } or { refused }. */
function add(body, now = new Date()) {
  const c = clean(body);
  if (c.refused) return c;
  const was = read();
  if (!was.ok) return { ok: false };
  const records = was.records.concat([{ at: now.toISOString(), ...c.record }]).slice(-MAX);
  try {
    fs.mkdirSync(store.ROOT, { recursive: true });
    store.saveFlushed(file(), JSON.stringify({ records }));
  } catch { return { ok: false }; }
  return { ok: true };
}

module.exports = { read, add, clean, file, MAX, KINDS };
