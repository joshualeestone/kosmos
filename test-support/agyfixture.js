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
function generation({ model = 'gemini-3.8-flash', prompt, reply, thoughts = 0, negative = false } = {}) {
  const usageParts = [num(1, 1318), num(2, prompt), num(3, reply + thoughts), num(9, reply), num(10, thoughts)];
  if (negative) usageParts.push(minusOne(12));
  const usage = prompt === undefined ? [] : [msg(4, ...usageParts)];
  const parts = [msg(1, model === null ? Buffer.alloc(0) : msg(19, model), ...usage)];
  if (negative) parts.push(minusOne(9));
  return Buffer.concat(parts);
}

let seq = 0;
/** Write a conversation db for `dir` under `home`, mapped in last_conversations.json. `wal` puts it
    in WAL mode, as agy's real dbs are. */
function writeConversation(home, dir, gens, { wal = false } = {}) {
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
  db.close();
  const mapFile = path.join(home, 'cache', 'last_conversations.json');
  let map = {};
  try { map = JSON.parse(fs.readFileSync(mapFile, 'utf8')); } catch { /* first one */ }
  map[fs.realpathSync(dir)] = id;
  fs.writeFileSync(mapFile, JSON.stringify(map));
  return { id, file };
}

module.exports = { generation, writeConversation };
