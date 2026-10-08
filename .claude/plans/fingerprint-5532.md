# fingerprint-5532: a per-computer fingerprint for the work Kosmos (#5532, Enterprise E0.3, contract v1.5)

Agreed 2026-10-07 with PigeonPete (coordinator owner). Found in #5531 review 13: the Kosmos+ signing key lives in the
world's data folder (<root>/remote), so a full copy of that folder on another computer is the same signer to the
company, and `thisComputer` cannot tell them apart.

## What this branch builds
- `engine/computerprint.js`:
  - `hardwareId()`: macOS IOPlatformUUID from `ioreg -rd1 -c IOPlatformExpertDevice` (measured: no prompt, no
    entitlement), read once per run. Windows: null until the Windows owner builds MachineGuid (spec on #5532, per the
    fleet's Windows rule). Anything else: null.
  - `fingerprint(salt, company)`: HMAC-SHA256(key = salt bytes, message = company + ':' + hardware id), lowercase hex,
    or null when the salt (hex from
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
- FIXED: the company (the enrolled org's id) is in the print (then sha256; review 5 made it an HMAC). Two companies always
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

## Review 5 (blind, opus)
- FIXED: rule 1 now forbids LOGGING the print, or a request body that carries it, not only storing it under a data
  root (a copied log replays as well as a copied folder). The same rule goes on the card for whoever wires enroll,
  leave and the rollup.
- CHANGED before any print is pinned: HMAC-SHA256 with the salt as the key (the standard keyed construction); the salt
  is accepted in either hex case and lower-cased, so a coordinator's case cannot change the print (mutation reddens);
  the retry wait uses a clock that never runs backwards; the catch block says never to log its error (its stdout is
  the full ioreg dump).
- DOCUMENTED: within one company the print is a pseudonym the company can resolve (it holds the salt and its own id,
  and an MDM inventory often lists hardware ids); it hides the id from everyone else.

## Review 6 (blind, sonnet)
- FIXED: the failure time uses null, not 0, as "never failed", so a failure at clock 0 still starts the wait (test;
  the old falsy check reddens it).
- ON THE CARD for whoever wires enroll, leave and the rollup (a repeat of reviews 4 and 5): the print is a pseudonym
  the company can resolve, and it is never stored or logged, nor a request body that carries it.
- KEPT: UUID and SALT stay exported for the tests; the guard sees tracked files only (it says so).

## Review 7 (blind, opus)
- FIXED: `printState()` tells a caller what to do: 'ok' (send the print), 'none' (no reader on this platform: send
  without one, as an older board), 'waiting' (a read failed and the retry wait runs: DEFER the request). Without it,
  one ioreg timeout on the real computer would send a print-less request, which the coordinator reads as a copy.
- CORRECTED: the coordinator's side can resolve prints too (it serves every salt, knows every company id and receives
  every print), and with candidate hardware ids could link one computer across companies. Not anonymous to Kosmos+.
- PINNED as test.todo: the first caller of fingerprint() must come with a guard that its file never logs the print or
  a body carrying it (the rule is prose until a caller exists). Also on #5532.
- FIXED: the doc comment and this plan described the old sha256 formula; "only fingerprint() leaves the module" now
  reads "the raw id is not exported"; tests register their cleanup first; three guard spellings are anchored to how
  they are invoked (/etc/machine-id, wmic csproduct, "Hardware UUID:"), so a mere mention does not redden the suite.

## Review 8 (blind, sonnet)
- FIXED: a Mac where ioreg answers but has no hardware id (some VMs) is 'none' (send without a print), not a
  'waiting' that never ends and so never lets it enroll or leave. A print is only compared once one was pinned, and
  none ever is for such a computer (mutation reddens). Asked PigeonPete to confirm an absent print at enroll pins
  nothing.
- ON THE CARD (a repeat of the kept synchronous read): callers compute the print off any request hot path.
- FIXED: the header claims what holds ("no function that READS the hardware is exported"); the repo-wide guard skips,
  with its reason, outside a git checkout.

## Review 9 (blind, opus)
- FIXED (all three from my reviews 7 and 8): `printFor(salt, company)` replaces printState and answers ONCE:
  { send: 'print', print } | { send: 'none' } | { send: 'later' }. 'print' always carries a print, so a malformed salt
  or company defers instead of sending a print-less request that reads as a copy. "No id here" is said only when
  ioreg's hardware block is there with no UUID key at all; a garbled or cut-off answer is a failed read to retry. An
  ioreg that always fails stops deferring after GIVE_UP_AFTER (10) failed reads, about ten minutes: then 'none', and a
  pinned computer is asked by its company to re-enroll with consent, a recoverable end instead of an endless wait.
  Each of the three mutations reddens.
- SCOPE (PigeonPete confirmed in code): an enroll with no print pins nothing and clears an earlier pin; a print is
  compared only while one is pinned. So the print stops a COPY of a data folder from reporting unseen; it does not stop
  the person from moving their own enrollment to another computer, which is the consented codeless enroll by design.
- FIXED: the merged comment line; withReader registers its cleanup first.
- KEPT: the tests-only hooks on the export, guarded by the repo scan (decided in review 4; the guard says it is a guard,
  not a proof).
