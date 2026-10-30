# restoregitcfg-5536: the restore listing names a project's command-bearing git settings (kosmos#5536 slice 4c-2, part 1)

Found by 4c-1's review (#7594, round 1): 4c-1 switches off only hooks and fsmonitor. A restored project keeps its
own .git, and its config can hold a filter, textconv, pager, sshCommand, credential helper or include, each of which
runs or loads something once the agent's git reaches it. The review screen must show these before Enable.

## Change
- engine/restoreworld.js runsIn: after everything else, gitSettingsIn(folder, runs). For a .git folder it reads
  .git/config and .git/config.worktree; for a bare layout (HEAD at the top) config and config.worktree.
- Each file is read by git itself: `git config --file <f> --no-includes --null --name-only --list`, cwd the system
  temporary folder, env with every GIT_* variable dropped, GIT_CONFIG_NOSYSTEM=1, GIT_CONFIG_GLOBAL=devNull.
- A key not in GIT_PLAIN_KEYS (an allowlist, subsection as `*`) is a line `<file> sets <key>`, label-cleaned, at
  most 20 per file plus a count line.
- Not checked, said so: a config git refuses, a link, not a file, over 1 MB, git missing or timing out (5 s), a .git
  that is a file or a link, and a commondir.

## Decided
- Allowlist, not a denylist: an unknown key is shown, never passed. Over-listing is the safe direction.
- git reads, not a parser here: a partial parser fails open on any construct it does not model.
- Key names only, never values: a value can carry a credential (a URL with a token).
- Rejected: following include.path (it names a file the backup's author chose; naming the include is enough).
- Weakest premise: `git config --file` with no --includes runs nothing from the file. It reads and prints; no
  config key there is executed by `config --list`.

## Measured
- restoreworld-5536.test.js new test: 7 named keys in site (config + config.worktree), none for plain settings,
  bare config, a broken config, a .git file, a commondir, and the 20-key cap. 58/58.
- Mutation: the gitSettingsIn push replaced by a comment reds the new test (0 pass, 1 fail); restored.
- engine.reachable, windows-coupling-audit-1732, win32-separator-guard: 78/78 with the file.
