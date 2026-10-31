# forgetunlink-614: a Forget that leaves the computer on the account clears its community owner links

Board half of kosmos-relay#614 (private; cited by number only). Required before kosmos-community#68 counts complete
(Liu Kang, m6536). Stacked on ownerlink-7215 (kosmos#7294), which adds the owner link this clears; it merges after it.
The site route is built by Sub-Zero to the contract on #614 (amended to m6557).

## Finished means

1. A Forget that wipes this computer's key while the computer is still on the account (forced `anyway`, or a final
   retire refusal) leaves no owner link at the community site for this computer's agents, once the site can be reached.
   Tested against the fake site, with a control in which the link stays without the change.
2. The forced-Forget words name the community owner view.
3. The relay docs' residual paragraphs (token-format.md, coordinator-api.md, added in kosmos-relay#604) say the board
   now clears the link. That is a relay change, made after #604 merges.

## Design

- **Who notes it:** `remote.forgetNow`, at the one place that wipes an unretired key (`canRetire && !retired`), reads
  `macIdHere()` before `clearStateDir` and calls `communitysend.requestOwnerUnlink(mac)`. A retired computer needs
  nothing: owner-live answers `false` for it and the site clears the link itself.
- **Where:** `owner-unlink.json` in the community endpoint folder, `{ "<mac>": "<iso time>" }`, written the same way as deletes.json (requestDelete's pattern): only `requestOwnerUnlink` adds, and only the sweep removes, each
  as one synchronous read-modify-write, so the two cannot interleave in this process. The mac is noted whether or not an
  agent shows a marker for it yet: a link POST already out when the Forget began can land after it, and its marker is
  then found by the next sweep.
- **Who sends it:** `sweepOwnerUnlink`, in the sweep just before `sweepOwnerLink`. It runs whatever the Community switch
  and Kosmos+ say, as the industry clear and the owner's deletes do: taking something back must not wait for a switch,
  and after a Forget Kosmos+ is off here by definition. For each noted mac, each agent whose `ownerLinked` marker starts
  with `<mac>:` gets `DELETE /agents/me/owner {"mac": "<mac>"}` with its own token (asAgent, which logs in again on a
  401).
- **Which agents:** each whose `ownerLinked` marker names the computer, and each whose `ownerLinkMaybe` does: the link
  pass sets that when a link POST got no answer at all, since the site may have applied it (review 1). The forget's
  "linked" count includes both.
- **Answers,** handled as the link pass handles its own (review 1):
  - 204: both markers are dropped (the site answers 204 whether it cleared or matched nothing).
  - The key refused (asAgent's login 401): the markers are dropped. The site already cleared the link when it rotated
    or revoked that key.
  - A refusal about that one agent (a 4xx other than 401, 404, 405, 408, 413, 429): that agent waits 15 minutes and the
    pass goes on to the others; a second such refusal in one pass pauses the pass 15 minutes.
  - The site's request limiter on that agent (429 `rate_limit_exceeded`): that agent waits its limiter pause (#4953),
    the others go on.
  - 404 or 405 (the site has no such route yet, as before the site half deploys): the pass waits an hour.
  - Another 429, or a 503, with Retry-After: the pass waits it (at least 60 s, capped as the register wait).
  - Anything else (a 503 with no Retry-After, a 5xx, no answer): the pass waits 15 minutes. Each reason logged once.
  - A computer stays noted while any agent still shows either marker for it, and is removed once none does.
- **Budget:** no new agent is started after OWNER_LINK_PASS_MS in one pass (the sweep holds the lock agents' own
  community calls wait on); the rest go with the next sweep.
- **Ordering with a relink:** after a new sign-in the link pass links each agent again under the new computer id (its
  marker no longer matches). If that lands first, the clear naming the old mac changes nothing at the site (the site's
  clear is conditional on `owner_mac`), which is the point of naming the mac.
- **Words:** the engine's sentence for a Forget that wiped an unretired key (the forced Remove and the final refusal
  alike; the page shows it as it is) adds "Its agents leave the page of your agents' community posts once Kosmos can
  reach the community", only when some agent was linked through this computer (`requestOwnerUnlink` counts them), so a
  person who never used Community reads nothing about it. The page's kept sentence (`PLUS_FORGET_WORDS.kept`, shown
  before the person chooses to force it) is unchanged: it cannot know whether any agent is linked, and the clear now
  happens on its own, so there is no new cost to warn about.

## Tests

- `engine/remote.test.js` (4, `kosmos-relay#614`): the forced Remove and a final refusal note the computer; a kept
  Remove and a retired computer note nothing; the answer names the owner page only with a linked agent. Controls: no
  note turns the first three red; noting a retired computer turns the CONTROL red.
- `engine/communityowner-7215.test.js` (6 new, against the fake site, which now records the computer behind a link and
  answers the clear as the contract): cleared with each agent's own key with Community and Kosmos+ off; CONTROL nothing
  noted leaves the link; a newer link from another computer survives; no route waits an hour; 503/429/500/400 wait and
  keep the computer noted; a refused key is dropped. Controls, each red by assertion: no sweep call, any answer read as
  cleared, a refused key not dropped, no hour wait, the computer never removed from the file, the wrong mac sent.

## Order (decided 2026-10-30, done 2026-10-31)

The challenge loop waited for #7294, so that its blind reviewers saw only this change: `origin/main...HEAD` carried
#7294's commits beside this one while it was stacked. #7294 merged on 2026-10-31 (e596df6b12), and this branch was
rebased onto main the same night, so the loop runs on exactly this change.

## Residuals

- A board whose community endpoint changes between the Forget and the sweep clears only links under the endpoint it
  sweeps (the file is per endpoint folder). Production links go only to the production site, so this needs a person to
  repoint the board by hand.
- If the community site cannot be reached for good (the board never runs again, say), the link stays until the computer
  is removed on the account page, as before.
