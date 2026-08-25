#!/bin/bash
# The install gate's control (#624): a bundle missing a file the installer's
# post-extract check expects must turn the gate RED. Without this, a gate that
# is green on a good bundle proves nothing about a bad one.
#
# Runs against a COPY of this checkout's install/, tools/ and dist/ (the
# harness installs from the dist beside its own script, so the copy is the
# only way to break a bundle without breaking the one the release ships).
# Needs the staged trees in dist/ (build them first, as test-install.sh says).
# Minutes, two gate runs; run by hand before changing the gate or the
# installer's post-extract list: `bash tools/test-install-gate-control.sh`.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
FAILS=0; ok(){ echo "PASS  $1"; }; bad(){ echo "FAIL  $1"; FAILS=$((FAILS+1)); }
[ -d dist/kosmos-bundle ] && [ -d dist/tmux-bundle ] || { echo "SKIP: dist/ staged trees missing (build them first)"; exit 1; }
C="$(mktemp -d "${TMPDIR:-/tmp}/install-gate-control.XXXXXX")"; trap 'rm -rf "$C"' EXIT
mkdir -p "$C/repo"; cp -R install tools package.json "$C/repo/"; cp -R dist "$C/repo/dist"
# Two gate runs back to back share nothing but the machine's ports: the
# harness picks a free port at start, and a board from the previous run can
# still be winding down on it (measured: the second run's update pass went
# red once, and passed alone). Wait until the harness's port range is quiet
# before each run, and say how long it took.
settle() {
  local i busy
  command -v lsof >/dev/null 2>&1 || { echo "   (no lsof on this machine; cannot tell quiet from busy, running anyway)"; return 0; }
  for i in $(seq 1 40); do
    busy="$(lsof -nP -iTCP:4460-4499 -sTCP:LISTEN 2>/dev/null | awk 'NR>1' | wc -l | tr -d ' ')"
    [ "$busy" = 0 ] && { [ "$i" -gt 1 ] && echo "   (waited $((i-1))s for the harness's port range to go quiet)"; return 0; }
    sleep 1
  done
  echo "   (the harness's port range is still busy after 40s; running anyway)"
}
# CONTROL OF THE CONTROL: the untouched copy must be green, or the red below
# could be the copy itself.
settle
if ( cd "$C/repo" && KOSMOS_INSTALL_GATE=1 bash tools/test-install.sh ) > "$C/green.log" 2>&1; then ok "CONTROL: the untouched copy passes the gate ($(grep -E ' passed, ' "$C/green.log" | tail -1))"
else bad "CONTROL: the untouched copy fails the gate, so nothing below discriminates: $(grep -E '^FAIL' "$C/green.log" | head -3 | tr '\n' ' ')"; echo "install-gate-control: $FAILS failures"; exit 1; fi
# The bundle-shape defect: a file the installer's post-extract check expects
# (install/setup.sh checks app/bin/kosmos-tunnel after extract) is missing
# from the staged tree AND from the packed tarball, as a broken build would
# leave it.
rm -f "$C/repo/dist/kosmos-bundle/app/bin/kosmos-tunnel"
# Repacked with the SAME member shape as the built tarball (top-level names,
# no ./ prefix): the only difference from the shipped artifact must be the
# missing file, or the red could be the repack's shape rather than the
# defect this control names.
( cd "$C/repo/dist" && mkdir -p repack && tar -xzf kosmos-arm64.tar.gz -C repack && rm -f repack/app/bin/kosmos-tunnel && ( cd repack && tar -czf ../kosmos-arm64.tar.gz -- * ) && rm -rf repack && shasum -a 256 kosmos-arm64.tar.gz > kosmos-arm64.tar.gz.sha256 )
tar -tzf "$C/repo/dist/kosmos-arm64.tar.gz" | grep -q '^app/' && ok "the repacked tarball keeps the built tarball's member shape (app/..., no ./)" || bad "the repack changed the member shape"
settle
if ( cd "$C/repo" && KOSMOS_INSTALL_GATE=1 bash tools/test-install.sh ) > "$C/red.log" 2>&1; then bad "a bundle missing app/bin/kosmos-tunnel PASSED the gate (the gate is blind to the bundle's shape)"
else ok "a bundle missing app/bin/kosmos-tunnel turns the gate red ($(grep -E ' passed, ' "$C/red.log" | tail -1 || true; [ -n "$(grep -E ' passed, ' "$C/red.log")" ] || echo "$(grep -c '^FAIL' "$C/red.log") FAIL line(s), no summary: the harness stopped at the broken install"))"; fi
grep -q "^FAIL  install exits 0" "$C/red.log" && ok "and the red names the install itself, not a later check" || bad "the red did not name the install: $(grep -E '^FAIL' "$C/red.log" | head -2 | tr '\n' ' ')"
echo "install-gate-control: $FAILS failures"; [ "$FAILS" -eq 0 ]
