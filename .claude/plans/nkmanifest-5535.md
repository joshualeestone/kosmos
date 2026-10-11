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
- (as built) restore: 5 accept and 9 refuse cases, nothing fetched on a refusal; snapshot: a round trip with no key given.
