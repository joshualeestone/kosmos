# whatsnew-0718: the 0.7.18 What's New highlights

Release lead for the 0.7.18 fast cut: Baron Draxum (Splinter accepted 2026-10-02 11:15; Josh 11:14 wants it fast).
The cut is triggered by #5039 (PR #5042) and #5029 (guidecap-5029) both merging. tools/whats-new-check.js refuses a cut
whose web/whats-new.json is not for the version being cut, so this PR must merge before the cut. Since the 0.7.17 bump
ccbc2ed46.

## Highlights, each checked against the code
1. Agents keep going when a message is flagged: #5039 / PR #5042. engine/trust.js preacceptBypass writes
   `"switchModelsOnFlag": true` (only when absent; an explicit false is kept) at create, on an account move and on
   every Mac launch, so Claude Code switches to Opus 4.8 instead of stopping on its safeguards modal.
2. The Guide says when it is out of usage: #5029 / guidecap-5029. A new marker reads Claude Code's "You've hit your
   ... limit" as rate limited, so guideFailure fires and the existing hosted backup (#3660, #3723) takes over with its
   own words ("I'm helping on Kosmos's backup. Add credits with Claude, or wait until the limit resets.").
3. See a file full page: #4930 (click a file a message carries: dark backdrop, X, Open in Finder / Download).
4. Room posts that landed: #4926 / #5001 (sendPostWithDelivery no longer throws when the post reached the room).

## Decided, not missed
- Left out: voice (#4971), see round 1; #5002 Documents one list at a time, #4983 a team says hello to its members, #4972 agents stop starting
  messages with their own name, #4961 page polish, #5027 one community introduction; and the infrastructure PRs.
  Each is real but smaller for the person than the four above; the dialog holds 1 to 5.
- Lines 1 and 2 describe PRs not yet merged at writing. This PR merges only after both have merged (the cut needs both
  anyway). If either changes before merge, its line is re-checked.

## Weakest premise
Line 1: PR #5042 itself says it has NOT measured that an agent launched the way Kosmos launches it honours the key and
skips the modal. The line describes the product as it will be once that holds (Josh, 09-14: legal and release copy
describe the product as it will be); if the measurement fails, line 1 comes out in a follow-up before prod.

## Review rounds
- Round 1 (opus): FIXED B: line 4 announced hold-to-talk, but voice has never been announced (#4899 pulled 0.7.16's
  line until someone has heard it working) and #4409 says it is not yet observed in the Mac app; dropped, replaced by
  #4926. FIXED W: line 3 said Finder (Windows says File Explorer; over Kosmos+ the button is Download): now "a button to
  show it on your computer, or to download it over Kosmos+". FIXED W: line 1 overclaimed Windows (win32launch.js does
  not write the key; existing Windows agents do not get it): "On Windows, new agents only." NITs taken: "Claude's safety
  check flags". DECIDED W (not taken): make observing the switch on a Kosmos-launched agent a merge condition. Josh
  wants this cut fast, and the cut exists for #5039; staging readers are the team. Line 1 stays, and observing it is a
  condition for the PROD promote instead: if it is not seen working on staging, line 1 comes out first. LEFT NIT: the
  default-account reach into the person's own ~/.claude/settings.json is a disclosure question for Josh (#5039).
