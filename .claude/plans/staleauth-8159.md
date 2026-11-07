# kosmos#8159: a Grok subscription sign-in not renewed for days reads "not confirmed since <date>"

## The defect (from the card)
`kosmos accounts` and the AI Models row read a Grok subscription as signed in (Kosmos's record) 18 days after its
refresh token had died. grokaccounts.subscriptionVerdict answers CONNECTED for any auth.json with a refresh token,
offline; #3997's free live check runs only on an unexpired key, because Kosmos never refreshes a person's token from a
probe (#3391). So a lapsed sign-in can only be found by an agent stopping at a sign-in screen.

## The call
grok renews its short key (about six hours) every run, so a key that expired more than 3 days ago means nothing has
renewed or used the sign-in since. Then the verdict stays CONNECTED but carries `notConfirmedSince` (the expiry), and:
- `because`: "Grok has not renewed this sign-in since <date>, so it is not confirmed. If its agents stop at a sign-in
  screen, sign in again" (kept over the live check's "renews on its next run" in the server overlay);
- `kosmos accounts`: "not confirmed since Oct 19, 2026; if its agents stop at a sign-in screen, the person signs in
  again in Settings > AI Models";
- the page pill: "Not confirmed since Oct 19" (amber, as before), the row's existing Sign in again is the remedy.
No sign-in is spent: nothing refreshes or calls xAI.

## Rejected
- Calling it expired or not connected: a long-unused refresh token can still work (the card's weakest premise).
- Refreshing to find out: rotates the token under a running grok (#3391) and spends the person's sign-in.
- Using the last observed agent success: a successful grok run rewrites auth.json, so expires_at already moves.

## The other subscription providers (measured by reading their code and this Mac's `kosmos accounts`, 19:4x CST)
- ChatGPT (codex): a real live check (codex doctor's handshake, #2790), so a dead sign-in reads dead. No gap.
- Claude: `claude auth status` plus agents seen working; all 8 Claude rows here read "signed in" (working). A
  long-unused Claude sign-in would read signed_in_unverified with no date; not changed here (no date Kosmos holds).
- Antigravity (Google): the row already says "signed in the last time Kosmos checked" with that time, and offers
  Sign in again. Honest already.
- Muse (Meta): Muse's own record; no date Kosmos holds, and a refused turn already turns it red (#4569). Not changed.
- Qwen and the api-key rows: live key checks. No gap.

## Weakest premise
Three days. grok renews on every run, so a sign-in in use never gets here; a person who runs Grok weekly sees
"not confirmed since" between runs, which is true. Not measured on a real expired auth.json: grok deleted the card's
file when xAI refused it; the tests use the same shape (refresh token, expires_at 18 days back).

## What would change my mind
A measured xAI refresh-token lifetime (then the line could follow it), or Grok gaining a free status command.

## Verification
engine/grokaccounts.stale-8159.test.js (10 tests after review 3; first 6: the card's case, a 2 h control, the 3-day line both sides, no or
bad expiry, the CLI line, page and server pins). Mutants: threshold 0 fails the control and the line; threshold
Infinity fails the card's case and the line. 45 related test files (1144 tests) pass. Page change not browser-checked
(an existing amber pill class with new words).

## Decided after review
- Round 1: autobalance never picks a not-confirmed sign-in as an automatic target. The manual move picker still
  offers it (the person chooses, and Settings labels it). One date wording (this computer's day, with the year).
  The overlay's reason is grokaccounts.subscriptionReason, tested.
- Round 2: the board summary counts not-confirmed sign-ins apart ("..., and one sign-in is not confirmed"; alone:
  "One sign-in is not confirmed and may need signing in again"), never as "thinking for your agents".
- Round 2, decided not changed: creating an agent on a not-confirmed sign-in is allowed with no new note. Refusing
  would block a long-unused refresh token that still works, and the person picks the account where Settings says
  "Not confirmed since". Weakest premise: a person creating from the board may not have looked at Settings. A
  create-time note would need the create result to carry warnings; a follow-up if that proves to matter.
- Round 3: the summary counts only rows still unconfirmed (badge checked); the pill's title names Sign in again only
  when the row has an email (the button needs one); "see it" for one row.
- Round 4: CORRECTION to round 1. Autobalance moves Claude accounts only (decide/eligible keep provider anthropic),
  so it never reached a Grok row; the guard, its test seam and its test are removed, and a test now fails if
  autobalance ever takes another provider. No Check now on a not-confirmed Grok row (its key ran out, so the check
  could only say "renews when Grok runs", against the row's advice). The CLI line says "adds the Grok account
  again" for a row with no email, as the page does; the date words are pinned in one test for both.
- Round 5: REVISES round 2's create decision. The create picker labels the row in place, "(not confirmed since
  <date>)", the way it already labels an unchecked one, so the person sees it where the agent is made (no create
  result change was needed). Creating on it stays allowed. Check now stays on a row seen working.
  Kept (NIT): accountline keeps its own copy of the date format. It requires nothing, and both CLIs load it by
  itself (install/kosmos via kosmos_engine_module, the Windows CLI via ctx.engine), so it does not pull in
  grokaccounts. One test pins both to "Oct 19, 2026".
