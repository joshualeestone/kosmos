# startupfiles-5774: the token-only guard denies the home folder's shell startup files (kosmos#5774 part 2)

## Why
#5774 route 2: shell startup files. Kosmos launches agents with --dangerously-skip-permissions, so a token-only agent's file tools can write any path no deny rule names. The home folder's shell startup files are read by every shell the same user starts outside the sandbox: anything that runs zsh (.zshenv, even non-interactive), a login shell, the person's own terminal, and each agent's shell snapshot. The sandboxed shell already cannot write the home folder (its write scope; setup-assistant drops additionalDirectories, allowWrite and excludedCommands), so the gap is the file tools'.

## The change
- `SHELL_START_FILES` and `shellStartPaths(home, env)` in engine/setup-assistant.js: .zshenv .zprofile .zshrc .zlogin .zlogout .bashrc .bash_profile .bash_login .profile .bash_logout .cshrc .tcshrc .login .logout in the home folder; zsh's under $ZDOTDIR when it names another folder; the file $BASH_ENV or $ENV names; fish's config.fish and its conf.d folder whole; nushell's config.nu and env.nu.
- Denied in both layers (the file tools' Edit rules and the sandbox's denyWrite), links followed with withTarget, so a dotfile linked from a dotfiles repo has its target denied too.
- A relative $BASH_ENV or $ENV is read from whatever folder the shell runs in, which the agent can choose: named, so the guard says it is not whole.
- Tests: engine/startupfiles-5774.test.js, 5 tests (each file in both layers; a linked dotfile's target; ZDOTDIR, BASH_ENV and ENV from the environment, in both layers, with a control; relative values named; ZDOTDIR set inside .zshenv; XDG_CONFIG_HOME; controls: an ordinary home file and the agent's own .zshrc stay writable). Each piece was mutated and turned red: 6 at first, 9 more after review 1.

## Decided
- Both layers, though the shell's write scope already refuses the home folder: consistent with part 1, and it covers a linked target that sits somewhere the shell can write. Cost, measured (review 2) with a worst-case probe (a linked .zshrc, ZDOTDIR set in .zshenv, BASH_ENV): about 51 more denyWrite entries (125 against 74, 8.1 KB against 4.6 KB as JSON) and 59 more deny rules, and the guard's own profile-size check (#5663) still passes.
- The environment read is the board's own (deps.env or process.env): agents are launched from it, so it is what their shells see. Weakest premise: a launch that sets ZDOTDIR or BASH_ENV differently for one agent is not seen.
- Claude Code's own writes are not affected: deny rules govern its tools, not the app's own code (an installer or updater adding a PATH line still works).
- Not covered here: system-wide startup files under /etc (root-owned, not writable by the agent), and files a startup file pulls in (`source ~/x`), which is route 3 ("what start-time files pull in"). User-writable startup folders outside the home (Homebrew's zsh site-functions and fish vendor folders, review 3) ARE covered, where they exist.

## Gaps, stated
- A shell beyond zsh, bash, sh, csh and tcsh, fish and nushell is not listed (ksh's .kshrc, xonsh, PowerShell profiles); nor ~/.inputrc (key bindings, not code).
- ENV=rc (a bare name with no slash) is read as a label and skipped (review 2), which fails open, but only for an interactive sh.
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

