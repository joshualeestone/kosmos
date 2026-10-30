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
- Not checked, said so: a config git refuses, a link, not a file, over 1 MB, git missing or timing out (2 s a read, 20 s a listing), a .git
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

## Review round 1 (opus): 3 WARNING, 1 CONVENTION, 3 NIT, all addressed
- A long subsection pushed the key's name off its label (60-char cut), so `remote.<long>.uploadpack` read as a
  remote URL. Now the section and name are shown whole and only the subsection is cut (keyLabelOf, 30 chars).
- An unlistable folder returned before the settings scan; now it runs there too.
- No bound on git runs (about 4,000 at 2.6 ms each): budget.gitReads, 400 per listing, then "not checked".
- GIT_CEILING_DIRECTORIES stops git looking for a repository above the temporary folder.
- The comment named a function that does not exist; the allowlist comment no longer says these keys hold no path.
- Tests: the long subsection, a linked config, an oversized config, the read budget, an unlistable project.
  Mutations (keyLabelOf back to labelOf, no budget decrement, no scan on unreadable) each red; restored green, 60/60.

## Review round 2 (sonnet): 2 WARNING, 1 CONVENTION, 3 NIT
- FIXED: the read count was bounded but not the time (400 x 5 s). Per-read timeout 2 s, and a 20 s total per
  listing (budget.gitUntil), past which a config says it was not checked.
- FIXED: .git/modules and .git/worktrees hold configs of their own; each is named as not checked.
- FIXED: GIT_EXEC_PATH is kept, so a relocated git (MinGit) still reads.
- FIXED: the reflowed contract comment line rewrapped.
- DEFERRED: Windows searches the cwd (the temporary folder) for git.exe first. A restored backup cannot write there,
  so it is outside this threat model; a planted git.exe there already runs for every other spawn on that machine.
- DEFERRED: commondir is named as not checked whatever its type, and config.worktree is still read. Both fail safe.
- Stated limit, not checked by this listing: nested repositories in a project's subfolders, and .gitattributes
  (the filter or textconv it names is defined in config, which is checked).
- Tests 61/61. Mutations (no time check; no modules/worktrees line) each red; restored green.

## Review round 3 (opus): 3 WARNING, 1 CONVENTION, 4 NIT
- FIXED: section and name were shown whole and git takes either at any length (measured 50,021-char lines). Each part
  is now cut on its own: section and name 40, subsection 30.
- FIXED: core.protectntfs, protecthfs, symlinks, ignorecase and precomposeunicode guard checkout paths (CVE-2019-1353
  class); they left the allowlist and are named.
- FIXED: refused agent folders spent the shared read budget before projects. Settings are now read only for projects
  and the projects top (runsIn's gitSettings flag); an agent folder with git is refused whatever its settings.
- FIXED: comment wording (GIT_EXEC_PATH kept, no repository looked for above the temp folder), "is not a folder"
  for a .git that is not a directory, the module header names the git time, the plan's timeout figures.
- DEFERRED: tests for a .git link, a config that is a directory, and git missing. Each fails toward "not checked";
  the config-link and oversized arms are tested.
- Tests 62/62. Mutations (protectntfs back in the allowlist; three-part section uncut; agent folders reading
  settings) each red; restored green.
