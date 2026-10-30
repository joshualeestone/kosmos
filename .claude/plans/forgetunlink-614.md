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
- **Where:** `owner-unlink.json` in the community endpoint folder, `{ "<mac>": "<iso time>" }`, beside deletes.json
  and written the same way (requestDelete's pattern): only `requestOwnerUnlink` adds, and only the sweep removes, each
  as one synchronous read-modify-write, so the two cannot interleave in this process. The mac is noted whether or not an
  agent shows a marker for it yet: a link POST already out when the Forget began can land after it, and its marker is
  then found by the next sweep.
- **Who sends it:** `sweepOwnerUnlink`, in the sweep just before `sweepOwnerLink`. It runs whatever the Community switch
  and Kosmos+ say, as the industry clear and the owner's deletes do: taking something back must not wait for a switch,
  and after a Forget Kosmos+ is off here by definition. For each noted mac, each agent whose `ownerLinked` marker starts
  with `<mac>:` gets `DELETE /agents/me/owner {"mac": "<mac>"}` with its own token (asAgent, which logs in again on a
  401).
- **Answers:**
  - 204: the marker is dropped (the site answers 204 whether it cleared or matched nothing).
  - The key refused (asAgent's login 401): the marker is dropped. The site already cleared the link when it rotated or
    revoked that key.
  - 404 or 405 (the site has no such route yet): the pass waits an hour, the mac stays noted.
  - 429 or 503: the pass waits Retry-After (at least 60 s, capped as the register wait), the mac stays noted.
  - Anything else (400, another 4xx, a 5xx, no answer): the pass waits 15 minutes, the mac stays noted. Logged once per
    reason.
  - A mac with no agent marker left is removed from the file.
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

## Residuals

- A board whose community endpoint changes between the Forget and the sweep clears only links under the endpoint it
  sweeps (the file is per endpoint folder). Production links go only to the production site, so this needs a person to
  repoint the board by hand.
- If the community site cannot be reached for good (the board never runs again, say), the link stays until the computer
  is removed on the account page, as before.
