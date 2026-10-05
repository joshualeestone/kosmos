'use strict';

/**
 * #4039: SYNTHESIZED Antigravity (agy) conversations for tests, byte by byte, in the field layout
 * measured on real agy conversations (see engine/agysession.js's header). No real conversation is
 * ever committed. `home` is the agy storage dir the code under test reads (AGENT_WORKFORCE_AGY_HOME).
 */

const fs = require('node:fs');
const path = require('node:path');

function varint(n) {
  const out = [];
  let v = n;
  do { let b = v % 128; v = Math.floor(v / 128); if (v > 0) b |= 0x80; out.push(b); } while (v > 0);
  return Buffer.from(out);
}
const num = (field, n) => Buffer.concat([varint(field * 8), varint(n)]);
const msg = (field, ...parts) => {
  const body = Buffer.concat(parts.map((p) => (typeof p === 'string' ? Buffer.from(p) : p)));
  return Buffer.concat([varint(field * 8 + 2), varint(body.length), body]);
};

/* A 10-byte varint: protobuf's encoding of int64 -1, which agy really writes beside these fields. */
const minusOne = (field) => Buffer.concat([varint(field * 8), Buffer.from([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01])]);

/** One generation as agy writes it: model at 1.19, usage at 1.4. `negative` adds an int64 -1 field
    inside the usage message and at top level, as real blobs carry such fields. */
function generation({ model = 'gemini-3.8-flash', prompt, cached, reply, thoughts = 0, negative = false } = {}) {
  // `prompt` is 1.4.2 (the uncached part); `cached` is 1.4.5, written only once agy's cache is in use.
  // `prompt: null` leaves 1.4.2 off the wire, as proto3 does for a zero (a turn served wholly from cache).
  const usageParts = [num(1, 1318)];
  if (prompt !== null) usageParts.push(num(2, prompt));
  usageParts.push(num(3, reply + thoughts));
  if (cached !== undefined) usageParts.push(num(5, cached));
  usageParts.push(num(9, reply), num(10, thoughts));
  if (negative) usageParts.push(minusOne(12));
  const usage = prompt === undefined ? [] : [msg(4, ...usageParts)];
  const parts = [msg(1, model === null ? Buffer.alloc(0) : msg(19, model), ...usage)];
  if (negative) parts.push(minusOne(9));
  return Buffer.concat(parts);
}

let seq = 0;
/** #5158: one step's metadata as agy writes it: the time at 1.1 (seconds), the call's idx at 20.3 (left off for 0). */
function stepMeta({ secs, idx = 0 }) {
  const parts = [msg(1, num(1, secs))];
  if (idx) parts.push(msg(20, num(3, idx)));
  return Buffer.concat(parts);
}

/** Write a conversation db for `dir` under `home`, mapped in last_conversations.json. `wal` puts it
    in WAL mode, as agy's real dbs are. #5158: `steps` = [{ type, secs, idx }] writes the steps table
    (type 15 is a model call's step), and `workspace` writes the folder as a file:// URI at 1.1 of
    trajectory_metadata_blob. */
function writeConversation(home, dir, gens, { wal = false, steps = null, workspace = null } = {}) {
  seq += 1;
  const id = String(seq).padStart(8, '0') + '-aaaa-bbbb-cccc-dddddddddddd';
  fs.mkdirSync(path.join(home, 'conversations'), { recursive: true });
  fs.mkdirSync(path.join(home, 'cache'), { recursive: true });
  const { DatabaseSync } = require('node:sqlite');
  const file = path.join(home, 'conversations', id + '.db');
  const db = new DatabaseSync(file);
  if (wal) db.exec('PRAGMA journal_mode=WAL');
  db.exec('CREATE TABLE gen_metadata (idx integer PRIMARY KEY, data blob, size integer NOT NULL DEFAULT 0)');
  const put = db.prepare('INSERT INTO gen_metadata (idx, data, size) VALUES (?, ?, ?)');
  gens.forEach((g, i) => put.run(i, g, g.length));
  if (steps) {
    db.exec('CREATE TABLE steps (idx integer PRIMARY KEY, step_type integer NOT NULL DEFAULT 0, metadata blob)');
    const st = db.prepare('INSERT INTO steps (idx, step_type, metadata) VALUES (?, ?, ?)');
    steps.forEach((s, i) => st.run(i, s.type, stepMeta(s)));
  }
  if (workspace) {
    db.exec('CREATE TABLE trajectory_metadata_blob (id text PRIMARY KEY DEFAULT "main", data blob)');
    const uri = require('node:url').pathToFileURL(workspace).href;
    db.prepare("INSERT INTO trajectory_metadata_blob (id, data) VALUES ('main', ?)").run(Buffer.concat([msg(1, msg(1, uri)), msg(7, uri)]));
  }
  db.close();
  const mapFile = path.join(home, 'cache', 'last_conversations.json');
  let map = {};
  try { map = JSON.parse(fs.readFileSync(mapFile, 'utf8')); } catch { /* first one */ }
  map[fs.realpathSync(dir)] = id;
  fs.writeFileSync(mapFile, JSON.stringify(map));
  return { id, file };
}

module.exports = { generation, writeConversation };
