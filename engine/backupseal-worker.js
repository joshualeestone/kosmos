'use strict';

/**
 * kosmos#7746: seals one backup manifest off the board's main thread, for backupsnapshot's sealOffThread. At the top plan
 * (477,000 chunks, a 117 MiB manifest) sealManifest is one block of about 2.5 s, which would freeze the board.
 *
 * Told { memberPk, deviceKey, ctx, json } once (json is the manifest as JSON.stringify wrote it on the main thread), it
 * parses it, seals it with backupformat.sealManifest exactly as the main thread would, and posts back { ok: true, sealed }
 * (the bytes, transferred) or { ok: false, message } (the seal's own error message, which is never a key or a path).
 */

const { parentPort } = require('node:worker_threads');
const { sealManifest } = require('./backupformat');

parentPort.once('message', (m) => {
  try {
    const sealed = sealManifest(Buffer.from(m.memberPk), m.deviceKey, m.ctx, JSON.parse(m.json));
    const out = new Uint8Array(sealed.length);
    out.set(sealed);
    parentPort.postMessage({ ok: true, sealed: out }, [out.buffer]);
  } catch (err) {
    parentPort.postMessage({ ok: false, message: String((err && err.message) || 'the manifest could not be sealed') });
  }
});
