#!/usr/bin/env bash
# test-publish-r2-3725.sh - offline checks for tools/windows/publish-r2.ps1 (#3725).
#
# The script's real work (signed S3 reads and writes to R2, reads back through installkosmos.com)
# needs a network and a key, so it was measured by hand against a throwaway key prefix in the real
# bucket (see the PR). What this pins offline, on every run:
#   1. it parses (PowerShell's own parser, zero errors);
#   2. THE SIGNER: New-SigV4Authorization reproduces AWS's published SigV4 example for S3 (GET
#      Object, examplebucket, 20130524), so a signing change cannot pass by luck;
#   3. POINTER PARITY: the bytes New-PointerBytes writes (with the script's own $Arch and $Alias)
#      equal what tools/lib/write-latest-win-pointer.js writes for the same build. Both promotes
#      copy a staging pointer onto prod byte for byte, so a drift in either writer breaks a promote;
#   4. the refusals that need no network.
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

# (pwsh -Command appends trailing words to the command text instead of binding $args, so each
# PowerShell step is a small -File script.)
cat > "$TMP/parse.ps1" <<'PSEOF'
$e = $null; [void][System.Management.Automation.Language.Parser]::ParseFile($args[0], [ref]$null, [ref]$e)
"errors=" + @($e).Count; $e | ForEach-Object { $_.ToString() }
PSEOF
# Loads named functions and top-level assignments OUT of the real script (no copies), so what is
# tested is what ships. Dot-sourced by the steps below.
cat > "$TMP/load.ps1" <<'PSEOF'
function Import-FromScript([string] $path, [string[]] $functions, [string[]] $variables) {
  $ast = [System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$null, [ref]$null)
  foreach ($v in $variables) {
    $a = $ast.EndBlock.Statements | Where-Object { $_ -is [System.Management.Automation.Language.AssignmentStatementAst] -and $_.Left.Extent.Text -ceq ('$' + $v) } | Select-Object -First 1
    if (-not $a) { throw "no top-level assignment to `$$v" }
    Set-Variable -Scope Global -Name $v -Value (& ([scriptblock]::Create($a.Right.Extent.Text)))
  }
  foreach ($f in $functions) {
    $d = $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq $f }, $true) | Select-Object -First 1
    if (-not $d) { throw "no function $f" }
    . ([scriptblock]::Create($d.Extent.Text.Replace("function $f", "function global:$f")))
  }
}
PSEOF

# 1. parse
out="$("$PWSH" -NoProfile -File "$TMP/parse.ps1" "$PS1" 2>&1)"
if [ "$(printf '%s\n' "$out" | head -1)" = "errors=0" ]; then pass "parses"; else fail "parse: $out"; fi

# 2. the signer against AWS's published example (Signature Version 4, "Example: GET Object")
cat > "$TMP/sigv4.ps1" <<'PSEOF'
. $args[1]
Import-FromScript $args[0] @('Hex', 'Sha256-Bytes', 'Hmac', 'New-SigV4Authorization') @('Utf8')
$empty = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
New-SigV4Authorization 'GET' 'examplebucket.s3.amazonaws.com' '/test.txt' @{ 'range' = 'bytes=0-9'; 'x-amz-content-sha256' = $empty; 'x-amz-date' = '20130524T000000Z' } $empty 'AKIAIOSFODNN7EXAMPLE' 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' '20130524T000000Z' 'us-east-1'
PSEOF
want='AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41'
got="$("$PWSH" -NoProfile -File "$TMP/sigv4.ps1" "$PS1" "$TMP/load.ps1" 2>&1)"
if [ "$got" = "$want" ]; then pass "SigV4 matches AWS's published GET Object example"; else fail "SigV4: got [$got]"; fi

# 3. pointer parity, both from the same inputs
V=0.6.94; SHA=d476fc6c913ee3254f8406ccad0db09724c313551203682c4ad712f51d20c2db
KM_LWP_VERSION=$V KM_LWP_SHA=$SHA KM_LWP_ARTIFACT="kosmos-win-x64.zip" KM_LWP_VERSIONED="kosmos-$V-win-x64.zip" KM_LWP_ARCH=x64 \
  node "$WRITER" "$TMP/js.json" || fail "the JS writer did not run"
cat > "$TMP/pointer.ps1" <<'PSEOF'
. $args[1]
Import-FromScript $args[0] @('New-PointerBytes') @('Arch', 'Alias', 'Utf8')
[IO.File]::WriteAllBytes($args[2], (New-PointerBytes $args[3] $args[4] "kosmos-$($args[3])-win-$Arch.zip"))
PSEOF
"$PWSH" -NoProfile -File "$TMP/pointer.ps1" "$PS1" "$TMP/load.ps1" "$TMP/ps.json" "$V" "$SHA"
rc=$?
if [ "$rc" -ne 0 ]; then fail "could not run New-PointerBytes out of publish-r2.ps1 (rc $rc)"
elif cmp -s "$TMP/js.json" "$TMP/ps.json"; then pass "pointer bytes equal write-latest-win-pointer.js"
else fail "pointer bytes differ: js=$(cat "$TMP/js.json") ps=$(cat "$TMP/ps.json")"; fi

# 4. offline refusals. Each case asserts its own message, not just the exit code, because a
# refusal about something else (no key, say) also exits 1.
refuses() { # <label> <expected substring> <args...>
  local label="$1" want="$2"; shift 2
  local o rc
  o="$(env -u R2_ACCOUNT_ID -u R2_ACCESS_KEY_ID -u R2_SECRET_ACCESS_KEY LOCALAPPDATA="$TMP/none" "$PWSH" -NoProfile -File "$PS1" "$@" 2>&1)"; rc=$?
  if [ "$rc" -eq 1 ] && printf '%s' "$o" | grep -qF -- "$want"; then pass "$label"; else fail "$label: rc=$rc out=$o"; fi
}
printf 'R2_ACCOUNT_ID=%s\nR2_ACCESS_KEY_ID=AKIDTEST\nR2_SECRET_ACCESS_KEY=secret\n' "$(printf 'a%.0s' $(seq 32))" > "$TMP/cred.env"
refuses "bad key prefix refused" "-KeyPrefix" -Zip "$TMP/x.zip" -KeyPrefix 'no-trailing-slash'
refuses "dot-dot key prefix refused" "no . or .. segment" -Zip "$TMP/x.zip" -KeyPrefix '../'
refuses "a stand-in served base needs a test prefix" "-ServedBase is for tests" -Promote -ApprovedVersion 1.2.3 -ApprovedSha "$SHA" -ApprovalRef 1.2 -ServedBase https://example.com/dist
refuses "missing zip refused" "no such zip" -Zip "$TMP/absent.zip"
refuses "no key refused" "no R2_ACCOUNT_ID" -Promote -ApprovedVersion 1.2.3 -ApprovedSha "$SHA" -ApprovalRef 1.2
refuses "non-x.y.z version refused" "x.y.z" -Promote -ApprovedVersion '-0.6.94' -ApprovedSha "$SHA" -ApprovalRef 1.2 -CredentialFile "$TMP/cred.env"
refuses "malformed sha refused" "lowercase 64-hex" -Promote -ApprovedVersion 1.2.3 -ApprovedSha nothex -ApprovalRef 1.2 -CredentialFile "$TMP/cred.env"
# PowerShell's plain -match ignores case; these must not.
refuses "UPPERCASE sha refused" "lowercase 64-hex" -Promote -ApprovedVersion 1.2.3 -ApprovedSha "$(printf '%s' "$SHA" | tr a-f A-F)" -ApprovalRef 1.2 -CredentialFile "$TMP/cred.env"
refuses "shell-ish approval ref refused" "is not a Slack message ts" -Promote -ApprovedVersion 1.2.3 -ApprovedSha "$SHA" -ApprovalRef 'x; rm' -CredentialFile "$TMP/cred.env"
refuses "approval ref with a trailing newline refused" "is not a Slack message ts" -Promote -ApprovedVersion 1.2.3 -ApprovedSha "$SHA" -ApprovalRef $'1.2\n' -CredentialFile "$TMP/cred.env"
# A zip whose launcher is not the committed Kosmos.exe (the refusal comes before any network).
python3 - "$TMP/wrongexe.zip" <<'PYEOF'
import sys, zipfile
with zipfile.ZipFile(sys.argv[1], 'w') as z:
    z.writestr('app/package.json', '{"version":"9.9.1"}'); z.writestr('Kosmos.exe', 'MZ not the launcher')
PYEOF
refuses "a zip with another launcher refused" "is not the committed launcher" -Zip "$TMP/wrongexe.zip" -CredentialFile "$TMP/cred.env"

[ "$fails" -eq 0 ] && { echo "test-publish-r2-3725: all passed"; exit 0; }
echo "test-publish-r2-3725: $fails failed"; exit 1
