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

## Review 1 (sonnet, blind, on 73c63c941): NOT CONVERGED
- Checked and held: domain separation (the only Rust mac_key signers, coordinator.rs:219 and assistant.rs:292, both sign
  `{ts}\n...` with ts a u64, first byte a digit; the manifest side signs from the tag, first byte `k`; both pure Ed25519,
  no prehash or context; no Node mac_key signer; pairing.rs only hashes the bytes). Base64 parsing agrees with
  URL_SAFE_NO_PAD's canonical rule.
- FIXED (WARNING): JS trim() strips a BOM that Rust keeps, so a file the connector refuses read here as a key nobody
  enrolled. Now trimmed with Rust's exact set (\p{White_Space}). Tests: a BOM refused, U+0085 and U+00A0 trimmed; the
  JS-trim mutant red.
- FIXED (NIT): where O_NOFOLLOW is 0 the lstat was by name; it must now name the opened file (same dev and inode).
  Not testable on this Mac (O_NOFOLLOW is set); stated as a residual for Windows tests.
- FIXED (NIT): key buffers are wiped in finally on every path; the comment says the string and KeyObject cannot be.
- FIXED (NIT): an empty, relative or non-string stateDir is refused, never the live default. Test; mutant red.
- FIXED (NIT): a FIFO case (refused as not a plain file, without blocking).
- NO CHANGE (NIT): the "no path, no key bytes" assertions cannot fail today (fixed sentences); kept as regression guards.

## Review 2 (opus, blind, on 38af31862): NOT CONVERGED
- Checked and held: \p{White_Space} in Node is exactly the 25 White_Space code points Rust trims (enumerated); base64
  0.22 URL_SAFE_NO_PAD agrees; domain separation; link/FIFO ordering; torn writes refuse rather than misread.
- FIXED (WARNING): mac_key is replaced with mac_id on every registration (setup.rs write_identity; renewal never touches
  either). mac_id is now read before and after the key and a change refuses ("registered again"); the result names
  macId so slice (c) can record which identity signed. CONTRACT for restore (#5536) and the content view (#5686): keep
  retired device keys, since a manifest verifies only against the identity that signed it (posted on #5535).
- FIXED (WARNING): a folder with mac_key and no mac_id (write_identity writes mac_key first; a cut-off registration) was
  read as a key. Now missing, as MacState::open and remote.holdsKey treat it.
- FIXED (NIT): "a renewed key is picked up" was wrong (renewal is the TLS certificate); the header now says what changes it.
- FIXED (NIT): the BOM and NBSP test literals were raw invisible characters; now escapes.
- Tests: 8. Mutants red: the identity compare, macId dropped, the mac_id form check, JS trim. The first read's missing
  check survives alone (the second read refuses the same missing file); with both reads' missing checks removed: red.
- Real files (17:5x, only ok/type/length printed): two connector-written state folders read ok, ed25519, a 32-char macId.
