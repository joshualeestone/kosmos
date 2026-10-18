# usagewire-5532: the company rollup reads this Kosmos's own token use

Card: kosmos#5532 (my slice of #5529). The board half of a pair; the coordinator half is kosmos-relay usageconsent-5532
(a company's consent words name per-day token use; the route then stores a company's usage rows).

## What changes
- `engine/orgrollup.js defaultSources`: `usageByDay` is `engine/usage.js worldUsageByModel(USAGE_DAYS)` (#5571), the
  reader scoped to this Kosmos's own roster (sessions launched in its agents' folders), never the computer-wide readers.
  Usage still leaves only under accepted words that name it (`usageConsented`, unchanged).
- `gather(src, { usage })`: reads usage only with `usage: true` (opt-in; any other caller scans nothing and says
  usageWithheld). The tick
  gathers with `usage: false`, decides, then reads usage for a send under words naming it (`usageConsented`); each other
  Kosmos's child reads usage only when told `usage` (one line names both every Kosmos and usage,
  `everyKosmosUsageConsented`); any other argument reads none. The child waits 30 s for usage (CHILD_USAGE_READ_MS), leaving
  its pane reads room inside the 2 minute bound. It takes the reader's `{ byDay, complete }`; an incomplete count sets `usageIncomplete`, which marks the
  body truncated, and NOT `partial` (partial holds the daily an hour and blocks change sends, and a count can stay
  incomplete for good). A plain day map (test sources) is still taken.
- Another Kosmos's usage goes only when ONE accepted line names both every Kosmos on this computer and usage
  (orgenroll everyKosmosUsageConsented; the coordinator's every-Kosmos line says "agent, project, activity and token use
  lines"): a usage line alone covers this Kosmos's own.
- A scan that outlasts the wait still finishes; the last finished scan (under a day old) is used by a later send whose
  own wait gives up, marked incomplete, so a computer whose scan always outlasts 60 s can still report usage on a send within a day of
  the last finished scan, when the tick runs in the board's own process (see Not covered). The first
  give-up is logged once.
- Merge order: the coordinator half first (Renet merges both; family-e2e's hash pin assumes it).
- A scan pending over an hour (PENDING_SCAN_MAX_MS) is given up on, so a hung scan cannot withhold usage for the life
  of the process; a superseded scan's late result touches nothing (a generation count). At most one given-up scan may
  still be running: on a stuck mount each would hold a worker thread, so a second give-up waits for the first to end.
- One scan at a time (scanUsageOnce), except after an hour pending: a read the wait gave up on keeps running, so a
  later send shares that scan; one pending past the hour is left running and a fresh one starts beside it. A reader answer of the wrong shape is withheld, never sent as zero.
- Stale text: orgenroll.js's NAMES_USAGE comment named the coordinator's removed flag; tools/family-e2e-6239.js pins
  the company consent hash, which the coordinator half changes (fc7e3f7b...).
- engine.reachable.test.js: the excuse for worldUsageByModel goes, since the rollup now calls it.

## Decided
- An incomplete count is sent, marked truncated, rather than withheld: a roster profile that outlives its folder keeps
  the count incomplete forever (usage.js says so), and withholding would then hide all usage permanently. It does not
  touch `partial`, so a Kosmos's other reports are not delayed by it. Weakest premise: that the console reads
  truncated as "not the whole" for usage as it does for agents and projects (contract v1.1).
- Cost: the tick decides whether anything is due WITHOUT usage (the signature never includes it), and reads usage only
  for a send, under consent: about once a day plus change sends, not every tick. Each other Kosmos's child reads it
  whenever the enrolled Kosmos sends, including for a Kosmos whose own change send is then skipped (up to 15 extra
  scans per enrolled send). A send waits at most USAGE_READ_MS (60 s) for usage; past it, or on
  a failed read, usage is withheld for that send ("not reported yet", never 0). The wait is bounded, not the scan (it is
  not cancelled), and the pane reads are not bounded by it, so a child can still hit its 2 minute limit on a slow
  board; a slow usage scan alone cannot. Without consent, nothing is scanned.
- Order with the coordinator half does not matter for behaviour: until both land, either the words do not name usage
  (the board withholds) or the coordinator refuses it. It does for one pin: tools/family-e2e-6239.js's
  COMPANY_CONSENT_HASH is the coordinator half's new hash, so merge the coordinator half first (until it lands the pin
  matches no served words and that step 9 clause discriminates nothing).

## Tests
- `engine/orgrollup-scope-5532.test.js`: with no agents on the roster, a session elsewhere on the computer is not sent
  (CONTROL: the computer-wide reader does see it), and usage is read rather than withheld; new: a session launched in
  an agent's folder IS sent, with its tokens, while the other session still is not (both with model ids build()
  keeps, so a leak would show); with words that do not name usage it is not read at all (CONTROL: the same sources
  read it when wanted); an incomplete count is truncated and not partial.
- `engine/orgrollup-5532.test.js`: under words naming usage, a send reads usage once and carries it; a later tick past
  the change window, with nothing changed, gathers but reads none (CONTROL: nothing was sent).
- `engine/orgrollup-scope-5532.test.js`: a reader slower than the wait is withheld (CONTROL: a quick one gives its count).
- `engine/orgrollup-5532.test.js`: under words that do not name usage, a send reads none (CONTROL: it sent); a failed
  read is sent as withheld, not as zero.
- `engine/orgrollup-worlds-5532.test.js`: the child-order pin now anchors on `rollup.gather(` (the call takes options);
  a source pin that sendOthers passes the consent, gatherIn tells the child `usage` only when consented, and the child reads none otherwise.
- `engine/orgrollup-5532.test.js`: a reader that never answers goes out as withheld on a real send (tick's usageReadMs).
- `engine/orgrollup-scope-5532.test.js`: the agent-folder test plants its own elsewhere session; a wrong-shaped answer is
  withheld.
- `engine/orgrollup-worlds-5532.test.js` (behaviour, beside the source pin): under words naming usage, each child is
  asked for usage and another Kosmos's count goes with its rollup, an incomplete one truncated (CONTROL: a complete one
  is not); under words that do not, each child is told not to read it.
- `engine/orgrollup-worlds-5532.test.js`: a usage line for this Kosmos alone, beside an every-Kosmos line that does not
  name usage, does not send another Kosmos's usage (each child not told usage, each sibling body withheld).
- CLAUDE.md: the orgrollup row names the usage source and the usage option.
- `engine/orgrollup-scope-5532.test.js`: when the scan outlasts the wait, the first read is withheld (CONTROL, from a
  reset state) and a later read uses the finished scan, marked incomplete. `_resetUsageScanForTests` is a test seam,
  excused in engine.reachable.test.js like `_resetOwnPostNudgesForTests`.

- `engine/orgrollup-scope-5532.test.js`: two overlapping reads share one scan; a kept scan more than a day old is not
  used (CONTROL: within the day it is); gatherIn gives the child `usage` only when told (execFile stubbed); a bare object
  with non-date keys, or an empty one, is withheld.
- `engine/orgrollup-scope-5532.test.js`: a scan pending over an hour is given up on (a second scan starts; CONTROL: within
  the hour a later read shares it), and the superseded scan's late answer does not replace the newer one.
- A superseded scan settling while the newer one runs leaves the newer one shared (no third scan).
- `engine/orgrollup-worlds-5532.test.js`: the child's `main` reads usage only when its argument is `usage` (gather stubbed).
- No third scan starts while a given-up scan still runs (a stuck mount).
- Once the given-up scan settles, a later hour may give up again (the slot frees).
- The hour is measured on the wall clock, so a clock jump forward can make a young scan look
  an hour old (the one-slot cap bounds what that costs), and a jump back delays the give-up by its size. A kept scan
  whose time is in the future is not used.
- An empty count that is not complete is withheld, never sent as a zero; an empty complete count is a real zero and
  is sent; a kept late scan with no days is not reused (tested, with a control that reuses one with days).
## Not covered
- An empty count marked incomplete is withheld even for a quiet week where one agent folder was unreadable:
  usage.js answers that the same way as a read that found nothing, and does not say which. That Kosmos shows "not
  reported yet" rather than zero until a read completes (the safe direction; a reason field would need usage.js).
- A test that spawns the real child: its default sources read the live tmux server and Kosmos status, which a test sandbox
  does not stand in for. Covered instead by behavioural tests on the parent (what `gatherIn` is asked), on the child's
  `main` with gather stubbed, and source pins on the argument; the child reads nothing unless told `usage`, and gather reads nothing unless asked, so both fail closed.
- A late count reused from an earlier scan can be up to a day old and is marked only truncated, not stale.
- The kept scan is module state. When the enrolled Kosmos's tick runs in a child process (the board on screen serves
  another Kosmos), it dies with each run, so there a scan that always outlasts the wait is always withheld; a board
  restart also forgets it, and with daily-only sends the reuse window is about one scan's length. Persisting it is
  possible later; for the pilot the board serves its own enrolled Kosmos.
- Scope residual (engine/usage.js): in the default world, where Kosmoses share the workers folder, same-named agents of
  two Kosmoses, or a person's own session started in an agent's exact folder, count as this one's. The consent line says
  "sessions launched in your agents' folders", which is what is counted.
- A reused scan is not tied to the roster it was taken for: within its day it can predate a removed or added agent.
