# claude-gate: #133, the installer refuses a Mac with no Claude Code

## The defect

install/setup.sh never mentions the Claude binary, so a clean install
finishes on a Mac that has none, and the first symptom is an agent that
never starts. machine.js's installedCheck reports it, but only if the
person goes and looks. Josh hit the question live on the fresh mini, and
tomorrow's audience is colleagues on machines that never had Claude Code.

## The shape

A named refusal in the requirements section, beside the arm64 and macOS
floor refusals whose shape the card cites, dispatched after --uninstall
(line 1089) so removal never demands the binary. The check asks the path
the PRODUCT asks (engine/create.js binPaths: ~/.local/bin/claude, or the
AGENT_WORKFORCE_CLAUDE_BIN override), never `which claude`, because a
fresh Mac does not carry ~/.local/bin on PATH and the obvious check says
no on machines where it IS installed.

Three states, three sentences, because two look identical from a Terminal:
- executable at the product's path: proceed, say where it looked
- installed elsewhere (command -v finds one): refuse, name where it is
  and the one-line ln -s fix
- genuinely absent: refuse, name the install step and that the installer
  puts it at the path Kosmos uses

## Tests

install.claude-gate.test.js lifts the shipped function (the tmux-picker
technique; a restatement would pass while the installer drifted): all
three states, the absent-vs-elsewhere sentences proven DIFFERENT, and the
env override honored so sandboxed installs can point at a fixture.

## Review bound

Two rounds maximum, declared before starting.
