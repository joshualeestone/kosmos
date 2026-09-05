# Plan: #2037 feedback-report transmit seam (engine)

Branch: `consent-checkboxes-2037`. Card: kosmos#2037 (the transmit half of the daily product-feedback loop). Built night-shift 2026-09-05 from the Angel handoff + the #2037 card; this file records the plan the handoff drove.

## Goal / what "finished" looks like for THIS slice

`engine/feedbacksend.js` exists as the separate, opt-in-gated SEND layer that `engine/feedback.js` names ("the send layer, scrubbing + the gated seam, is a separate module built on top of these files"). Given a day's locally-stored report, it can POST that report to the collector in the exact shape agreed with kosmos#2246, scrubbed of home paths, and only when the person has opted in. Off by default. No `web/` change. Fully unit-tested with an injectable sender so a test run never phones home.

This is deliberately NOT the whole feature. The UI opt-in control, the default-ON flip, and the board-side send trigger are follow-up slices (see "Out of scope" below).

## Scope decisions (with reasons + weakest premise)

1. **Off by default in this slice, even though Josh ruled #2037 default-checked-on.** A default-on phone-home with no off-switch is the exact harm #2020 documents. Per #2013, a default and its control are one decision, so the default-ON flip lands in the same PR as the Settings/setup opt-in control (PR-C). Until then `read()` fails to OFF and nothing leaves the machine. Weakest premise: that sequencing default-off-now honors Josh's ruling. It does, by landing the flip WITH the control in PR-C; if Josh wants it on the instant the control exists, PR-C delivers exactly that.
2. **The send layer is a separate module (`feedbacksend.js`), not folded into `feedback.js`.** `feedback.js` explicitly reads no send/opt-in flag; writing is unconditional. Keeping the gate out of it preserves that contract.
3. **`maybeSend` ships unwired (no production caller) and is excused in the #265 reachability guard.** The `/api/feedback` POST route has no caller today, and the `kosmos feedback write` CLI is engine-direct and short-lived (a fire-and-forget async POST would hang it up to the timeout). The correct trigger is a board-side (long-lived) send, which belongs with the UI slice (PR-C). Wiring the seam into the route now would be cosmetic (the exact orphan-one-level-up the guard catches).
4. **What leaves is scrubbed of home paths.** `feedback.js` keeps home paths / project / agent names on disk on purpose; the send path is where they are redacted. `/Users/<name>` and `/home/<name>` (any account, boundary-safe) rewrite to `~`. Not called "anonymous" (a body can still name a project; #2037 forbids that word on this data).

## Contract with the collector (kosmos#2246, confirmed)

`POST <endpoint>` (`https://installkosmos.com/api/feedback`, env-overridable via `AGENT_WORKFORCE_FEEDBACK_URL`). JSON body: `{ install, date, generated_at, body, consent:{given,version} }`. Response `200 {ok:true,id}`. `payload()` is the single source of that shape; a test pins the keys so the two sides cannot drift. Kitty owns the collect + store-for-review side (#2246); Featurebase is deferred (stored to @vercel/blob instead) but the transmit endpoint is unchanged.

## Design (mirrors the proven ping.js / notify.js phone-home seam)

- `read()` / `setOn()`: the opt-in preference, fails-to-OFF (absent/unreadable/non-object all read off).
- `scrub(text)`: home-path redaction, boundary-safe on every account (mac + Linux).
- `payload(date)`: builds the #2246 contract from `feedback.read`/`readBody` + `ping.installId()`, body scrubbed, `generated_at` taken from the report frontmatter.
- `maybeSend(date)`: triple gate (test-network guard via `NODE_TEST_CONTEXT`, opt-in on, report exists), then a fire-and-forget POST with a bounded `AbortController` timeout and every error swallowed. Injectable `setSender` for tests.

## Test plan

`engine/feedbacksend.test.js`: sandboxed data root; OFF-by-default; unreadable-fails-off; setOn round-trip + non-boolean reject; scrub covers this machine's home, any `/Users/<name>`, and other `/home/<name>` accounts with a boundary (no prefix corruption); payload matches the contract exactly with a scrubbed body; generated_at from frontmatter (guarded with a fixed past timestamp so a fallback fails by years, not a 1ms race); no-report-null; the opt-in gate; endpoint env override; and a genuine red-able network guard (a test run never phones home). Plus the full suite green and the #265 reachability guard passing with the `maybeSend` excuse.

## Out of scope (follow-up slices)

- **PR-C (#2037 UI):** the Settings + setup opt-in checkbox, the default-ON flip, and the board-side send trigger. Disclosure copy approved by Josh: "An agent sends a daily report with bugs and improvement suggestions."
- **PR-B (#2020, separate card):** the create-agent ping checkbox restore (create-page checkbox + default-ON + inverting the ping.test.js guard), per Josh's ruling reversing the 08-26 removal. Different card, web change.
