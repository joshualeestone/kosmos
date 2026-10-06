# whatsnew-0725: the 0.7.25 "Kosmos has been updated" highlights (cut pinned at 03:00 CDT, Splinter's 10-06 plan)

Four lines, each checked against code on main; no API-key items (Josh 10-05):
| line | from | checked against |
|---|---|---|
| Copy a message or its id | #5312 (PR #5327) | web/index.html has "Copy message" and "Copy message id" on the message hover bar |
| Know before a Claude sign-in stops (MAC only) | #5168 (PR #5342) | Settings > AI Models row "Signed in · stops working at about <time>"; engine/claudeloginlive.js reads the keychain only on darwin, so tagged platforms ["mac"] |
| Older pictures reach the community | #5302 (PR #5337, 3cd4304aa) | the page fits pre-#4885 pictures with fitPicture while Community is on; the original kept (avatar-originals) |
| More Settings on a phone | #5303 (PR #5322) | a scroll-aware fade and a "More sections" chevron on the phone Settings row |

Left out: #5311 (native Mac app; not sure the cut rebuilds it), #4581 (CLI), #5285/#4649 (federation, off), agent-facing
changes (#5294 #5307 #5309 #5316 #5317 #5318 #5319). #5333 (PR #5341) is added if it merges before ~02:00.
tools/whats-new-check.js 0.7.25: mac 4, windows 3.
Weakest premise: line 3's "too big" covers pictures refused for size; pictures refused for their TYPE are also fitted (the
fit re-encodes), which the line does not mention but does not contradict.
