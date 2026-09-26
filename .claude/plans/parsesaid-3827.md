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
