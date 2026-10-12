'use strict';
/* kosmos#4737: what makes this computer's Kosmos+ state folder "set up", in one place. engine/remote.js
   (enrolled(), halfRegistered()) and engine/remote-report.js (the tunnel state and the missing-files
   reason) both ask THIS module, which is pure so the report can load it without loading remote.js.

   Set up means the identity and the certificate: `mac_id`, `address`, `tls.crt`, `tls.key`. One
   exception: a computer registered while it waits for the older computer's Allow is given no
   certificate yet (the coordinator will not issue a waiting computer one for its name). The tunnel marks
   that registration by writing `held` as its LAST step, removes it FIRST at every register, and removes
   it again once it fetches the certificate after the Allow (kosmos-relay crates/tunnel/src/setup.rs and
   renew.rs). So `held` stands in for the certificate files, never for the identity.
   ⚠️ COUPLING, stated because it crosses a repo: the file name `held` is kosmos-relay's. A tunnel that
   never writes it leaves this module answering exactly as before. */
const ENROL_FILES = ['mac_id', 'address', 'tls.crt', 'tls.key'];
const CERT_FILES = ['tls.crt', 'tls.key'];
const HELD_FILE = 'held';

/** The enrolment files missing, given `exists(name)`: the certificate files are not missing while `held` is there. */
function missingFor(exists) {
  const held = exists(HELD_FILE);
  return ENROL_FILES.filter((f) => !exists(f) && !(held && CERT_FILES.includes(f)));
}

/** Whether the folder is set up: nothing missing. */
function enrolledBy(exists) {
  return missingFor(exists).length === 0;
}

/* kosmos#5871: which id names this computer NOW, given `read(name)` (the file's text, or null) and `mtimeOf(name)`
   (its modification time in ms, or null). The tunnel writes `mac_identity` (the id, then the key, one per line) FIRST
   at every registration, in one step, and the old `mac_id` / `mac_key` pair after it for older readers. So: the id
   in `mac_identity` names it, unless the `mac_id` file names a DIFFERENT id and is NEWER (an older tunnel, which
   writes only the pair, registered since). No `mac_identity` (registered before it existed): the `mac_id` file.
   This rests on every registration getting a NEW id (the coordinator's register_mac mints one, util::new_id, into a
   primary key): a re-registration under the same id with a new key would keep mac_identity's old key here.
   ⚠️ COUPLING, across a repo: this is the rule of kosmos-relay crates/tunnel/src/coordinator.rs
   MacState::identity_record, so the app and the tunnel always name the same computer. Change them together.
   A mac_identity without BOTH an id and a key, or one that cannot be read (read throws), is no id (null), never
   the other file's: the tunnel refuses those too. No mac_id file at all is no id either: the tunnel's every entry
   point (MacState::open) refuses a folder without one, so a FIRST registration cut after its mac_identity write
   is not a computer yet, here as there. An empty mac_id counts as no mac_id. A tie in mtime keeps mac_identity. engine/enrolment-macid-5871.test.js and the tunnel's identity_rule_table hold the same cases. */
const IDENTITY_FILE = 'mac_identity';
function currentMacIdBy(read, mtimeOf) {
  let pairRaw; let text;
  try { pairRaw = read('mac_id'); text = read(IDENTITY_FILE); } catch { return null; }
  const pairId = ((pairRaw || '').trim()) || null;
  if (text === null || text === undefined) return pairId;
  if (pairRaw === null || pairRaw === undefined) return null;   // no mac_id file: the tunnel will not open the folder
  const lines = String(text).split('\n').map((l) => l.trim());
  const id = lines[0] || null;
  if (!id || !lines[1]) return null;
  if (pairId && pairId !== id) {
    const pairAt = mtimeOf('mac_id'); const fileAt = mtimeOf(IDENTITY_FILE);
    if (pairAt !== null && fileAt !== null && pairAt > fileAt) return pairId;
  }
  return id;
}

module.exports = { ENROL_FILES, CERT_FILES, HELD_FILE, IDENTITY_FILE, missingFor, enrolledBy, currentMacIdBy };
