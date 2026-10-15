#!/bin/bash
# kosmos#6245: the CI mini's job-cleanup hook (tools/ci-runner-setup.sh, hook_body cleanup) must end a kosmos job's
# leftover tmux/node, and must spare the kosmos-relay runner that shares the kosmos-ci user (~/actions-runner-relay)
# and the hook's own ancestors. Real processes, built from copies of sleep and bash named `node`, under a temp HOME.
# It runs the hook with --list ONLY: the real hook ends every node of this uid, so it must never kill here.
set -u
HERE="$(cd "$(dirname "$0")/.." && pwd -P)"
T="$(mktemp -d "${TMPDIR:-/tmp}/cleanup6245.XXXXXX")"
pids=()
done_() { for p in "${pids[@]:-}"; do [ -n "$p" ] && kill "$p" 2>/dev/null; done; rm -rf "$T"; }
trap done_ EXIT
fails=0; passes=0
pass() { echo "PASS  $1"; passes=$((passes + 1)); }
fail() { echo "FAIL  $1"; fails=$((fails + 1)); }

# The hook exactly as the setup script writes it.
HOOK="$T/job-cleanup.sh"
# The function ends at its case's esac and a closing brace; the hook bodies inside it have their own column-0 braces.
( src="$(perl -0ne 'print $1 if /(^hook_body\(\) \{.*?^  esac\n\}\n)/ms' "$HERE/tools/ci-runner-setup.sh")"; eval "$src"; hook_body cleanup ) > "$HOOK"
chmod 755 "$HOOK"
# Refuse to run a hook that has no --list: running it bare would end every node of this uid on this machine.
head -1 "$HOOK" | grep -qx '#!/bin/bash' && grep -q 'actions-runner-relay' "$HOOK" && grep -q '"${1:-}" = --list' "$HOOK" && pass "the hook body extracted from ci-runner-setup.sh" || { fail "could not extract the hook"; exit 1; }

# Real node processes (a copied system binary is killed by macOS code signing), each tagged on its command line.
NODE="$(command -v node)" || { fail "no node on PATH"; exit 1; }
STAY='setTimeout(() => {}, 300000)'
mkdir -p "$T/actions-runner-relay"
# 1. The relay runner's tree: a service script in ~/actions-runner-relay starts a node whose OWN command line is elsewhere.
printf '#!/bin/bash\n"%s" -e "%s" relay6245-%s\n' "$NODE" "$STAY" "$$" > "$T/actions-runner-relay/runsvc.sh"; chmod 755 "$T/actions-runner-relay/runsvc.sh"
"$T/actions-runner-relay/runsvc.sh" & pids+=($!)
# 2. A kosmos job's leftover: a node that detached (its parent is launchd).
( "$NODE" -e "$STAY" orphan6245-$$ & )
sleep 1
relay_node=$(pgrep -f "relay6245-$$\$"); orphan=$(pgrep -f "orphan6245-$$\$"); pids+=("$relay_node" "$orphan")
[ -n "$relay_node" ] && [ -n "$orphan" ] && [ "$(ps -o ppid= -p "$orphan" | tr -d ' ')" = 1 ] && pass "fixtures: a relay-tree node and a detached node" || { fail "fixtures did not start (relay=$relay_node orphan=$orphan)"; exit 1; }

# 3. The hook's own ancestor named node: node runs the hook as its child, and reports its own pid.
list="$(HOME="$T" "$NODE" -e 'const c=require("child_process"); process.stdout.write(c.execFileSync(process.argv[1],["--list"]).toString()); console.log("ANCESTOR "+process.pid)' "$HOOK")"
anc=$(printf '%s\n' "$list" | sed -n 's/^ANCESTOR //p')
listed() { printf '%s\n' "$list" | grep -qx "$1"; }
listed "$orphan" && pass "a detached kosmos leftover is ended" || fail "the detached leftover $orphan was not listed"
! listed "$relay_node" && pass "a node under the relay runner (by ancestry, not its own command) is spared" || fail "the relay runner's node $relay_node was listed"
[ -n "$anc" ] && ! listed "$anc" && pass "the hook's own node-named ancestor is spared (as pkill spared it)" || fail "the hook's ancestor $anc was listed"

# CONTROL: the same hook with the relay exception removed must list the relay node, or the test proves nothing.
sed 's/case "\$c" in \*"\$RELAY_DIR"\*) return 0 ;; esac/:/' "$HOOK" > "$T/nospare.sh"; chmod 755 "$T/nospare.sh"
grep -q 'RELAY_DIR"\*) return 0' "$T/nospare.sh" && fail "control: the exception was not removed" || {
  ctl="$(HOME="$T" "$T/nospare.sh" --list)"
  printf '%s\n' "$ctl" | grep -qx "$relay_node" && pass "CONTROL: without the exception the relay node is listed" || fail "CONTROL: without the exception the relay node is still spared"
}
echo "$passes passed, $fails failed"
[ "$fails" = 0 ]
