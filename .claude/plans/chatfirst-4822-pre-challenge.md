---
pre_challenge: true
method: challenge-loop
branch: chatfirst-4822
diff_hash: 5324ad8f2c2b4a33f6b35053486eeaddc08f46f27682dc16326adee3b244b713
validation: path C (release blocker, Splinter 00:39), focused on the branch head, which sits directly on main ef7de426a. Baron on Mortals: render-dm-chatfirst-718 413/0 twice on 9f7402842; render-onekosmos-4815 56/56, render-tophead-stable-2624 OK, render-worldsw-lockout-3055 1/0, render-plus-bar-3837 19/0, render-worldsw-height-2350 0 FAIL, render-computers-4648 88/0 on 674288bc7 (web/ byte-identical since). web.* 2224/0 and browser-checks-reason-grep/wired 16/0 here.
subdir_audit: passed (no subdirectory CLAUDE.md in the diff)
timestamp: 2026-10-01T05:42:27Z
iterations: 2
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** No, stopped at round 2 on the PM's ruling (Splinter, 00:40): this fixes the check that stopped the 0.7.15 staging cut, and Josh's morning build waits on it. Ship the conversation-height fix; file the rest. Round 2 had no blocker. Its two warnings are on #4847 (claimed: Mona Lisa), with the round 2 review's reasoning.
**Fixed:** every round 1 WARNING | **Filed:** round 2's two WARNINGs on #4847

### Per-Iteration Breakdown

#### Round 1
**Reviewer model:** opus
- [WARNING] a showing notice could sit on the K mark's row and squeeze the name to an ellipsis --> FIXED (a showing slot takes its own row)
- [WARNING] max-width: 100% dropped the name's 220px cap on phones --> FIXED (min(220px, 100%))
- [WARNING] no check proved the name stays readable (an ellipsis-only name passed every cited check) --> FIXED (new arm in render-dm-chatfirst-718 at 130 and 150%; its floor set from Baron's measurement, 1.25em)
- [NIT] arrow spill at zero width --> FIXED (min-width 2.25rem); [NIT] WebKit sizing of a zero-basis child --> FIXED (.headleft justify-self: stretch); [NIT] #login-adv-slot:empty not hidden (pre-existing) --> noted

#### Round 2
**Reviewer model:** sonnet
- [WARNING] a long person's name on the right can still push the computer name to a second row at 320 and 150% text --> FILED #4847 (cap the right-hand group on a phone, with a long-name arm)
- [WARNING] the 2.25rem floor leaves almost no letters --> FILED #4847 (the new arm fails if it happens, as intended)
- [NIT] a showing notice wraps narrow and tall at 320; [NIT] the arm hardcodes a 16px root --> noted
