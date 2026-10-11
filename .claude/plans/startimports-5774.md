# #5774 route 3: what start-time files pull in (CLAUDE.md imports)

## The gap
Claude Code reads its instruction files (CLAUDE.md, CLAUDE.local.md, AGENTS.md and rules files) at every start, and each one can pull in other files with an `@path` line. The pulled-in file is read as instructions too, and it can sit anywhere. The guard denies the instruction files themselves (#5516) but not what they import. So a token-only agent's file tools can rewrite an imported file, and that changes the instructions of every session that imports it, on the account or below that folder.

## How Claude Code 2.1.296 reads imports (measured from its own bundle; details in the private notes)
- An import is `@` at the start of the text or after whitespace, followed by non-space characters (a backslash-space is a space). A `#` ends the path. Punctuation is part of it: `@./b.md,` imports `b.md,`.
- It is read in markdown text only. Fenced and inline code are skipped, and HTML comments are stripped.
- The path must start with `./`, `~/` or `/` (but not `/` alone), or be a bare name starting with a letter, digit, `.`, `_` or `-`. It is resolved from the importing file's folder.
- Imports nest. A file is loaded at depths 0 to 4 (the importing file is depth 0, and depth 5 is refused). Each file is loaded once.
- An import is resolved from the folder the importing file REALLY is in (Claude Code parses with the resolved path).
- An import whose extension is not one of Claude Code's 107 text extensions is skipped, unread (it logs "Skipping non-text file in @include"); a file with no extension is read. An instruction file over 4 MB is skipped, with its imports. The lexer runs with gfm off.

## The change
- The 2000-file cap counts files READ. An agent folder holds one or two instruction files, so it is reached at about a thousand agents; past it the guard is named not whole, as a spent link budget is (part 2).
- New `engine/startimports.js`: `importTargets(roots, { home })` follows the imports of each root file, depth-limited as Claude Code does, and returns every import target, plus a named reason when the scan is cut short. setup-assistant.js decides how each target is denied.
- The roots are every instruction file the guard already treats as start-time:
  - each config home's CLAUDE.md, AGENTS.md and rules;
  - each folder above the agent: CLAUDE.md, CLAUDE.local.md, AGENTS.md, .claude/CLAUDE.md, .claude/AGENTS.md and .claude/rules;
  - the agent's own folder, when it is in the agents' folder (its instruction files are then denied to it by the sibling globs, so what they import is too). A connected agent's folder is its own repo: its CLAUDE.md is its own to edit, so what it imports is not denied (`@README.md` is the common case).
  - sibling agents' folders, when the agent is in the agents' folder;
  - the agent's own .claude/CLAUDE.md, .claude/AGENTS.md and .claude/rules in every case (they are denied to it, connected or not);
  - the managed CLAUDE.md and the managed rules (`<managed>/.claude/rules`, as 2.1.296 builds it).
- Each target goes through withTarget (links followed) and is denied in both layers, as part 1's command scripts are. A target inside a folder already denied whole is left to that rule.
- A target inside an agent's folder in the agents' folder gets ONE mid-path glob per name (`<agents>/*/<name>`), file tools only, as the sibling members already do. Measured on this fleet: Kosmos's own agent instruction files say "@-mention" and "@-mentioned." in prose, which Claude Code reads as imports of `<agent>/-mention`. It would load such a file as instructions if one were created, so it is denied, but by name it would be one rule per agent (26 on this machine), growing with every agent. The glob also matches the agent's own folder, the safe direction.
- A target the rule syntax cannot carry is named when it exists. An absent one is skipped, as part 1 decided for a word that only looks like a path.

## Decided
- Every reachable import is denied, whether or not the person approved external imports. The approval can be granted later, and the guard would not know, so the deny is the safe direction.
- REVIEW 3 CHANGED THIS: the raw text is scanned as well as the subset, and the union kept. Claude Code scans a list item's RAW text (code spans and comments included; measured in the bundle), and the subset does not model lists, so the subset alone missed the commonest shape there is (a bullet with a command in backticks). With the union, any difference from the lexer errs toward denying more. Measured on this fleet: the union adds nothing to what the subset found (5 targets outside the agents' folder, 2 names inside). Cost elsewhere: an `@word` inside code in a paragraph is denied too; an absent one is harmless, and an existing one whose path the rules cannot carry would make the guard not whole (rare).
- Markdown is read by a small subset rather than a full lexer (the repo has no dependencies): fenced code, inline code (never across a blank line) and HTML comments are stripped, in that order; emphasis and link marks (* [ ], and a _ before the @) are token edges. Indented code is NOT stripped, so an import-like word in an indented example is denied too: the safe direction, and an absent uncarriable one is skipped, so it cannot make the guard not whole. Review 1 showed my first subset also erred the OTHER way (a stray backtick, a comment mark inside code, `**@a.md**`); each is fixed and tested, but a subset of a lexer can still differ from it in shapes nobody has tried.
- A target, or where it leads, that is read-only is not listed (nothing can write it, and a store's hashed name would pile up); a link at the leaf to one is still denied to the file tools. One in a store or a Homebrew Cellar gets that folder's one stable rule, both layers, as part 2's shell startup files do.
- A target inside an agent's folder that leads elsewhere (a link, a dangling link, a linked folder) has that place denied too, as any target is.
- A rules file is any name ending in `.md`, matched case-sensitively, as 2.1.296's own walk does (`name.endsWith(".md")`).
- A target under a linked FOLDER is listed by both spellings (the real folder, which Claude Code loads, and the folder as given), since the agent's tools can write it by either. For a linked FILE only the real folder is used (review 3): the folder as given is then a different file nobody loads, and inside the agents' folder it would be a glob over every agent.
- Import-derived rules are not pruned when an import goes away. Review 4 noted the raw-text scan widens what is listed outside the agents' folder (an `@types/node` in a code block of a folder-above instruction file is one more rule); measured on this fleet it adds nothing, and the profile size check still bounds it. A pruning record stays a follow-up on the card. (only launch rules are, #5663), as #5516 decided for a repointed link target. The import set changes only when someone adds a new `@word` to an instruction file, and names inside the agents' folder are one glob per name, not per agent. DECIDED, not built: a record for pruning these, like the launch record, is a change of its own if the profile size ever needs it.
- A directory target is skipped, since Claude Code reads files only.

## Gaps, stated
- claudeMdExcludes (a setting that stops Claude Code reading some instruction files) is not read, so excluded files' imports are still denied. That is the safe direction.
- The auto-memory index (MEMORY.md) is not followed for imports. Not measured whether Claude Code reads imports there.
- An import that only appears once the agent edits an instruction file it can write is not followed until the next guard refresh (route 4's class).
- A token-only agent working in a SUBFOLDER of a repo cannot edit what the repo's top-level instruction files import (they are ancestors, read at its start), as #5516 decided for those files themselves.
- Part 1's command scripts still do not deny a link in the middle of a chain (imports do since review 4, by part 2's chainHops).
- An import that names an existing FOLDER is skipped (Claude Code reads files only). Where the shell can write, the agent could replace the folder with a file of that name; denying the folder whole instead would refuse the agent's own work there.
- Claude Code skips an external include (outside the folder it runs in) unless the person approved external includes, and a User-type root that is a link; the guard denies them regardless (the safe direction; the approval can change later).

## Cost
On this host, the real roots for this agent's folder (two config homes, the folders above it, 23 siblings: 149 root files) read in 11 ms and give 5 import targets outside the agents' folder (the global CLAUDE.md's four imports plus `-addresses` from prose) and 3 names inside it. The size probe: 1017 deny rules and 145 denyWrite entries (9.2 KB), against 1012 and 140 before; the size check passes.

## Tests
engine/startimports-5774.test.js, 11 tests. Thirteen mutations, each red: the config-home, ancestor and managed roots; the agents'-folder glob; the whole-folder skip; the absent-uncarriable skip; the sandbox layer; the depth limit; fenced code, inline code, comments, the # cut and the escaped space. The inline-code mutation stayed GREEN at first: the fixture's @ followed a backtick, which the import pattern never matches anyway; the fixture now puts a space before it inside the code span.

## Challenge loop notes
- Iteration 1 (Opus), on c5be2d57d:
  - [BLOCKER] FIXED (reproduced by the reviewer). A CONNECTED agent (its folder outside the agents' folder) had what its own CLAUDE.md imports denied (`@README.md`, `@package.json`) while that CLAUDE.md itself stays its own to edit: ordinary repo work refused, nothing protected. The agent's own folder is now a root only when it is in the agents' folder. Tested; mutation red.
  - [BLOCKER] FIXED. An import inside a LINKED instruction file was resolved from the link's folder; Claude Code resolves it from the real file's folder (it parses with the resolved path), so the real target stayed writable. Both folders are now used (real first). Tested with a base that has no link above it; mutation red.
  - [WARNING] FIXED. The markdown subset erred in the unsafe direction too: a stray backtick swallowed later paragraphs, a `<!--` inside a code span opened a comment, and `**@a.md**`, `*@b.md*`, `_@c.md_`, `[@d.md](u)` were missed. Fixed as stated under Decided; four mutations red. The comment-order mutation stayed GREEN at first (the fixture's import sat after the -->, where either order keeps it); the import now sits between the span and the -->, and a comma I left after it made the sharpened test fail on the real code first (punctuation is part of the path).
  - [WARNING] FIXED. 256 KB read cap; Claude Code reads to 4 MB and skips larger. Now the same. Two mutations red.
  - [WARNING] FIXED. The 2000-file cap counted absent roots, so about 400 agents would make every guard not whole. It counts files read. Mutation red.
  - [WARNING] DECIDED (stated above): import-derived rules are not pruned.
  - [WARNING] FIXED. Rules folders were walked 4 deep; Claude Code has no cap. Walked fully, each folder once (a link cycle ends).
  - [WARNING] FIXED: the tests above.
  - [NIT] TAKEN. Non-text imports are skipped, as Claude Code does (so `-mentioned.`, extension ".", is not a target, and an image import cannot make the guard not whole). Mutation red.
  - [NIT] TAKEN. The repeated "named when it exists" block is one helper.
- Iteration 2 (Sonnet), on 5bb14e8b0:
  - [WARNING] FIXED. Import targets skipped the read-only and store filters part 2 applies: a CLAUDE.md linked into a Nix store would list the store's hashed names, which pile up. Now a read-only target is not listed (a leaf link to one is, to the file tools), and one in a store or Cellar gets the folder's one stable rule in both layers. Tested with a writable store and an injected read-only target; five mutations red. My first cut pushed links into a list already copied into the rules earlier in the function, so they would have been dropped; caught before testing. Its first test went red on a path under the /var link, counted as "linked" through its parent: only a LEAF link can be replaced, so the check is now lstat.
  - [WARNING] FIXED. A target inside an agent folder got only its glob; one that is a link (or dangles, or sits under a linked folder) left where it leads writable. That place is now denied as any target is. Tested (a link and a dangling link in a sibling); mutation red.
  - [WARNING] DECIDED (stated above): the 2000-file cap counts files read, about a thousand agents.
  - [WARNING] FIXED in part: sibling CLAUDE.local.md and nested rules, and a folder-above rules file, are now tested as roots. Not added: a depth-4 chain through the whole guard (the walk's depth is tested on importTargets, which the guard calls as is).
  - [NIT] DECIDED: rules files match `.md` case-sensitively, as 2.1.296 does; stated above.
  - [NIT] TAKEN. A code span closes only on a backtick run of the same length (CommonMark); a lone backtick before a double one no longer hides an import. Mutation red (its first try stayed GREEN: no fixture had a lone backtick before a double; one does now).
  - [NIT] not taken: the `^[#%^&*()]+` test mirrors Claude Code's own line, kept for fidelity.
  - [NIT] DUPLICATE: import rules are not pruned (decided in iteration 1).
- Iteration 3 (Opus), on 8305cb0bb:
  - [BLOCKER] FIXED (measured by the reviewer in the bundle). In a list item Claude Code scans the item's RAW text, code spans and comments included; the subset stripped them, so `- run \`claude @notes.md\`` (the commonest shape in an instruction file) was a silent miss. The raw text is now scanned too and the union kept (see Decided). Tested with the reviewer's three list shapes; mutation red.
  - [WARNING] FIXED by the same change: an unclosed fence inside a list item no longer hides the rest of the file. Tested.
  - [WARNING] FIXED. A connected agent's own .claude/CLAUDE.md, AGENTS.md and rules are denied to it, but what they import was not (iteration 1's carve-out dropped them with the top-level CLAUDE.md). They are now roots in every case; the top-level files stay the connected agent's own. Tested; mutation red.
  - [WARNING] FIXED. The managed rules folder is a root. Tested; mutation red.
  - [WARNING] FIXED. The rules walk is bounded (5000 folders across all rules folders); one cut short is named. Tested with a small budget; mutation red.
  - [NIT] TAKEN. A store root too wide to deny is named, as linkAware does. Mutation red (its first try stayed GREEN: part 2's shell files named the same store in that test; the assertion now matches the import's own reason).
  - [NIT] STATED under Gaps: a middle link in an import's chain; an existing folder as an import.
  - [NIT] TAKEN. An agent folder whose name starts with ".." is still recognised (`..` alone or `../` only). Mutation red.
  - [NIT] TAKEN. For a linked FILE, the folder as given is not used. Mutation red.
- Iteration 4 (Sonnet), on e7f7e6b49:
  - [WARNING] FIXED. A link in the middle of an import's chain was not denied (withTarget names the end only); part 2's chainHops now runs on every import outside the agents' folder (file tools only; a hop in a store or Cellar by its stable rule). Tested; mutation red.
  - [WARNING] NOT A DEFECT, shown by test. A store root the rules cannot carry: every path under it carries the same character, so the target's own check names it (present) or skips it (absent) before a store rule is built. I first added a branch for it; the test showed it unreachable, and it was removed. My first fixture also failed for a reason of its own: an unescaped space in an import ends the path there, as in Claude Code.
  - [WARNING] DECIDED (stated above): import rules are not pruned; the raw scan's extra cost measured as none on this fleet.
  - [NIT] TAKEN: the plan's duplicate sentence on linked folders and files.
  - [NIT] not taken: `_` as an edge may trim a path differently from Claude Code; the raw-text union reads the untrimmed one too, so nothing is missed.
  - [NIT] TAKEN: the extension set's size is asserted (106; 2.1.296's 107 include ".R", which the lowercased lookup folds into ".r").

