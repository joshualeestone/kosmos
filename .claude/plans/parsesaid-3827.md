# parsesaid-3827 (kosmos#3827, split out as its own small change)

## Why
Live on 0.6.95 (Splinter confirmed on the served bytes, 2026-09-25 23:04): a fresh `kosmos-tunnel signin register` prints two stdout lines. First comes `fetch_certificate`'s "certificate for <address> written to ... (key stayed here)" (kosmos-relay crates/tunnel/src/setup.rs), then the JSON answer (`emit`, signin.rs). engine/remote.js `parseSaid` ran `JSON.parse` over all of stdout, so every first in-app sign-in read as "the tunnel program answered in a shape we could not read" while the Mac was registered, and `turnOnAfterSignin` never ran: the Mac stayed off. That fits Josh's 16:54 test.

## Change
- `parseSaid` reads the last line of stdout that is JSON. Every tunnel verb that answers JSON prints it last, as one line (`emit` / `println!("{}", json)`).
- The test fake's register prints the certificate line before its JSON, as the real one does. Every register test now runs against the real shape.
- Test: a fresh register is read as signed in and switches Kosmos+ on.

## Weakest premise
That the JSON is always the last line. True of `emit` on origin/main. If the tunnel ever printed a trailing non-JSON line after its answer, this would still find the last JSON line before it, as long as the answer is on one line.

## Not in this change
The wider #3827 hardening (single-flight register and Forget, half identities, cancels) is on signin-guard-3827, still in review. This is split out so the live bug makes the next cut.

## Round 1 review (opus)
- WARNING: macRequest (mac-standing, updating, phonenotify) and assistantChat parsed all of stdout too. The tunnel logs to stdout for every verb but fed-room (tracing's default writer, kosmos-relay main.rs), so a warn such as "could not record mac_last_signed" (full disk) made a signed request unreadable. All three readers now share lastJsonLine. Test: the fake mac-request prints a tracing line before its JSON; control (whole-stdout parse) fails by name. The upstream fix (route every verb's tracing to stderr) belongs to kosmos-relay and is noted on #3827.
- WARNING: the register test proved nothing by itself (every register test goes red on the old parse). lastJsonLine is exported and unit-tested: certificate line then JSON, JSON only, a tracing line first, CRLF, empty, no JSON line, a last line that does not parse (never falls back to an older object), pretty-printed JSON. Controls: the fallback-to-older variant fails "never the older object"; whole-stdout fails "a certificate line before the JSON".
- NIT: a re-register that kept its certificate prints JSON only; the fake has that branch (name "kept") and a test.
- Pre-existing, carded separately: setupComplete never caches standing (setupRun sets no .data and real `setup complete` prints no JSON).

## Round 2 review (sonnet)
- WARNING: the old parseSaid doc comment sat above the new lastJsonLine (documenting the wrong function, and "every devices verb" undersold it). parseSaid has its own doc again; lastJsonLine's names its three callers.
- WARNING: nothing pinned the assumption that the tunnel never logs a JSON-shaped line to stdout (its tracing uses the default human-readable format; no .json() anywhere in crates/tunnel). Stated at lastJsonLine with the file it depends on; the matching note beside tracing_subscriber::fmt() in kosmos-relay main.rs goes with that repo's next change (kosmos#3827 comment).
- NIT: the macRequest test used GET, which the real tunnel refuses (check_mac_request); now POST like every real caller.
- NIT: lastJsonLine returned an unused `ok`; it returns { value } or null.
