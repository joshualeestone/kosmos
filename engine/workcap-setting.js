'use strict';
/* kosmos#7406: how many of this computer's agents ON ONE ACCOUNT may be working at once before Kosmos's automatic
 * senders wait (Settings > Automation). One user's ~35 agents were woken together and the turns set off the
 * provider's rate limits (about 1,000 failed turns in a morning). A provider's limit is per account, so the cap
 * counts the agents that share one account (a runner and its account folder). engine/agyquota.js heldForCap reads
 * this for every agent that is not a Gemini subscription (Antigravity) one; those keep their own cap
 * (engine/agycap-setting.js), because they share one Google quota across accounts.
 *
 * OFF BY DEFAULT (no limit), as the Gemini cap is: a cap slows a team down, and it is for a person who would rather
 * go slower than be rate-limited. A person's own message is never held by it (chat.deliver is not gated).
 * Same file rules as agycap-setting.js (one function makes both): a missing or unreadable file reads no limit.
 */
const path = require('node:path');
const store = require('./store');

const cap = require('./agycap-setting').make(path.join(store.ROOT, 'workcap.json'), [0, 2, 4, 6, 8, 12, 16], 0);

module.exports = { FILE: cap.FILE, CHOICES: cap.CHOICES, DEFAULT_MAX: cap.DEFAULT_MAX, isValidMax: cap.isValidMax, read: cap.read, set: cap.set };
