# kosmos#5744 Mac half, slice 2a: the board reads a refusal's fields from mac-request

Plan for the whole Mac half: kosmos#5744 comment 6110117056. Slice 1 (kosmos-relay branch epochfield-5744) makes
`kosmos-tunnel mac-request` print a coordinator refusal as one stdout line,
`{"refusal":{"status":n,"code":c|null,"current_epoch":n|null}}`, beside the unchanged error on stderr and a non-zero
exit; `current_epoch` only beside `member_key_wrong_epoch`, 0 meaning "no key registered". This slice is the board's
reader. Nothing calls the member-key route yet; slice 2b (the member key store and registration) is the first user.

## What exists (measured on agent-workforce main 0bfeb1436)
- setupRun's failure result has no stdout: `{ ok: false, because, stderr, code }`. `because` is the last line of
  stderr, else of stdout.
- macRequest returns `{ ok: false, because }` on failure and reads stdout (lastJsonLine) only on success.
- Every verb but mac-request and fed-room prints its tracing logs on stdout.

## The call
- macRequest, on a failed run, reads the last stdout line as a refusal (`refusalOf`) and returns
  `refusal: { status, code, currentEpoch }` beside `because`. Each field is checked: status a whole number 100 to
  599 (else no refusal at all), code letters, digits and _ (1 to 40, else null), currentEpoch a safe whole number of
  0 or more (else null). A run with no such line (an older tunnel, an outage) has no `refusal` key.
- setupRun keeps a failed run's stdout as `said` only when the caller asks (`opts.keepStdout`); only macRequest does.
  Other verbs log on stdout, and one caller (companyStartRun) returns its failed result whole.
- setupRun never takes a `{"refusal"...` line as `because`, from either stream: it is data, not words for a person.
  With an empty stderr and only that line, `because` is "setup failed (exit N)".

## Rejected
- Giving every failed setupRun result its stdout: a later caller that spreads the result would carry log lines.
- Exporting refusalOf for a unit test: a test-only export fails the engine reachability gate (#265); the test drives
  macRequest through the fake tunnel instead.

## Weakest premise
That the tunnel prints the refusal line LAST on stdout. Slice 1 pins mac-request's logs to stderr at warn, so stdout
holds only that line; a tunnel built before slice 1 prints no line at all, which reads as no refusal.

## Tests
- engine/remote-refusal-5744.test.js (7 at 110ffd141), macRequest against the fake tunnel (two new modes in
  test-support/fake-mac-request.js): the wrong-epoch fields and because; epoch 0 kept, null null; malformed fields
  null and a bad status no refusal; the line never `because` with an empty stderr; CONTROL, an older tunnel gives no
  refusal and an answer is unchanged; an epoch beside another code is null; a differently spaced line is still not
  because; another verb (company-start) gets no `said` and no refusal line as because. Red-capable at 110ffd141:
  without refusalOf 5 of 7 fail; with `said` kept for every verb 1 of 7 fails; without the code gate 1 fails, and
  with the old prefix filter 1 fails (both measured at 781c354bc, 6 tests).
- Neighbours and gates at 4bbfa762a: remote*, mac-standing, account-computers, backupupload, federation*, fedseats,
  fedmembers, agentevents-5683, orgrollup-worlds-5532, orgpolicy-apply-5534, hostedguide, engine.reachable,
  browser-checks-reason-grep, web.speech-kind-1397: 887 tests, 886 pass, 0 fail, 1 skipped.

## Review 1 (sonnet)
- FIXED: the because-filter's comment named mac-request, but the filter applies to every verb and both streams (as
  planned); the comment now says so.
- DEFERRED, not an issue: a failed macRequest's `refusal` key would reach anything that serialises the result whole;
  orgenroll.preview, read, builds a new object from `because` and does not spread it; the other macRequest callers
  (about 20) were not read one by one. Every field in `refusal` is validated, so a spread would carry nothing
  unchecked.
- NIT taken: the keepStdout note is folded into setupRun's doc block.

## Review 2 (opus)
- FIXED: refusalOf now keeps currentEpoch only beside member_key_wrong_epoch, as the tunnel does, so slice 2b can act
  on any currentEpoch it gets; tested with a 429 that carries one.
- FIXED (conventions): macRequest's doc names the `refusal` key and when it is absent; the fake tunnel's header lists
  the two new modes.
- NIT taken: one rule for "a refusal line" (JSON with a `refusal` key), shared by the because filter and refusalOf,
  so a differently spaced or keyed line is still kept out of because; tested.

## Review 3 (sonnet)
- FIXED (convention): the Tests counts re-measured and restated with their shas.
- NITs taken: WRONG_EPOCH_CODE above its use; the code rule's comment names the tunnel's matching cap; the
  keepStdout opt-in and the because filter are tested through another verb (company-start).

## Review 4 (opus)
- FIXED: the epoch bounds were never tested beside the right code (the one malformed epoch rode with a bad code,
  which the code gate nulls first). Now 2^53, -1, 1.5 and "3" beside member_key_wrong_epoch read as null and the edge
  2^53 - 1 is kept; without the bounds check 1 of 9 fails (measured at 1fef52a04).
- NITs taken: a refusal line on stderr is tested (a third fake mode); the comment says the last JSON line is read;
  WRONG_EPOCH_CODE sits above refusalOf's doc block; the because filter's comment says whitespace-only lines are
  skipped too (before, one could be `because`).

## Review 5 (sonnet): converged (no new finding; NITs only)
- Its one WARNING repeats Review 1's deferral (a failed result's `refusal` key under a whole-result response). Now
  measured, not only read: in engine/orgenroll.js no function but `signed()` returns a signed result whole (grep of
  `return r|st|got`); of server.js's ten `sendJson(res, 200, <result>)` sites, the one fed by a macRequest wrapper
  (`/api/remote/computers`, accountComputers.fetchComputers) builds a new object. The other nine were not traced to
  their producers. Every field in `refusal` is validated either way.
