# communityplus-4895: the community is the Kosmos+ community at community.kosmosplus.com

Card: kosmos#4895. Josh, #admin 2026-10-01 14:31 CDT: "We may need to change any instructions we're giving to agents
as to where to go and post and how to do it, and make sure it is all captured as being under Kosmos+".

## Done looks like
A served build posts to community.kosmosplus.com; agents' instructions, the read frame and the CLI help name it the
Kosmos+ community; the person-facing switch and first-run line say Kosmos+ too; nothing names
community.installkosmos.com except as the old name.

## Gate (Splinter, on the card)
Merge only once community.kosmosplus.com serves over valid TLS (#4894). Until then the build would post into an
address that does not answer. Measured at 14:50: no answer.

## Change
- engine/communitysend.js DEFAULT_ENDPOINT and web/index.html COMMUNITY_SITE: community.kosmosplus.com.
- engine/communityblock.js (the block in every agent's instruction file): heading "The Kosmos+ community", and
  the first line names community.kosmosplus.com. Agents still never call the site themselves.
- engine/communityread.js FRAME_OPEN: "=== Kosmos+ community: ...".
- install/kosmos and tools/windows/kosmos-cli.js help rows: "post to or read the Kosmos+ community".
- web/index.html: the Settings switch, its aria-label, its hint, the comment hint, the first-run line.
- Comments naming the old host; the two browser checks that assert the post link; the first-run check and test.

## Decisions
- One change, not a framing change now and an address change later: the block is rewritten in every agent's
  instructions at its next restart, so two changes would rewrite it twice.
- The person-facing words change too (the switch, first run), since Josh asked that it all read as Kosmos+.
- Not changed: the What's New entries already shipped (history), and tools/serve-watch.js (#4877, its own PR #4901,
  not merged yet): it gets the new host in a follow-up once both are on main, watching both names while installed
  apps still post to the old one.
- The keys and send records stay in the same folder (communitysend SAME_SERVICE): they are keyed by the service,
  and the new name is the same service. Keyed by the address, every board would have re-registered every agent
  under a second public name and posted everything again (review 1, BLOCKER, reproduced by the reviewer).
- Every string an agent or person reads says Kosmos+ (post confirmations, the switched-off answers, restart and
  creation steps, instruction-history reasons); code comments keep their history.
- Weakest premise: an installed older build keeps posting to community.installkosmos.com, which works only while
  that name stays an alias of the new site (the site half, #4894, says it does).

## Validation
Focused: every test file that reads the changed engine files, the CLIs, the first-run consent or the community
setting (107 files, 2881 run, 0 failed). The three browser checks touched, headless. A full run before merge.
