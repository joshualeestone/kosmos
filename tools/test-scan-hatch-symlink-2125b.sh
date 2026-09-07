#!/bin/bash
# kosmos#3 / #2125: BEHAVIORAL guard for the --kosmos-app-scan hatch's no-symlink-escape rule.
#
# The hatch walks the TCC-protected roots (~/Documents, ~/Downloads, ~/Desktop) under the app's
# broad grant. Those folders are USER-WRITABLE, so a symlink dropped there must NOT steer the walk
# out of the tree (a symlinked dir into /etc, or a symlinked .md at /etc/hosts whose bytes would
# surface as a find-agents preview). The source-wiring guard is native-app.scan-hatch-2125b.test.js;
# this compiles main.swift and PROVES the refusal on a real fixture, because a source grep cannot
# tell a correct lstat guard from a subtly-wrong one. (Analog of test-a11y-writer-mock-2125.sh.)
set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"

# swiftc-guarded: the fast suite deliberately does not compile Swift on hosts without it.
if ! command -v swiftc >/dev/null 2>&1; then
  echo "scan-hatch-symlink: SKIP (no swiftc on this host; the source-wiring guard is native-app.scan-hatch-2125b.test.js)"
  exit 0
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
BIN="$tmp/kosmosapp"
FLOOR="$(cat "$REPO/tools/macos-floor" 2>/dev/null || echo 13.5)"

if ! ( swiftc -target "arm64-apple-macos${FLOOR}" "$REPO/native-app/main.swift" -o "$BIN" ) 2>"$tmp/build.err"; then
  echo "scan-hatch-symlink: main.swift did NOT compile (a real failure, not a skip):"
  cat "$tmp/build.err" >&2
  exit 1
fi
[ -x "$BIN" ] || { echo "scan-hatch-symlink: no binary produced"; exit 1; }

STORE="$tmp/store"; AW="$STORE/AgentWorkforce"; FIX="$tmp/fixture"
mkdir -p "$AW" "$FIX/real-agent"
printf 'You are Realbob, an agent.\n' > "$FIX/real-agent/CLAUDE.md"
printf 'You are Realsue, an agent.\n' > "$FIX/real-loose.md"
ln -s /etc "$FIX/evil-dir"            # symlinked DIR: must NOT be descended
ln -s /etc/hosts "$FIX/evil.md"       # symlinked FILE: must NOT be read
cat > "$AW/scan-request.inflight" <<EOF
{"roots":[{"dir":"$FIX","maxDepth":4}],"budgets":{"maxDirs":8000,"maxMdPerDir":40,"maxMdReads":3000,"readCap":4000},"req":"symnonce"}
EOF

AGENT_WORKFORCE_DATA="$STORE" "$BIN" --kosmos-app-scan
RES="$AW/scan-result.json"
[ -f "$RES" ] || { echo "scan-hatch-symlink: hatch wrote no scan-result.json"; exit 1; }

# Assert with python3 (JSON parse): no evil paths, no /etc leak, real content present.
python3 - "$RES" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
files = [x.get('file','') for x in d.get('loose',[])] + [x.get('instr',{}).get('file','') for x in d.get('dirs',[])]
dirs  = [x.get('dir','') for x in d.get('dirs',[])]
heads = ' '.join([x.get('head','') for x in d.get('loose',[])] + [x.get('instr',{}).get('head','') for x in d.get('dirs',[])])
fail = []
if any('evil' in f for f in files): fail.append('a symlinked file (evil.md) was read')
if any('/etc' in x for x in dirs): fail.append('a symlinked dir (evil-dir -> /etc) was descended')
if 'localhost' in heads or '127.0.0.1' in heads: fail.append('/etc/hosts content leaked into a preview head')
if not any('real-agent' in x for x in dirs): fail.append('the real CLAUDE.md agent was not found (walk broken)')
if not any('real-loose' in f for f in files): fail.append('the real loose .md was not found (walk broken)')
if fail:
    print('scan-hatch-symlink: FAIL'); [print('  - '+m) for m in fail]; sys.exit(1)
print('scan-hatch-symlink: PASS (symlinks refused, no escape, real agents found)')
PY
