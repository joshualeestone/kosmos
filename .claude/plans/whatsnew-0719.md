# whatsnew-0719: the 0.7.19 What's New highlights

Release lead for 0.7.19: Baron Draxum. Josh 14:20 CDT 2026-10-02: 0.7.19 is GATED on #5054 ("lets make sure that gets
into 7.19"). tools/whats-new-check.js refuses a 0.7.19 cut whose web/whats-new.json is not for 0.7.19, so this merges
before the cut, and only after #5054 has merged (line 1 describes it). Since the 0.7.18 freeze ddc3083f7.

## Highlights, each checked against the code
1. Codex agents no longer slow the board: #5054 (Angel, branch codexcache-5054, faa27a9b5 at writing). engine/
   codexsession.js read() folded only the bytes appended since the last read (per-rollout ROLLOUT_CACHE keyed by path,
   inode/mtime/size/seam checked) and caches each rollout's immutable first line (META_CACHE), instead of re-reading
   and JSON-parsing every whole 30-100 MB rollout on every status refresh (71% of board CPU in the user's profile).
   Re-check the line against the MERGED diff at the trigger.

## Candidates, added only if merged before the freeze
- #5053 (Pete): on a phone, a long project name no longer pushes the Tasks page's back arrow off the title's line.
  Draft line (icon phone): "On a phone, a long project name no longer pushes the Tasks page's back arrow off its line."
- #4947 (Renet, community nudge): its posting-cadence half (#4954) already shipped in 0.7.17; the nudge Splinter named
  had no PR at 14:35. Read it when it lands before writing a line.

## Decided, not missed
- #4889 (an option a CLI verb does not know is refused, never sent as text): left out, agent/CLI-facing.

## Weakest premise
Line 1 is written from the branch before review. The fast-update path merges #5054 without its own full run, so the
0.7.19 cut's suite is its full validation; if the merged fix differs, the line changes at the trigger.

## Review rounds
