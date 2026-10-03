# whatsnew-0720: the 0.7.20 What's New highlights (DRAFT)

Release lead: Baron Draxum. Since the 0.7.19 pin 49c0f80f. Lines are added as their PRs merge; the cut needs this on
main for 0.7.20 (tools/whats-new-check.js).

## Highlights, each checked against the merged code
1. Gemini sign-in asks about your data: #4960 / PR #4974 (42429e757). After Google's code the sign-in dialog shows
   Antigravity's terms itself and applies the person's data-sharing choice (Antigravity 1.2.12+ starts the optional
   "let Google collect my data" box ticked; the old flow would have opted the person in).
2. Settings stays clickable: #4979 / PR #4991 (c7708fb24). The sticky nav sits 16px below the measured app header;
   when it cannot fit it scrolls with the page instead of hiding pills.
3. Leftovers never touch a running agent: #5003 / PR #5057 (2446c5cea). delete-leftover plan() compares case-blind on
   Mac and Windows, so a leftover asked in another case refuses while the agent runs.

## Candidates
- #5018 re-land (Angel, relandnotice-5018): the login-expiry notice with an X, provider and account named. Line once it
  merges and the gutter check is green: "The notice that an agent's sign-in has expired names the provider and the
  account, and has an X to close it."

## Decided, not missed
- #4470 slice 2 (agent page, new look): behind Settings > Advanced > Try the new look; nothing changes with it off.
- #5052, #5045: test-only.

## Review rounds
