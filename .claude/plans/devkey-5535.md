# kosmos#5535 E0.6 slice (b): the device key a backup manifest is signed with

Design on #5535 (comment 6114619425): restore and the content view check a manifest against the member's enrolled
device key, which is the connector's Ed25519 mac_key. Nothing on the Mac supplied it to the snapshot.

## The change
engine/backupdevicekey.js `deviceKey({ stateDir? })`: reads `<connector state>/mac_key` (default remote.stateDir(), the
folder remote.js hands the connector) as the connector reads it (trimmed; base64url, no padding, 32 bytes), and returns
Ed25519 KeyObjects. Opened without following a link (and an lstat where O_NOFOLLOW is 0), a plain file only, at most
256 bytes, canonical spelling only. No file is `missing` (never set up), distinct from an unusable one. `because` is a
fixed sentence, never a path or a byte. Read on each call, never cached or written.

## Decided
- Same key for manifests and mac-requests: the signed bytes are domain-separated (a manifest's start with the fixed tag
  `kosmos-backup v1 manifest-signature\0`; a mac-request's with the timestamp's digits).
- Rejected: a connector `sign` verb (a connector release, and a compromised board can already sign through mac-request).
- Weakest premise: the private key now sits in the board's memory for a run. The seed buffers are zeroed after use;
  the KeyObject itself cannot be.

## Checks
- 4 tests: the read key's public half equals the one the connector registers (computed independently, from a fresh
  pair's JWK), and it signs a manifest that verifies under it (control: another key does not); 7 wrong forms refused
  with no path or key bytes in the sentence (control: the exact form with whitespace reads); missing vs link vs folder;
  the default folder follows AGENT_WORKFORCE_TUNNEL_STATE.
- On the real thing, 2026-10-11 17:5x: two mac_key files the Rust connector wrote on this Mac (a fedproof sandbox and a
  walk base) read ok as ed25519; a third, a 1-byte placeholder in a probe folder, was refused. Nothing printed but ok/type.
- Mutants: the canonical check, the trim and the missing case each red alone. Three checks are deliberate second
  layers and survive alone, so they were run in pairs, each pair red: O_NOFOLLOW with the lstat check (a link), the
  base64url regex with the canonical check (another spelling), the stat size with the read size (an oversize file).
  isFile first survived (a folder failed later on read); the test now requires the "not a plain file" sentence: red.
