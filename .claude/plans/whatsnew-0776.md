# whatsnew-0776: the What's New list for 0.7.76 (kosmos#7615 item 5)

Decision on #7615 (Baron, 10-30 07:47): the next cut builds the list for its own version first,
so 0.7.76 is not another cut with no "Kosmos has been updated" window.

Steps:
1. `node tools/whats-new-pool.js build 0.7.76` (online: prod-check read prod 0.7.71, which the pool
   already records, so nothing is marked shown and the pool file does not change).
2. Generated file only: web/whats-new.json, version 0.7.72 -> 0.7.76, same five highlights.
3. Checked: `tools/whats-new-check.js 0.7.76 ... --platform=mac` exit 0 (mac 5, windows 2);
   the four What's New test files, 52 pass, 0 fail.

If anything lands in the pool before the 0.7.76 cut, rebuild on a new branch; this list is not final
by being merged first.

Review round 1 (blind, 10-30 07:56): no BLOCKER or MAJOR.
- NIT, done: the build ran online; `--offline` gives the same bytes only while prod and the pool's
  lastProd agree (both 0.7.71 today). A re-check after a prod promote must run online.
- MINOR, follow-up card, not this branch: nothing checks at cut time that web/whats-new.json still
  matches a fresh build of the pool, so a pool item merged after this list ships silently missing.
  Two items are already queued for 0.7.76 (wnroom-7246, musequota-7615); I rebuild when they land.
