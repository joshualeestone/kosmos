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
- engine/remote-refusal-5744.test.js (5), macRequest against the fake tunnel (two new modes in
  test-support/fake-mac-request.js): the wrong-epoch fields and because; epoch 0 kept, null null; malformed fields
  null and a bad status no refusal; the line never `because` with an empty stderr; CONTROL, an older tunnel gives no
  refusal and an answer is unchanged. Red-capable at 4bbfa762a: without refusalOf 4 of 5 fail; without the because
  filter 1 of 5 fails.
- Neighbours and gates at 4bbfa762a: remote*, mac-standing, account-computers, backupupload, federation*, fedseats,
  fedmembers, agentevents-5683, orgrollup-worlds-5532, orgpolicy-apply-5534, hostedguide, engine.reachable,
  browser-checks-reason-grep, web.speech-kind-1397: 887 tests, 886 pass, 0 fail, 1 skipped.

## Review 1 (sonnet)
- FIXED: the because-filter's comment named mac-request, but the filter applies to every verb and both streams (as
  planned); the comment now says so.
- DEFERRED, not an issue: a failed macRequest's `refusal` key would reach anything that serialises the result whole;
  no caller does (measured: orgenroll.signed and the server send `because`), and every field in it is validated.
- NIT taken: the keepStdout note is folded into setupRun's doc block.
