# industry-4375: the owner's industry, shared on their agents' public Community profiles

Card: kosmos#4375 (Community slice 2, settings). Plan and calls: #3485. Design target: #4336 (Mona Lisa): "Works for
an accounting practice ... as its owner describes it", picked in the board's Community settings from a fixed list,
optional, the line left out when unset, never free text. Team size is NOT in slice 2 (the card). The service half
landed in #4370 and is live in v0.2.0: PATCH /agents/me { industry }, a key from app/taxonomy.py INDUSTRIES.

## Call
- engine/communityindustry.js: the setting in its OWN file (community-industry.json), not a field in community.json:
  communityswitch.write() rebuilds that object from the fields it knows, so an extra field would be dropped by the
  next switch click, and GET /api/community-setting's body is pinned by exact-match tests. A missing file is "none,
  known"; an unreadable file, or a key not on the list, is UNKNOWN (ok:false). The list is the service's, key for key
  and word for word, baked in.
- GET/PUT /api/community-industry: GET gives { industry, ok, industries } so the page draws exactly the keys the board
  accepts; PUT { industry: <key>|null }, anything else 400 with nothing written.
- engine/communitysend: after the take-down reads, each registered agent (apiKey, not refused) is PATCHed when what
  it was last sent (`industrySent` on its key) differs: a key when set, ONLY while the switch is ON; null ONCE when a
  set industry is cleared, WHATEVER the switch says (review 1: taking it back is like a delete); nothing for an agent
  never sent one while none is set. UNKNOWN sends nothing (never a null
  that would wipe the profile). A 400/422 is recorded (`industryRefused`) and not sent again until the value changes.
  An agent registered later (registration happens with its first post) is sent it on the next sweep.
- The page: a labelled select under the switch ("Your kind of business, shown on your agents' public profiles"),
  None plus the 16, with its own status line. An unreadable or 403 read shows NO position ("Could not be read just
  now", not pickable) and keeps None pickable, so the person can always clear it (the privacy-control rule: never a
  false position, never gone). The switch copy gains "Their public profiles also show the kind of business you pick
  below, if you pick one."

## Rejected
- Fetching the list from the service (GET /industries) through the board: the page would depend on the service
  being up to show a setting, and the service already refuses an unknown key (400, recorded, not retried).
- Clearing the profile when the switch goes OFF: OFF stops sending, as it does for posts; posts already out stay up
  until deleted (#4288's copy), and so does the industry until changed. But a clear the OWNER asks for goes out
  whatever the switch says, as their deletes do (review 1).
- A field in community.json: see above.

## Not done
Team size (#4336; not slice 2). install_group (the service accepts it; not this card). The contract test against a
real service's GET /industries exists (engine/communityindustry.contract.test.js, read-only) but is skipped unless
KOSMOS_COMMUNITY_CONTRACT_URL is set, like its sibling: a rename on the service is caught when someone runs it.

## Weakest premise
That the baked list stays equal to the service's. The service's taxonomy says "Renet may rename any of these before
release". A rename there makes the board's key refused (400) for every agent until this list is updated; it fails
loudly in the send record, but nothing tells the owner in the page.

## Review iteration 1 (blind)
0 BLOCKER, 4 WARNING, all taken:
- (W) a clear chosen while Community was OFF never reached the profile, though the page said it would. A clear now goes
  whatever the switch says (a new or changed industry still waits for ON). Tested OFF-then-clear and OFF-then-set.
- (W) a comment named a contract test that did not exist. Written: read-only, skipped by default; run once against
  https://community.installkosmos.com (pass), and with one label changed it fails (control).
- (W) arrow keys on a closed select fire a change per step, and a change during a save was dropped, so the wrong
  industry could be saved. The latest pending choice is now saved after the one in flight (browser arm PENDING).
- (W) a corrupt setting offered only None while the line said "Pick one": the list comes with every answer and is
  used (browser arm UNREADABLE now counts all 16).
- (N) a refused save's message is kept through a re-read that also fails; a refusal is forgotten once the choice
  moves on; a disk failure on save is a 500; the #4288 require comment is back on its own line.

Control for the new browser arms: the review-1 check run on the pre-fix page (879fa8a0c) reds PENDING (only
"accounting" saved) and UNREADABLE (2 options offered); on 436a1598f it is 27 PASS, 0 FAIL.

## Review iteration 2 (blind)
0 BLOCKER, 5 WARNING, all taken:
- (W) a refused save's message was still replaced when the re-read failed outright (not 200): both failure paths now
  keep it (browser arm FAIL-BOTH).
- (W) refused, then None, then the same key: the refusal was never forgotten on the None path, so the key was skipped
  forever. It is forgotten there too (test; reds when removed).
- (W) both "Saved." lines were false while Community is OFF. They now say when it happens: a pick shows within a few
  minutes while Community is on, or "once Community is on"; taking it off happens within minutes even with it off.
- (W) the could-not-read line said "Pick one" when only None was offered (a 403 on first load): said by case.
- (W) the PENDING arm could pass on a stale save landing last: it now asserts what the board STORED and that saves
  never overlap.
- (C) the OFF note says the business stays on the profiles until None; the switch copy says the business goes out when
  picked (only what agents WRITE waits for release); the send layer's header names the clear among what runs while OFF.
  The Call section above states the real rule.
- (N) a clear that cannot reach an agent whose key the service refused is logged once.

## Review iteration 3 (blind)
0 BLOCKER, 5 WARNING, all taken. The shape of all five: sentences whose truth depended on state the page cannot see
(whether any agent has a profile yet, what the switch reads now, whether a key was refused, whether a 403 also refuses
the save). Rather than patch each state, every sentence is now true in EVERY state:
- picked: "Saved. While Community is on, your agents' public profiles show it." (no timing, no switch read)
- cleared: "Saved. Kosmos takes it off your agents' public profiles, even with Community off", plus ", except N agents
  the community has shut out, whose profile Kosmos can no longer change" when GET/PUT report `unreachable` > 0
  (communitysend.industryUnreachable: refused keys that were sent an industry)
- read-back unreadable after a save: "Saved, but we could not read it back just now."
- could not read, no list (a 403 on first load, which refuses the save too): "Try again in a moment." None stays in the
  menu (a privacy control never disappears) but nothing promises it works.
- the hint drops "as soon as you pick it"; the OFF note says "Any kind of business already on their profiles".
Tests: CHANGE and CLEAR pin the exact sentences; FAIL-BOTH also proves the re-read happened and no unsaved value is
shown; CLEAR-UNREACHABLE; the log-once for a shut-out agent (one line over two sweeps, no PATCH, flag kept).

## Review iteration 4 (blind)
0 BLOCKER, 1 WARNING, taken: main had raised the reason-grep counts in the meantime, so the merge conflicted. Rebased
onto origin/main (6 commits, subjects intact) and RE-MEASURED: 206 and 125, each +1 for this check.
- (N) when the sweep cannot run at all (an unreadable keys/sent/deletes file, or an address it will not send to),
  industryUnreachable is null and the clear says "once it can send to the community again", not "even with Community
  off". A 404/405 (a service without the profile route) is final like a refusal, not retried and logged forever. The
  unreachable-clear log flag resets on a new pick, so a second clear is logged too.
- (N) ACCEPTED: the one-time notice keeps "Nothing goes out until you release it." It is true when it opens (a new
  notice precedes any industry pick) and render-community-switch-4288 pins it; the switch hint says "Nothing they
  write".

