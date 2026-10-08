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
- **`sealChunk` / `openChunk`:** `KBC1 | enc(32) | ct`, HPKE to the member's backup public key, info `kosmos-backup v1 chunk`, **associated data = the chunk name**, so a chunk stored under the wrong name does not open (v2 integrity). `chunkMatchesName` lets restore check content against the name (constant-time compare).
- **`sealManifest` / `verifyManifestSignature` / `openManifest`:**
  - The manifest is canonical JSON, HPKE-sealed to the member with the snapshot context (org, member, epoch, period, snapshot) as associated data.
  - It is then **signed by the member device's Ed25519 key** over `sha256(KBM1 | enc | ct)` plus the context bytes.
  - Object: `KBM1 | sig(64) | enc(32) | ct`.
  - `verifyManifestSignature` needs no member key, so the coordinator can check it and record the hash at grant time.
  - Context ids are pinned to `[A-Za-z0-9._:-]{1,128}`, so no field can forge another and no two contexts share signed bytes.
- **`canonicalJson`:** keys sorted at every depth, arrays in order, NaN and Infinity refused.
- Every open and verify returns null (or false) on any failure and never throws.

## Tests: `engine/backupformat.test.js` (13, each with a control)
- reassembly, min/max, determinism;
- content-defined: after a 1-byte insert near the start, at most 3 chunks differ (control: fixed-size slicing loses its chunks);
- empty, tiny and 6 MB real-size inputs; bad sizes refused;
- padme never shrinks, overhead at most 12.5% on 10 sizes, and 1000 neighbouring sizes fall into fewer than 10 buckets;
- chunk round trip; a wrong name does not open and does not match; another period's key gives another name; two sizes in one bucket give same-size objects (control: a larger chunk is larger);
- open failure cases;
- manifest: verify without the member key; another device refused; replay into each of the 5 context fields refused; a tampered byte breaks the signature; another member key cannot read it; empty and newline fields refused;
- canonical JSON.

## Checks
backupformat 13/13, hpke 11/11, engine.reachable (6 exports excused by name with their caller slices; the 5 others have real internal callers), plus every engine/ and tracked-file walker green. **Red-check:** a fixed associated data in place of the chunk name makes exactly the wrong-name test fail.

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
