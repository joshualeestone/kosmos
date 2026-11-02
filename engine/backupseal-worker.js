'use strict';

/**
 * kosmos#7746: seals one backup manifest off the board's main thread, for backupsnapshot's sealOffThread. At the top plan
 * (477,000 chunks, a 117 MiB manifest) sealManifest is one block of 1.6 to 1.8 s (measured), which would freeze the board.
 *
 * Told { memberPk, deviceKey, ctx, json } once (json is the manifest as JSON.stringify wrote it on the main thread), it
 * parses it, seals it with backupformat.sealManifest exactly as the main thread would, and posts back one of:
 *   { ok: true, sealed }                 the bytes, transferred
 *   { ok: false, refused: true, message } the seal itself refused (its own message, never a key or a path)
 *   { ok: false }                        anything else failed (the parse, the copy, the post): the main thread seals
 */

const { parentPort } = require('node:worker_threads');
const { sealManifest } = require('./backupformat');

parentPort.once('message', (m) => {
  let manifest, memberPk;
  try { manifest = JSON.parse(m.json); memberPk = Buffer.from(m.memberPk); } catch { parentPort.postMessage({ ok: false }); return; }
  let sealed;
  try {
    sealed = sealManifest(memberPk, m.deviceKey, m.ctx, manifest);
  } catch (err) {
    // The seal itself refused: `refused` tells the main thread to pass the refusal on rather than seal again there.
    parentPort.postMessage({ ok: false, refused: true, message: String((err && err.message) || 'the manifest could not be sealed') });
    return;
  }
  try {
    // The sealed bytes are transferred, not copied, when they fill their own buffer (the usual case for a large one).
    const whole = sealed.byteOffset === 0 && sealed.byteLength === sealed.buffer.byteLength;
    const out = whole ? new Uint8Array(sealed.buffer) : Uint8Array.from(sealed);
    parentPort.postMessage({ ok: true, sealed: out }, [out.buffer]);
  } catch {
    // Not a refusal (the copy or the post failed): the main thread seals it there instead.
    parentPort.postMessage({ ok: false });
  }
});
