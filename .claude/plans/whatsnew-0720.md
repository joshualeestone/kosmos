# whatsnew-0720: the 0.7.20 What's New highlights (DRAFT)

Release lead: Baron Draxum. Since the 0.7.19 pin 49c0f80f. Lines are added as their PRs merge; the cut needs this on
main for 0.7.20 (tools/whats-new-check.js).

## Highlights, each checked against the merged code
1. Gemini sign-in asks about your data: #4960 / PR #4974 (42429e757). After Google's code the sign-in dialog shows
   Antigravity's terms itself and applies the person's data-sharing choice (Antigravity 1.2.12+ starts the optional
   "let Google collect my data" box ticked; the old flow would have opted the person in).
2. Settings stays clickable: #4979 / PR #4991 (c7708fb24). The sticky nav sits 16px below the measured app header;
   when it cannot fit it scrolls with the page instead of hiding pills.
3. A running agent's files stay safe: #5003 / PR #5057 (2446c5cea). delete-leftover plan() compares case-blind on
   Mac and Windows, so a leftover asked in another case refuses while the agent runs.

## Candidates
- #5018 re-land (Angel, relandnotice-5018): the login-expiry notice with an X, provider and account named. Line once it
  merges and the gutter check is green: "The notice that an agent's sign-in has expired names the provider and the
  account, and has an X to close it."

## Decided, not missed
- #4470 slice 2 (agent page, new look): behind Settings > Advanced > Try the new look; nothing changes with it off.
- #5052, #5045: test-only.

## Review rounds
- Round 1 (opus): FIXED W: line 1 is Mac only (Windows' win32agysignin is unchanged): "On a Mac, ...". FIXED W: line 1's
  "asks before Google may collect" overstated (the box starts as Antigravity has it, ticked on 1.2.12+; the person
  chooses and nothing is sent until Agree): "and you choose if Google may use your data". FIXED W: "leftover" is not a
  word the app uses (it says removed agents / "Delete its files..."): line 3 and its title reworded. Line 2 true in both
  layouts. Nothing important left out.
- Round 2 (sonnet): all three JSON lines true (agysignin passes the terms and data box to the panel and never ticks or agrees for the person; s-nav below the measured header, static under 56rem; plan() case-blind on darwin/win32). One W on the release ENTRY draft (outside this repo): its 'instead of stopping on a screen Kosmos did not recognise' described the old failure wrongly; clause removed. The JSON is CONVERGED at 016e42db.
- 22:00: #5018 re-land line ADDED as line 1 against PR #5089 (head 61141e5ed, NOT yet merged): "The notice that an agent's
  sign-in expired now floats over the page instead of pushing it down, names the account, and has an X." This PR merges
  only after #5089 merges; re-check the line against the merged diff then.
- Review vs PR #5089 (sonnet): FIXED W: "sign-in expired" overclaimed (the notice also shows BEFORE expiry, warn and urgent
  states, and can cover several agents on one account); now "The warning that your agents' sign-in is ending now floats
  over the page instead of pushing it down, names the account, and has an X." Checked: floats in .topnotes under the
  header; names provider, email and agents; the X persists per browser until the state changes.
