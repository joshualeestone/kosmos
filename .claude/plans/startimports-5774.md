# #5774 route 3: what start-time files pull in (CLAUDE.md imports)

## The gap
Claude Code reads its instruction files (CLAUDE.md, CLAUDE.local.md, AGENTS.md and rules files) at every start, and each one can pull in other files with an `@path` line. The pulled-in file is read as instructions too, and it can sit anywhere. The guard denies the instruction files themselves (#5516) but not what they import. So a token-only agent's file tools can rewrite an imported file, and that changes the instructions of every session that imports it, on the account or below that folder.

## How Claude Code 2.1.296 reads imports (measured from its own bundle; details in the private notes)
- An import is `@` at the start of the text or after whitespace, followed by non-space characters (a backslash-space is a space). A `#` ends the path. Punctuation is part of it: `@./b.md,` imports `b.md,`.
- It is read in markdown text only. Fenced and inline code are skipped, and HTML comments are stripped.
- The path must start with `./`, `~/` or `/` (but not `/` alone), or be a bare name starting with a letter, digit, `.`, `_` or `-`. It is resolved from the importing file's folder.
- Imports nest. A file is loaded at depths 0 to 4 (the importing file is depth 0, and depth 5 is refused). Each file is loaded once.

## The change
- New `engine/startimports.js`: `importTargets(roots, { home })` follows the imports of each root file, depth-limited as Claude Code does, and returns every import target, plus a named reason when the scan is cut short. setup-assistant.js decides how each target is denied.
- The roots are every instruction file the guard already treats as start-time:
  - each config home's CLAUDE.md, AGENTS.md and rules;
  - each folder above the agent: CLAUDE.md, CLAUDE.local.md, AGENTS.md, .claude/CLAUDE.md, .claude/AGENTS.md and .claude/rules;
  - the agent's own folder (its instruction files are denied to it, so what they import is too);
  - sibling agents' folders, when the agent is in the agents' folder;
  - the managed CLAUDE.md.
- Each target goes through withTarget (links followed) and is denied in both layers, as part 1's command scripts are. A target inside a folder already denied whole is left to that rule.
- A target inside an agent's folder in the agents' folder gets ONE mid-path glob per name (`<agents>/*/<name>`), file tools only, as the sibling members already do. Measured on this fleet: Kosmos's own agent instruction files say "@-mention" and "@-mentioned." in prose, which Claude Code reads as imports of `<agent>/-mention`. It would load such a file as instructions if one were created, so it is denied, but by name it would be one rule per agent (26 on this machine), growing with every agent. The glob also matches the agent's own folder, the safe direction.
- A target the rule syntax cannot carry is named when it exists. An absent one is skipped, as part 1 decided for a word that only looks like a path.

## Decided
- Every reachable import is denied, whether or not the person approved external imports. The approval can be granted later, and the guard would not know, so the deny is the safe direction.
- Markdown is read by a small subset rather than a full lexer (the repo has no dependencies): fenced code, inline code and HTML comments are stripped. Indented code is NOT stripped, so an import-like word in an indented example is denied too. That is the safe direction, and an absent uncarriable one is skipped, so it cannot make the guard not whole.
- A directory target is skipped, since Claude Code reads files only.

## Gaps, stated
- claudeMdExcludes (a setting that stops Claude Code reading some instruction files) is not read, so excluded files' imports are still denied. That is the safe direction.
- The auto-memory index (MEMORY.md) is not followed for imports. Not measured whether Claude Code reads imports there.
- An import that only appears once the agent edits an instruction file it can write is not followed until the next guard refresh (route 4's class).

## Cost
On this host, the real roots for this agent's folder (two config homes, the folders above it, 23 siblings: 149 root files) read in 11 ms and give 5 import targets outside the agents' folder (the global CLAUDE.md's four imports plus `-addresses` from prose) and 3 names inside it. The size probe: 1017 deny rules and 145 denyWrite entries (9.2 KB), against 1012 and 140 before; the size check passes.

## Tests
engine/startimports-5774.test.js, 4 tests. Thirteen mutations, each red: the config-home, ancestor and managed roots; the agents'-folder glob; the whole-folder skip; the absent-uncarriable skip; the sandbox layer; the depth limit; fenced code, inline code, comments, the # cut and the escaped space. The inline-code mutation stayed GREEN at first: the fixture's @ followed a backtick, which the import pattern never matches anyway; the fixture now puts a space before it inside the code span.

## Challenge loop notes
