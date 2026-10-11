# kosmos#5535 E0.6 slice (a): the naming key travels inside the manifest

Design on #5535 (comment 6114619425, 17:45 CDT): restore needs the period's naming key to check chunk names, the
manifest records only its id, and nothing stores the KBN1 wrap anywhere. So a backup taken today could not be restored.

## The change
- engine/backupsnapshot.js: the manifest gains `namingKey` (base64 of the 32 bytes) beside `namingKeyId`. The manifest is
  sealed to the member public key (what a KBN1 wrap is sealed to) and device-signed, so the key is as confidential as a
  wrap and, unlike a stored wrap, authenticated. The estimate's fixed 1024 bytes cover it.
- engine/backuprestore.js: `namingKey` becomes optional. manifestNamingKey: a carried key must be canonical base64 of
  32 bytes and match the manifest's namingKeyId; a given key must equal it; an older manifest (none carried) uses the
  given key, which must match the recorded id when there is one. Otherwise { malformed: 'namingKey' }, before any fetch.
  A malformed carried key never falls back to a given one.

## Decided
- Rejected: a separately uploaded wrap object (needs a new grant kind and route, and still needs an authenticator).
- Kept the caller's namingKey parameter so manifests written before this change still restore.
- Weakest premise: everyone who can open the manifest (the member key, so the escrow and a reviewer the unwrap service
  re-seals to) now gets the naming key without a second step. They could get it from a KBN1 wrap anyway: same recipient.

## Checks
- restore: 5 accept and 9 refuse cases, nothing fetched on a refusal (including a malformed carried key with a valid
  one given, which must never fall back); snapshot: a round trip that restores with no key given.
- Mutants, each red (node --check first): the field dropped from the manifest; the carried key ignored; the given-equals
  check, the id check, the carried-needs-an-id check, the canonical base64 regex, the malformed-carried refusal and the
  malformed result each removed.
- engine/backup*.test.js + engine.reachable.test.js all pass (count in the commit).

## Review 1 (sonnet, blind, on b89a8dada): NOT CONVERGED
- Checked and held: forged-chunk resistance (key and id both come from the signed manifest), no wrong or chosen key on
  any restore path, no Mac names new chunks from a carried key, readers unchanged (member secret key holders, as KBN1),
  the size budget (about 270 bytes of fixed fields), no caller of restoreSnapshot outside tests.
- FIXED (WARNING): "canonical base64" was not enforced: a last character with a non-zero padding bit decoded to the
  same key and passed. The decoded bytes must now encode back to the very string. Test case (the padding bit flipped);
  mutant red.
- FIXED (CONVENTION): manifestNamingKey had landed between restoreSnapshot's doc block and the function, and the new
  result lines lacked the " * " prefix. Moved above the block; prefixed.
- FIXED (NIT): backupkeys.js header points at the manifest-carried key. FIXED (NIT): the 1024 comment names ~270.
