# fingerprint-5532: a per-computer fingerprint for the work Kosmos (#5532, Enterprise E0.3, contract v1.5)

Agreed 2026-10-07 with PigeonPete (coordinator owner). Found in #5531 review 13: the Kosmos+ signing key lives in the
world's data folder (<root>/remote), so a full copy of that folder on another computer is the same signer to the
company, and `thisComputer` cannot tell them apart.

## What this branch builds
- `engine/computerprint.js`:
  - `hardwareId()`: macOS IOPlatformUUID from `ioreg -rd1 -c IOPlatformExpertDevice` (measured: no prompt, no
    entitlement), read once per run. Windows: null until the Windows owner builds MachineGuid (spec on #5532, per the
    fleet's Windows rule). Anything else: null.
  - `fingerprint(salt, company)`: sha256(salt + ':' + company + ':' + hardware id), or null when the salt (hex from
    the coordinator's status, whole bytes), the company (the enrolled org's id) or the hardware id is missing. The raw id never leaves the computer; a per-account salt keeps prints from matching
    across accounts.
- Nothing calls it yet: enroll, leave and the rollup send it once the coordinator accepts the field (v1.5).

## Decided
- Null means "cannot say": a caller sends no print (as an older board would), never a made-up one.
- Weakest premise: a cloned disk image or VM clone copies MachineGuid, and a logic-board repair changes
  IOPlatformUUID. Both end at the consent prompt to make this computer the enrolled one, not at lost data.

## Tests
- `engine/computerprint-5532.test.js`: the ioreg parse on fixtures (serial number and malformed values refused); the
  print's formula, salt separation, null on a bad salt, a missing id, a failing ioreg, Windows and Linux; this Mac's
  real id checked for shape only (never printed). Mutations of the salt, the salt check and the parse each redden.

## Review 1 (blind, opus)
- FIXED: only a successful read is cached (a single ioreg timeout no longer silences the print for the whole run);
  any test seam bypasses the cache. Tested on the real, unseamed path through a test-only runner hook; the two cache
  guards back each other up, so each alone does not redden, and removing both does.
- FIXED: the raw hardware id is no longer exported (only fingerprint() leaves the module), and a guard test fails if
  any other engine file reads IOPlatformUUID or MachineGuid.
- DOCUMENTED, the two rules the guarantee rests on: never store the print under a data root (a copy would replay it);
  and the coordinator treats a missing print after a pin as a mismatch (told PigeonPete).
- FIXED: the stability test compares prints from fresh reads, as a boolean, so a failure can never print a value; the
  fixture no longer looks like a home path.
- KEPT: a synchronous read, once per board run until it succeeds (decided; an async read would add a state for one
  five-second worst case).

## Review 2 (blind, sonnet)
- FIXED (from my review-1 fix): after a failed read, ioreg is not asked again for 60 s, so a hung ioreg cannot block
  the board for five seconds on every call (mutation reddens).
- FIXED: the reader guard scans every tracked .js, .sh, .ps1 and .html file in the repo for any spelling of a raw
  hardware read (IOPlatformUUID, IOPlatformExpertDevice, IOPlatformSerialNumber, MachineGuid, the Cryptography key),
  and fails if the test-only reader swap is called outside the tests. Proven by planting a tracked file.
- FIXED: the salt must be whole bytes. parseIoreg stays exported for the fixture tests (it returns an id only from
  text the caller already holds); `_testRunner` is marked tests-only and guarded.

## Review 3 (blind, opus)
- FIXED: the print is sha256(salt:company:hardware id), the company being the enrolled org's id. Two companies always
  get different prints for one computer, even if a coordinator served them the same salt; unlinkability across
  companies no longer rests on the coordinator alone (mutation reddens). Told PigeonPete: the board computes it, the
  coordinator only pins and compares, so the coordinator needs no change.
- FIXED: the guard covers more spellings (system_profiler's hardware page, kern.uuid, WMI's computer-system product,
  machine-id, the split registry key) and says it is a guard on known spellings, not a proof; the exclusion is anchored
  to engine/; the test's fresh read uses the module's timeout and quiet stderr; `now` is documented as tests only.

## Review 4 (blind, sonnet)
- FIXED: no option on fingerprint() can change how the hardware is read. The reader, the platform and the clock are
  swapped only through the tests-only `_testRunner` / `_testClock`, which a guard test forbids outside the tests;
  `fingerprint.length === 2` is pinned (mutation reddens). So no production caller can skip the cache or the wait.
- FIXED: a platform with no reader returns null at once and records no failure (ioreg is never run on Windows;
  mutation reddens).
- DOCUMENTED: the print is a stable identifier for this computer within one company, so it is personal data that
  company holds under its own policy; it cannot link companies (the company id is in the hash). The guard test needs
  git and says so.
