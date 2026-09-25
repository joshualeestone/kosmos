# hosted-client-3660: the Mac side of the setup assistant on Kosmos's own model

Card: kosmos#3660. Splinter, 2026-09-24 21:23: Renet takes the Mac-side client (install key at first run, signing,
retry and re-sign); the coordinator side is Ice Cream Kitty's (kosmos-relay `assistant-3660`); the bubble is Mona's
(`assistant-bubble-3034`). Owner split recorded on #3660.

## What this branch does
- `remote.assistantChat(body)`: runs the tunnel's `assistant-chat` verb, body on stdin, and reads
  `{"status", "body"}`. A refusal is still an answer; a missing verb (an older tunnel) is marked `unsupported`; a
  failure or an unreadable answer is `ok: false`. Suite guard: under the test runner with no fake tunnel it never
  runs the real one (which would spend our key on a sandbox's message).
- `engine/hostedguide.js`: shapes the conversation to the contract (the last 8 turns, starting and ending with the
  person, 2,000 characters each, refused rather than cut), adds `page` in the in-app guide's own words
  (`pagecontext.describe`, bounded to 1,000), retries ONCE after the next second on `assistant_upstream`,
  `assistant_busy`, `replayed` or no answer, and turns every outcome into one shape.
- `POST /api/setup-guide/hosted` `{ messages, page? }` for the bubble: 200 `{ reply, remaining }`, or the refusal's
  own status with `{ error, code, retryAfterSecs, unsupported }`. `error` is a sentence to show as-is.

## Decided, and why
- **No crypto on the board.** The board's rule (`engine/remote.js`, "NO CRYPTO HERE"): keys and the signature string
  live in the tunnel binary, tested against the coordinator in one repo. So the install key, its registration and
  the signing are the tunnel verb's, proposed to ICK on #3660 as ONE verb that picks the key (the Mac's when enrolled,
  else the install key it registers on first use) and prints `{status, body}` for any answer. Rejected: signing in
  Node with `node:crypto`, a second implementation of the signature string nothing tests against the verifier.
- **Retry by code, never by sentence.** The coordinator's refusals are sentences for the person; asked ICK to add the
  fixed `code` to the body. Until it does, no refusal is retried (the safe direction), and only "no answer" is.
- **Review round 1:** a missing verb is recognised from the tunnel's WHOLE stderr (clap prints the
  "unrecognized subcommand" line first and usage after, measured on the shipped tunnel; `setupRun` now also returns
  `stderr`); a timeout is never retried (the message may be counted); only 429 and 503 pass through, anything else
  from upstream is 502 (401/403 mean "sign in to the board" here), with the reason in `code`; two person turns in a
  row keep the newest; `page` carries the SCREEN LINE ONLY, so agent, project and tab names never leave the Mac.
- **The route is a pure proxy.** Whether to ask the hosted assistant or the person's own guide is the bubble's call
  (Mona's `GET /api/setup-guide` says whether a guide exists).

## Weakest premise
That ICK (or whoever owns the tunnel crate) adds the `assistant-chat` verb soon. Until a tunnel with it ships, the
route answers 501 "the setup assistant arrives with the next Kosmos update", which is honest and useless.

## Verification
- `engine/hostedguide.test.js` (12): shaping (keeps the newest, starts with the person, refuses a system turn,
  alternation, length, controls), page text, answer passthrough with `remaining` and the page in the body, refusals
  not retried, the three give-back codes retried once after a wait and at most once, no-code and cap not retried,
  transport retried once then said plainly, an older tunnel's 501, nothing sent for a malformed conversation;
  `remote.assistantChat` through a fake tunnel (argv verb, body on stdin not argv, refusal as an answer, missing
  verb, failure, bad shape) and the suite guard.
- `server.hosted-guide-3660.test.js` (4, the real server in-process with a fake tunnel): passthrough, a refusal's
  status and fields, the 501, and a bad request refused before the tunnel runs.
- Five mutations, each RED.
