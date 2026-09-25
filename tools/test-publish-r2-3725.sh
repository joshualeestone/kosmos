#!/usr/bin/env bash
# test-publish-r2-3725.sh - offline checks for tools/windows/publish-r2.ps1 (#3725).
#
# The script's real work (signed S3 writes to R2, reads back through installkosmos.com) needs a
# network and a key, so it was measured by hand against a throwaway key prefix in the real bucket
# (see the PR). What this pins offline, on every run:
#   1. it parses (PowerShell's own parser, zero errors);
#   2. POINTER PARITY: the bytes its New-PointerBytes writes equal what
#      tools/lib/write-latest-win-pointer.js writes for the same build. promote-channel.sh and the
#      promote in publish-r2.ps1 both copy a staging pointer onto prod byte for byte, and
#      deploy-site.sh reads these fields, so a drift in either writer is a broken promote;
#   3. the refusals that need no network: a bad -Arch, a bad -KeyPrefix, a missing zip, no key.
#
# Needs pwsh. GitHub's macOS runners ship it; locally a missing pwsh SKIPS, but under CI it FAILS,
# because a guard that silently never runs is not a guard.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
PS1="$HERE/windows/publish-r2.ps1"
WRITER="$HERE/lib/write-latest-win-pointer.js"
fails=0
pass() { printf 'ok   %s\n' "$1"; }
fail() { printf 'FAIL %s\n' "$1"; fails=$((fails + 1)); }

PWSH="$(command -v pwsh || true)"
if [ -z "$PWSH" ]; then
  if [ -n "${CI:-}" ]; then echo "FAIL pwsh is not installed on this CI runner, so publish-r2.ps1 is untested"; exit 1; fi
  echo "SKIP test-publish-r2-3725: pwsh is not installed here (CI runs it)"; exit 0
fi
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

# 1. parse
# (pwsh -Command appends trailing words to the command text instead of binding $args, so each
# PowerShell step is a small -File script.)
cat > "$TMP/parse.ps1" <<'PSEOF'
$e = $null; [void][System.Management.Automation.Language.Parser]::ParseFile($args[0], [ref]$null, [ref]$e)
"errors=" + @($e).Count; $e | ForEach-Object { $_.ToString() }
PSEOF
out="$("$PWSH" -NoProfile -File "$TMP/parse.ps1" "$PS1" 2>&1)"
if [ "$(printf '%s\n' "$out" | head -1)" = "errors=0" ]; then pass "parses"; else fail "parse: $out"; fi

# 2. pointer parity, both from the same inputs
V=0.6.94; SHA=d476fc6c913ee3254f8406ccad0db09724c313551203682c4ad712f51d20c2db; ARCH=x64
KM_LWP_VERSION=$V KM_LWP_SHA=$SHA KM_LWP_ARTIFACT="kosmos-win-$ARCH.zip" KM_LWP_VERSIONED="kosmos-$V-win-$ARCH.zip" KM_LWP_ARCH=$ARCH \
  node "$WRITER" "$TMP/js.json" || fail "the JS writer did not run"
cat > "$TMP/pointer.ps1" <<'PSEOF'
  $ast = [System.Management.Automation.Language.Parser]::ParseFile($args[0], [ref]$null, [ref]$null)
  $fn = $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq "New-PointerBytes" }, $true) | Select-Object -First 1
  if (-not $fn) { exit 3 }
  $Arch = $args[4]; $Alias = "kosmos-win-$Arch.zip"; $Utf8 = New-Object Text.UTF8Encoding $false
  Invoke-Expression $fn.Extent.Text
  [IO.File]::WriteAllBytes($args[1], (New-PointerBytes $args[2] $args[3] "kosmos-$($args[2])-win-$Arch.zip"))
PSEOF
"$PWSH" -NoProfile -File "$TMP/pointer.ps1" "$PS1" "$TMP/ps.json" "$V" "$SHA" "$ARCH"
rc=$?
if [ "$rc" -ne 0 ]; then fail "could not run New-PointerBytes out of publish-r2.ps1 (rc $rc)"
elif cmp -s "$TMP/js.json" "$TMP/ps.json"; then pass "pointer bytes equal write-latest-win-pointer.js"
else fail "pointer bytes differ: js=$(cat "$TMP/js.json") ps=$(cat "$TMP/ps.json")"; fi

# 3. offline refusals. No key anywhere, so a refusal that is NOT about the case under test would
# still exit 1; each case therefore asserts its own message, not just the exit code.
refuses() { # <label> <expected substring> <args...>
  local label="$1" want="$2"; shift 2
  local o rc
  o="$(env -u R2_ACCOUNT_ID -u R2_ACCESS_KEY_ID -u R2_SECRET_ACCESS_KEY LOCALAPPDATA="$TMP/none" "$PWSH" -NoProfile -File "$PS1" "$@" 2>&1)"; rc=$?
  if [ "$rc" -eq 1 ] && printf '%s' "$o" | grep -qF -- "$want"; then pass "$label"; else fail "$label: rc=$rc out=$o"; fi
}
refuses "bad arch refused" "implausible arch" -Zip "$TMP/x.zip" -Arch '../x'
refuses "bad key prefix refused" "-KeyPrefix" -Zip "$TMP/x.zip" -KeyPrefix 'no-trailing-slash'
refuses "dot-dot key prefix refused" "no . or .. segment" -Zip "$TMP/x.zip" -KeyPrefix '../'
refuses "no key refused" "no R2_ACCOUNT_ID" -Zip "$TMP/x.zip"
refuses "promote with no key refused" "no R2_ACCOUNT_ID" -Promote -ApprovedVersion 1 -ApprovedSha nothex -ApprovalRef 1.2
# The credential check runs before the mode's own checks, so give it a key to reach them.
printf 'R2_ACCOUNT_ID=%s\nR2_ACCESS_KEY_ID=AKIDTEST\nR2_SECRET_ACCESS_KEY=secret\n' "$(printf 'a%.0s' $(seq 32))" > "$TMP/cred.env"
refuses "missing zip refused" "no such zip" -Zip "$TMP/absent.zip" -CredentialFile "$TMP/cred.env"
refuses "leading-dash version refused" "not starting with -" -Promote -ApprovedVersion '-0.6.94' -ApprovedSha "$SHA" -ApprovalRef 1.2 -CredentialFile "$TMP/cred.env"
refuses "malformed sha refused" "lowercase 64-hex" -Promote -ApprovedVersion 1 -ApprovedSha nothex -ApprovalRef 1.2 -CredentialFile "$TMP/cred.env"
refuses "shell-ish approval ref refused" "is not a Slack message ts" -Promote -ApprovedVersion 1 -ApprovedSha "$SHA" -ApprovalRef 'x; rm' -CredentialFile "$TMP/cred.env"

[ "$fails" -eq 0 ] && { echo "test-publish-r2-3725: all passed"; exit 0; }
echo "test-publish-r2-3725: $fails failed"; exit 1
