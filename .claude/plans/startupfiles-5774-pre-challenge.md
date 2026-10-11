---
pre_challenge: true
method: challenge-loop
branch: startupfiles-5774
diff_hash: 6d52ac3ef4b0e4dad84062b7eb0eea65fd2876c6488ce725bc9a4be911a96061
validation: passed
subdir_audit: passed
timestamp: 2026-10-11T08:12:31Z
iterations: 24
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 24 blind reviews, alternating Opus and Sonnet, plus 1 final-validation red(s) that reopened the loop.
**Converged:** Yes, at iteration 24: no new finding above NIT. First at iteration 20 (Sonnet, NITs only); the final validation then went red on a repo guard (#1777), which was fixed and reviewed again. Iteration 17 (Opus) found a real BLOCKER (a silent miss on a nested ${HOME} default); iterations 18 and 19 each found a real WARNING after it. Reviews 21 to 23 then each found real WARNINGs (21: a completion-dump folder the rules cannot carry, and a Cellar hop left with no rule; 22: a dangling dotfile link; 23: a linked ZDOTDIR's real dump, and the unquoted self-folder form), all fixed with mutation-checked tests; review 24 (Sonnet) found NITs only, taken in the plan with no code change.
**Findings:** every review's findings, fixes, decisions and mutation results are below, one section per review, taken from the plan's "Challenge loop notes" written as each review closed. Each fix was checked with a mutation that turned its test red; mutations that stayed green were sharpened until red, and the notes say which.
**Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 6 WARNINGs (as recorded in the plan)
- Iteration 1 (Opus), on 5f7efbc22:
- [WARNING] FIXED. ZDOTDIR is usually set INSIDE ~/.zshenv, and zsh then reads its other files from there; only the board's environment was read. Now ZDOTDIR is read from .zshenv as well (absolute, ~, $HOME or $XDG_CONFIG_HOME forms), and the conventional $XDG_CONFIG_HOME/zsh folder is always covered. A value it cannot work out is named, so not whole.
- [WARNING] FIXED. fish and nushell ignored XDG_CONFIG_HOME, and nushell's macOS default is ~/Library/Application Support/nushell. Both are now covered.
- [WARNING] FIXED. fish also autoloads functions/ and keeps universal variables (PATH among them) in fish_variables. Its whole folder is now denied, in both layers.
- [WARNING] FIXED. zsh runs a newer compiled <file>.zwc in place of a startup file, and compinit loads .zcompdump (often host-suffixed). Each zsh file is denied with its .zwc, and .zcompdump* by a glob in the permission layer only (the guard's own glob, added to ruleHasPatternChar's list; the shell cannot write the home folder anyway).
- [WARNING] FIXED. A relative ZDOTDIR was ignored while a relative BASH_ENV was named. Both are now named, and ENV too, each tested.
- [WARNING] FIXED. The sandbox layer was untested for the environment paths and the folders. Now asserted; dropping the folders from denyWrite turns a test red.
- [NOTE] My own error, caught at once: a comment I wrote held "*/" and closed itself (a syntax error the test run showed).
- [NOTE] NITs taken: the new block no longer sits between CONFIG_HOME_CODE_DIRS and its comment; the plan's mutation line is exact. Not taken: an absolute BASH_ENV with a pattern character is caught by the generic "not whole" message rather than named (rare; still not whole).

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 4 WARNINGs (as recorded in the plan)
- Iteration 2 (Sonnet), on cc8b4e8ae:
- [WARNING] FIXED. ENV is also a common label (ENV=staging), and naming any relative value would have made every guard not whole. ENV is now read only when it looks like a path. BASH_ENV stays strict, since every non-interactive bash reads it. Tested both ways; the mutation turned red.
- [WARNING] FIXED. nushell also reads login.nu and its autoload folders, so its folders are now denied whole, as fish's.
- [WARNING] FIXED. `ZDOTDIR="$HOME"/.zsh` was read as "$HOME" and dropped silently (failing open). The whole value is now parsed, and a quote in the middle is named. My first mutation for this stayed green, because the fallback path also names it. The meaningful mutation, restoring the old regex, turned red.
- [WARNING] FIXED. The plan's cost line was stale. It is now measured: 51 denyWrite entries in the worst case, and the size check passes.
- [NOTE] NITs taken: .bash_aliases (its first mutation stayed green, because the test iterated the list it removes from; now named explicitly, red); a fresh folder per ZDOTDIR case; the typeset forms and other shells are stated under Gaps.

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs (as recorded in the plan)
- Iteration 3 (Opus), on 80dcceb66:
- [WARNING] FIXED (reproduced by the reviewer). XDG_CONFIG_HOME was read from the board's environment only, never from .zshenv, so `XDG_CONFIG_HOME=$HOME/.cfg; ZDOTDIR=$XDG_CONFIG_HOME/zsh` left ~/.cfg/zsh writable and the guard said whole. Also, an environment XDG replaced ~/.config, which the person's own terminal still reads. Now every candidate is used: ~/.config always, the environment's, and one .zshenv sets. $XDG_CONFIG_HOME in a ZDOTDIR value is expanded for each.
- [WARNING] FIXED. Links inside a folder denied whole (GNU Stow links fish's config.fish out) left the target writable. Links inside those folders are now followed, bounded to 3 levels and 500 entries, and their targets denied in both layers.
- [WARNING] FIXED. A ZDOTDIR's own .zshenv can move ZDOTDIR again. Each ZDOTDIR's .zshenv is now read, bounded to 8 rounds against a cycle.
- [WARNING] FIXED, not left as a gap. User-writable startup code outside the home: Homebrew's zsh site-functions (on zsh's default fpath) and fish's vendor_conf.d, vendor_functions.d and vendor_completions.d, under /opt/homebrew and /usr/local, are denied whole where they exist. Tests pin them to the sandbox (deps.userShellDirs).
- [NOTE] NITs taken: an empty ZDOTDIR is "unset", so the guard stays whole; ENV=rc is stated under Gaps; nushell's folders and a ZDOTDIR's .zcompdump are now asserted in both layers. Six mutations, each red.

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 4 WARNINGs (as recorded in the plan)
- Iteration 4 (Sonnet), on 588704676:
- [WARNING] DECIDED, measured. Following Homebrew's links adds each Cellar target. The Cellar is user-writable, so those targets are real exposure and stay denied. The cost on this host is measured above, within the size check, and the scan budget caps it.
- [WARNING] FIXED. A ZDOTDIR outside the home can be inside the shell's write scope, where the dump glob (permission layer only) does not reach. Existing dumps are now named in both layers; one not yet created is stated under Gaps.
- [WARNING] FIXED in part, the rest stated. Files are read as regular files only (a FIFO .zshenv would block) and capped at 256 KB; a relative XDG_CONFIG_HOME is named. Conditional assignments are listed under Gaps.
- [WARNING] TESTED. A folder linked inside fish (Stow folding) has its contents denied in both layers.
- [NOTE] NITs taken: the stale comment above foldersOf; the plan's top sections rewritten to match the code. Not taken: .zsh_sessions (state, not code).
- [NOTE] Mutations: existing dumps not named, red; a relative XDG dropped, red; reading a FIFO hung the run until an alarm killed it (counted red). That orphaned one test child blocked on the FIFO; I killed it by its pid after checking its command line.

#### Iteration 5
**Reviewer model:** opus
**New findings:** 1 BLOCKERs, 4 WARNINGs (as recorded in the plan)
- Iteration 5 (Opus), on deb555750:
- [BLOCKER] FIXED. Following Homebrew's links wrote versioned Cellar paths into deny lists that only grow (the #5663 pattern), so each brew upgrade would add more for good. Each prefix's Cellar is now denied whole, one stable rule in both layers, and Cellar targets are no longer listed one by one. The test simulates an upgrade (1.0, then 2.0) and asserts that no versioned path appears in either layer and that the new target is covered. Two mutations, each red.
- [WARNING] FIXED. A spent link-scan budget failed open. The budget is now shared, and when it runs out the guard is not whole (tested with 510 links; mutation red).
- [WARNING] FIXED. `${XDG_CONFIG_HOME:-$HOME/.config}`, the most common form, made every guard not whole. Both arms are now read (tested; mutation red).
- [WARNING] FIXED. A linked folder got a bare-path rule, where every other folder gets /**; whether Claude Code reads a bare rule as covering contents was never measured. It now gets /** (the test asserts the exact rule; mutation red).
- [WARNING] DECIDED, stated under Gaps: other guard test files read the host's environment and Homebrew folders.
- [NOTE] NITs taken: a ZDOTDIR something sets explicitly has its .zshenv read, even when it is the conventional folder (tested; mutation red); the budget is now one shared budget, and the plan says so. Stated: links inside a linked folder; the FIFO test hangs rather than going red.

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 6 WARNINGs (as recorded in the plan)
- Iteration 6 (Sonnet), on c3a2b7cc8:
- [WARNING] FIXED. A folder denied whole that a link makes the home, the root, or a folder holding the agent's own (fish's folder linked at ~, or Stow-folded at a broad folder) would get <that>/** in both layers and take the agent's own work. Such a folder is now named, not denied. Two tests, checking the agent's own file stays writable. I first wrote the check twice, once for linked folders and once for all folders. The first check's mutation stayed green, because the second already covers it, so I removed the first, and the remaining check's mutation is red.
- [WARNING] FIXED. Indented assignments (inside a here-document, a function or an if) were read, so a mention could make a guard not whole. Only assignments at the very start of a line are read now, matching the plan. Test with a here-document and a function; mutation red.
- [WARNING] FIXED. The FIFO test could hang the run. It now runs the read in a child process with a 20 s timeout, so a regression fails, and it is skipped where mkfifo is absent. Its own home folder, so the shared HOME is untouched. Mutation red, with no hang.
- [WARNING] DECIDED. The Cellar rule's effect on `brew upgrade` from an agent's sandboxed shell: that shell cannot write /opt/homebrew already (its write scope), so the rule changes nothing there; brew run by the person is not governed by deny rules.
- [WARNING] DUPLICATE of iteration 5: other guard tests read the host's environment and Homebrew folders.
- [WARNING] NOT A DEFECT. A ZDOTDIR or XDG path with a pattern character makes rules the deny filter drops. That sets tokenRuleDropped, so the guard says it is not whole (the generic message, not a named one).

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs (as recorded in the plan)
- Iteration 7 (Opus), on c89b5982f. Context it raised, which raises the stakes of every "not whole": engine/create.js throws when the guard is not whole, so a value named here blocks creating a token-only agent. Each fix below keeps a common, harmless setup whole.
- [WARNING] FIXED. `export ZDOTDIR="${ZDOTDIR:-$HOME/.config/zsh}"`, the usual line, was named (the reviewer reproduced it), so creation would fail. ${ZDOTDIR:-...} is now read as both arms (each ZDOTDIR already known, and the default). Tested; mutation red.
- [WARNING] FIXED. The scan budget counted every entry, so a fish plugin manager's hundreds of files would make the guard not whole. It now counts links (what gets denied), with a separate cap of 50,000 entries read. Tested with 600 plain files; mutation red.
- [WARNING] FIXED. Existing dumps in the home folder were listed by name, so each zsh upgrade or host change (oh-my-zsh's .zcompdump-<host>-<version>) would add entries that are never pruned. The home glob already covers the file tools, and the shell cannot write the home folder. Names are now kept only for a ZDOTDIR outside the home. Tested; mutation red.
- [WARNING] FIXED. Homebrew's Caskroom keeps casks by version, as the Cellar does, so it gets the same stable rule. Tested; mutation red.
- [NOTE] NITs taken: only the Cellar or Caskroom a target is in is denied (tested; mutation red); the real paths in tooBroad are computed once; the plan's test count is corrected.

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs (as recorded in the plan)
- Iteration 8 (Sonnet), on 220796e09:
- [WARNING] FIXED. Review 7's dump fix excluded only a ZDOTDIR equal to the home, so the conventional ~/.config/zsh, under the home, still had its dumps named (the pile-up again). Dumps are now named only for a folder not anywhere under the home, compared by real path. Tested; mutation red.
- [WARNING] FIXED. Links into a Cellar or Caskroom spent the shared link budget though one stable rule covers them, so a heavy Homebrew host could get a false "not whole". They are no longer counted. Tested with 510 Cellar links (whole); the control is review 5's 510 links elsewhere (named). Mutation red.
- [NOTE] NITs taken: .bash_completion is listed and named in the test. Stated under Gaps: a second assignment on one line. Not taken: other guard tests reading the host's Homebrew (decided in iteration 5).

#### Iteration 9
**Reviewer model:** opus
**New findings:** 1 BLOCKERs, 2 WARNINGs (as recorded in the plan)
- Iteration 9 (Opus), on 618fdb5e6:
- [BLOCKER] FIXED (measured by the reviewer end to end). `${XDG_CONFIG_HOME:-${HOME}/.config}`, a common spelling, was cut at its inner brace, which gave paths with a literal } that the deny filter dropped, so the guard was not whole and creation failed. A plain ${HOME}, ${XDG_CONFIG_HOME} or ${ZDOTDIR} is now unbraced before parsing, and any brace left over makes the value named rather than a path. Tested with both nested lines (whole, and no brace in any rule); mutation red.
- [WARNING] FIXED. nix home-manager links dotfiles into /nix/store/<hash>-..., and the hash changes at every switch, so the targets piled up (the reviewer measured 2, then 4, then 6 entries). That store is read-only. Targets the user cannot write are now dropped; a path not there yet is kept. Tested with a read-only store simulated by chmod; mutation red.
- [WARNING] FIXED with the above: a braced-default test.
- [NOTE] NITs taken: the plan's budget sentence, a re-measured cost with the commit named, and one realpath per link.

#### Iteration 10
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs (as recorded in the plan)
- Iteration 10 (Sonnet), on c84bff9a4:
- [WARNING] FIXED, and it was MY regression from iteration 9. The writability filter followed links, so for a home-manager ~/.zshrc linked into the read-only store it dropped the LINK too, and a tool replacing the link would write a new ~/.zshrc (a silent miss). My iteration-9 test asserted only that the store path was absent, so it could not see this. The link is now always kept. A link whose target is read-only goes to the file tools only, by its own path: the sandbox side would resolve it back to the hashed store path (my first fix did exactly that, and the test caught it). Writability is judged before withTarget, so a read-only target is never named. Tests now assert that the link is still denied; three mutations, each red.
- [WARNING] DECIDED (stated under Gaps): a writable target with a rule-syntax character is named.
- [WARNING] FIXED. A Homebrew under another prefix listed versioned paths. A Cellar or Caskroom is now detected from the target's shape. Tested with an unlisted prefix; mutation red.
- [NOTE] NITs taken: the space-in-path case is stated under Gaps.

#### Iteration 11
**Reviewer model:** opus
**New findings:** 1 BLOCKERs, 3 WARNINGs (as recorded in the plan)
- Iteration 11 (Opus), on b8685ca48:
- [BLOCKER] FIXED, and MY regression from review 10. The leaf-only link check (lstat) missed a link in a PARENT folder: a Stow-folded ~/.config, or a linked ZDOTDIR folder. The real files there got no file-tools rule and the guard said whole (the reviewer reproduced both). "Linked" is now decided by where the path really resolves (realOrLeaf), wherever the link sits. Tests for both shapes; restoring the leaf-only check turns them red.
- [WARNING] FIXED. A read-only non-link ~/.bashrc was dropped entirely, but the home folder is writable, so it could be replaced. A path is now always kept; only a resolved target is judged. In the test sandbox the home sits under /var (a link to /private/var), so such a file counts as linked and is denied to the file tools only, which is the layer that matters there. Mutation red.
- [WARNING] FIXED. Joined quoting (`ZDOTDIR="$HOME"/.zsh`, a common spelling) was named, so the guard was not whole. Values are now unquoted part by part. A quoted ~ (zsh leaves it literal) or a single-quoted $ is named, and a quoted space is fine. The old review-1 and review-2 test cases were corrected: one expected a quoted ~ to expand, and one expected "$HOME"/.zsh to be named. Mutation of the quoted-~ rule: red.
- [WARNING] FIXED: tests for linked parents and for a read-only non-link file.
- [NOTE] NITs taken: a read-only linked folder gets /** (mutation red). Accepted: dumps by name in a ZDOTDIR outside the home can pile up at zsh upgrades (rare). The hermeticity of homebrewPrefixes is stated in iteration 5.

#### Iteration 12
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs (as recorded in the plan)
- Iteration 12 (Sonnet), on d05d2c5ba:
- [WARNING] FIXED. A DANGLING link found by the folder scan was skipped as "nothing there to write". But anything that creates its target (the agent's tools) makes the link run it. Its would-be target is now denied, as withTarget does for a top-level dangling file. Tested; mutation red.
- [WARNING] DECIDED, stated under Gaps: other versioned or hashed link targets can pile up.
- [NOTE] NITs: DEPS now pins homebrewPrefixes to empty (this file is fully hermetic). ENV with a slash, and dumps outside the home, are stated under Gaps.

#### Iteration 13
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs (as recorded in the plan)
- Iteration 13 (Opus), on 9625fc687:
- [WARNING] FIXED (both reproduced by the reviewer). The dangling-target fix from review 12 followed one hop, from the link's WRITTEN folder: a relative link inside a Stow-linked folder, and a two-hop chain, each left the real would-be target writable. It now goes through danglingTarget, which takes every hop, each from the link's real folder (as withTarget already did). Tested; mutation red.
- [WARNING] FIXED. "Cannot write" meant not writable now, so a 0444 file the user owns, which the owner can chmod back, was treated like a read-only store. It now means: not writable now, not owned by this user, and in a folder this user cannot write. Tests cannot make a root-owned store, so they pass deps.readOnlyTarget; a new test shows the user's own 0444 target stays denied in both layers. Mutation red.
- [WARNING] FIXED. Two direct shellStartPaths calls in the tests (one in the FIFO child) still read this host's Homebrew; both now pin it.
- [WARNING] FIXED. ${VAR:=...}, ${VAR-...} and ${VAR=...} were named (a false "not whole"). They are read with the same two arms as :-. Tested; mutation red.
- [NOTE] NITs taken: the joined-quoting comment (a quoted space IS read); ~/.ssh/rc added (tested; mutation red); the chmod-based test arm is skipped when run as root. Not taken: the Cellar or Caskroom shape could match a user folder named Cellar (tooBroad stops the worst case); on macOS the plain-path branch is not exercised by these tests (the sandbox home is under /var, a link).

#### Iteration 14
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs (as recorded in the plan)
- Iteration 14 (Sonnet), on 84967107d:
- [WARNING] FIXED (reproduced by the reviewer). A read-only target found INSIDE a startup folder (home-manager linking ~/.config/fish/config.fish into the store) skipped the read-only check, because the folder scan returns real targets, so the hashed paths piled up again. Linked targets are now judged by the same isReadOnlyTarget (moved to module level; tests override it through deps.readOnlyTarget). The link itself is under its folder's /** rule. Tested; mutation red.
- [WARNING] FIXED. One-line conditional forms were a silent miss. Every assignment on a top-level line is now read: after && or ;, with typeset -x, as a second assignment, and as : ${ZDOTDIR:=x}. A conditional means "this or what it was", and both are covered. Comments are not read. Tested with four forms and a comment control; two mutations red.
- [NOTE] NITs not taken: BASH_ENV with a bare label stays named (every non-interactive bash reads it); dumps outside the home (accepted).

#### Iteration 15
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs (as recorded in the plan)
- Iteration 15 (Opus), on 9e38114dd:
- [WARNING] FIXED (reproduced by the reviewer). `ZDOTDIR=${0:A:h}` and `${${(%):-%x}:A:h}`, the usual way a dotfiles repo points ZDOTDIR at the folder its .zshenv really lives in, were named, so creation failed. They now resolve to that folder (:A follows links, :a does not). Tested; mutation red.
- [WARNING] FIXED, reverting part of review 13. The owner check brought the store pile-up back on single-user Nix (a user-owned store), and neither layer can chmod: the file tools do not, and the sandboxed shell cannot outside its write scope. Read-only now means not writable now, in a folder this user cannot write. A new test uses a user-owned 0444 file in a 0555 folder; restoring the owner check turns it red. My review-13 test could not fail on this, because its folder was writable.
- [WARNING] FIXED. Per-user data folders: fish's vendor_conf.d, vendor_functions.d and vendor_completions.d, nushell's vendor/autoload, and bash-completion's completions, under ~/.local/share and $XDG_DATA_HOME. Tested; mutation red.
- [WARNING] FIXED. ~/.ssh/config (ProxyCommand, LocalCommand and Match exec run code). Tested; mutation red.
- [CONVENTION] FIXED: the stale Gaps line about typeset and := forms.
- [NOTE] NITs not taken: a linked target with a rule-syntax character found inside a folder is caught by the generic not-whole message rather than named; the Cellar shape match; the test's own realOrLeaf does not follow a leaf link (assertions pass targets).

#### Iteration 16
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs (as recorded in the plan)
- Iteration 16 (Sonnet), on 0033355ea:
- [WARNING] FIXED (reproduced by the reviewer). A trailing comment (`export FOO=1 # ZDOTDIR=$XDG_DATA_HOME/z`) or a quoted mention (`echo "set ZDOTDIR=foo"`) was read as an assignment, so a harmless setup was not whole. assignmentsIn now tracks quote state: an unquoted # after a space ends the line, and a NAME= that starts inside quotes is a mention. The dangerous arms are tested too: an assignment before a comment, and `: "${ZDOTDIR:=x}"` inside quotes, are still read. Two mutations, each red.
- [WARNING] FIXED. `ZDOTDIR=$HOME/My\ Dir/zsh` read as `<home>/My\` (a cut-off path, then the generic not-whole). A backslash in a value is now named. Mutation red.
- [WARNING] DECIDED, stated under Gaps: $XDG_DATA_HOME and $XDG_CACHE_HOME in a ZDOTDIR are named rather than resolved from the environment (resolving from the environment alone would miss a value .zshenv sets).
- [NIT] TAKEN: ~/.bashrc.d (Fedora's default .bashrc runs every file in it) is denied whole; other drop-in folders and login items are stated under Gaps. Mutation red.
- [NIT] TAKEN: a dangling link whose would-be target is in a Cellar no longer spends the link budget (510 such links stay whole). Mutation red.
- [NIT] TAKEN: the USER_WRITABLE_SHELL_DIRS comment no longer claims they are the user's on every host.
- [NIT] not taken: other guard tests reading the host's Homebrew (decided in iteration 5).

#### Iteration 17
**Reviewer model:** opus
**New findings:** 1 BLOCKERs, 3 WARNINGs (as recorded in the plan)
- Iteration 17 (Opus), on 8963afe41:
- [BLOCKER] FIXED (reproduced by the reviewer). `: ${ZDOTDIR:=${HOME}/.zsh}` was a silent miss: the second form's `[^}]*` cut the default at the inner brace, and foldersOf then read the lone `${HOME` as the home folder, which is skipped as already covered. The second form now captures balanced braces, and foldersOf accepts only `$HOME` exactly (`${HOME}` is unbraced first), so an unclosed brace is named. Two mutations, each red.
- [WARNING] FIXED. A single-user Nix store root is the user's own, so home-manager's two-hop links (a file directly in the store root) are not read-only, and the hashed name was listed and would pile up. A target in a known store (/nix/store; deps.storeRoots in tests) now gives one stable rule for the store in both layers, and the link stays with the file tools. Tested with a user-owned 0755 store holding a 0444 target, both through ~/.zshrc and a link inside fish; mutations of each path red. A store elsewhere is stated under Gaps.
- [WARNING] FIXED. XDG_CONFIG_HOME set in .zprofile, .zshrc, .profile or .bashrc, or in a ZDOTDIR's files, was not read (fails open). Now read from each. Two mutations red.
- [WARNING] FIXED. XDG_DATA_HOME: a relative value in the environment is named (it was dropped), and it is read from the startup files too, including the `${XDG_DATA_HOME:-$HOME/...}` form; ZDOTDIR=$XDG_DATA_HOME/zsh now resolves. Mutation red.
- [NIT] TAKEN: the lone-brace match (the blocker's cause).
- [NIT] TAKEN: the two comments that still described the removed owner check.
- [NIT] not taken: the Cellar shape match on a person's own folder named Cellar (accepted earlier; tooBroad bounds it).

#### Iteration 18
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNINGs (as recorded in the plan)
- Iteration 18 (Sonnet), on 71eb1c928:
- [WARNING] FIXED (reproduced by the reviewer). A link in the MIDDLE of a chain (`~/.zshrc -> ~/dotfiles/zshrc -> <target>`) was never denied, so a tool replacing it with a file changed what ~/.zshrc runs. New chainHops: every link a chain passes through, named by its real folder (an absolute link target can pass a linked folder like /var), is denied to the file tools, for the home's files and folders and for links found inside startup folders. A hop in a folder the user cannot write (a store's link farm) is left out, and so is one in a Cellar or store (the stable rule covers it, and its name would pile up). Tested: a hop to a read-only target, a writable chain, a chain inside fish, a hop in a 0555 folder, and a hop directly in a writable store root. Eight mutations, each red; the store-skip mutation stayed GREEN at first (the only store hop sat in a 0555 folder, so the read-only check hid it), and the test was sharpened with a hop directly in the store root until red. My first version also named hops by the link's literal spelling, which the test caught.
- [NIT] not taken: the greedy Cellar match on a nested Cellar folder (a second Cellar under a versioned one; not seen in Homebrew's layout).
- [NIT] not taken: the Cellar shape on a person's own folder (accepted earlier).
- [NIT] DUPLICATE: a writable target with a rule-syntax character gets the generic message (stated under Gaps).

#### Iteration 19
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs (as recorded in the plan)
- Iteration 19 (Opus), on 0baa0f185:
- [WARNING] FIXED (reproduced by the reviewer). A target found inside a startup folder (fish, nushell, .bashrc.d, Homebrew's), or a link on the way (review 18's hops), whose path the rule syntax cannot carry went to the generic drop: the WHOLE guard was not written, and the message blamed the agent's, home or Kosmos folder. Each is now named ("a path the permission rules cannot carry", with the rename hint) and left out of the file tools' rules only; the sandbox list keeps it, and the rest of the guard is written. When the home itself cannot be carried nothing is named here, since the generic message is then the true one. This also corrects review 18's note, which called this finding a duplicate of a Gaps line that held on one route only. Tested: a fish target, a linked fish folder and a hop, each with a ( in its path; the named reason, settings.json written, the link still denied, the sandbox still carrying the target. Four mutations (the check, and each of the files, link files and folders lists left unfiltered), each red. The read-only linked FOLDER list is filtered the same way and has no test of its own (its entries are links under the startup folders, so a rule-syntax character there means one in the home or XDG path).
- [WARNING] FIXED: the missing test above.
- [NIT] TAKEN: links inside a linked folder (Stow folding a whole functions/ folder) are now followed, both layers. Mutation red.
- [NIT] NOT A DEFECT: duplicate denyWrite entries. The list is already a Set where settings are written (`denyWrite: [...new Set([...dw, ...denyWritePaths])]`), which is what the size check reads.

#### Iteration 20
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs (as recorded in the plan)
- Iteration 20 (Sonnet), on 04a615925: no BLOCKER, no WARNING (CONVERGED). The reviewer probed 15 common ZDOTDIR and XDG spellings in a scratch home (all whole) and ran shellStartPaths read-only on this host's real home (unsafe [], the Cellar as one stable rule).
- [NIT] TAKEN (plan only): the Decided line still said "not owned by this user" after review 15; corrected.
- [NIT] TAKEN (plan only): the cost line was measured at 618fdb5e6, before reviews 10 to 19; re-measured (above).
- [NIT] not taken: the named message for `XDG_DATA_HOME=$(brew --prefix)/share` shows the value cut at its first space (fails closed; the setting name is in it).
- [NIT] not taken: an absolute ENV or BASH_ENV of /dev/null lands in denyWrite (harmless, very rare). The Cellar shape is POSIX only (Homebrew is too).
- [NIT] DUPLICATE: PowerShell, ksh, xonsh and ~/.inputrc are stated under Gaps and stay on the card.

#### Iteration 6j-1
**Reviewer model:** none (the final validation helper)
**New findings:** 0 BLOCKERs, 1 WARNINGs (as recorded in the plan)
- Final validation 1 (the validation helper, through queued-heavy), on 95bfbbe25 (main merged clean): RED, two items.
- [WARNING] FIXED. engine/windows-tests-1777's guard: a test file that compares process.platform with 'win32' must run on Windows or be excluded with a reason. The FIFO case was gated on `process.platform !== 'win32' && fs.existsSync('/usr/bin/mkfifo')`; the second half alone already skips it where there is no mkfifo, so the platform comparison is gone. Both files green together (53 tests). This reopens the loop: review 21 follows.
- [NOTE] [NOTE] A 4273 LEAK of one kts temp folder was reported for the whole suite, with no file named. This file alone, under a fresh TMPDIR, leaves nothing (measured: the folder was empty after a full run, including the 0555 and 0444 fixtures, which each test restores). Not attributed to this branch; the next validation shows whether it recurs.

#### Iteration 21
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs (as recorded in the plan)
- Iteration 21 (Opus), on 14dc88ba2 (reopened by final validation 1):
- [WARNING] FIXED (reproduced by the reviewer). Review 19 missed one route: the .zcompdump* globs. A ZDOTDIR or XDG_CONFIG_HOME with a rule-syntax character (a dotfiles folder under ~/Dropbox (Personal)) still dropped the WHOLE guard with the generic message. The globs now go through the same check, judged by their folder. Tested for a ZDOTDIR and an XDG folder, each with a (: named, settings.json written. Mutation red.
- [WARNING] FIXED: the plan's "on every route" overstated it; corrected above.
- [NIT] TAKEN, because the harm was unmeasured rather than shown harmless: BASH_ENV=/dev/null (the usual way to switch it off) put /dev/null in denyWrite, which could break every `> /dev/null` in the agent's shell. An absolute BASH_ENV or ENV is now listed only when it is a file or absent. Tested both arms (/dev/null not listed; an absent file still listed); two mutations red. Iteration 20's note called this harmless without measuring it.
- [NIT] TAKEN, and it was worse than reported. A home dotfile linked into a Homebrew Cellar listed its versioned target by name (the store rule of review 17 applied to stores only), and a hop inside a Cellar was SKIPPED on both routes, which left it with no rule at all unless the final target was in the same Cellar: a silent miss my review-18 design introduced. Now a target or hop in a Cellar, Caskroom or store adds that folder's one stable rule (stableRootOf, shared by both routes). Tested: a dotfile linked into a Cellar, and a Cellar hop reached from a dotfile and from inside fish. Six mutations red. One stayed GREEN at first: my test parked the other link by renaming it inside the fish folder, which the scan still read; it now parks it outside every scanned folder.

#### Iteration 22
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs (as recorded in the plan)
- Iteration 22 (Sonnet), on 6f80f592f:
- [WARNING] FIXED (reproduced by the reviewer). A DANGLING dotfile link (`~/.zshrc -> ~/gone/zshrc`) got no rule for its target, in either layer: linkAware asked realOrLeaf, which keeps a dangling leaf's own name, so the link read as an ordinary file and never reached withTarget's dangling handling. The agent could create the target and the next zsh runs it. linkAware now resolves as withTarget does (realpath, else danglingTarget). Its first mutation stayed GREEN: the test HOME sits under /var (a link to /private/var), where every path reads as linked, so the bug cannot show there. A case with a home that has no link above it was added, and that mutation is red. The test file's own realOrLeaf now follows a leaf link as production does (all tests stayed green). Checked the class: the only other "linked?" test of this shape is withTarget's, which was already right.
- [WARNING] FIXED in the part that was real. A Cellar-shaped folder (a person's own folder named Cellar) reached through linkAware got a whole-folder rule with no too-wide check, unlike the folder scan's. linkAware now names one that is the root or holds the home or the agent's own folder, and keeps the link for the file tools. Tested (an agent folder inside a folder named Cellar); two mutations red. The shape match itself stays (decided in reviews 10, 18 and 20).
- [WARNING] DUPLICATE, decided in review 11 and stated under Gaps: completion dumps by name in a ZDOTDIR outside the home.
- [NIT] NOT A DEFECT: DEPS does pin userShellDirs and homebrewPrefixes (assigned just below its declaration).
- [NIT] TAKEN: the test realOrLeaf (above).

#### Iteration 23
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs (as recorded in the plan)
- Iteration 23 (Opus), on 2ab667f52:
- [WARNING] FIXED (reproduced by the reviewer). A LINKED ZDOTDIR (~/.config/zsh -> ~/dotfiles/zsh, Stow's usual shape) had its .zcompdump* glob written on the link's spelling only, and the file tools write the dump by its real path: a silent miss, with the guard whole. Every glob is now also written on its folder's real path (realOrLeaf): one stable glob, nothing versioned. Tested with a home that has no link above it (the /var trap of review 22). Mutation red.
- [WARNING] FIXED (reproduced by the reviewer). The unquoted `export ZDOTDIR=${${(%):-%x}:A:h}` (normal in zsh) was cut at its ) and named, so creation failed on a harmless setup; review 15's selfDir read only the quoted spelling. A ${...} group (two levels) is now one part of a value. Tested for the %x/:A and %N/:a spellings, each resolving to the right folder (:A follows the link to the repo, :a keeps the link's folder). Mutation red.
- [NIT] TAKEN, it failed open. A # inside a word (ZDOTDIR=$HOME/z#1) is literal in the shell, but ended the value, which read as a different folder with nothing named. # now ends a value only where a comment can start: at a word's start, after a space or ; & | (. Both arms tested (z#23 read whole; `;# ZDOTDIR=...` is a comment). Two mutations red.
- [NIT] TAKEN (plan only): the Windows sentence above.
- [NIT] not taken: tooWide and tooBroad are two copies of one rule (each tested); chainHops' read-only folder check is not injectable (its test uses a real 0555 folder); the refusal's heading names start-time files generally.

#### Iteration 24
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs (as recorded in the plan)
- Iteration 24 (Sonnet), on 9322c0c71: no BLOCKER, no WARNING (CONVERGED again). The reviewer probed 15 common setups in scratch homes (nvm's `${XDG_CONFIG_HOME-}`, conda init, conditional assignments, ENV=production, BASH_ENV=/dev/null and more): all whole.
- [NIT] TAKEN (plan only): a per-run temp BASH_ENV would pile up; stated under Gaps.
- [NIT] TAKEN (plan only): the 500-link budget on a plugin tree fails closed; stated under Gaps.
- [NIT] TAKEN (plan only): the change list now names ~/.ssh/config.
- [NIT] DUPLICATE: the Cellar shape match (decided in reviews 10, 18 and 20).

#### Iteration 6j-2
**Reviewer model:** none (the final validation helper)
**New findings:** 0 BLOCKERs, 0 WARNINGs
- [NOTE] Final validation 2, through queued-heavy, on d106bc1f7 (main merged clean, no overlap with this branch's files): GREEN. 18985 tests, 18750 pass, 0 fail; subdir audit passed; no #4273 leak reported. validation-log recorded hash 6d52ac3ef4b0, equal to diff_hash above.

### Strengths (across all iterations)
- Unknowns are named, never dropped: a value the parser cannot read, a scan cut short, a folder too wide to deny, a path the rule syntax cannot carry (every review)
- Pile-up is designed out: one stable rule per Cellar, Caskroom or store; read-only targets filtered; home dumps by glob (reviews 5, 7, 14, 17)
- Every fix has a test that a mutation turns red (every review)

