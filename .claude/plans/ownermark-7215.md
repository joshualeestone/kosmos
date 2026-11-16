# ownermark-7215: the Settings link's "is an agent linked" check compares the whole owner marker (kosmos#7215)

Card: kosmos#7215 (Angel). The leftover from #8591's review cap (round 8): `ownerPageUrl()` counted an agent as linked
when its `ownerLinked` marker only started with this computer's id. The sweep compares the whole marker
(`ownerLinkMarker(mac, apiKey)`: the computer id and a digest of the agent's key), so after an agent registers again
with a new key its old marker still counted, and the link could show before any current agent was on the site.

## Done looks like

`ownerPageUrl()` counts an agent as linked only when `k.ownerLinked === ownerLinkMarker(mac, k.apiKey)`, exactly as
sweepOwnerLink does, and a test shows a marker for an old key does not count while one for the current key does.

## Change

- engine/communitysend.js `ownerPageUrl()`: the comparison above, and the sweep's own filters (review round 1): a
  deleted (retired) or retiring agent, a test seat, a refused key, or an entry with no name or key is not linked.
  If the retire list or the seat check cannot be read, they answer "skip", so the link hides then. That path has no
  test of its own: it fails in the safe direction (no link), and the fold beside it keeps every Delete.
- engine/communitymine-ownerpage-7215.test.js: `linkAgent` writes the marker as communitysend does (computer id and
  the key's digest); cases for a stale key, no key, a refused key, a retired account, a test seat and an agent being
  retired, each beside the current-key control.

Merges after the kosmos merge hold lifts (Baron's 0.8.06 promote, 11-16 15:58).
