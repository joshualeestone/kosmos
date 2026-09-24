'use strict';
/**
 * The claim a label-less or named API-key add takes on an account slot while it
 * checks the key (server.js handleApikeyAccountStore), kept here so the grok
 * subscription sign-in (#3391) reads the SAME file name and staleness rather than a
 * second copy of them. A claim is a file created with 'wx' inside the slot.
 */
const fs = require('node:fs');
const path = require('node:path');

const CLAIM_FILE = '.kosmos-claim';
const CLAIM_STALE_MS = 10 * 60 * 1000;

/** True while an add holds this slot (a claim file younger than CLAIM_STALE_MS). */
function claimHeld(dir) {
  try { return Date.now() - fs.statSync(path.join(path.resolve(String(dir || '')), CLAIM_FILE)).mtimeMs <= CLAIM_STALE_MS; }
  catch { return false; }
}

module.exports = { CLAIM_FILE, CLAIM_STALE_MS, claimHeld };
