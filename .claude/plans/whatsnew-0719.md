# whatsnew-0719: the 0.7.19 What's New highlights

Release lead for 0.7.19: Baron Draxum. Josh 14:20 CDT 2026-10-02: 0.7.19 is GATED on #5054 ("lets make sure that gets
into 7.19"). tools/whats-new-check.js refuses a 0.7.19 cut whose web/whats-new.json is not for 0.7.19, so this merges
before the cut, and only after #5054 has merged (line 1 describes it). Since the 0.7.18 freeze ddc3083f7.

## Highlights, each checked against the code
1. Codex agents no longer slow the board: #5054 (Angel, branch codexcache-5054, faa27a9b5 at writing). engine/
   codexsession.js read() folds only the bytes appended since the last read (per-rollout ROLLOUT_CACHE keyed by path,
   inode/mtime/size/seam checked) and caches each rollout's immutable first line (META_CACHE), instead of re-reading
   and JSON-parsing every whole 30-100 MB rollout on every status refresh (71% of board CPU in the user's profile).
   Re-check the line against the MERGED diff at the trigger.

## Candidates, added only if merged before the freeze
- #5053 (Pete): on a phone, a long project name no longer pushes the Tasks page's back arrow off the title's line.
  Draft line (icon phone): "On a phone, a long project name no longer pushes the Tasks page's back arrow off its line."
- #4947 slice 2 (Renet, started 14:28): a board-side community turn, so an idle agent with no post in about 3 hours
  gets one line nudging it to post. Splinter 14:35: it rides 0.7.19 ONLY if it merges before #5054; otherwise it is
  out and the cut does not wait. Line written from its merged diff, never before.

## Decided, not missed
- #4889 (an option a CLI verb does not know is refused, never sent as text): left out, agent/CLI-facing.

## Weakest premise
Line 1 is written from the branch before review. The fast-update path merges #5054 without its own full run, so the
0.7.19 cut's suite is its full validation; if the merged fix differs, the line changes at the trigger.

## Review rounds
- Round 1 (opus, against codexcache-5054 @ faa27a9b5): FIXED W: "Kosmos now reads ... each conversation" with no reason
  could read as a privacy statement; now "to check on each agent, Kosmos now reads only what is new in its
  conversation, not all of it." FIXED W (release entry): "most of the computer's attention" overstated (71% is the
  board process's CPU); now "could keep Kosmos itself too busy to answer." LEFT NITs: title kept; the entry's opening
  needs widening if #5053 or #4947 slice 2 joins; the ~30-agent profile check on the card is not run (re-check at merge).
- Round 2 (sonnet, against MERGED #5054 19aa2a1f5): CONVERGED. Line 1 and the entry still true (merged fix = branch plus byte-exact offset and row guards). #4947 slice 2 and #5053 did not merge before #5054: OUT (Splinter 14:35).
