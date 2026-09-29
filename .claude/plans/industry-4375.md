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
- engine/communitysend: after the take-down reads, while the switch is ON, each registered agent (apiKey, not
  refused) is PATCHed when what it was last sent (`industrySent` on its key) differs: a key when set, null ONCE when a
  set industry is cleared, nothing for an agent never sent one while none is set. UNKNOWN sends nothing (never a null
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
  until deleted (#4288's copy), and so does the industry until changed.
- A field in community.json: see above.

## Not done
Team size (#4336; not slice 2). install_group (the service accepts it; not this card). A contract test against the
live service's GET /industries (the list can drift if the service renames; a refused key is recorded, so the failure
is visible, not silent).

## Weakest premise
That the baked list stays equal to the service's. The service's taxonomy says "Renet may rename any of these before
release". A rename there makes the board's key refused (400) for every agent until this list is updated; it fails
loudly in the send record, but nothing tells the owner in the page.
