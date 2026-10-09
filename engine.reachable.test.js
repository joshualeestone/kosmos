/**
 * Engine complete, tested, unreachable — detectable (#265).
 *
 * Angel's diagnosis: the engine is written first and carefully, and the screen
 * is a separate act nobody re-checks was performed. Four features shipped that
 * way (assignPart, restart, commitments, owesReply): tests green, engine
 * documented, no person able to reach any of it — and one of them the product
 * actively DENIED having.
 *
 * The signature is greppable: an exported engine name that its own tests
 * exercise and NOTHING else references. This test computes that list and
 * fails on any name not explicitly excused below, so the fifth instance is
 * caught the week it is written rather than found by a person.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

/* Test seams and re-exports, excused BY NAME WITH A REASON. An entry here is
   a claim someone can check; do not add names to quiet the test without one. */
const EXCUSED = {
  _chainWaitMs: 'engine/communitysend.js (#5623 Rule 2): a read-only view of agentCall\'s chain wait (chainWaitMs stays private), so engine/replynudge.assign-5623.test.js pins that every bad waitMs falls back to AGENT_WAIT_MS and that a caller omitting it keeps the old wait; agentCall itself is the production caller.',
  worldUsageByModel: 'engine/usage.js (#5532 E0.3): the scoped usage reader for the company rollup, landed and tested on its own first (as chunkBuffer above). Its caller is engine/orgrollup.js on the rollup branch, which reads it only under the consent words; remove this excuse when that lands.',
  resetPauses: 'engine/communitysend.js (#4953): a test seam that clears the per-minute 429 pauses (and the once-said unreadable-429 note) between tests, so one test\'s pause cannot hold the next; nothing in the app resets them',
  setTmuxCandidates: 'engine/status.js (#2955): a test seam, the list of tmux binaries tmuxRepick asks at the version wall; engine/status.test.js sets it so its fakes are asked instead of the real Homebrew paths.',
  setOwnTmux: 'engine/status.js (#2955): a test seam, Kosmos\'s own tmux path, which status.js derives from where it is installed (pinned by its own test); engine/status.test.js points it at a fake.',
  setLauncherTmux: 'engine/status.js (#2955): a test seam, the launcher pick that status.js otherwise reads once at module load; engine/status.test.js sets it because a loaded module cannot re-read its environment.',
  _registerRetryAt: 'engine/communitysend.js (#4940): a read-only view of the register 429 wait (registerRetryAt stays private), so the five-minute cap is measured by engine/communitycomment-4373.test.js rather than inferred. A test seam, as _paths is.',
  _saveJsonForTest: 'engine/communitysend.js (#5431): saveJson itself, so engine/communitysend.test.js can drive a save of unchanged bytes and check that keys.json is still put back to owner-only. A test seam, as _paths is.',
  isCodexHookEvidence: 'test-only by design (#4589): pins a Codex card\'s evidence to the hooks dialog\'s rows; NO production code keys on it, because the delivery floor reads the screen fresh (its comment in engine/status.js says so)',
  setRunner: 'test seam: injects the tmux runner',
  setCompanyOpenCommandForTests: 'test seam (#5628 slice 2b-ui): engine/remote.js runs this command instead of the system opener (open, rundll32 or xdg-open) for the company sign-in page, so engine/remote.test.js drives the REAL spawn and exit-code path with true and false, never a browser. Production uses the platform opener.',
  setManagedReaderForTests: 'test seam (#5628): engine/remote.js replaces the MDM profile reader (which runs plutil on /Library/Managed Preferences), so engine/remote.test.js can drive a managed and an unmanaged Mac without a real profile. Production uses the default reader.',
  _setNofollowForTest: 'test seam (#1777 item 3): engine/instructions.js drops O_NOFOLLOW to simulate win32, so a Mac can see the refuseSymlinkTarget hand check doing the work on the CLAUDE.md.previous backup. With the kernel flag present, deleting that check is silent.',
  setChannel: 'test seam (#570 7c-4): engine/chat.js\'s twin of setRunner for Windows agents, injecting the supervisor-channel sayer so a suite never reaches a real agent pipe. Clearing it re-arms dry-run, the same interlock as setRunner.',
  setSpawn: 'test seam (#570): injects engine/win32launch.js\'s spawn, so a suite never starts a real agent and a Mac can drive the win32 arm. Named here rather than passing by luck: "setSpawn" is unique to that file, while its siblings (setRunner, setAnchorer) escape only by colliding with other files\' seams.',
  superviseStreaming: 'engine/win32supervisor.js (#570 7c-1): the supervisor that HOLDS a streaming agent\'s pipes -- the other half of launchStreaming, and the thing that will carry delivery. Unwired for the same reason and on the same card: the Scheduled Task still runs supervise(), and swapping the entry point is slice 7c-2. Landed with its own arms first because the properties that matter here (a death is one death; the throttle limps; every restart is a --resume, never a fresh id) are cheaper to pin now than to debug through a task later.',
  insideWorkKosmos: 'engine/backupscan.js (#5535 E0.6 slice 3, first pure part): what may leave the Mac in a backup (credential deny-list, redaction in place through secretmask, fail closed). Landed and tested on its own first, as slices 1 and 2 were; its caller is the slice-3 walker, after it resolves a symlink.',
  scanFile: 'engine/backupscan.js (#5535 E0.6 slice 3, first pure part): what may leave the Mac in a backup (credential deny-list, redaction in place through secretmask, fail closed). Landed and tested on its own first, as slices 1 and 2 were; its caller is the slice-3 walker, on every file it backs up. If E0.6 is abandoned, this module goes with it.',
  uploadChunks: 'engine/backupupload.js (#5535 E0.6 slice 3, the uploader): sealed chunks to the org bucket through the coordinator\'s write-once presigned PUT grants, refused unless each grant binds our exact bytes. Landed and tested on its own first, like the other E0.6 parts; its caller is the slice-3 walker, which needs E0.1/E0.2 keys, and it reaches Macs only with the connector that allow-lists the grant route (kosmos-relay backuproutes-5535). If E0.6 is abandoned, this module goes with it.',
  uploadManifest: 'engine/backupupload.js (#5535 E0.6 slice 3, the manifest half of the uploader): one sealed manifest to the org bucket through the coordinator\'s manifest grant (slice 2, x-amz-checksum-sha256), refused unless it binds our bytes, goes to the chunks\' bucket and locks no longer than the earliest chunk it names. Landed and tested beside uploadChunks; its caller is the same slice-3 walker. If E0.6 is abandoned, this export goes with it.',
  sessionsFor: 'engine/backupsessions.js (#5686): where an agent\'s own provider sessions live (each provider\'s session folder as a snapshot root with `only` this agent\'s sessions). Landed and tested on its own first, like the E0.6 parts; its caller is the backup schedule that chooses a world\'s roots, which needs key storage and the policy bundle (E0.1/E0.2). If E0.6 is abandoned, this module goes with it.',
  takeSnapshot: 'engine/backupsnapshot.js (#5535 E0.6 build-order step 3, the snapshot walker): walks a work Kosmos, decides each file with backupscan, chunks and seals with backupformat, uploads with backupupload and the signed manifest last. Landed and tested on its own first (a round trip through the real restore), like the other E0.6 parts; its caller is the backup schedule, which needs key storage and the policy bundle (E0.1/E0.2) first. If E0.6 is abandoned, this module goes with it.',
  restoreSnapshot: 'engine/backuprestore.js (#5536 E0.7 step 3, its pure part): turning a backed-up snapshot back into files, verified per chunk and per file, fail closed. Landed and tested on its own first, like E0.6\'s pure slices; its caller is E0.7\'s restore engine on the destination board, which needs E0.1/E0.2 for keys and grants. Do not wire it to a real sink before that sink passes the conformance tests listed at the top of .claude/plans/bkrestore-5536.md (and on #5536). If E0.7 is abandoned, this goes with it.',
  createRestoreSink: 'engine/restoresink.js (#5536 E0.7 step 3): the folder sink restoreSnapshot writes through, meeting the sink duties backuprestore.js states (a fresh root other users cannot write in, a temp folder inside the root until commit, link() that never replaces, an lstat check on each folder against symlinks), measured by its own conformance tests. Its caller is E0.7\'s restore engine on the destination board, with restoreSnapshot. If E0.7 is abandoned, this goes with it.',
  shrinkWarning: 'engine/backuprestore.js (#5536 E0.7 step 3, its pure part): turning a backed-up snapshot back into files, verified per chunk and per file, fail closed. Landed and tested on its own first, like E0.6\'s pure slices; its caller is E0.7\'s restore engine on the destination board, which needs E0.1/E0.2 for keys and grants. If E0.7 is abandoned, this goes with it (the shrink warning shown before a person picks a snapshot).',
  recordSeen: 'engine/restorerequest.js (#5536 E0.7 design v2/v2.1): the reference for recording when the unwrap service first saw a request, keyed by requestId (keyed by anything else, a second request could inherit a wait). Its caller is the unwrap service, which needs E0.1/E0.2 device keys. If E0.7 is abandoned, this goes with it.',
  signRequest: 'engine/restorerequest.js (#5536 E0.7 design v2/v2.1): the signed two-admin restore request, its canonical bytes and the unwrap service\'s release check, with fixed vectors for any other implementation of that service. Landed and tested on its own first, like E0.6\'s pure slices; its callers are the admins\' boards (signing) and the unwrap service (checking), which need E0.1/E0.2 device keys. If E0.7 is abandoned, this goes with it.',
  checkRelease: 'engine/restorerequest.js (#5536 E0.7 design v2/v2.1): the signed two-admin restore request, its canonical bytes and the unwrap service\'s release check, with fixed vectors for any other implementation of that service. Landed and tested on its own first, like E0.6\'s pure slices; its callers are the admins\' boards (signing) and the unwrap service (checking), which need E0.1/E0.2 device keys. If E0.7 is abandoned, this goes with it.',
  namingKeyId: 'engine/backupkeys.js (#5535 E0.6, the pure half of the backup keys): member backup key pairs, the member key wrapped to the org, device or destination public key, and per-period naming keys wrapped to the member key. Landed and tested on its own first, like backupformat.js; its callers are the slice-3 walker and the key storage that E0.1/E0.2 enable. If E0.6 is abandoned, this module goes with it.',
  newMemberKey: 'engine/backupkeys.js (#5535 E0.6, the pure half of the backup keys): member backup key pairs, the member key wrapped to the org, device or destination public key, and per-period naming keys wrapped to the member key. Landed and tested on its own first, like backupformat.js; its callers are the slice-3 walker and the key storage that E0.1/E0.2 enable. If E0.6 is abandoned, this module goes with it.',
  newNamingKey: 'engine/backupkeys.js (#5535 E0.6, the pure half of the backup keys): member backup key pairs, the member key wrapped to the org, device or destination public key, and per-period naming keys wrapped to the member key. Landed and tested on its own first, like backupformat.js; its callers are the slice-3 walker and the key storage that E0.1/E0.2 enable. If E0.6 is abandoned, this module goes with it.',
  wrapMemberKey: 'engine/backupkeys.js (#5535 E0.6, the pure half of the backup keys): member backup key pairs, the member key wrapped to the org, device or destination public key, and per-period naming keys wrapped to the member key. Landed and tested on its own first, like backupformat.js; its callers are the slice-3 walker and the key storage that E0.1/E0.2 enable. If E0.6 is abandoned, this module goes with it.',
  unwrapMemberKey: 'engine/backupkeys.js (#5535 E0.6, the pure half of the backup keys): the RESTORE side, opening a wrapped member key or naming key. Its callers are restore (#5536) and the unwrap service, never the backup walker: a Mac must not unwrap a naming key to name new chunks. Landed and tested with the wrap side first, like backupformat.js. If E0.6 is abandoned, this module goes with it.',
  wrapNamingKey: 'engine/backupkeys.js (#5535 E0.6, the pure half of the backup keys): member backup key pairs, the member key wrapped to the org, device or destination public key, and per-period naming keys wrapped to the member key. Landed and tested on its own first, like backupformat.js; its callers are the slice-3 walker and the key storage that E0.1/E0.2 enable. If E0.6 is abandoned, this module goes with it.',
  unwrapNamingKey: 'engine/backupkeys.js (#5535 E0.6, the pure half of the backup keys): the RESTORE side, opening a wrapped member key or naming key. Its callers are restore (#5536) and the unwrap service, never the backup walker: a Mac must not unwrap a naming key to name new chunks. Landed and tested with the wrap side first, like backupformat.js. If E0.6 is abandoned, this module goes with it.',
  memberContextBytes: 'engine/backupkeys.js (#5535 E0.6, the pure half of the backup keys): member backup key pairs, the member key wrapped to the org, device or destination public key, and per-period naming keys wrapped to the member key. Landed and tested on its own first, like backupformat.js; its callers are the slice-3 walker and the key storage that E0.1/E0.2 enable. If E0.6 is abandoned, this module goes with it.',
  namingContextBytes: 'engine/backupkeys.js (#5535 E0.6, the pure half of the backup keys): member backup key pairs, the member key wrapped to the org, device or destination public key, and per-period naming keys wrapped to the member key. Landed and tested on its own first, like backupformat.js; its callers are the slice-3 walker and the key storage that E0.1/E0.2 enable. If E0.6 is abandoned, this module goes with it.',
  createChunker: 'engine/backupformat.js (#5535 E0.6 slice 3): the streaming form of chunkBuffer, so a file larger than memory can be backed up; its caller is the slice-3 walker, for files above a size threshold. If E0.6 is abandoned, this goes with it.',
  chunkBuffer: 'engine/backupformat.js (#5535 E0.6 slice 2, the pure half): the bytes of the Enterprise backup (chunking, sealed chunks, signed manifests). Landed and tested on its own first, as slice 1 was; its caller is slice 3, the snapshot walker. If E0.6 is abandoned, this module goes with it.',
  sealNamedChunk: 'engine/backupformat.js (#5535 E0.6 slice 2, the pure half): the bytes of the Enterprise backup (chunking, sealed chunks, signed manifests). Landed and tested on its own first, as slice 1 was; its caller is slice 3, the uploader, and it is the ONLY way the uploader seals a chunk (the name is derived from the content, so it always restores).',
  openVerifiedChunk: 'engine/backupformat.js (#5535 E0.6 slice 2, the pure half): the bytes of the Enterprise backup (chunking, sealed chunks, signed manifests). Landed and tested on its own first, as slice 1 was; its caller is slice 4, restore, and it is the ONLY way restore opens a chunk (decrypt, then check the content against its HMAC name).',
  sealManifest: 'engine/backupformat.js (#5535 E0.6 slice 2, the pure half): the bytes of the Enterprise backup (chunking, sealed chunks, signed manifests). Landed and tested on its own first, as slice 1 was; its caller is slice 3, the uploader.',
  openManifest: 'engine/backupformat.js (#5535 E0.6 slice 2, the pure half): the bytes of the Enterprise backup (chunking, sealed chunks, signed manifests). Landed and tested on its own first, as slice 1 was; its caller is slice 4, restore.',
  hpkeSeal: 'engine/hpke.js (#5535 E0.6 slice 1): HPKE base mode (RFC 9180, X25519 / HKDF-SHA256 / ChaCha20-Poly1305), the per-object encryption of the Enterprise backup. Landed and tested on its own first, pinned byte for byte by the RFC\'s own vectors, because it is cryptography and gets its own review. Its caller is slice 3, the snapshot uploader (#5535 design v2.1 section 9). If E0.6 is abandoned, this module goes with it.',
  hpkeOpen: 'engine/hpke.js (#5535 E0.6 slice 1): the open half of hpkeSeal (see there); its caller is slice 4, restore. Same named next slice, same terms.',
  hpkeVectorSeamsForTests: 'test seam (#5535): engine/hpke.js hands out its deterministic setup and multi-sequence context ONLY so hpke.test.js can check every intermediate of RFC 9180 A.2.1, and refuses outside a test process as live-execution.inTestProcess judges it (an execArgv heuristic: --test* flags; Kosmos never launches itself with one). Production uses hpkeSeal/hpkeOpen.',
  launchStreaming: 'engine/win32launch.js (#570 7c-1): the streaming launch -- `claude -p --input-format stream-json` with the pipes held -- which is the substrate for MESSAGING a Windows agent. Deliberately NOT wired yet: create.js and win32supervisor.js still use the detached launch(), and the wiring is slice 7c-2 (.claude/plans/WINDOWS-ROADMAP.md §3). Landed and tested on its own first because this lane has repeatedly shipped a green suite over a path production could not take. An excuse with a named next slice, not an orphan -- if 7c is abandoned, this export goes with it.',
  setSpawnForTests: 'test seam (#3324): engine/win32explorer.js replaces child_process.spawn for foregroundSettings only, BELOW the live gate, so engine/machine.win32-sleep.test.js sees the real spawn options (the runner seam returns before them) and a reintroduced detached:true, which makes powershell.exe exit without running the helper, goes red.',
  setAnchorer: 'test seam (#570): injects engine/win32job.js\'s anchor step, so a suite never copies the 92 MB interpreter and a Mac is never asked to write a Windows path -- both of which happen the moment installJob is driven with platform:"win32", which is exactly how this branch is asserted. Named here rather than passing by luck: "setAnchorer" is unique to that file, while its sibling setRunner escapes only by colliding with every other file\'s runner seam.',
  setPresenceTtl: 'test seam (send-lag): turns the presence memo in engine/win32job.js on (or off) under an injected runner. Production never calls it: with no runner the memo is on by default, and under a runner it is off unless a test opts in, so no stubbed answer outlives the step that set it.',
  // readPointer's excuse was removed in win32-update-stage: engine/win32update.js's prepare()
  // now reads the pointer (B0: it must name the folder being updated), so it has a real caller
  // and the #265 orphan guard protects it again.
  setChecker: 'test seam (#1930): injects the live claude-auth checker so authprobe tests do not spawn a real subprocess',
  resetForTest: 'test seam (#1930): clears the authprobe per-account cache between tests',
  bundledConnector: 'test seam (kosmos#4597): engine/remote.js answers where an installed app keeps its Plus connector for a given app dir and platform, so the Windows name (bin\kosmos-tunnel.exe) is asserted against a Windows app laid out in a temp dir, from any host. Production calls it with no arguments, through BIN().',
  resetSubscriptionLiveForTest: 'test seam (#3997): clears engine/grokaccounts.js\'s Grok subscription check cache and in-flight map between tests, and bumps its generation so a run started before the reset writes nothing after it.',
  setPauser: 'test seam: observes the codex Enter gap without sleeping (#571)',
  setDryRun: 'test seam: keeps suites off real panes',
  setClaudeProbe: 'test seam: injects the claude -p liveness probe so tests do not spawn a real claude (#1916)',
  setChatgptBrowserOpener: 'test seam (0.6.96 OpenAI sign-in): engine/openaiaccounts.js records the device page it would open, so a suite never starts a real browser and a Mac can drive the win32 arm',
  resetForTests: 'test seam',
  setWorldCaseFoldPlatformForTests: 'test seam (#5386): engine/worlds.js folds world-name spellings on a copy only on Windows; tests set win32 to drive that arm from any host (engine/envcase-5386.test.js). Production uses process.platform.',
  setMuslDetectForTests: 'test seam (#5419): engine/connect.js detects musl from process.report, musl\'s own loader file and, with no report, a glibc loader, on Linux; tests answer glibc or musl from any host (connect.test.js). Production uses detectMusl.',
  setMuslLibsCheckForTests: 'test seam (#5419 review 24): engine/connect.js asks whether a musl Linux host lacks libstdc++/libgcc before a Claude download; tests answer from any host (connect.test.js). Production checks the usual library folders.',
  setTmuxCheckForTests: 'test seam (#5419): engine/connect.js asks whether tmux is missing on Linux before a Claude sign-in; tests answer from any host (connect.test.js and the connect.* files that pin it). Production uses the launcher\'s AGENT_WORKFORCE_TMUX_BIN when it is runnable, else create.linuxTmuxBin.',
  setProbePlatformForTests: 'test seam (#5445): engine/create.js pins the platform its fleet probes (disabledJobsResult, runningJobs) ask when the caller names none, so a board test on a launchctl fake (server.world-offline-rows-1704, server.world-switch-agents-1704, server.offline-nextmove, server.socket-split) keeps the Mac arm on a Linux CI runner. Production never sets it.',
  resetUnloadWaitsForTests: 'test seam (#4964): engine/remove.js empties the restart unload-wait burst ledger, so one test\'s waits do not spend the next test\'s allowance. Production never resets it.',
  _sendWithDelivery: 'test seam (#4580 item 1): engine/messages.js\'s send core with an injected (slow, or unconfirmed) deliver, so two concurrent identical sends can be held in flight and the fold asserted (the second waits on the first, one delivery). Production reaches the same core through send/sendAsync with chat.deliver(Async).',
  _sendPostWithDelivery: 'test seam (#4580 item 1): engine/messages.js\'s post core with an injected deliver, the post-side twin of _sendWithDelivery (a retried room post folds onto the one still in flight). Production reaches it through sendPost/sendPostAsync.',
  newKeyPair: 'test seam (#3728): engine/fedseal.js makes a fresh X25519 pair so a test can play the OTHER board (owner or member) against this one; production uses the one sealingKey() from the key file. A board never needs a second identity.',
  underTest: 'test-only export (#988): engine/updating.js exports its test-context predicate for its own arms; production inlines the check. Named here rather than passing by luck: it otherwise survives only by colliding with ping/feedbacksend (notify.js, a third definer, was deleted in #2623)',
  agePartWritesForTests: 'test seam: ages the parts records instead of shortening the hour (#803)',
  ageMemberChangesForTests: 'test seam: ages the membership records instead of shortening the hour (#803)',
  setPaneSource: 'test seam: keeps status reads off the real machine',
  setRenderer: 'test seam (attachments preview)',
  setRevealRunner: 'test seam (projects reveal)',
  setRevealPlatform: 'test seam (win32-board-copy): engine/projects.js picks the Mac (/usr/bin/open) or Windows (File Explorer) opener; the Mac suites state darwin through it so their pins hold on a Windows box. Production reads process.platform.',
  setStatForTests: 'test seam (win32-board-copy): engine/win32explorer.js\'s existence check, so the Windows launcher is asserted with a Windows path from any host. Production uses fs.statSync.',
  setFsWorldForTests: 'test seam (win32-board-copy review round 2): engine/projects.js reads a project folder and its files through realpath/stat/access together, so a mapped drive (Z:\\ resolving to \\\\server\\share) is asserted without mapping a drive. Production uses the real filesystem.',
  setWin32SleepClockForTests: 'test seam (win32-board-copy review round 1): engine/machine.js measures the age of its cached powercfg reading on this clock, so the cache window is asserted without sleeping. Production uses Date.now.',
  resetWin32SleepReading: 'test hook (win32-board-copy review round 1): forgets engine/machine.js\'s cached powercfg reading between tests, the same role as resetSleepPaneCache.',
  resetGrantCache: 'test hook (#2085): forgets engine/a11ystatus.js\'s cached tmuxGrant verdict between tests, so the production (no-opts) cache path can be asserted then cleared -- the same role as resetWin32SleepReading. The a11ystatus exports block was single-line before #2559 (which this sweep\'s `\\n};` regex could not parse, so the file\'s exports were invisible to it); the #2559 multi-line reformat surfaced this real test seam, named here rather than left as a hidden orphan.',
  resetAppGrantCache: 'test hook (#2559): the appGrant twin of resetGrantCache -- forgets engine/a11ystatus.js\'s cached app-Accessibility verdict between tests. Same role and same reason as resetGrantCache.',
  setSqliteRunner: 'test seam (#2085): injects engine/a11ystatus.js\'s tmux TCC sqlite runner so tmuxGrant is asserted without a real system db (the tmuxGrant/route tests spy on it). Named here rather than escaping only by an incidental comment mention of it.',
  setAppSqliteRunner: 'test seam (#2559): the appGrant twin of setSqliteRunner -- injects the app-Accessibility TCC runner so appGrant and the /api/a11y-status route are asserted without a real system db. Named here explicitly for the same reason.',
  setSessionSource: 'test seam: keeps session reads off the real machine',
  setTickInterval: 'test seam (connect pacing)',
  setUnknownGrace: 'test seam (connect pacing)',
  setAbandonedSigninMs: 'test seam (connect pacing, #727 item 4 abandoned-signin bound)',
  setRefreshExpiryReader: 'test seam (#3326): injects engine/connect.js\'s refreshTokenExpiresAt reader so the forced-login proof (expiryMoved) is asserted without the real macOS keychain; under node --test the default reads nothing.',
  setFreshnessForTests: 'test seam',
  setSwitchForTests: 'test seam (#3568): engine/win32agy.js answers its Windows switch (on by default, off by env or an .off file) without touching the env or the data folder. Production reads the env and the file.',
  setRootForTests: 'test seam (#3568): engine/win32agy.js keeps its agy homes, stub and switch file under a sandbox instead of store.ROOT. Production uses store.ROOT.',
  setTreeKill: 'test seam (#3568): engine/win32agy.js kills a turn\'s process tree with taskkill /T /F on Windows; a suite records the kill and ends the stand-in itself on any host.',
  setExec: 'test seam (#3568): engine/win32agy.js runs `agy models` (the sign-in check) through execFile; a suite answers it signed in or out without a real agy.',
  setOpener: 'test seam (#3568): engine/win32agysignin.js opens Google\'s page with win32signin.openInDefaultBrowser; a suite records the link instead of opening a browser.',
  setTyper: 'test seam (#3568): engine/win32agysignin.js types the pasted code into agy\'s console through a PowerShell helper; a suite writes it to the stand-in\'s stdin instead (the real typer has its own win32-only test).',
  setProbeTtlForTests: 'test seam: ages the willInstall probe cache instead of sleeping 60s (#1556)',
  setUnansweredAfterForTests: 'test seam (#185 unanswered constant)',
  setGrokTimers: 'test seam (#3391): shrinks the Grok subscription sign-in watchdog, reap TTL and force-kill grace so the abandoned-child and cancel tests run in ms instead of minutes (never wired to a screen)',
  resetEnsureGuideForTests: 'test seam (#3660): forgets the setup guide\'s in-flight create and its 10-minute back-off between test cases (never wired to a screen)',
  setChatgptTimers: 'test seam (#2338): shrinks the ChatGPT-subscription sign-in watchdog + reap TTL so the abandoned-child and session-reap tests run in ms instead of minutes (never wired to a screen)',
  setBase: 'test seam (update feed base url)',
  setInstallRunner: 'test seam (update installer)',
  setWindowsInstaller: 'test seam (win32-update-arm S4): injects engine/win32update.js\'s begin() so a suite drives engine/update.js\'s beginInstall win32 arm without a real download/swap. Production calls win32update.begin() directly (beginWindowsInstall reads the windowsInstallerFn variable, so the setter itself has no production caller). Named here rather than passing by luck: setBoardContext, its neighbour, escapes only because server.js calls it.',
  setWindowsHelperWitnessMs: 'test seam (win32-update-arm S4): shrinks the detached-helper single-flight witness window (default win32apply.STAGED_HELPER_STARTUP_GRACE_MS, 2 min) so the witness-release test runs in ms. Production derives the window from win32apply and never calls the setter.',
  setWindowsRollback: 'test seam (win32-update-rollback S5, #3017): injects engine/win32update.js\'s rollbackToPrevious() so a suite drives engine/update.js\'s beginRollback without a real board swap. Production calls win32update.rollbackToPrevious() directly (beginRollback reads the windowsRollbackFn variable, so the setter has no production caller).',
  setKeptPreviousBuild: 'test seam (win32-update-rollback S5, #3017): injects the kept-previous-build lookup so rollbackOffer() runs without a real WORK folder. Production asks win32update.keptPreviousBuild().',
  setInstalledRoot: 'test seam (update root)',
  setRecordedChannel: 'test seam (#2969): replaces engine/update.js\'s read of the install stamp (<store.ROOT>/source-channel) that the Mac update channel falls back to, so a suite states a staging or prod install without writing the real store. Production reads the stamp (recordedChannel reads the recordedChannelFn variable, so the setter has no production caller).',
  setAutoPref: 'test seam (auto-update preference file)',
  setPlatform: 'test seam (win32-update-check): engine/update.js\'s platform for the pointer, manifest and channel rules, so the Windows arm is asserted from a Mac and the Mac contract (update.test.js) is pinned to darwin on the Windows box. Production reads process.platform.',
  setWindowsBundleRoot: 'test seam (win32-update-check): engine/update.js\'s answer to "is this a Windows bundle", so the manual-offer arm runs without a real runtime\\node.exe layout. Production asks win32board.bundleRoot().',
  projectsFor: 'superseded reader: list()/get() carry the same join; kept for its tests until they migrate (#265 sweep)',
  currentChildPid: 'test seam: reads the tunnel supervisor child pid to assert its lifetime deterministically',
  turnOnAfterSigninForTests: 'test seam (kosmos#4743): engine/remote.js\'s switch-on after a sign-in, driven without setOn\'s busy() check so a test can order it against a Forget. Production reaches it from the sign-in completion inside remote.js.',
  cancelledAfterForTests: 'test seam (kosmos#4743): engine/remote.js\'s cancelledAfter, what a sign-in cancelled after it began leaves behind, driven directly. Production calls it from the sign-in flow when a newer sign-in or a Forget has moved signinEpoch.',
  standingQuietForTests: 'test seam (kosmos#4743): true when no standing refresh or switch-flip report is in flight, so a test waits for remote.js to settle instead of sleeping. Never read in production.',
  standingOutForTests: 'test seam (kosmos#4743): true while a standing refresh is in flight, so a test can wait out one another case started. Never read in production.',
  setSetupSpawnForTests: 'test seam (#4167): injects only setupRun children so tests can order exit, delayed stdio, close and error deterministically; production and the supervised tunnel use child_process.spawn directly.',
  setRelay: 'engine/remote.js: dormant until the Kosmos-team Settings surface wires the self-host relay field; validated here so garbage is refused at set time. Its siblings (setOn, status, ...) escape this sweep only because their names collide with words in other files; setRelay is unique, so it is named here rather than passing by luck.',
  setTransport: 'test seam (#2296): injects the blob list/get transport so engine/feedbackpull.js tests never hit the network or the real secrets map. Named here because "setTransport" is unique to this file; production pull() uses the default fetch transport.',
  setTimeoutMs: 'test seam (#4287): engine/communitysend.js shortens its request timeout so the slow-server test fails in two seconds instead of hanging the suite; production keeps the default.',
  setSwitch: 'test seam (#4287): engine/communitysend.js takes a stand-in for engine/communityswitch.js, which is #4288 and not built yet, so the send tests can turn sending on; production reads the real module.',
  setAgentWaitMs: 'test seam (#4774): engine/communitysend.js shortens how long agentCall waits for the board, so the follow tests reach the timeout arm in 100 ms; production keeps AGENT_WAIT_MS.',
  _registration: 'test seam (#4922): engine/communitysend.js lets engine/communitysend.test.js see what a registration would carry (whether install_group goes for a removed or folder-gone agent) without a sweep; production calls registration() inside ensureRegistered.',
  _installGroupRetry: 'test seam (#4922): engine/communitysend.js sets how long the install-group pass pauses after a failure and clears its pauses (the whole-pass pause, the hour-long unknown-field window, and where the next pass starts), so engine/communitysend.test.js runs its retry tests sweep by sweep and pins each pause itself with an hour; production keeps 15 minutes.',
  setAgentBudgetMs: 'test seam (#4774): engine/communitysend.js shortens agentCall\'s total budget, so the follow tests reach the over-budget arm quickly; production keeps AGENT_BUDGET_MS.',
  PAYLOAD_KEYS: 'contract pin (#4287): the exact keys engine/communitysend.js sends to kosmos-community, asserted by its tests against what payload() builds. Exported so the test compares against the module rather than a second copy of the list.',
  setSender: 'test seam (#2037): engine/feedbacksend.js injects a fake sender so the daily-report send tests never hit the network; production uses global fetch. Named here from #2623 onward: it used to escape this sweep by a name-collision with engine/notify.js and engine/ping.js, both of which had a setSender -- #2623 deleted notify.js and ping.js\'s sender, so feedbacksend.js is now the sole definer and the collision cover is gone. A test seam, not an orphan.',
  setSigninPlatformForTests: 'test seam (win32-claude-signin-host): engine/connect.js picks its sign-in host by platform. A suite pins darwin to drive the tmux host from a Windows box, or win32 to drive the Windows host from a Mac. Production uses process.platform.',
  setBrowserOpener: 'test seam (#3288): replaces engine/win32signin.js\'s own opener (rundll32 url.dll,FileProtocolHandler, detached), so a suite never opens a real browser and can see the link Kosmos opens.',
  setPortFinder: 'test seam (#3288): replaces engine/win32signin.js\'s netstat lookup of the sign-in program\'s listening port, so a suite never runs netstat.',
  setWindowsSigninHostForTests: 'test seam (win32-claude-signin-host): forces engine/win32signin.js on or off under test (null follows WINDOWS_SIGNIN_HOST_ENABLED, which ships true since the L-1 live check, #3288). Off keeps the kill-switch path covered. Refuses outside a node --test process.',
  setPlatformForTests: 'test seam (#1704 PR3): engine/worldstarts.js picks the platform arm for a caller that does not pass one. The switch route never passes one, so server.world-switch-agents-1704.test.js states the Mac arm through this and drives it with remove.setRunner from any host. Production uses process.platform.',
  // #3485 Kosmos Community feed store (engine/communitystore.js): the DATA-MODEL slice,
  // landed + tested before its screen per the data-model/build split on #3485. The caller is
  // the board's /api/community publish + moderation routes (Mikey's build slice, not yet
  // built), which call insertPost({...verdict.post, status}) per PigeonPete's emit-path
  // contract on #3485 (after feedguard.guard scrubs). Deliberately unwired here, NOT orphaned:
  // if #3485's build is abandoned, this store goes with it. toPublic/recordApproval/trustRecord
  // have genuine internal callers and are not listed. The three PRIMARY entry points
  // (insertPost/publicFeed/trustState) are listed explicitly: they happen to pass this sweep
  // today only because the module names each in its own docstrings/emit-path examples, which
  // the mentions-minus-defs heuristic reads as an internal caller — NOT a name-collision with
  // another file (grep -w finds them nowhere else). Naming them here arms the guard for them
  // and stops a docstring edit from surprise-flipping them to "orphan".
  insertPost: '#3485 community store: the board /api/community publish route (Mikey\'s build slice) calls it per Pete\'s emit-path contract, pending. Listed explicitly so the guard is armed rather than relying on a docstring self-mention.',
  publicFeed: '#3485 community store: the board community feed route (Mikey) serves this, pending that slice.',
  trustState: '#3485 community store: the board passes trustState(agentId) to feedguard.guard per Pete\'s contract, pending the route.',
  insertComment: '#3485 community store: the board comment route (Mikey\'s build slice) will call it, pending. Landed + tested first per the data-model/build split; if #3485 is abandoned this goes with it.',
  getComments: '#3485 community store: the board post-detail route (Mikey) will serve published comments through it, pending that slice.',
  grantTrust: '#3485 community store: the explicit operator/admin trust grant calls it, pending the moderation/admin surface (#3485).',
  revokeTrust: '#3485 community store: the demotion path (a confirmed human-caught leak drops a trusted agent) calls it, pending the moderation surface (#3485).',
  _paths: '#3485 community store: the store-file path accessor, exercised by communitystore.test.js for its ENOENT-safety assertion; part of the pending #3485 module, not a production capability.',
  // setActiveWorld's excuse was removed in slice 2b-ii: POST /api/worlds/active
  // (server.js) is now a real caller, so the #265 orphan guard protects it again.
  // checkLive's excuse was removed in the #2420 listing slice because it is no longer
  // TRUE, not because the guard gained coverage. accounts.listLiveNow() now calls
  // claudeaccounts.checkLive for an api-key Claude row (the live-badge reader for a
  // stored api-key account), so it is no longer "genuinely dormant" -- and an excuse
  // is a claim, so a discharged one is removed to keep the EXCUSED set honest.
  // ⚠️ The #265 sweep does NOT independently re-verify this: "checkLive" collides by
  // name with subscription.js/openaiaccounts.js, so it could never have been flagged
  // as an orphan anyway (the old excuse said exactly this), and it could not flag a
  // future regression that dropped the real caller either. What protects it is the
  // genuine caller existing, not the sweep. (forgetKey and unwireApiKeyHelper were
  // already reachable via server.js's failed-store cleanup.)
  _nextIdForTests: 'test seam (#4888): engine/messages.js says which id the NEXT post will get (the larger of the log\'s highest and the in-memory high mark, +1), so a test that predicts ids does not have to re-derive the minting rule; a refused send now burns its id, which broke tests that counted. Production mints through mintId and never calls it.',
  reachForAgent: 'the #5309 part 2 slice-1 signal: engine/pluginreach.js reachForAgent returns, per agent, whether the plugins the person installed in their own app reach that agent. Built ahead of its caller on purpose: slice 2 wires it onto the /api/status per-agent agents map and a board indicator (card #5309); no live caller until then. DELETE this entry when slice 2 adds that caller, so it cannot later mask a genuinely dead export. The pure reachFrom it wraps stays reachable through it.',
  _setPause: 'test seam (#5460): engine/communityswitch.js swaps the pause between retries for a test (null restores the real one) and forgets the last failure, so the retry tests run in milliseconds. Production never calls it.',
  _endRetryGap: 'test seam (#5460): engine/communityswitch.js acts as if RETRY_GAP_MS had passed while keeping the remembered failure, so a test reaches the next round without waiting. Production never calls it.',
  _setBeforeWriteForTests: 'test seam (#4491): engine/undo.js runs a hook just before a restore write (any non-function restores the no-op), so a test can swap the folder at the write and prove the pre-write check refuses it. Production never calls it.',
};

/* #5548: test seams that became visible when this guard learned to read every exports block. Each is an injector
   or reset whose default restores the real behaviour, and only its own tests call it (measured when the guard first
   read the module). Keyed by FILE, like TRIAGED_5548, because several names are generic (setClock, setBin, _lock):
   a by-name excuse would also hide a real orphan of the same name in another module (#5548 review 2). */
const SEAMS_5548 = {
  // #5532: the ioreg runner and the clock engine/computerprint-5532.test.js replaces, and the bare print function it
  // pins the formula through (callers use printFor, which reads the id itself).
  _testRunner: 'engine/computerprint.js',
  _testClock: 'engine/computerprint.js',
  _testFingerprint: 'engine/computerprint.js',
  allowSandboxInstallForTests: 'engine/agystatus.js',
  // #5535 E0.6: lets engine/backupupload.test.js use its local http bucket; off by default, and only under node --test.
  allowHttpForTests: 'engine/backupupload.js',
  setInstallerForTests: 'engine/agystatus.js',
  setLastFileForTests: 'engine/agystatus.js',
  _lock: 'engine/agytrust.js',
  _setNonceClock: 'engine/boardauth.js',
  setInstalledCli: 'engine/boardrestart.js',
  setBoardOps: 'engine/boardrestart.js',
  setUid: 'engine/boardrestart.js',
  setReaderForTests: 'engine/claudeloginlive.js',
  _resetRate: 'engine/communityfollow.js',
  _freshDownReset: 'engine/communityread.js',
  resetSleepPaneCache: 'engine/machine.js',
  setAppRevealRunner: 'engine/machine.js',
  setSystemConfigPaths: 'engine/orgchartcodex.js',
  setVersion: 'engine/orgchartcodex.js',
  setBin: 'engine/orgchartcodex.js',
  setReaderForTest: 'engine/orgchartfile.js',
  setModelRunner: 'engine/orgchartfile.js',
  setModelAvailable: 'engine/orgchartfile.js',
  _ageFallbackForTests: 'engine/personlanguage.js',
  setAvailableForTests: 'engine/phonenotify.js',
  setClock: 'engine/phonenotify.js',
  resetCooldownForTests: 'engine/phonenotify.js',
  _files: 'engine/restartnote.js',
  _parseCmdlines: 'engine/runningas.js',
  setPartsLimitForTests: 'engine/tasks.js',
  setCatalogue: 'engine/teamseed.js',
  setResolver: 'engine/unfurl.js',
  _agyCache: 'engine/usageproviders.js',
  setFileForTests: 'engine/whatsnew.js',
  setLiveness: 'engine/win32job.js',
  setRunningClock: 'engine/win32job.js',
  setAlive: 'engine/win32stop.js',
};

/* #5548 slice 2: the triage of the 34 exports slice 1 surfaced (research table and calls on #5548). Keyed by FILE, each
   with why it is not an unreachable capability, or the card that owns it if it is one. bin/ joining CALLER_FILES cleared
   sweepClass1 and retireLauncher, which were never orphans. An entry here is a claim someone can check. */
const TEST_SEAM = 'test seam: only its own tests call it (its source comment says so, or it injects or reports state for them)';
const INTERNAL = 'used inside its own module; exported only so its test can pin it';
const ACCESSOR = 'a thin accessor of a sibling export that production does call (the capability is reached through that sibling)';
const TRIAGED_5548 = {
  newPoolMemo: ['engine/agyquota.js', TEST_SEAM + ' (an isolated memo for a test; production uses the module default)'],
  stopAll: ['engine/fedseats.js', TEST_SEAM + ' (its docblock: only tests call it; board shutdown closes stdin)'],
  clearFirstTurnCache: ['engine/groksession.js', TEST_SEAM + ' (added because the cache survived the tests\' reset)'],
  setEnabled: ['engine/orgchartkeys.js', TEST_SEAM + ' (overrides the enabled map; production keeps ENABLED_DEFAULT)'],
  setKeyFor: ['engine/orgchartkeys.js', TEST_SEAM + ' (injects the key resolver; production uses defaultKeyFor)'],
  knownSecretCount: ['engine/secretmask.js', TEST_SEAM + ' (reports how many forms are known)'],
  fragmentIndexStats: ['engine/secretmask.js', TEST_SEAM + ' (reports the word-fragment index for its tests, #3935)'],
  WIN32_ROW_KEYS: ['engine/win32roster.js', TEST_SEAM + ' (the column list its parity test asserts, #5333)'],
  codexLastCompletionAt: ['engine/status.js', TEST_SEAM + ' (its comment: snapshot() does not use it; production uses codexCompletionAt)'],
  geminiLastCompletionAt: ['engine/status.js', TEST_SEAM + ' (same as codexLastCompletionAt, #3296)'],
  grokLastCompletionAt: ['engine/status.js', TEST_SEAM + ' (same as codexLastCompletionAt, #3391)'],
  IMPORT_CONTRACT: ['engine/agentfile.js', INTERNAL + ' (a declarative contract: its tests assert the wired importAgent enforces what it says)'],
  // Review 1: these three are NOT used in their module either: test helpers of #5346's capture hardening.
  ALLOWED_TOOLS: ['engine/orgchartcodex.js', TEST_SEAM + ' (the hardening policy list the capture test asserts; nothing in the module reads it)'],
  deriveCatalog: ['engine/orgchartcodex.js', TEST_SEAM + ' (a wrapper over catalogFor for the capture test; production calls catalogFor)'],
  offeredTools: ['engine/orgchartcodex.js', TEST_SEAM + ' (asserted by the capture test; nothing in the module calls it)'],
  parentOf: ['engine/tasks.js', ACCESSOR + ' (treeOf(p).up; the screen reads the tree through allTasks rows)'],
  childrenOf: ['engine/tasks.js', ACCESSOR + ' (treeOf(p).under)'],
  subtaskProgress: ['engine/tasks.js', ACCESSOR + ' (treeOf(p).progress; the screen shows "N of M subtasks done" from the row)'],
  whyNoReader: ['engine/orgchartfile.js', ACCESSOR + ' (lastWhy; production reads readerAndWhy)'],
  offReason: ['engine/orgchartkeys.js', ACCESSOR + ' (pick().offWhy; production calls pick())'],
  chooseReader: ['engine/orgchartkeys.js', ACCESSOR + ' (pick().reader; production calls pick())'],
  hasPicture: ['engine/you.js', ACCESSOR + ' (picturePath() !== null; server.js calls picturePath)'],
  rotateForRevoked: ['engine/fedseats.js', ACCESSOR + ' (a wrapper over revokeCheck, which production calls)'],
  setIntervalMinutes: ['engine/heartbeat-setting.js', ACCESSOR + ' (a single-field setter beside the patch setter the PUT route uses, #1722)'],
  labelFor: ['engine/communityindustry.js', 'pending: slice 2 of OPEN #4375 (the public label for an owner\'s industry)'],
  HANDOFF_CHECK_FOR_SERVING_AFTER_MS: ['engine/win32handoff.js', 'mirrored by tools/windows/KosmosLauncher.cs (CheckForServingAfterMs), pinned equal by tools.win-launcher-native.test.js'],
};

const engineDir = path.join(__dirname, 'engine');
const engineFiles = fs.readdirSync(engineDir).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'));

/* Every non-test source a caller could live in. */
const CALLER_FILES = [
  ...engineFiles.map((f) => path.join('engine', f)),
  'server.js',
  path.join('web', 'index.html'),
  path.join('install', 'kosmos'),
  path.join('install', 'setup.sh'),
  ...fs.readdirSync(path.join(__dirname, 'tools')).map((f) => path.join('tools', f)),
  ...fs.readdirSync(path.join(__dirname, 'test-support')).map((f) => path.join('test-support', f)),
  // #5548 slice 2: bin/ holds real callers (bin/class1-autohandle.js calls sweepClass1; bin/agent-supervisor.sh calls
  // sendertoken.retireLauncher in a node -e), which this sweep could not see.
  ...fs.readdirSync(path.join(__dirname, 'bin')).map((f) => path.join('bin', f)),
].filter((f) => { try { return fs.statSync(path.join(__dirname, f)).isFile(); } catch { return false; } });

const read = (f) => { try { return fs.readFileSync(path.join(__dirname, f), 'utf8'); } catch { return ''; } };
const testFiles = [
  ...fs.readdirSync(engineDir).filter((f) => f.endsWith('.test.js')).map((f) => path.join('engine', f)),
  ...fs.readdirSync(__dirname).filter((f) => f.endsWith('.test.js')).map((f) => f),
];
const testBlob = testFiles.map(read).join('\n');
const sources = CALLER_FILES.map((f) => ({ f, text: read(f) }));

/* #5548: the exports block is found by matching braces in CODE (comments and strings blanked), so its layout no
   longer matters. The old regex read only blocks that closed on a line of their own (`\n};`): 69 of 253 modules,
   and it took words from comments as names. Names are the top-level keys: a shorthand name or the key of
   `key: value`, never a comment word and never the contents of a nested object. */
const REGEX_AFTER = new Set(['return', 'typeof', 'case', 'in', 'of', 'else', 'do', 'throw', 'delete', 'void', 'new', 'yield', 'await', 'instanceof']);
function codeOnly(src) {
  const out = src.split('');
  const n = src.length;
  const blank = (a, b) => { for (let k = a; k < b; k++) if (out[k] !== '\n') out[k] = ' '; };
  let i = 0;
  const stack = []; // template nesting: brace depth at each ${
  let depth = 0;
  let prev = ''; // last significant code char ('w' after a word)
  let lastWord = '', wordAfterDot = false, prevPrev = '';
  let afterOpen = false; // just entered a template ${: what follows starts an expression
  function str(q) { const s = i; i++; while (i < n && src[i] !== q) { if (src[i] === '\\') i++; else if (src[i] === '\n') break; i++; } i++; blank(s, i); }
  function tmpl(resume) { // at a backtick, or (resume) just after the } that closes a ${...}
    let s = i; if (!resume) i++;
    while (i < n) {
      if (src[i] === '\\') { i += 2; continue; }
      if (src[i] === '`') { i++; blank(s, i); return; }
      if (src[i] === '$' && src[i + 1] === '{') { blank(s, i); i += 2; stack.push(depth); depth++; afterOpen = true; return; }
      i++;
    }
    blank(s, i);
  }
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { const s = i; while (i < n && src[i] !== '\n') i++; blank(s, i); continue; }
    if (c === '/' && d === '*') { const s = i; i = src.indexOf('*/', i + 2); i = i < 0 ? n : i + 2; blank(s, i); continue; }
    if (c === '"' || c === "'") { str(c); prev = 'a'; continue; }
    if (c === '`') { tmpl(); prev = afterOpen ? '{' : 'a'; afterOpen = false; continue; }
    /* A `/` starts a regex after an operator or a keyword such as return; it is division after a value: a name,
       `)`, `]`, `}` (an object or a block, read as a value: rarer the other way), a postfix `++`/`--`, or a
       keyword used as a property (`x.return / 2`). Review 1 of #5548 found the `}`, `++` and `.return` cases. */
    const postfix = (prev === '+' || prev === '-') && prevPrev === prev;
    if (c === '/' && !postfix && (prev === '' || '(,=:[!&|?{;+-*%<>~^'.includes(prev) || (prev === 'w' && !wordAfterDot && REGEX_AFTER.has(lastWord)))) {
      const s = i; i++; let cls = false;
      while (i < n && src[i] !== '\n') { if (src[i] === '\\') { i += 2; continue; } if (src[i] === '[') cls = true; else if (src[i] === ']') cls = false; else if (src[i] === '/' && !cls) break; i++; }
      i++; while (i < n && /[a-z]/i.test(src[i])) i++;
      blank(s, i); prev = 'a'; continue;
    }
    if (c === '{') depth++;
    if (c === '}') { depth--; if (stack.length && depth === stack[stack.length - 1]) { stack.pop(); i++; tmpl(true); prev = afterOpen ? '{' : 'a'; afterOpen = false; continue; } }
    if (/[A-Za-z_$]/.test(c)) {   // a word: remember it, so `return /re/` reads as a regex and `x / y` as division
      const s = i; while (i < n && /[\w$]/.test(src[i])) i++;
      wordAfterDot = prev === '.'; lastWord = src.slice(s, i); prevPrev = prev; prev = 'w'; continue;
    }
    if (!/\s/.test(c)) { prevPrev = prev; prev = c; }
    i++;
  }
  return out.join('');
}
/* The text of the `module.exports = { ... }` object (braces included), found by matching braces in code. */
function exportsBlock(src) {
  const code = codeOnly(src);
  const m = /module\.exports\s*=\s*\{/.exec(code);
  if (!m) return null;
  let depth = 0;
  for (let k = m.index + m[0].length - 1; k < code.length; k++) {
    if (code[k] === '{') depth++;
    else if (code[k] === '}' && --depth === 0) return { start: m.index, end: k + 1, code: code.slice(m.index, k + 1) };
  }
  return null;
}
function exportedNames(src) {
  const b = exportsBlock(src);
  if (!b) return [];
  const inner = b.code.slice(b.code.indexOf('{') + 1, -1);
  const names = [];
  let depth = 0, seg = '';
  for (const ch of inner + ',') {
    if ('{[('.includes(ch)) depth++;
    if ('}])'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) { const t = seg.trim(); seg = ''; if (!t) continue;
      const mm = /^(?:get\s+|set\s+|async\s+)?([A-Za-z_$][\w$]*)/.exec(t); if (mm && !t.startsWith('...')) names.push(mm[1]); continue; }
    seg += ch;
  }
  return names;
}

/* The #265 signature over a set of modules: exported, tested, called by no other caller file and by no CODE in
   its own file. #5548: an internal caller counts only in code, so a comment or an error message that names the
   export no longer passes for a call (it did in hpke-5535, twice). */
function findOrphans(modules, callerSources, tests, skip) {
  const orphans = [];
  for (const { rel, text } of modules) {
    const block = exportsBlock(text);
    let code = codeOnly(text);
    if (block) code = code.slice(0, block.start) + ' '.repeat(block.end - block.start) + code.slice(block.end);
    // `module.exports.x = name` or `exports.x = name` after the block re-exports; it is not a call (#5548 review 1).
    code = code.replace(/\b(?:module\.)?exports\.[A-Za-z_$][\w$]*\s*=[^;\n]*/g, (m) => ' '.repeat(m.length));
    for (const name of exportedNames(text)) {
      if (skip(name, rel)) continue;
      /* Short and generic names (FILE, LOG, get, list...) collide with
         unrelated words in a plain-text grep; a word-boundary search plus a
         5+ character floor keeps the check about the class it hunts (the
         four instances were assignPart, restart, commitments, owesReply --
         all long, specific names). */
      if (name.length < 5) continue;
      const id = name.replace(/\$/g, '\\$');
      const word = new RegExp('\\b' + id + '\\b');
      if (!word.test(tests)) continue;
      if (callerSources.some((s2) => s2.f !== rel && word.test(s2.text))) continue;
      /* A name its own module calls is reachable through whatever calls it;
         the signature is a capability NOTHING invokes. Count mentions in the
         module's code (exports block blanked) beyond its definitions: any left
         means an internal caller. */
      const mentions = (code.match(new RegExp('\\b' + id + '\\b', 'g')) || []).length;
      const defs = (code.match(new RegExp('function\\s*\\*?\\s*' + id + '\\b', 'g')) || []).length
        + (code.match(new RegExp('(const|let|var|class)\\s+' + id + '\\b', 'g')) || []).length
        + (code.match(new RegExp('(?<!\\b(?:const|let|var)\\s+)(?<![.\\w$])' + id + '\\s*=\\s*(async\\s+)?(function\\b|\\([^)]*\\)\\s*=>|[A-Za-z_$][\\w$]*\\s*=>)', 'g')) || []).length;
      if (mentions - defs > 0) continue;
      orphans.push(rel + ' exports ' + name);
    }
  }
  return orphans;
}

/* #5548 slice 2 review 1: bin/ callers count only in CODE, or the hundreds of comment lines in its shell scripts could
   name an export and hide an orphan. JS files go through codeOnly; shell scripts lose their full-line # comments (not
   a trailing # after code: agent-supervisor.sh carries JS inside node -e '...', where a # can be code). Done here, not
   where sources is built, because codeOnly's REGEX_AFTER is declared below that line. */
for (const s2 of sources) {
  if (!/^bin[\/\\]/.test(s2.f)) continue;
  s2.text = s2.f.endsWith('.js') ? codeOnly(s2.text) : s2.text.split('\n').map((l) => (/^\s*#/.test(l) ? '' : l)).join('\n');
}

// posix keys, so the file-keyed lists compare the same on Windows (#5548 review 2)
const engineModules = engineFiles.map((f) => ({ rel: path.posix.join('engine', f), text: read(path.join('engine', f)) }));

/* EXCUSED is by name (an excuse covers the name wherever it is exported); SEAMS_5548 and TRIAGED_5548 are by file, so a pending
   name cannot cover a new orphan of the same name in another module (#5548 review 1). */
const skipped = (n, rel) => Boolean(EXCUSED[n]) || SEAMS_5548[n] === rel || (TRIAGED_5548[n] && TRIAGED_5548[n][0] === rel);

test('no engine export is tested, excused by nobody, and reachable from nowhere', () => {
  const orphans = findOrphans(engineModules, sources, testBlob, skipped);
  assert.deepEqual(orphans, [],
    'tested, exported, and reachable from nowhere -- the #265 signature. Wire it to a screen, or excuse it here with a reason someone can check.');
});

/* Engine modules that export something other than a `module.exports = { ... }` literal, so this guard reads no
   names from them. Named so a new one is a decision, not a silent gap (#5548 review 1). */
const NO_LITERAL_EXPORTS = {
  'engine/agent-browser-config.js': 'no module.exports (a config the board reads as a file)',
  'engine/agent-permission-config.js': 'no module.exports (a config the board reads as a file)',
  'engine/doctrine-past.js': 'module.exports = blocks (an array of retired doctrine text, data not functions)',
  'engine/github.js': 'module.exports = Object.assign(makeDoor({...}), ...) (a connection door built by a factory)',
  'engine/vercel.js': 'module.exports = Object.assign(makeDoor({...}), ...) (a connection door built by a factory)',
};

test('#5548: the guard reads every engine exports block', () => {
  const unread = engineModules.filter((m) => exportedNames(m.text).length === 0).map((m) => m.rel).sort();
  assert.deepEqual(unread, Object.keys(NO_LITERAL_EXPORTS).sort(),
    'a module whose exports this guard cannot read is a module it never checks: read it, or name it in NO_LITERAL_EXPORTS with why');
  assert.ok(engineModules.length > 200, 'found only ' + engineModules.length + ' engine modules; a moved directory looks like this');
});

test('#5548: every seam excused by file is still exported there', () => {
  for (const [n, file] of Object.entries(SEAMS_5548)) {
    assert.ok(exportedNames(read(file)).includes(n), file + ' no longer exports ' + n + ': remove it from SEAMS_5548');
  }
});

test('#5548: a triaged name covers only its own file, and each is still exported there', () => {
  for (const [n, [file, why]] of Object.entries(TRIAGED_5548)) {
    assert.ok(why && why.length > 20, n + ' has no reason someone can check');
    assert.ok(exportedNames(read(file)).includes(n), file + ' no longer exports ' + n + ': remove it from TRIAGED_5548');
    assert.equal(skipped(n, 'engine/some-other-module.js'), Boolean(EXCUSED[n]), n + ' must not cover another module');
  }
});

test('#5548: every triaged name is still an orphan without its entry (a name that gained a caller comes off)', () => {
  const still = new Set(findOrphans(engineModules, sources, testBlob, (n, rel) => Boolean(EXCUSED[n]) || SEAMS_5548[n] === rel));
  const fixed = Object.keys(TRIAGED_5548).filter((n) => !still.has(TRIAGED_5548[n][0] + ' exports ' + n));
  assert.deepEqual(fixed, [], 'no longer orphans: remove them from TRIAGED_5548');
});

test('#5548 self-test: a one-line exports block, a comment mention and a string mention do not hide an orphan', () => {
  const fixture = [
    '// orphanCapability is described here, which is not a call.',
    'function orphanCapability() { return "orphanCapability failed"; }',
    'function calledHelper() { return 1; }',
    'function publicThing() { return calledHelper(); }',
    'module.exports = { orphanCapability, calledHelper, publicThing: publicThing, nested: { notAnExport: 1 } };',
  ].join('\n');
  const mods = [{ rel: 'engine/fixture-5548.js', text: fixture }];
  assert.deepEqual(exportedNames(fixture), ['orphanCapability', 'calledHelper', 'publicThing', 'nested']);
  const tests = 'orphanCapability(); calledHelper(); publicThing();';
  const callers = [{ f: 'server.js', text: 'fixture.publicThing()' }];
  assert.deepEqual(findOrphans(mods, callers, tests, () => false), ['engine/fixture-5548.js exports orphanCapability']);
  // and the old shapes stay covered: a multi-line block, and a template literal holding code
  const multi = 'function lonelyExport() {}\nconst t = `${lonelyExport.name}`;\nmodule.exports = {\n  lonelyExport,\n};\n';
  assert.deepEqual(findOrphans([{ rel: 'engine/m.js', text: multi }], [], 'lonelyExport()', () => false), [],
    'code inside a template ${} is a real use');
  // review 1: division after } or a postfix ++ is not a regex, so a comment after it stays a comment
  // (one case per line: a misread regex ends at the next `/` on its line, so two cases on one line can re-sync)
  const div = 'function quietExport() {}\nconst o = {} / 2; // quietExport\nmodule.exports = { quietExport };\n';
  assert.deepEqual(findOrphans([{ rel: 'engine/d.js', text: div }], [], 'quietExport()', () => false), ['engine/d.js exports quietExport']);
  const inc = 'function stillQuiet() {}\nlet i = 0; i++ / 2; // stillQuiet\nmodule.exports = { stillQuiet };\n';
  assert.deepEqual(findOrphans([{ rel: 'engine/p.js', text: inc }], [], 'stillQuiet()', () => false), ['engine/p.js exports stillQuiet']);
  const dotkw = 'function dottedExport() {}\nconst y = x.return / 2; // dottedExport\nmodule.exports = { dottedExport };\n';
  assert.deepEqual(findOrphans([{ rel: 'engine/k.js', text: dotkw }], [], 'dottedExport()', () => false), ['engine/k.js exports dottedExport']);
  // review 1: a re-export after the block and a `name = function` definition are not calls
  const declared = 'const arrowExport = () => 1;\nfunction user() { return arrowExport(); }\nmodule.exports = { arrowExport, user };\n';
  assert.deepEqual(findOrphans([{ rel: 'engine/a.js', text: declared }], [{ f: 'server.js', text: 'user()' }], 'arrowExport() user()', () => false), [],
    'a const arrow is one definition, not two');
  const reexp = 'let assignedExport;\nassignedExport = function () {};\nmodule.exports = { assignedExport };\nmodule.exports.alias = assignedExport;\n';
  assert.deepEqual(findOrphans([{ rel: 'engine/r.js', text: reexp }], [], 'assignedExport()', () => false), ['engine/r.js exports assignedExport']);
  // a real regex after return is still a regex: its quote must not swallow the call after it
  const re = 'function realCall() {}\nfunction user() { return /["]/.test(realCall()); }\nmodule.exports = { realCall, user };\n';
  assert.deepEqual(findOrphans([{ rel: 'engine/q.js', text: re }], [{ f: 'server.js', text: 'user()' }], 'realCall() user()', () => false), []);
  // review 2: a regex at the start of a template ${} is a regex, so its quote does not hide the code after it
  const tre = 'function viaTemplate() {}\nfunction user(s) { return `${/\'/.test(s) ? viaTemplate() : 0}`; }\nmodule.exports = { viaTemplate, user };\n';
  assert.deepEqual(findOrphans([{ rel: 'engine/t.js', text: tre }], [{ f: 'server.js', text: 'user()' }], 'viaTemplate() user()', () => false), []);
  const multi2 = 'function lonelyExport() {}\nmodule.exports = {\n  lonelyExport, // lonelyExport\n};\n';
  assert.deepEqual(findOrphans([{ rel: 'engine/m.js', text: multi2 }], [], 'lonelyExport()', () => false), ['engine/m.js exports lonelyExport']);
});

test('#5548 slice 2 review 1: a bin/ comment naming an export does not count as a call', () => {
  const sh = sources.find((s2) => /^bin[\/\\]agent-supervisor\.sh$/.test(s2.f));
  assert.ok(sh, 'fixture: bin/agent-supervisor.sh is a caller file');
  assert.ok(/retireLauncher/.test(sh.text), 'CONTROL: its real call (inside node -e) survives the comment strip');
  assert.ok(!/^\s*#/m.test(sh.text), 'no full-line comment is left in a bin shell script');
});
