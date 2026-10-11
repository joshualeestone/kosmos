# startupfiles-5774: the token-only guard denies the home folder's shell startup files (kosmos#5774 part 2)

## Why
#5774 route 2: shell startup files. Kosmos launches agents with --dangerously-skip-permissions, so a token-only agent's file tools can write any path no deny rule names. The home folder's shell startup files are read by every shell the same user starts outside the sandbox: anything that runs zsh (.zshenv, even non-interactive), a login shell, the person's own terminal, and each agent's shell snapshot. The sandboxed shell already cannot write the home folder (its write scope; setup-assistant drops additionalDirectories, allowWrite and excludedCommands), so the gap is the file tools'.

## The change
- `SHELL_START_FILES` and `shellStartPaths(home, env)` in engine/setup-assistant.js: .zshenv .zprofile .zshrc .zlogin .zlogout .bashrc .bash_profile .bash_login .profile .bash_logout .cshrc .tcshrc .login .logout in the home folder; zsh's under $ZDOTDIR when it names another folder; the file $BASH_ENV or $ENV names; fish's config.fish and its conf.d folder whole; nushell's config.nu and env.nu.
- Denied in both layers (the file tools' Edit rules and the sandbox's denyWrite), links followed with withTarget, so a dotfile linked from a dotfiles repo has its target denied too.
- A relative $BASH_ENV or $ENV is read from whatever folder the shell runs in, which the agent can choose: named, so the guard says it is not whole.
- Tests: engine/startupfiles-5774.test.js (each file both layers; a linked dotfile's target; ZDOTDIR, BASH_ENV, ENV from the environment with a control; a relative value named; controls: an ordinary home file and the agent's own .zshrc stay writable). Six mutations, each red.

## Decided
- Both layers, though the shell's write scope already refuses the home folder: consistent with part 1, and it covers a linked target that sits somewhere the shell can write. The cost is about 16 denyWrite entries against the profile size limit (#5663), which the guard measures.
- The environment read is the board's own (deps.env or process.env): agents are launched from it, so it is what their shells see. Weakest premise: a launch that sets ZDOTDIR or BASH_ENV differently for one agent is not seen.
- Claude Code's own writes are not affected: deny rules govern its tools, not the app's own code (an installer or updater adding a PATH line still works).
- Not covered here: system-wide startup files (/etc/zshenv and the like; root-owned, not writable by the agent), and files a startup file pulls in (`source ~/x`), which is route 3 ("what start-time files pull in").

## Gaps, stated
- A shell beyond zsh, bash, sh, csh and tcsh, fish and nushell is not listed.
- Route 3 and on stay on the card.

## Challenge loop notes
