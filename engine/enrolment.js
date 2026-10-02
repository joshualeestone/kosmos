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

module.exports = { ENROL_FILES, CERT_FILES, HELD_FILE, missingFor, enrolledBy };
