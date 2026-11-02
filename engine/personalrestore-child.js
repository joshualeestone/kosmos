'use strict';
/**
 * kosmos#7404: the child process a personal-backup restore runs in, off the board's event loop (the restore sink's
 * writes and restoreworld's finish are synchronous, and a large restore runs for hours). engine/personalrestorejob.js
 * forks it with an IPC channel and sends ONE ask:
 *
 *   { run: { op: 'list' } }               engine/personalrestore.js listBackups()
 *   { run: { op: 'restore', key, base } } engine/personalrestore.js restoreFiles({ key }), into the board's worlds' base
 *
 * and gets ONE answer back, { done: <the answer> }, then this process exits (the board also ends it once it has the
 * answer, and when the person stops the restore).
 *
 * This process signs nothing. Every Kosmos+ request the restore makes is sent to the board as
 * { mac: { id, method, route, body } }, and the board answers { macAnswer: { id, got } } after checking the route
 * against its own short list and signing it inside its own busy() guard (engine/remote.js macRequest). So a restore
 * here can never sign a route the board has not named, nor sign while a register or a Forget is out.
 *
 * The board going away (a crash, a quit, a kill) closes the channel, and this process exits when it next sees that
 * (engine/personalrestorejob-7404.test.js forks it and checks). A restore cut off that way stops where it was: its
 * Kosmos and the files already written stay, and nothing tidies them.
 */
const path = require('node:path');

const pending = new Map();
let nextId = 1;
let started = false;

const gone = (because) => ({ ok: false, notSent: true, because });

/* One signed Kosmos+ request, made by the board. Never throws. */
function macRequest(method, route, body) {
  return new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    try { process.send({ mac: { id, method, route, body: body || {} } }); } catch {
      pending.delete(id);
      resolve(gone('this Kosmos stopped while the restore was asking Kosmos+'));
    }
  });
}

function finish(done) {
  try { process.send({ done }, () => process.exit(0)); } catch { process.exit(0); }
}

async function run(ask) {
  const pr = require('./personalrestore');
  // opts are built here by hand, never from the ask: they replace personalrestore's own calls.
  if (ask.op === 'list') return pr.listBackups({ macRequest });
  // base is the board's own worlds' base (personalrestorejob), never from a request.
  if (ask.op === 'restore' && typeof ask.key === 'string' && typeof ask.base === 'string' && path.isAbsolute(ask.base)) {
    return pr.restoreFiles({ key: ask.key }, { macRequest, base: ask.base });
  }
  return { ok: false, because: 'this Kosmos could not read that restore' };
}

function onMessage(m) {
  if (!m || typeof m !== 'object') return;
  if (m.macAnswer && Number.isSafeInteger(m.macAnswer.id)) {
    const resolve = pending.get(m.macAnswer.id);
    if (!resolve) return;
    pending.delete(m.macAnswer.id);
    const got = m.macAnswer.got;
    resolve(got && typeof got === 'object' ? got : gone('this Kosmos could not read the answer from Kosmos+'));
    return;
  }
  if (m.run && typeof m.run === 'object' && !started) {
    started = true;
    run(m.run).then(finish, () => finish({ ok: false, because: 'the restore failed on this computer' }));
  }
}

if (require.main === module) {
  if (typeof process.send !== 'function') process.exit(2);   // only ever started by personalrestorejob, with a channel
  process.on('message', onMessage);
  process.on('disconnect', () => process.exit(0));
}

module.exports = { onMessage, macRequest };
