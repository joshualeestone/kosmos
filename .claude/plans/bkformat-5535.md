# bkformat-5535: E0.6 (#5535) slice 2, the pure half: the bytes a backup is made of

## Why
Design v2.1 on #5535 (two blind review rounds) fixes the backup's format: what a chunk is, how it is named, how it is sealed, and what a manifest binds. Slice 2's pure half has no I/O and no dependency on E0.1 / E0.2, so it lands now, on top of slice 1 (engine/hpke.js, merged as 06f76bf58). The walker (slice 3) and restore (slice 4) will call it.

## Change: `engine/backupformat.js`
- **`chunkBuffer(buf, opts)`:** content-defined chunking, FastCDC-style: a gear rolling hash with normalized masks (harder before the average size, easier after).
  - Format 1 sizes: min 256 KiB, average 1 MiB, max 4 MiB.
  - The gear table is fixed forever by format 1 (from SHA-256 of a constant label).
  - Masks test the HIGH bits. Bit k of a gear hash depends only on the last k+1 bytes, so low-bit masks would cut on a few bytes of local content.
- **`chunkName(namingKey, pt)`:** hex HMAC-SHA256 under the period's naming key (v2: per period, wrapped in the member key). It lives only in manifests and associated data; storage sees the coordinator's random object key (v2.1 item 7).
- **`padme(L)`:** the Padme padding of Nikitin et al. (PURBs, 2019), overhead at most about 12%. Chunk plaintext is framed as u32 length, data, then zero padding to `padme(4 + len)`. Unframing checks the length and that the padding is zero.
- **`sealNamedChunk` / `openVerifiedChunk`** (the only entries; `sealChunk` / `openChunk` are internal): `KBC1 | enc(32) | ct`, HPKE to the member's backup public key, info `kosmos-backup v1 chunk`, **associated data = the chunk name**, so a chunk stored under the wrong name does not open (v2 integrity). `chunkMatchesName` lets restore check content against the name (constant-time compare).
- **`sealManifest` / `verifyManifestSignature` / `openManifest`:**
  - The manifest is canonical JSON, HPKE-sealed to the member with the snapshot context (org, member, epoch, period, snapshot) as associated data.
  - It is then **signed by the member device's Ed25519 key** over `sha256(KBM1 | enc | ct)` plus the context bytes.
  - Object: `KBM1 | sig(64) | enc(32) | ct`.
  - `verifyManifestSignature` needs no member key, so the coordinator can check it and record the hash at grant time.
  - Context ids are pinned to `[A-Za-z0-9._:-]{1,128}`, so no field can forge another and no two contexts share signed bytes.
- **`canonicalJson`:** keys sorted at every depth, arrays in order, NaN and Infinity refused.
- Every open and verify returns null (or false) on any failure and never throws.

## Tests: `engine/backupformat.test.js` (15, each with a control)
- reassembly, min/max, determinism;
- content-defined: after a 1-byte insert near the start, at most 3 chunks differ (control: fixed-size slicing loses its chunks);
- empty, tiny and 6 MB real-size inputs; bad sizes refused;
- padme never shrinks, overhead at most 12.5% on 10 sizes, and 1000 neighbouring sizes fall into fewer than 10 buckets;
- chunk round trip; a wrong name does not open and does not match; another period's key gives another name; two sizes in one bucket give same-size objects (control: a larger chunk is larger);
- open failure cases;
- manifest: verify without the member key; another device refused; replay into each of the 5 context fields refused; a tampered byte breaks the signature; another member key cannot read it; empty and newline fields refused;
- canonical JSON.

## Checks
backupformat 15/15, hpke 11/11, engine.reachable (10 exports: 5 excused by name with their caller slices, the other 5 have real internal callers), plus every engine/ and tracked-file walker green. **Red-check:** a fixed associated data in place of the chunk name makes exactly the wrong-name test fail.

## Not in scope
Redaction and the credential scan (slice 3, with the walker), quotas, grants, POST policy (coordinator), restore orchestration (slice 4).

## Weakest premise
The 1 MiB average and the content-defined boundaries are tuned by reasoning, not measured on real work Kosmos trees (many small markdown files, a few large transcripts). Most files are far below the 256 KiB minimum and become one chunk each, so dedup across snapshots works per file. Measure on a real tree in slice 3 before freezing format 1. The gear table and sizes are the two things a format bump would change.

## Review round 1 (opus): 2 BLOCKERs, 3 WARNINGs, all fixed
- **BLOCKER, a manifest that seals and signs but can never be opened** (`undefined` serialized to invalid JSON; Dates, Maps and array holes silently changed). `canonicalJson` is now strict: it refuses everything that would not read back (undefined, functions, symbols, bigint, NaN, Infinity, -0, unsafe integers, non-plain objects). `sealManifest` also re-parses its output and refuses if it does not read back as itself.
- **BLOCKER, a forged chunk opened.** HPKE base mode has no sender authentication, so the name-as-associated-data stops swaps, not forgeries. Restore now opens chunks only through `openVerifiedChunk` (decrypt, then check the content against its HMAC name; the naming key is the member's), and the comments say where integrity really comes from. `openChunk` and `chunkMatchesName` are now internal.
- **WARNING, domain separation:** the signed bytes start with a fixed tag (`kosmos-backup v1 manifest-signature\0`).
- **WARNING, manifest size leak:** manifests are framed and padded like chunks.
- **WARNING, small files matched by size:** the frame has a 4 KiB floor, so all small chunks and manifests look alike.
- **NITs:** a canonical-name check in every function; each frame must be exactly its padded size (one valid encoding); the canonical JSON comment; new tests for crafted bad frames, chunking boundaries, refused manifest values and manifest padding.
- **Deferred, named:** a streaming chunker for very large files belongs to slice 3 (the walker), which reads files. This pure function takes a Buffer.

## Review round 2 (sonnet): no BLOCKER, 2 WARNINGs, fixed
- **Silent drops in strict JSON:** a one-hole array (`[,]`) became `[]` and still read back; symbol keys, non-enumerable properties and extra array properties were dropped. All are now refused (Reflect.ownKeys checks), with tests for each shape.
- **A top-level null manifest** sealed and signed but opened as null, which is indistinguishable from failure. Manifests must be plain objects (tested, with a null-prototype control).
- **Context ids** are pinned to `[A-Za-z0-9._:-]{1,128}`: a lone surrogate became U+FFFD, so two contexts shared a signed byte string.
- **padme** uses integer bit math (`clz32`), so the exact frame size cannot depend on an engine's Math.log2. A test compares it with a float reference at every power-of-two edge up to 2^31.
- Documented: `devicePub` must come from trusted state (the member's enrolled devices, E0.2). The signature proves the device, and that binding proves the member.

## Review round 3 (opus): no BLOCKER, 1 WARNING, fixed
- **A non-Ed25519 device key** (P-256, Ed448, RSA: all measured) sealed a manifest that could never verify or open, because the layout holds a 64-byte signature. `sealManifest` now refuses anything but an Ed25519 private key and checks the signature length. `verifyManifestSignature` refuses a non-Ed25519 public key. Tested for all three key types.
- NITs: the undefined-in-array row is nested (it was caught by the top-level guard instead); `openManifest` returns only a plain object; the plan's counts and context rule are updated.

## Review round 4 (sonnet): no BLOCKER, 2 WARNINGs (tests that could not fail), fixed
- The reviewer mutated two guards away and every test still passed. **The devicePub guard** now also requires a PUBLIC key (a private key was accepted), with a test that catches its removal; the Ed25519-type half is named as defence in depth (an Ed25519 signature never verifies under another type anyway). **The plain-object return of openManifest** is tested with hand-built, validly signed manifests whose content is null, an array, a number or a string (the control: the same builder's plain object opens), plus wrong magic, truncation and a non-Buffer.
- `sealNamedChunk(memberPk, namingKey, pt)` is the uploader's only entry: it derives the name, so a chunk cannot be sealed under a wrong name and never restore. `sealChunk` is internal; the tests forge chunks with raw HPKE, as an attacker with the public key would.
- A note on own `__proto__` keys in manifests (data, round-trips; restore must not merge blindly).

## Review round 5 (opus): no BLOCKER, 1 WARNING, fixed
- The reviewer removed each of 26 guards in a scratch copy, and 16 went red. **The only security guard with no test was the naming-key length check**, the thing that stops an empty or short key letting anyone forge valid chunk names. It is now tested: empty, 16-byte, 33-byte and string keys are refused on seal and on open, a forgery under an empty-key name is refused, and the round trip is the control.
- The remaining untested guards are unreachable behind other checks. Each is now labelled defence in depth in the code (the read-back check, the signature length, the frame length half), so the next reviewer does not report them again.
- The plan's export counts and entry names are corrected.

## Review round 6 (sonnet): converged (no BLOCKER, WARNING or CONVENTION), both NITs taken
- **A golden vector pins format 1's chunk boundaries:** 6 MiB of deterministic bytes give exactly 7 chunks of 286742, 1078049, 1781820, 1480926, 1131483, 441857 and 90579 bytes. Changing the gear table, the masks or the hard/easy switch would keep every property test green while silently ending dedup against existing backups. Now it fails a test, and needs a format bump.
- `chunkBuffer` validates caller sizes: integers, 0 < min < avg < max, 64 <= avg <= 2^28 (so the mask shift stays in range).
