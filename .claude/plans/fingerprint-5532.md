# fingerprint-5532: a per-computer fingerprint for the work Kosmos (#5532, Enterprise E0.3, contract v1.5)

Agreed 2026-10-07 with PigeonPete (coordinator owner). Found in #5531 review 13: the Kosmos+ signing key lives in the
world's data folder (<root>/remote), so a full copy of that folder on another computer is the same signer to the
company, and `thisComputer` cannot tell them apart.

## What this branch builds
- `engine/computerprint.js`:
  - `printFor(salt, company)`: THE call for callers: `{ send: 'print', print }`, `{ send: 'none' }`,
    `{ send: 'later' }` or `{ send: 'error', because }`. The bare print function is private (exported to the tests only
    as `_testFingerprint`): its null is ambiguous (review 11).
  - The print: HMAC-SHA256(key = salt bytes, message = company + ':' + hardware id), lowercase hex. The salt comes from
    the coordinator (whole bytes, either case); the company is the enrolled org's id FROM THIS BOARD'S OWN RECORD, never
    from a coordinator's answer. The company id in the HMAC keeps prints from matching across companies.
  - The hardware id (private): macOS IOPlatformUUID from `ioreg -rd1 -c IOPlatformExpertDevice` (measured: no prompt,
    no entitlement). A successful read is kept; a failed one is retried after a minute; after ten minutes of failing it gives up, and the
    wait then doubles up to an hour.
    Windows: null until the Windows owner builds MachineGuid (spec on #5532). Anything else: null.
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
  is accepted in either hex case (CORRECTED by review 13: Node's hex decoding already reads both cases alike, so the
  lower-casing did nothing and the mutation I recorded here reddened by changing the key's form, not its case; the
  lower-casing is gone and the upper-case test pins Node's behaviour);
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

## Review 10 (blind, sonnet)
- FIXED: a malformed salt or company is `{ send: 'error', because }`, a bug to say, not a silent wait forever and not
  a print-less send; the reason never holds an id or a print (mutation reddens).
- FIXED: "no id here" needs the hardware block's own header line (`+-o ... <class IOPlatformExpertDevice`), so a
  quoted mention elsewhere is a failed read to retry (fixture; mutation reddens).
- STATED in the module header, not only here: the residual that a computer which pinned no print can be copied and the
  copy passes; only a pin closes it, on the coordinator's side.
- FIXED: the guard's listing check asserts known files are present instead of a count.
- DUPLICATES / KEPT: the tests-only hooks on the export (review 4); module-wide retry counters (one computer, one
  hardware answer, so one counter is right).

## Review 11 (blind, opus)
- FIXED: callers use printFor() only; the bare print function is no longer exported (its null meant "send none" and
  "wait" at once). The header said to send no print on null; it now says to use printFor.
- STATED in the header and on the card: the company id must come from this board's own enrollment record, never from
  a coordinator's answer, or a coordinator could link companies with no hardware list at all. The print also does not
  rotate within a company across leaving and joining again.
- FIXED: the guard also flags any `ioreg` call and any use of `parseIoreg` outside this module (measured: no other
  hits today); salt and company are checked before the platform, so a malformed one is the same error everywhere; the
  give-up boundary is pinned at exactly GIVE_UP_AFTER; a test title now says what it checks; this plan's summary is
  current.

## Review 12 (blind, sonnet)
- FIXED (from my review-9/10 rule): "no id here" needs the hardware block without an id on TWO reads in a row, a
  minute apart; one such answer can be a dump cut short after its header line, and a good read resets the streak
  (tests; one-read mutation reddens).
- FIXED: the guard's failure message says only engine/computerprint.js may read the hardware, and that the Windows
  MachineGuid arm belongs there.
- NOT TAKEN: skipping the real-ioreg arm when ioreg is blocked (on a Mac that cannot read it the failure is real and
  says so); trimming the UUID and SALT exports (the tests use them).

## Review 13 (blind, opus)
- CORRECTED (my own overclaim in review 5): see the salt-case line above.
- FIXED: the guard scans the native app's languages too (swift, objective-c, c, java, kotlin, python) and more
  spellings (gethostuuid, IORegistryEntryCreateCFProperty, kIOPlatformUUIDKey, identifierForVendor, ANDROID_ID);
  measured with no other hits today.
- FIXED: the header says the bare print function is exported only under a tests-only name; the todo names printFor.
- DOCUMENTED (decided): the raw id lives in a module variable for the process lifetime; after giving up, the reader
  still tries once a minute, so a recovered reader is noticed.

## Review 14 (blind, sonnet)
- FIXED (from my reviews 11 and 13): the guard's loose words are anchored to how a read is made (a quoted or
  path-ended `ioreg`, `ioreg -x`, a call of parseIoreg or gethostuuid or IORegistryEntryCreateCFProperty,
  `.identifierForVendor`, `Secure.ANDROID_ID`), so a comment that merely mentions them in another lane's file does not
  redden the suite. Measured both ways: a planted mention passes, a planted ioreg invocation fails.
- DOCUMENTED: one enrollment can see 'none' and later a print (the reader recovered); an enroll with no print pins
  nothing, so the later print cannot mismatch.
- (WITHDRAWN by review 15: `out = ''` wiped nothing, since a JavaScript string cannot be cleared; the line is gone and
  the header says the dump stays in memory until garbage collection.)
- DUPLICATE: the never-log rule is prose until a caller lands (pinned test.todo, on #5532).

## Review 15 (blind, opus)
- FIXED: the reader guard also scans extensionless scripts (found by their #! line: install/kosmos, the pkg
  postinstall), CI yml, plist and gradle files; a planted extensionless ioreg script reddens it.
- ARMED NOW, not a todo: no file outside the tests may load computerprint until its first caller is added to an
  allowlist, in the same PR as its no-logging and company-source tests (a planted loader reddens it).
- FIXED: the give-up is ten minutes on the clock since the first failure in a row, not ten reads (a caller retrying
  rarely would wait days); after giving up the wait doubles up to an hour, so a hung ioreg costs one five-second stall
  an hour, not one a minute (both mutations redden).
- CORRECTED (my own overclaim in review 14): see above; "this Mac" in a test message is now "this computer".
- KEPT: the tests-only hooks on the export (review 4).

## Review 16 (blind, sonnet)
- FIXED (a repeat of review 12's class, which two-in-a-row only narrowed): "no id here" needs the WHOLE hardware block,
  its header line and its property list closed by a lone `}`. A dump cut off before the end, however often and however
  identically, is a failed read (test with the same cut twice; header-only mutation reddens).
- NOTED for the first caller (on #5532): run printFor off the request path or at start; the read can take 5 seconds.

## Review 17 (blind, opus): CONVERGED (its one warning repeats the decided synchronous read)
- Taken anyway, because the code did not do what its comment said: the whole-block check is anchored to the end of
  the text, not to any line (a lone "}" mid-dump no longer counts; test; the line-anchor mutation reddens).
- Also taken: the guard scans .json and .xml; the loader guard skips outside a git checkout like its sibling; the
  allowlist comment says the first caller runs printFor off the request path; the header says the monotonic clock does
  not count sleep.
- NOT TAKEN: renaming parseIoreg (it returns an id only from text its caller holds, and reading that text trips the
  READ guard).

## Review 18 (blind, sonnet)
- FIXED (my review-17 regex): the whole-block check is linear (a header search, an opening brace after it, and a
  lone "}" as the text's last line), so no backtracking; a 5 MB non-matching dump takes 5 ms (end-check mutation
  reddens).
- DECLINED: asking ioreg only for IOPlatformUUID (`-k`): that drops the block when the key is missing, so a VM with no
  id could not be told apart from a broken read.
- DUPLICATES: the tests-only hooks (review 4); the raw id in memory (review 13); parseIoreg (review 13).

## The design as it stands (the review notes above describe it as it changed)
- `printFor(salt, company)` only: `print` | `none` | `later` | `error`. Retry a failed read after a minute; give up
  after ten minutes of failing (then the wait doubles to an hour); "no id here" only for a WHOLE hardware block with no
  id, twice in a row.
- HMAC-SHA256(key = salt bytes, company + ':' + hardware id). Company id from this board's own record.
- No file outside the tests may load the module until its first caller is allowlisted with its no-logging and
  company-source tests; no file but this one may read the hardware.
