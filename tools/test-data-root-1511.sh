#!/usr/bin/env bash
# #1511: install/setup.sh held its own definition of the data root, and it is the
# one that deletes. `_kosmos_data_root` is now the single shell answer, preferring
# the product's own `dataRootFor` when the install can give one.
#
# 🛑 EVERY ARM HERE EXISTS BECAUSE THE VALUE STEERS AN `rm -rf`. An arm that
# cannot fail is worse than no arm on a delete path.
set -uo pipefail
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); printf 'PASS  %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); printf 'FAIL  %s\n     got: %s\n' "$1" "$2"; }

SETUP="$(cd "$(dirname "$0")/.." && pwd)/install/setup.sh"
HELPER="$(mktemp)"
python3 - "$SETUP" "$HELPER" <<'PY'
import io,sys
s=io.open(sys.argv[1],encoding='utf-8').read()
i=s.index('_kosmos_data_root() {'); j=s.index('\n}\n', i)+3
io.open(sys.argv[2],'w',encoding='utf-8').write(s[i:j])
PY
[ -s "$HELPER" ] || { echo "FAIL  could not extract _kosmos_data_root from setup.sh"; exit 1; }

run() { ( eval "$1"; . "$HELPER"; _kosmos_data_root ); }

# 1. no runtime: the literal, which for every install older than #570 IS the path
r=$(run 'KOSMOS_HOME=/nonexistent; unset AGENT_WORKFORCE_DATA')
[ "$r" = "$HOME/Library/Application Support/AgentWorkforce" ] \
  && ok "no runtime falls back to the default root" || bad "no runtime falls back to the default root" "$r"

# 2. the sandbox seam is honoured in the fallback
r=$(run 'KOSMOS_HOME=/nonexistent; AGENT_WORKFORCE_DATA=/tmp/sbx-1511')
[ "$r" = "/tmp/sbx-1511/AgentWorkforce" ] \
  && ok "the sandbox seam is honoured" || bad "the sandbox seam is honoured" "$r"

FAKE="$(mktemp -d)"; mkdir -p "$FAKE/runtime/bin" "$FAKE/app/engine"
ln -sf "$(command -v node)" "$FAKE/runtime/bin/node"

# 3. THE ARM THAT CAN TELL THE TWO PATHS APART. On macOS the product's answer and
#    the literal are IDENTICAL, so an arm using the real store.js proves nothing:
#    it passes whether the consult ran or not. This one returns a path the shell
#    fallback could never produce.
printf '%s\n' "module.exports = { dataRootFor: () => '/tmp/ONLY-NODE-1511/AgentWorkforce' };" > "$FAKE/app/engine/store.js"
r=$(run "KOSMOS_HOME=$FAKE; unset AGENT_WORKFORCE_DATA")
[ "$r" = "/tmp/ONLY-NODE-1511/AgentWorkforce" ] \
  && ok "the product's own dataRootFor wins when the install can answer" \
  || bad "the product's own dataRootFor wins when the install can answer" "$r"

# 4. CONTROL for arm 3: same store.js, runtime gone, must fall back
rm -f "$FAKE/runtime/bin/node"
r=$(run "KOSMOS_HOME=$FAKE; unset AGENT_WORKFORCE_DATA")
[ "$r" = "$HOME/Library/Application Support/AgentWorkforce" ] \
  && ok "CONTROL: no runtime means the literal, even with a willing store.js" \
  || bad "CONTROL: no runtime means the literal, even with a willing store.js" "$r"
ln -sf "$(command -v node)" "$FAKE/runtime/bin/node"

# 5. a store.js with no dataRootFor: the real shape of every install before #570
printf '%s\n' "module.exports = {};" > "$FAKE/app/engine/store.js"
r=$(run "KOSMOS_HOME=$FAKE; unset AGENT_WORKFORCE_DATA")
[ "$r" = "$HOME/Library/Application Support/AgentWorkforce" ] \
  && ok "an install predating dataRootFor falls through" || bad "an install predating dataRootFor falls through" "$r"

# 6. a relative answer must NOT steer a delete
printf '%s\n' "module.exports = { dataRootFor: () => 'not-absolute' };" > "$FAKE/app/engine/store.js"
r=$(run "KOSMOS_HOME=$FAKE; unset AGENT_WORKFORCE_DATA")
[ "$r" = "$HOME/Library/Application Support/AgentWorkforce" ] \
  && ok "a relative answer is refused" || bad "a relative answer is refused" "$r"

# 7. a throwing store.js must not take the uninstall down or return empty
printf '%s\n' 'throw new Error("boom");' > "$FAKE/app/engine/store.js"
r=$(run "KOSMOS_HOME=$FAKE; unset AGENT_WORKFORCE_DATA")
[ "$r" = "$HOME/Library/Application Support/AgentWorkforce" ] \
  && ok "a throwing store.js falls back rather than emptying" || bad "a throwing store.js falls back rather than emptying" "$r"

# 8. never empty, on any arm: an empty root would make "$root/bin" mean "/bin"
[ -n "$r" ] && ok "the helper never returns empty" || bad "the helper never returns empty" "<empty>"

rm -rf "$FAKE" "$HELPER"
printf '\n%s\n' "$([ "$FAIL" -eq 0 ] && echo "ALL PASS ($PASS arms)" || echo "$FAIL FAILED, $PASS passed")"
[ "$FAIL" -eq 0 ]
