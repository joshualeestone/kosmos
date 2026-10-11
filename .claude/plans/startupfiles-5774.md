# startupfiles-5774: the token-only guard denies the home folder's shell startup files (kosmos#5774 part 2)

## Why
#5774 route 2: shell startup files. Kosmos launches agents with --dangerously-skip-permissions, so a token-only agent's file tools can write any path no deny rule names. The home folder's shell startup files are read by every shell the same user starts outside the sandbox: anything that runs zsh (.zshenv, even non-interactive), a login shell, the person's own terminal, and each agent's shell snapshot. The sandboxed shell already cannot write the home folder (its write scope; setup-assistant drops additionalDirectories, allowWrite and excludedCommands), so the gap is the file tools'.

## The change
- `shellStartPaths(home, env, opts)` in engine/setup-assistant.js returns the files, the folders read whole, the permission-layer globs, and what it cannot work out:
  - zsh: .zshenv .zprofile .zshrc .zlogin .zlogout, each with its compiled .zwc, in the home folder and in every ZDOTDIR found. ZDOTDIR comes from the environment, from ~/.zshenv, and from each ZDOTDIR's own .zshenv (bounded to 8 rounds), and the conventional <XDG>/zsh is always included. Completion dumps (.zcompdump*): a glob in the home and each ZDOTDIR (the file tools), plus existing dumps by name in a ZDOTDIR outside the home (both layers).
  - bash and sh: .bashrc .bash_profile .bash_login .profile .bash_logout .bash_aliases, and the file $BASH_ENV or $ENV names. csh and tcsh: .cshrc .tcshrc .login .logout.
  - XDG_CONFIG_HOME: ~/.config always, plus the environment's, plus one ~/.zshenv sets. fish's and nushell's folders are denied whole under each, with nushell's macOS default (~/Library/Application Support/nushell).
  - User-writable startup folders outside the home, where they exist: Homebrew's zsh site-functions and fish vendor_conf.d, vendor_functions.d and vendor_completions.d, under /opt/homebrew and /usr/local.
  - Links inside the whole folders are followed (3 levels deep; one budget of 500 links and 50,000 entries read, which names itself when spent), and every file goes through withTarget, so each target is denied too: a linked folder gets a whole-folder rule. Targets in a Homebrew Cellar or Caskroom are covered by one stable rule for that folder, only for the one a target is in.
  - Files are read as regular files only, up to 256 KB.
  - ${XDG_CONFIG_HOME:-default}, ${HOME:-default} and ${ZDOTDIR:-default} are read as both arms.
  - A folder to be denied whole that is the root, the home folder, or holds the agent's own folder (a link pointing there) is named instead of denied (review 6), since its rule would take the agent's own work.
  - What it cannot work out is named, so the guard is not whole: a relative BASH_ENV; a path-like relative ENV; a relative or unexpandable ZDOTDIR or XDG_CONFIG_HOME; a quote in the middle of a value.
- Both layers: the file tools' Edit rules, and the sandbox denyWrite through realOrLeaf.
- Tests: engine/startupfiles-5774.test.js, 17 tests, each fix mutated red (counts per iteration below).

## Decided
- Both layers, though the shell's write scope already refuses the home folder: consistent with part 1, and it covers a linked target that sits somewhere the shell can write. Cost, measured on this host with its real Homebrew folders (17 zsh completion links, and fish's vendor_completions.d), a linked .zshrc, ZDOTDIR set in .zshenv and BASH_ENV: 57 more denyWrite entries (131 against 74; 8.3 KB against 4.6 KB as JSON) and 65 more deny rules. The guard's own profile-size check (#5663) still passes.
- Homebrew's links point into its Cellar by VERSION (review 5). The deny lists only grow, and only launch rules are pruned, so following each target would add new versioned paths at every upgrade, for good. Each prefix's Cellar is denied whole instead: one stable rule, in both layers, which covers every version. Neither the agent's file tools nor its shell has any business writing there, and brew's own writes are not governed by deny rules (the sandboxed shell cannot write /opt/homebrew anyway).
- Link scanning shares one budget of 500 entries across all the startup folders. When it runs out, the guard says it is not whole.
- The environment read is the board's own (deps.env or process.env): agents are launched from it, so it is what their shells see. Weakest premise: a launch that sets ZDOTDIR or BASH_ENV differently for one agent is not seen.
- Claude Code's own writes are not affected: deny rules govern its tools, not the app's own code (an installer or updater adding a PATH line still works).
- Not covered here: system-wide startup files under /etc (root-owned, not writable by the agent), and files a startup file pulls in (`source ~/x`), which is route 3 ("what start-time files pull in"). User-writable startup folders outside the home (Homebrew's zsh site-functions and fish vendor folders, review 3) ARE covered, where they exist.

## Gaps, stated
- A shell beyond zsh, bash, sh, csh and tcsh, fish and nushell is not listed (ksh's .kshrc, xonsh, PowerShell profiles); nor ~/.inputrc (key bindings, not code).
- ENV=rc (a bare name with no slash) is read as a label and skipped (review 2), which fails open, but only for an interactive sh.
- A ZDOTDIR or XDG_CONFIG_HOME set conditionally (`[[ -d x ]] && ZDOTDIR=x`) or indented (inside an if, a function or a here-document) is not read: only an assignment at the very start of a line is (review 6, so a mention never makes a guard not whole). The conventional XDG folder is covered regardless.
- A link inside a folder that is itself reached through a link is not followed further.
- Other guard tests that pass neither deps.env nor deps.userShellDirs read this host's environment and Homebrew folders. Decided, not pinned in their nine files: only a relative BASH_ENV, path-like ENV, ZDOTDIR or XDG_CONFIG_HOME in the host's environment can change their result, and it fails closed. Homebrew targets are now covered by a stable Cellar rule rather than by name.
- A completion dump that does not exist yet, in a ZDOTDIR the shell can write, is covered by the file tools' glob only.
- ZDOTDIR set in .zshenv by `typeset -x ZDOTDIR=...` or `: ${ZDOTDIR:=...}`, or in /etc/zshenv, is not read; the conventional XDG folder is covered regardless.
- Route 3 and on stay on the card.

## Challenge loop notes
- Iteration 1 (Opus), on 5f7efbc22:
  - [WARNING] FIXED. ZDOTDIR is usually set INSIDE ~/.zshenv, and zsh then reads its other files from there; only the board's environment was read. Now ZDOTDIR is read from .zshenv as well (absolute, ~, $HOME or $XDG_CONFIG_HOME forms), and the conventional $XDG_CONFIG_HOME/zsh folder is always covered. A value it cannot work out is named, so not whole.
  - [WARNING] FIXED. fish and nushell ignored XDG_CONFIG_HOME, and nushell's macOS default is ~/Library/Application Support/nushell. Both are now covered.
  - [WARNING] FIXED. fish also autoloads functions/ and keeps universal variables (PATH among them) in fish_variables. Its whole folder is now denied, in both layers.
  - [WARNING] FIXED. zsh runs a newer compiled <file>.zwc in place of a startup file, and compinit loads .zcompdump (often host-suffixed). Each zsh file is denied with its .zwc, and .zcompdump* by a glob in the permission layer only (the guard's own glob, added to ruleHasPatternChar's list; the shell cannot write the home folder anyway).
  - [WARNING] FIXED. A relative ZDOTDIR was ignored while a relative BASH_ENV was named. Both are now named, and ENV too, each tested.
  - [WARNING] FIXED. The sandbox layer was untested for the environment paths and the folders. Now asserted; dropping the folders from denyWrite turns a test red.
  - My own error, caught at once: a comment I wrote held "*/" and closed itself (a syntax error the test run showed).
  - NITs taken: the new block no longer sits between CONFIG_HOME_CODE_DIRS and its comment; the plan's mutation line is exact. Not taken: an absolute BASH_ENV with a pattern character is caught by the generic "not whole" message rather than named (rare; still not whole).
- Iteration 2 (Sonnet), on cc8b4e8ae:
  - [WARNING] FIXED. ENV is also a common label (ENV=staging), and naming any relative value would have made every guard not whole. ENV is now read only when it looks like a path. BASH_ENV stays strict, since every non-interactive bash reads it. Tested both ways; the mutation turned red.
  - [WARNING] FIXED. nushell also reads login.nu and its autoload folders, so its folders are now denied whole, as fish's.
  - [WARNING] FIXED. `ZDOTDIR="$HOME"/.zsh` was read as "$HOME" and dropped silently (failing open). The whole value is now parsed, and a quote in the middle is named. My first mutation for this stayed green, because the fallback path also names it. The meaningful mutation, restoring the old regex, turned red.
  - [WARNING] FIXED. The plan's cost line was stale. It is now measured: 51 denyWrite entries in the worst case, and the size check passes.
  - NITs taken: .bash_aliases (its first mutation stayed green, because the test iterated the list it removes from; now named explicitly, red); a fresh folder per ZDOTDIR case; the typeset forms and other shells are stated under Gaps.
- Iteration 3 (Opus), on 80dcceb66:
  - [WARNING] FIXED (reproduced by the reviewer). XDG_CONFIG_HOME was read from the board's environment only, never from .zshenv, so `XDG_CONFIG_HOME=$HOME/.cfg; ZDOTDIR=$XDG_CONFIG_HOME/zsh` left ~/.cfg/zsh writable and the guard said whole. Also, an environment XDG replaced ~/.config, which the person's own terminal still reads. Now every candidate is used: ~/.config always, the environment's, and one .zshenv sets. $XDG_CONFIG_HOME in a ZDOTDIR value is expanded for each.
  - [WARNING] FIXED. Links inside a folder denied whole (GNU Stow links fish's config.fish out) left the target writable. Links inside those folders are now followed, bounded to 3 levels and 500 entries, and their targets denied in both layers.
  - [WARNING] FIXED. A ZDOTDIR's own .zshenv can move ZDOTDIR again. Each ZDOTDIR's .zshenv is now read, bounded to 8 rounds against a cycle.
  - [WARNING] FIXED, not left as a gap. User-writable startup code outside the home: Homebrew's zsh site-functions (on zsh's default fpath) and fish's vendor_conf.d, vendor_functions.d and vendor_completions.d, under /opt/homebrew and /usr/local, are denied whole where they exist. Tests pin them to the sandbox (deps.userShellDirs).
  - NITs taken: an empty ZDOTDIR is "unset", so the guard stays whole; ENV=rc is stated under Gaps; nushell's folders and a ZDOTDIR's .zcompdump are now asserted in both layers. Six mutations, each red.
- Iteration 4 (Sonnet), on 588704676:
  - [WARNING] DECIDED, measured. Following Homebrew's links adds each Cellar target. The Cellar is user-writable, so those targets are real exposure and stay denied. The cost on this host is measured above, within the size check, and the scan budget caps it.
  - [WARNING] FIXED. A ZDOTDIR outside the home can be inside the shell's write scope, where the dump glob (permission layer only) does not reach. Existing dumps are now named in both layers; one not yet created is stated under Gaps.
  - [WARNING] FIXED in part, the rest stated. Files are read as regular files only (a FIFO .zshenv would block) and capped at 256 KB; a relative XDG_CONFIG_HOME is named. Conditional assignments are listed under Gaps.
  - [WARNING] TESTED. A folder linked inside fish (Stow folding) has its contents denied in both layers.
  - NITs taken: the stale comment above foldersOf; the plan's top sections rewritten to match the code. Not taken: .zsh_sessions (state, not code).
  - Mutations: existing dumps not named, red; a relative XDG dropped, red; reading a FIFO hung the run until an alarm killed it (counted red). That orphaned one test child blocked on the FIFO; I killed it by its pid after checking its command line.
- Iteration 5 (Opus), on deb555750:
  - [BLOCKER] FIXED. Following Homebrew's links wrote versioned Cellar paths into deny lists that only grow (the #5663 pattern), so each brew upgrade would add more for good. Each prefix's Cellar is now denied whole, one stable rule in both layers, and Cellar targets are no longer listed one by one. The test simulates an upgrade (1.0, then 2.0) and asserts that no versioned path appears in either layer and that the new target is covered. Two mutations, each red.
  - [WARNING] FIXED. A spent link-scan budget failed open. The budget is now shared, and when it runs out the guard is not whole (tested with 510 links; mutation red).
  - [WARNING] FIXED. `${XDG_CONFIG_HOME:-$HOME/.config}`, the most common form, made every guard not whole. Both arms are now read (tested; mutation red).
  - [WARNING] FIXED. A linked folder got a bare-path rule, where every other folder gets /**; whether Claude Code reads a bare rule as covering contents was never measured. It now gets /** (the test asserts the exact rule; mutation red).
  - [WARNING] DECIDED, stated under Gaps: other guard test files read the host's environment and Homebrew folders.
  - NITs taken: a ZDOTDIR something sets explicitly has its .zshenv read, even when it is the conventional folder (tested; mutation red); the budget is now one shared budget, and the plan says so. Stated: links inside a linked folder; the FIFO test hangs rather than going red.
- Iteration 6 (Sonnet), on c3a2b7cc8:
  - [WARNING] FIXED. A folder denied whole that a link makes the home, the root, or a folder holding the agent's own (fish's folder linked at ~, or Stow-folded at a broad folder) would get <that>/** in both layers and take the agent's own work. Such a folder is now named, not denied. Two tests, checking the agent's own file stays writable. I first wrote the check twice, once for linked folders and once for all folders. The first check's mutation stayed green, because the second already covers it, so I removed the first, and the remaining check's mutation is red.
  - [WARNING] FIXED. Indented assignments (inside a here-document, a function or an if) were read, so a mention could make a guard not whole. Only assignments at the very start of a line are read now, matching the plan. Test with a here-document and a function; mutation red.
  - [WARNING] FIXED. The FIFO test could hang the run. It now runs the read in a child process with a 20 s timeout, so a regression fails, and it is skipped where mkfifo is absent. Its own home folder, so the shared HOME is untouched. Mutation red, with no hang.
  - [WARNING] DECIDED. The Cellar rule's effect on `brew upgrade` from an agent's sandboxed shell: that shell cannot write /opt/homebrew already (its write scope), so the rule changes nothing there; brew run by the person is not governed by deny rules.
  - [WARNING] DUPLICATE of iteration 5: other guard tests read the host's environment and Homebrew folders.
  - [WARNING] NOT A DEFECT. A ZDOTDIR or XDG path with a pattern character makes rules the deny filter drops. That sets tokenRuleDropped, so the guard says it is not whole (the generic message, not a named one).
- Iteration 7 (Opus), on c89b5982f. Context it raised, which raises the stakes of every "not whole": engine/create.js throws when the guard is not whole, so a value named here blocks creating a token-only agent. Each fix below keeps a common, harmless setup whole.
  - [WARNING] FIXED. `export ZDOTDIR="${ZDOTDIR:-$HOME/.config/zsh}"`, the usual line, was named (the reviewer reproduced it), so creation would fail. ${ZDOTDIR:-...} is now read as both arms (each ZDOTDIR already known, and the default). Tested; mutation red.
  - [WARNING] FIXED. The scan budget counted every entry, so a fish plugin manager's hundreds of files would make the guard not whole. It now counts links (what gets denied), with a separate cap of 50,000 entries read. Tested with 600 plain files; mutation red.
  - [WARNING] FIXED. Existing dumps in the home folder were listed by name, so each zsh upgrade or host change (oh-my-zsh's .zcompdump-<host>-<version>) would add entries that are never pruned. The home glob already covers the file tools, and the shell cannot write the home folder. Names are now kept only for a ZDOTDIR outside the home. Tested; mutation red.
  - [WARNING] FIXED. Homebrew's Caskroom keeps casks by version, as the Cellar does, so it gets the same stable rule. Tested; mutation red.
  - NITs taken: only the Cellar or Caskroom a target is in is denied (tested; mutation red); the real paths in tooBroad are computed once; the plan's test count is corrected.

