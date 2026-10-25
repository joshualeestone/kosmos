# iosparity-7084: the iPhone board-parity suites run in the board's own validation (kosmos#7084)

## The call
The suites that read the board's source to pin parity (room, settings, tasks; newtask with #7078) also run in the
board's node suite as ios.board-parity-7084.test.js, on any machine with swiftc. Every full validation runs on a Mac,
so a web or engine change that breaks a pin goes red before it merges, and the GitHub Mac queue gains nothing (#5488).
On Linux CI they skip with the reason. ios.yml is unchanged except a header note saying where they run.

Suites are found, not listed: a main.swift that READS a file under web/ or engine/ (repoText("web/..."),
appendingPathComponent("engine/...")). A mention in a comment is not a read (the top-level suite names engine files in
comments; actions reads only iOS files). Measured: room, settings, tasks; newtask joins automatically.

## Rejected (the card's options)
1. web/index.html and engine/tasks.js in ios.yml's paths: a full Mac job (app build) on almost every web PR (#5488).
2. A separate small Mac job on those paths: still a Mac queue slot per web PR; the queue wait is the cost, not the run.
3. The pins on the node side: each pin compares a compiled Swift value with the page; reimplementing them by parsing
   Swift source is fragile and doubles the fact.
4. Accept the drift: it reddens innocent iOS PRs, which is the defect.
A Linux runner with a Swift toolchain was checked and rejected: BoardLogic imports CryptoKit and
UniformTypeIdentifiers, and the suites compile SessionKeychain (Security).

## Weakest premise
That every web or engine PR gets a full local validation on a Mac before it merges. That is the fleet's rule (the
validation helper), not a CI gate; a PR merged without one would not be caught until the next iOS PR, as before.

## Cost
About 32 s of swiftc per full validation (three suites, measured on this Mac).

## Proof
ios.board-parity-7084.test.js: 5 pass (discovery, the read-not-mention rule, three suites). Arms: a board word changed
in web/index.html (TSK_GROUPS' first label) reds the tasks suite here; discovery broken reds the discovery tests.
tools.all-node-tests-considered-1934.test.js passes with the new file.

## Review 1: no blocker; two lows taken, two recorded
- Taken: discovery reads one shape of read, so a future suite reading the board another way would be unguarded in
  silence. New test: every other suite that reads the repo (KOSMOS_REPO) may read only ios/ files; anything else fails
  and names the read. Arm: actions pointed at docs/push.md reds it.
- Taken: the skip reason said "Linux CI"; the condition is "no swiftc" (also a Mac without Xcode), and it now says the
  suites were NOT checked there.
- Recorded: on a 10-minute timeout node kills only the runner, so a hung swiftc or test binary and its temp folder can
  outlive it (needs a hang first). And the premise is a convention, not a gate (above).
- Tests: 6 pass.
