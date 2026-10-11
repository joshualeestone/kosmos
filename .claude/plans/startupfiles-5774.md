# startupfiles-5774: the token-only guard denies the home folder's shell startup files (kosmos#5774 part 2)

## Why
#5774 route 2: shell startup files. Kosmos launches agents with --dangerously-skip-permissions, so a token-only agent's file tools can write any path no deny rule names. The home folder's shell startup files are read by every shell the same user starts outside the sandbox: anything that runs zsh (.zshenv, even non-interactive), a login shell, the person's own terminal, and each agent's shell snapshot. The sandboxed shell already cannot write the home folder (its write scope; setup-assistant drops additionalDirectories, allowWrite and excludedCommands), so the gap is the file tools'.

## The change
- `shellStartPaths(home, env, opts)` in engine/setup-assistant.js returns the files, the folders read whole, the permission-layer globs, and what it cannot work out:
  - zsh: .zshenv .zprofile .zshrc .zlogin .zlogout, each with its compiled .zwc, in the home folder and in every ZDOTDIR found. ZDOTDIR comes from the environment, from ~/.zshenv, and from each ZDOTDIR's own .zshenv (bounded to 8 rounds), and the conventional <XDG>/zsh is always included. Completion dumps (.zcompdump*): a glob in the home and each ZDOTDIR, plus existing dumps by name.
  - bash and sh: .bashrc .bash_profile .bash_login .profile .bash_logout .bash_aliases, and the file $BASH_ENV or $ENV names. csh and tcsh: .cshrc .tcshrc .login .logout.
  - XDG_CONFIG_HOME: ~/.config always, plus the environment's, plus one ~/.zshenv sets. fish's and nushell's folders are denied whole under each, with nushell's macOS default (~/Library/Application Support/nushell).
  - User-writable startup folders outside the home, where they exist: Homebrew's zsh site-functions and fish vendor_conf.d, vendor_functions.d and vendor_completions.d, under /opt/homebrew and /usr/local.
  - Links inside the whole folders are followed (3 levels, 500 entries), and every file through withTarget, so each target is denied too.
  - Files are read as regular files only, up to 256 KB.
  - What it cannot work out is named, so the guard is not whole: a relative BASH_ENV; a path-like relative ENV; a relative or unexpandable ZDOTDIR or XDG_CONFIG_HOME; a quote in the middle of a value.
- Both layers: the file tools' Edit rules, and the sandbox denyWrite through realOrLeaf.
- Tests: engine/startupfiles-5774.test.js, 11 tests, each fix mutated red (counts per iteration below).

## Decided
- Both layers, though the shell's write scope already refuses the home folder: consistent with part 1, and it covers a linked target that sits somewhere the shell can write. Cost, measured on this host (review 4: with its real Homebrew folders, 17 zsh completion links and fish's vendor_completions.d, plus a linked .zshrc, ZDOTDIR set in .zshenv and BASH_ENV): 78 more denyWrite entries (152 against 74; 9.9 KB against 4.6 KB as JSON) and 86 more deny rules. The guard's own profile-size check (#5663) still passes. Homebrew's links point into its Cellar, which the user can write, so their targets are real exposure and stay denied; the 500-entry scan budget caps a host with many formulae.
- The environment read is the board's own (deps.env or process.env): agents are launched from it, so it is what their shells see. Weakest premise: a launch that sets ZDOTDIR or BASH_ENV differently for one agent is not seen.
- Claude Code's own writes are not affected: deny rules govern its tools, not the app's own code (an installer or updater adding a PATH line still works).
- Not covered here: system-wide startup files under /etc (root-owned, not writable by the agent), and files a startup file pulls in (`source ~/x`), which is route 3 ("what start-time files pull in"). User-writable startup folders outside the home (Homebrew's zsh site-functions and fish vendor folders, review 3) ARE covered, where they exist.

## Gaps, stated
- A shell beyond zsh, bash, sh, csh and tcsh, fish and nushell is not listed (ksh's .kshrc, xonsh, PowerShell profiles); nor ~/.inputrc (key bindings, not code).
- ENV=rc (a bare name with no slash) is read as a label and skipped (review 2), which fails open, but only for an interactive sh.
- A ZDOTDIR or XDG_CONFIG_HOME set conditionally (`[[ -d x ]] && ZDOTDIR=x`, inside an if) is not read: only an assignment at the start of a line is. The conventional XDG folder is covered regardless.
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

