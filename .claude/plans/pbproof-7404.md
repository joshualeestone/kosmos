# Personal backup slice D1: a manifest proves itself to the member key (#7404)

Decision and rejected options: card #7404, "Slice D design decision".

What: a personal manifest carries `memberProof { device, proof }` in its sealed body. proof = HMAC(HKDF(clamped member
secret), domain + snapshot context + device public key). `openManifestByProof` opens the body, checks the proof, then the
device signature under the key the proof names. `runRestore` takes `trust: 'member-proof'` in place of a history.

Company backups: no proofKey, manifest unchanged, history still required. The exact word 'member-proof' is the only way
off the history path.

The member secret stops at personalbackupkey.js; the job carries only the derived proof key, never in runOnce's answer.

Not here: the two relay read routes (D2), the run behind the panel's Restore (D3), the stops that name no next step,
deleting a person's objects after the lock, the switch and the price (#7685, Josh's).

For D3: `trust: 'member-proof'` replaces the device-key history, so a test at the caller must pin when it is set. The
personal record's org kind is itself copied from Kosmos+, so the record is no guarantee; what protects a mislabelled
company org is that its manifests carry no proof and are refused. Nothing calls runRestore yet.

Earlier manifests: the switch has never been on, so no real personal manifest exists without a proof. A test one is refused.

Deliberately not done: zeroing the derived proof key after a run. The member key it comes from sits in a 0600 file on the
same disk, and backupkeys.js already says Node cannot reliably zero memory.
