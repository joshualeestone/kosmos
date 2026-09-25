<#
publish-r2.ps1 -- publish a Windows build to the R2 bucket the site serves it from, from the
Windows PC, with no Mac step (#3725).

WHY THIS EXISTS. installkosmos.com answers every Windows download name (/dist/kosmos-*-win-x64.zip,
their .sha256 sidecars, latest-win.json and latest-win-staging.json) with a 307 to the public R2
bucket kosmos-dist-win. publish-kosmos-windows.sh and promote-channel.sh --family win only write a
site checkout's dist/, and nothing in the repo uploaded to R2, so every Windows release reached users
by a hand upload. Josh ruled (2026-09-25) that Homer releases Windows independently; this is the
upload step, with the same file set and the same gates as those two scripts.

TWO MODES.

  Staging (the default). From a built zip (tools/build-kosmos-windows.sh):
    kosmos-<v>-win-x64.zip, its .sha256 sidecar, then latest-win-staging.json LAST (the pointer is
    the go-live, so it never names bytes that are not already up). Prod readers are untouched.

    pwsh tools/windows/publish-r2.ps1 -Zip .\dist\kosmos-win-x64.zip

  Promote (prod, ONLY on Josh's go). Moves prod onto the staged build, the R2 twin of
  promote-channel.sh --family win. It refuses unless ALL of these hold, checked case-sensitively:
    - the staging pointer names exactly -ApprovedVersion and -ApprovedSha, in the one canonical
      pointer shape, and the staged zip and its sidecar hold exactly those bytes;
    - -ApprovalRef is a Slack ts or permalink of Josh's message, and is logged before any write;
    - this PC holds a passing verification record for that sha (tools/win-staging-verify.js
      writes it; tools/lib/win-staging-record.js validates it, through node).
  Then: the alias kosmos-win-x64.zip becomes a server-side copy of the staged zip (pinned to the
  exact object just verified), its sidecar is rewritten to name the alias, both are read back, and
  only then latest-win.json becomes the staging pointer's bytes verbatim, LAST.

    pwsh tools/windows/publish-r2.ps1 -Promote -ApprovedVersion 0.6.94 -ApprovedSha <sha> -ApprovalRef <ref>

  -DryRun on either mode does every read and check and prints what it would write, writing nothing.

WHICH READS DECIDE. Every read that decides whether to write (does this version exist, what does
prod name, what is staged) is a SIGNED read of the bucket itself, so an edge that is challenging or
rate-limiting us answers with a refusal, never with "nothing there". The public URL is read only
AFTER writing, to confirm users are served the new bytes.

CREDENTIALS. An R2 S3 key scoped to the one bucket (Object Read & Write on kosmos-dist-win), from
-CredentialFile (default %LOCALAPPDATA%\Kosmos\release-secrets\r2-dist-win.env, lines
R2_ACCOUNT_ID=, R2_ACCESS_KEY_ID=, R2_SECRET_ACCESS_KEY=) or, when that file is absent, from
environment variables of the same names. The secret is never printed.

TESTING. KOSMOS_PUBLISH_R2_FAKE_DIR=<dir> makes a local directory the bucket (and the served
base) and logs every request to <dir>/.calls; tools/test-publish-r2-3725.sh drives the gates and
the write order through it. Nothing is published in that mode, and it says so on stderr.

Windows x64 only: every Windows redirect on the site is x64. Versions are x.y.z, what the updater
accepts. Exit codes: 0 done (or dry run clean), 1 refused or failed. PowerShell 5.1 and 7.
#>
[CmdletBinding(DefaultParameterSetName = 'Staging')]
param(
  [Parameter(ParameterSetName = 'Staging', Mandatory = $true)] [string] $Zip,
  [Parameter(ParameterSetName = 'Staging')] [string] $Version,
  [Parameter(ParameterSetName = 'Staging')] [switch] $ReplaceVersioned,

  [Parameter(ParameterSetName = 'Promote')] [switch] $Promote,
  [Parameter(ParameterSetName = 'Promote', Mandatory = $true)] [string] $ApprovedVersion,
  [Parameter(ParameterSetName = 'Promote', Mandatory = $true)] [string] $ApprovedSha,
  [Parameter(ParameterSetName = 'Promote', Mandatory = $true)] [string] $ApprovalRef,

  [string] $Bucket = 'kosmos-dist-win',
  [string] $CredentialFile = $(if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA 'Kosmos\release-secrets\r2-dist-win.env' } else { '' }),
  # Where users are served from; read only to confirm a write reached them.
  [string] $ServedBase = 'https://installkosmos.com/dist',
  # For tests only: write every key under this prefix (e.g. "_selftest/abc/"). A non-default
  # -ServedBase is refused without it, so no stand-in server can speak for prod. -ServedBase
  # must then ALREADY END IN the prefix (the bucket's public URL + "/_selftest/abc"): names are
  # appended to it as they are, so the served checks read the prefixed objects.
  [string] $KeyPrefix = '',
  [switch] $DryRun
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
Add-Type -AssemblyName System.Net.Http
Add-Type -AssemblyName System.IO.Compression.FileSystem
$Invariant = [Globalization.CultureInfo]::InvariantCulture

# Anything that goes wrong after latest-win.json is written must say so (set just before it).
$script:AfterNote = ''
function Say([string] $m) { [Console]::Out.WriteLine("publish-r2: $m") }
# Anything unexpected still ends in the same clear shape, with the partial-state note.
trap { [Console]::Error.WriteLine("publish-r2: UNEXPECTED - $($_.Exception.Message)$script:AfterNote"); exit 1 }
function Refuse([string] $m) { [Console]::Error.WriteLine("publish-r2: REFUSING - $m$script:AfterNote"); exit 1 }

# ---------- names -------------------------------------------------------------------------------
# All comparisons below are CASE-SENSITIVE (-c...), because R2 keys are: PowerShell's plain -eq
# would let X64 pass as x64 and then write a key nobody reads. \z, not $, so a trailing newline
# cannot slip through.
$Arch = 'x64'
$Alias = "kosmos-win-$Arch.zip"
function Assert-Version([string] $what, [string] $v) {
  if ($v -cnotmatch '^[0-9]+\.[0-9]+\.[0-9]+\z') { Refuse "an implausible $what '$v' (x.y.z, what the updater accepts)" }
}
function Assert-Sha([string] $what, [string] $v) {
  if ($v -cnotmatch '^[0-9a-f]{64}\z') { Refuse "$what '$v' must be a lowercase 64-hex sha256" }
}
if ($KeyPrefix -and ($KeyPrefix -cnotmatch '^[0-9A-Za-z._-]+(/[0-9A-Za-z._-]+)*/\z' -or ($KeyPrefix.TrimEnd('/') -split '/') -contains '..' -or ($KeyPrefix.TrimEnd('/') -split '/') -contains '.')) { Refuse "-KeyPrefix '$KeyPrefix' must be path segments ending in '/', with no . or .. segment" }
# TEST TRANSPORT: when KOSMOS_PUBLISH_R2_FAKE_DIR names a directory, it stands in for the bucket
# AND for the served base, and every request is appended to <dir>/.calls, so the offline test
# drives the real gates and orderings. Nothing leaves this machine in that mode.
$FakeDir = $env:KOSMOS_PUBLISH_R2_FAKE_DIR
if ($FakeDir) { [Console]::Error.WriteLine("publish-r2: TEST TRANSPORT: the bucket is the local directory $FakeDir; nothing is published") }
if ($ServedBase -cne 'https://installkosmos.com/dist' -and -not $KeyPrefix) { Refuse "-ServedBase is for tests and needs -KeyPrefix; users are served from https://installkosmos.com/dist" }
if ($KeyPrefix -and $ServedBase -match '^https?://([a-z0-9-]+\.)*installkosmos\.com(/|:|$)' -and -not $FakeDir) { Refuse "-KeyPrefix needs a -ServedBase that serves that prefix; otherwise the checks after writing would read prod's objects" }

# ---------- hashing and signing -----------------------------------------------------------------
$Utf8 = New-Object Text.UTF8Encoding $false
function Hex([byte[]] $b) { -join ($b | ForEach-Object { $_.ToString('x2') }) }
function Sha256-Bytes([byte[]] $b) { $h = [Security.Cryptography.SHA256]::Create(); try { Hex $h.ComputeHash($b) } finally { $h.Dispose() } }
function Sha256-File([string] $p) {
  $h = [Security.Cryptography.SHA256]::Create(); $s = [IO.File]::OpenRead($p)
  try { Hex $h.ComputeHash($s) } finally { $s.Dispose(); $h.Dispose() }
}
function Hmac([byte[]] $key, [string] $msg) {
  $h = New-Object Security.Cryptography.HMACSHA256 (, $key)
  try { $h.ComputeHash($Utf8.GetBytes($msg)) } finally { $h.Dispose() }
}
# SigV4 for S3, a pure function of its inputs so a test can pin it against AWS's published vector.
# $Headers holds every header to sign EXCEPT host (lower-case names). Returns the Authorization value.
function New-SigV4Authorization([string] $Method, [string] $HostName, [string] $UriPath, [hashtable] $Headers,
                                [string] $PayloadSha, [string] $AccessKey, [string] $Secret, [string] $AmzDate, [string] $Region) {
  $all = @{ 'host' = $HostName }
  foreach ($k in $Headers.Keys) { $all[$k] = $Headers[$k] }
  [string[]] $names = @($all.Keys); [Array]::Sort($names, [StringComparer]::Ordinal)   # what SigV4 specifies
  # Values are trimmed; SigV4 also collapses INNER runs of spaces, which none of the headers
  # this script signs can contain (dates, hashes, keys, ETags, fixed words).
  $canonHeaders = -join ($names | ForEach-Object { "$($_):$(([string]$all[$_]).Trim())`n" })
  $signed = $names -join ';'
  $canonical = "$Method`n$UriPath`n`n$canonHeaders`n$signed`n$PayloadSha"
  $day = $AmzDate.Substring(0, 8)
  $scope = "$day/$Region/s3/aws4_request"
  $toSign = "AWS4-HMAC-SHA256`n$AmzDate`n$scope`n$(Sha256-Bytes $Utf8.GetBytes($canonical))"
  $k = Hmac ($Utf8.GetBytes('AWS4' + $Secret)) $day
  $k = Hmac $k $Region; $k = Hmac $k 's3'; $k = Hmac $k 'aws4_request'
  "AWS4-HMAC-SHA256 Credential=$AccessKey/$scope, SignedHeaders=$signed, Signature=$(Hex (Hmac $k $toSign))"
}

# ---------- credentials -------------------------------------------------------------------------
function Read-Credentials {
  $c = @{}
  if ($CredentialFile -and (Test-Path -LiteralPath $CredentialFile)) {
    foreach ($line in [IO.File]::ReadAllLines((Resolve-Path -LiteralPath $CredentialFile).ProviderPath)) {
      if ($line -cmatch '^\s*(?:export\s+)?(R2_ACCOUNT_ID|R2_ACCESS_KEY_ID|R2_SECRET_ACCESS_KEY)\s*=\s*["'']?([^"''\s]+)["'']?\s*\z') { $c[$Matches[1]] = $Matches[2] }
    }
    $from = $CredentialFile
  } else {
    if ($CredentialFile) { Say "no credential file at $CredentialFile; reading the environment instead" }
    foreach ($n in 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY') { $v = [Environment]::GetEnvironmentVariable($n); if ($v) { $c[$n] = $v } }
    $from = 'the environment'
  }
  foreach ($n in 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY') {
    if (-not $c.ContainsKey($n)) { Refuse "no $n in $from (see the CREDENTIALS note at the top of this script)" }
  }
  if ($c.R2_ACCOUNT_ID -cnotmatch '^[0-9a-f]{32}\z') { Refuse "R2_ACCOUNT_ID from $from is not a 32-hex Cloudflare account id" }
  Say "credentials from $from (key id ending ...$($c.R2_ACCESS_KEY_ID.Substring([Math]::Max(0, $c.R2_ACCESS_KEY_ID.Length - 4))))"
  $c
}

# ---------- R2 over the S3 API ------------------------------------------------------------------
$Http = New-Object Net.Http.HttpClient
$Http.Timeout = [TimeSpan]::FromMinutes(30)
# Some edges challenge a client that names itself nothing.
[void]$Http.DefaultRequestHeaders.TryAddWithoutValidation('User-Agent', 'kosmos-publish-r2/1 (+https://installkosmos.com)')

function Invoke-R2 {
  param([string] $Method, [string] $Key, [byte[]] $Body = $null, [string] $BodyFile = $null,
        [string] $PayloadSha = $null, [string] $ContentType = $null, [hashtable] $Extra = @{})
  if ($FakeDir) { return (Invoke-FakeR2 $Method $Key $Body $BodyFile $Extra $PayloadSha) }
  $hostName = "$($Cred.R2_ACCOUNT_ID).r2.cloudflarestorage.com"
  $uriPath = "/$Bucket/$Key"   # keys are [0-9A-Za-z._/-] only, all unreserved, so none need encoding
  if (-not $PayloadSha) { $PayloadSha = if ($null -ne $Body) { Sha256-Bytes $Body } else { Sha256-Bytes ([byte[]]@()) } }
  $amzDate = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ', $Invariant)
  $hdr = @{ 'x-amz-content-sha256' = $PayloadSha; 'x-amz-date' = $amzDate }
  foreach ($k in $Extra.Keys) { $hdr[$k.ToLowerInvariant()] = $Extra[$k] }
  $auth = New-SigV4Authorization $Method $hostName $uriPath $hdr $PayloadSha $Cred.R2_ACCESS_KEY_ID $Cred.R2_SECRET_ACCESS_KEY $amzDate 'auto'
  $req = New-Object Net.Http.HttpRequestMessage ([Net.Http.HttpMethod]::new($Method)), "https://$hostName$uriPath"
  # A signed header .NET will not carry on the request (a content header) would break the
  # signature silently, so it is a refusal, not a dropped header.
  foreach ($n in $hdr.Keys) { if (-not $req.Headers.TryAddWithoutValidation($n, $hdr[$n])) { Refuse "internal: the signed header '$n' cannot be sent as a request header" } }
  [void]$req.Headers.TryAddWithoutValidation('Authorization', $auth)
  $stream = $null
  if ($BodyFile) { $stream = [IO.File]::OpenRead($BodyFile); $req.Content = New-Object Net.Http.StreamContent $stream }
  elseif ($null -ne $Body) { $req.Content = New-Object Net.Http.ByteArrayContent (, $Body) }
  elseif ($Method -ceq 'PUT') { $req.Content = New-Object Net.Http.ByteArrayContent (, [byte[]]@()) }
  if ($req.Content -and $ContentType) { $req.Content.Headers.ContentType = [Net.Http.Headers.MediaTypeHeaderValue]::Parse($ContentType) }
  try {
    $resp = $Http.SendAsync($req).GetAwaiter().GetResult()
    $bytes = $resp.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult()
    $etag = if ($resp.Headers.ETag) { $resp.Headers.ETag.Tag } else { '' }
    $cc = if ($resp.Headers.CacheControl) { $resp.Headers.CacheControl.ToString() } else { '' }
    [pscustomobject]@{ Status = [int]$resp.StatusCode; CacheControl = $cc; Bytes = $bytes; Body = $(if ($bytes.Length -le 1MB) { $Utf8.GetString($bytes) } else { '' }); ETag = $etag }
  } catch {
    $why = "network error on $Method $Key ($($_.Exception.GetBaseException().Message))"
    if ($Method -ceq 'GET') { Refuse $why }
    Refuse "$why. Writes before this one may have landed: re-run with -DryRun to see the bucket's state before re-running for real."
  } finally { if ($stream) { $stream.Dispose() }; $req.Dispose() }
}

# The test stand-in: a directory with S3's semantics for the four requests this script makes.
# Test seams, each one environment variable (all under the test transport only):
#   KOSMOS_PUBLISH_R2_FAKE_GET_STATUS=<key suffix>:<status>   a GET of that key answers <status>
#   KOSMOS_PUBLISH_R2_FAKE_AFTER=<METHOD> <key suffix>|<key>|<file>
#     once a matching request is answered, <key> is overwritten with <file>'s bytes (a
#     concurrent writer landing between two of this script's steps)
function Invoke-FakeR2([string] $Method, [string] $Key, [byte[]] $Body, [string] $BodyFile, [hashtable] $Extra, [string] $PayloadSha) {
  $gs = [Environment]::GetEnvironmentVariable('KOSMOS_PUBLISH_R2_FAKE_GET_STATUS')
  if ($Method -ceq 'GET' -and $gs -and $Key.EndsWith($gs.Split(':')[0])) {
    [IO.File]::AppendAllText((Join-Path $FakeDir '.calls'), "GET $Key | status=$($gs.Split(':')[1])`n", $Utf8)
    return [pscustomobject]@{ Status = [int]$gs.Split(':')[1]; Bytes = [byte[]]@(); Body = 'injected'; ETag = '' }
  }
  $r = Invoke-FakeR2Core $Method $Key $Body $BodyFile $Extra $PayloadSha
  $after = [Environment]::GetEnvironmentVariable('KOSMOS_PUBLISH_R2_FAKE_AFTER')
  if ($after) {
    $parts = $after.Split('|'); $trig = $parts[0].Split(' ')
    if ($Method -ceq $trig[0] -and $Key.EndsWith($trig[1])) { [IO.File]::Copy($parts[2], (Join-Path $FakeDir $parts[1]), $true) }
  }
  $r
}
function Invoke-FakeR2Core([string] $Method, [string] $Key, [byte[]] $Body, [string] $BodyFile, [hashtable] $Extra, [string] $PayloadSha) {
  $path = Join-Path $FakeDir $Key
  $copy = if ($Extra.ContainsKey('x-amz-copy-source')) { $Extra['x-amz-copy-source'] } else { '' }
  # Each request is logged with the extra headers it carried, so a test can see them.
  [string[]] $hn = @($Extra.Keys); [Array]::Sort($hn, [StringComparer]::Ordinal)
  $hdrs = ($hn | ForEach-Object { "$_=$($Extra[$_])" }) -join ';'
  [IO.File]::AppendAllText((Join-Path $FakeDir '.calls'), "$Method $Key$(if ($copy) { " COPY $copy" }) | $hdrs`n", $Utf8)
  # Like S3: a declared payload sha that is not the body's is refused.
  if ($Method -ceq 'PUT' -and -not $copy -and $PayloadSha) {
    $actual = if ($BodyFile) { Sha256-File $BodyFile } elseif ($null -ne $Body) { Sha256-Bytes $Body } else { Sha256-Bytes ([byte[]]@()) }
    if ($actual -cne $PayloadSha) { return [pscustomobject]@{ Status = 400; Bytes = [byte[]]@(); Body = 'XAmzContentSHA256Mismatch'; ETag = '' } }
  }
  $tag = { param($p) '"' + (Sha256-File $p) + '"' }
  if ($Method -ceq 'GET') {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return [pscustomobject]@{ Status = 404; Bytes = [byte[]]@(); Body = ''; ETag = '' } }
    $b = [IO.File]::ReadAllBytes($path)
    $cc = if (Test-Path -LiteralPath "$path.cc") { [IO.File]::ReadAllText("$path.cc") } else { '' }
    $noEtag = [Environment]::GetEnvironmentVariable('KOSMOS_PUBLISH_R2_FAKE_NO_ETAG')
    $et = if ($noEtag -and $Key.EndsWith($noEtag)) { '' } else { (& $tag $path) }
    return [pscustomobject]@{ Status = 200; CacheControl = $cc; Bytes = $b; Body = $Utf8.GetString($b); ETag = $et }
  }
  $fail = [Environment]::GetEnvironmentVariable('KOSMOS_PUBLISH_R2_FAKE_FAIL')
  if ($fail -and $Key.EndsWith($fail)) { return [pscustomobject]@{ Status = 500; Bytes = [byte[]]@(); Body = 'injected failure'; ETag = '' } }
  $exists = Test-Path -LiteralPath $path -PathType Leaf
  if ($Extra.ContainsKey('if-none-match') -and $exists) { return [pscustomobject]@{ Status = 412; Bytes = [byte[]]@(); Body = 'PreconditionFailed'; ETag = '' } }
  if ($Extra.ContainsKey('if-match') -and -not $copy -and (-not $exists -or $Extra['if-match'] -cne (& $tag $path))) { return [pscustomobject]@{ Status = 412; Bytes = [byte[]]@(); Body = 'PreconditionFailed'; ETag = '' } }
  [void](New-Item -ItemType Directory -Force -Path (Split-Path -Parent $path))
  if ($copy) {
    $src = Join-Path $FakeDir ($copy.Substring($Bucket.Length + 2))
    # Test seam: a concurrent re-stage landing between the promote's checks and its copy.
    $drift = [Environment]::GetEnvironmentVariable('KOSMOS_PUBLISH_R2_FAKE_RESTAGE_BEFORE_COPY')
    if ($drift) { [IO.File]::Copy($drift, $src, $true) }
    if (-not (Test-Path -LiteralPath $src -PathType Leaf)) { return [pscustomobject]@{ Status = 404; Bytes = [byte[]]@(); Body = 'NoSuchKey'; ETag = '' } }
    if ($Extra.ContainsKey('x-amz-copy-source-if-match') -and $Extra['x-amz-copy-source-if-match'] -cne (& $tag $src)) { return [pscustomobject]@{ Status = 412; Bytes = [byte[]]@(); Body = 'PreconditionFailed'; ETag = '' } }
    [IO.File]::Copy($src, $path, $true)
  } elseif ($BodyFile) { [IO.File]::Copy($BodyFile, $path, $true) }
  else { [IO.File]::WriteAllBytes($path, $(if ($null -ne $Body) { $Body } else { [byte[]]@() })) }
  # Like S3, a PUT replaces the object's metadata: its Cache-Control is what THIS PUT sent.
  if ($Extra.ContainsKey('cache-control')) { [IO.File]::WriteAllText("$path.cc", $Extra['cache-control']) } else { Remove-Item -LiteralPath "$path.cc" -Force -ErrorAction SilentlyContinue }
  [pscustomobject]@{ Status = 200; Bytes = [byte[]]@(); Body = ''; ETag = (& $tag $path) }
}

# The bucket's own answer for a name: $null when it does not exist (404), the object when it does,
# and a REFUSAL for anything else. An unreadable bucket is never "nothing there".
function Get-Object([string] $Name) {
  $r = Invoke-R2 -Method GET -Key "$KeyPrefix$Name"
  if ($r.Status -eq 404) { return $null }
  if ($r.Status -ne 200) { Refuse "reading $KeyPrefix$Name from the bucket answered $($r.Status): $($r.Body)" }
  $r
}
# Objects that are OVERWRITTEN in place (pointers, the alias and its sidecar) carry
# Cache-Control: no-cache, so no cache between R2 and a user can keep serving the old bytes.
$NoCache = @{ 'cache-control' = 'no-cache' }
$script:LastPut = $null   # set by Put-Object; initialised for StrictMode (a dry run sets nothing)
function Put-Object([string] $Name, [byte[]] $Body, [string] $File, [string] $Sha, [string] $Type, [hashtable] $Extra = @{}) {
  $key = "$KeyPrefix$Name"
  if ($DryRun) { Say "DRY RUN: would PUT $key ($Type, sha256 $Sha)"; return }
  $r = Invoke-R2 -Method PUT -Key $key -Body $Body -BodyFile $File -PayloadSha $Sha -ContentType $Type -Extra $Extra
  if ($r.Status -ne 200) { Refuse "PUT $key answered $($r.Status): $($r.Body)" }
  Say "wrote $key"
  $script:LastPut = $r   # the response (its ETag), without emitting it into the output stream
}
function Copy-Object([string] $FromName, [string] $ToName, [string] $IfMatch) {
  $from = "$KeyPrefix$FromName"; $to = "$KeyPrefix$ToName"
  if ($DryRun) { Say "DRY RUN: would COPY $from -> $to (server side, only if it is still $IfMatch)"; return }
  # REPLACE, so the alias gets its own no-cache header rather than the immutable zip's metadata.
  # (Content-Type rides on the request content, which .NET keeps apart from the signed headers.)
  $r = Invoke-R2 -Method PUT -Key $to -ContentType 'application/zip' -Extra @{ 'x-amz-copy-source' = "/$Bucket/$from"; 'x-amz-copy-source-if-match' = $IfMatch; 'x-amz-metadata-directive' = 'REPLACE'; 'cache-control' = 'no-cache' }
  if ($r.Status -ne 200 -or $r.Body -cmatch '<Error>') { Refuse "COPY $from -> $to answered $($r.Status): $($r.Body)" }
  Say "copied $from -> $to"
}
function Assert-Object([string] $Name, [string] $WantSha) {
  $o = Get-Object $Name
  $got = if ($o) { Sha256-Bytes $o.Bytes } else { '(absent)' }
  if ($got -cne $WantSha) { Refuse "the bucket holds $KeyPrefix$Name as $got, not $WantSha" }
  $o
}

# ---------- confirming what users are served (after writing) ------------------------------------
function Get-Served([string] $Name) {
  if ($FakeDir) {
    $p = Join-Path $FakeDir "$KeyPrefix$Name"
    if (Test-Path -LiteralPath $p -PathType Leaf) { return [pscustomobject]@{ Status = 200; Bytes = [IO.File]::ReadAllBytes($p); Url = "fake:$KeyPrefix$Name" } }
    return [pscustomobject]@{ Status = 404; Bytes = [byte[]]@(); Url = "fake:$KeyPrefix$Name" }
  }
  $url = "$($ServedBase.TrimEnd('/'))/$Name"
  $req = New-Object Net.Http.HttpRequestMessage ([Net.Http.HttpMethod]::Get), $url
  $req.Headers.CacheControl = New-Object Net.Http.Headers.CacheControlHeaderValue
  $req.Headers.CacheControl.NoCache = $true
  try {
    $resp = $Http.SendAsync($req).GetAwaiter().GetResult()
    $bytes = $resp.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult()
    [pscustomobject]@{ Status = [int]$resp.StatusCode; Bytes = $bytes; Url = $url }
  } catch {
    [pscustomobject]@{ Status = 0; Bytes = [byte[]]@(); Url = $url }
  } finally { $req.Dispose() }
}
function Assert-Served([string] $Name, [string] $WantSha) {
  # The edge can lag a write by a moment; retry briefly before calling it a failure.
  for ($i = 1; $i -le 6; $i++) {
    $s = Get-Served $Name
    $got = if ($s.Status -eq 200) { Sha256-Bytes $s.Bytes } else { '' }
    if ($got -ceq $WantSha) { Say "served OK: $($s.Url) ($WantSha)"; return }
    if ($FakeDir -or $i -eq 6) { break }
    Start-Sleep -Seconds 5
  }
  Refuse "$($s.Url) serves status $($s.Status) sha256 '$got', not the $WantSha just written"
}

# ---------- the file formats --------------------------------------------------------------------
# The one pointer shape, byte for byte what tools/lib/write-latest-win-pointer.js writes, so a
# promote can copy the staging pointer onto prod verbatim and deploy-site's checks still hold.
function New-PointerBytes([string] $V, [string] $Sha, [string] $Versioned) {
  $Utf8.GetBytes('{"version":"' + $V + '","sha256":"' + $Sha + '","artifact":"' + $Alias + '","versioned":"' + $Versioned + '","arch":"' + $Arch + '"}' + "`n")
}
# A sidecar in shasum's format: "<sha>  <name>\n", naming its own file so `shasum -c` verifies it.
function New-SidecarBytes([string] $Sha, [string] $Name) { $Utf8.GetBytes("$Sha  $Name`n") }
# A pointer's fields, or $null when it is not JSON or lacks one (StrictMode would crash on a
# missing property, and a hand-staged pointer with the wrong shape has happened: 0.6.94).
function Read-PointerFields([byte[]] $Bytes) {
  try { $j = $Utf8.GetString($Bytes) | ConvertFrom-Json } catch { return $null }
  if (-not $j -or -not ($j -is [psobject])) { return $null }
  foreach ($f in 'version', 'sha256', 'artifact', 'versioned', 'arch') {
    if (-not ($j.PSObject.Properties.Name -ccontains $f) -or -not ($j.$f -is [string]) -or -not $j.$f) { return $null }
  }
  $j
}

# ---------- the approval log, shared with promote-channel.sh ------------------------------------
$ApprovalLog = if ($env:KOSMOS_WIN_PROMOTE_LOG) { $env:KOSMOS_WIN_PROMOTE_LOG } else { Join-Path $HOME '.claude/logs/win-promote-approvals.log' }
$ApprovalLog = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($ApprovalLog)   # .NET resolves relative paths elsewhere
function Write-ApprovalLine([string] $line, [switch] $Outcome) {
  if ($DryRun) { Say "DRY RUN: would log to ${ApprovalLog}: $line"; return }
  try {
    [void](New-Item -ItemType Directory -Force -Path (Split-Path -Parent $ApprovalLog))
    [IO.File]::AppendAllText($ApprovalLog, "$line`n", $Utf8)
  } catch {
    # The go is a gate (refuse); the outcome line after a finished promote is a record, and
    # failing to write it must not report a promote that happened as a failure.
    if ($Outcome) { [Console]::Error.WriteLine("publish-r2: WARNING could not append the outcome line to $ApprovalLog; the promote itself completed"); return }
    Refuse "could not record Josh's go in $ApprovalLog (an approval that is not logged is not given)."
  }
}
function Stamp { [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ', $Invariant) }

if ($PSCmdlet.ParameterSetName -ceq 'Staging') {
  # ======================================== STAGING ==========================================
  if (-not (Test-Path -LiteralPath $Zip -PathType Leaf)) { Refuse "no such zip: $Zip" }
  $Cred = Read-Credentials
  $ZipPath = (Resolve-Path -LiteralPath $Zip).ProviderPath
  $committedExe = Join-Path $PSScriptRoot 'Kosmos.exe'
  if (-not (Test-Path -LiteralPath $committedExe -PathType Leaf)) { Refuse "the committed launcher $committedExe is missing, so the zip's launcher cannot be checked" }
  $archive = [IO.Compression.ZipFile]::OpenRead($ZipPath)
  try {
    # The version the build baked in (app/package.json inside the zip), never the repo's. A
    # -Version that disagrees would publish these bytes under another version's name.
    $baked = ''
    $e = $archive.GetEntry('app/package.json')
    if ($e) {
      $r = New-Object IO.StreamReader ($e.Open())
      try { $pkg = $r.ReadToEnd() | ConvertFrom-Json } catch { Refuse "$ZipPath has an unreadable app/package.json" } finally { $r.Dispose() }
      if ($pkg.PSObject.Properties.Name -contains 'version') { $baked = [string]$pkg.version }
    }
    if (-not $Version) {
      if (-not $baked) { Refuse "$ZipPath has no version in app/package.json (pass -Version)" }
      $Version = $baked
    } elseif ($baked -and $baked -cne $Version) { Refuse "-Version $Version is not the version this zip was built as ($baked)" }
    # The launcher must BE the committed, signed Kosmos.exe (#3677): a validly signed exe from
    # anyone else, or an older launcher, is not the one we ship.
    # A zip with two entries of one name: the check below would read the first while Explorer
    # extracts the last, so a different launcher could pass. Refuse it.
    $dups = @($archive.Entries | Group-Object -Property FullName -CaseSensitive | Where-Object { $_.Count -gt 1 })
    if ($dups.Count -gt 0) { Refuse "$ZipPath has duplicate entries ($(($dups | ForEach-Object { $_.Name }) -join ', '))" }
    $exe = $archive.GetEntry('Kosmos.exe')
    if (-not $exe) { Refuse "$ZipPath carries no Kosmos.exe at its root" }
    $tmp = Join-Path ([IO.Path]::GetTempPath()) ("kosmos-exe-" + [Guid]::NewGuid().ToString('N') + '.exe')
    [IO.Compression.ZipFileExtensions]::ExtractToFile($exe, $tmp)
    try {
      if ((Sha256-File $tmp) -cne (Sha256-File $committedExe)) { Refuse "the Kosmos.exe inside $ZipPath is not the committed launcher $committedExe" }
      if (Get-Command Get-AuthenticodeSignature -ErrorAction SilentlyContinue) {
        $sigStatus = (Get-AuthenticodeSignature -LiteralPath $tmp).Status.ToString()
        if ($sigStatus -cne 'Valid') { Refuse "the launcher's Authenticode status on this PC is '$sigStatus', not Valid" }
        Say "launcher: the committed Kosmos.exe, Authenticode Valid"
      } else { Say "launcher: the committed Kosmos.exe (Authenticode is checked on Windows only)" }
    } finally { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }   # a scanner may hold it a moment
  } finally { $archive.Dispose() }
  Assert-Version 'version' $Version
  $Versioned = "kosmos-$Version-win-$Arch.zip"
  $Sha = Sha256-File $ZipPath
  Say "staging $Versioned ($Sha) from $ZipPath"

  # The versioned name is IMMUTABLE once published (the same promise publish-kosmos-windows.sh
  # keeps): republishing different bytes under it hands two builds one name, which is how 0.6.94
  # staging was served with bytes nobody had announced (2026-09-25). Read from the bucket itself,
  # and keyed on the ZIP, so an earlier run cut off before its sidecar still counts.
  $existing = Get-Object $Versioned
  $putExtra = @{}
  if ($existing) {
    $existingSha = Sha256-Bytes $existing.Bytes
    if ($existingSha -ceq $Sha) { Say "$Versioned is already in the bucket with these bytes; it is uploaded again unchanged" }
    elseif (-not $ReplaceVersioned) { Refuse "$Versioned is already in the bucket with DIFFERENT bytes ($existingSha). Versioned names are immutable: bump the version, or pass -ReplaceVersioned if the published one was never announced." }
    else {
      $prod = Get-Object 'latest-win.json'
      if ($prod) {
        $pf = Read-PointerFields $prod.Bytes
        if (-not $pf) { Refuse "prod's latest-win.json cannot be read, so it cannot be ruled out that prod names $Versioned; -ReplaceVersioned needs to know" }
        if ($pf.versioned -ceq $Versioned) { Refuse "$Versioned is what PROD's latest-win.json names ($existingSha); replacing it would change prod's bytes. Bump the version." }
      }
      Say "NOTICE -ReplaceVersioned: $Versioned changes from $existingSha to $Sha"
    }
  } else {
    # Not there when read, so create it only if it is STILL not there when the PUT lands.
    $putExtra = @{ 'if-none-match' = '*' }
  }

  # Zip, then sidecar, then pointer LAST, so the pointer never names bytes that are not up.
  # A real replace (-ReplaceVersioned, different bytes) is no-cache, and pinned with If-Match to
  # the object read above, so a CONCURRENT STAGING of the same name makes it refuse (R2 honours
  # If-Match on PUT, measured 2026-09-25). A promote does not write the zip, so the pin cannot
  # see one: that race is closed by re-reading prod right after the upload (below). A same-bytes
  # re-run stays cacheable.
  $replacing = [bool]($existing -and (Sha256-Bytes $existing.Bytes) -cne $Sha)
  # A same-bytes re-upload is pinned too: unpinned, it could silently revert a concurrent
  # -ReplaceVersioned of the same name back to these bytes.
  if ($existing -and -not $replacing -and $existing.ETag) {
    $putExtra = @{ 'if-match' = $existing.ETag }
    # A PUT replaces metadata: keep no-cache on a zip that had it (a re-run of an interrupted
    # -ReplaceVersioned must not make the replaced zip cacheable again).
    if ($existing.CacheControl -match 'no-cache') { $putExtra['cache-control'] = 'no-cache' }
  }
  if ($replacing) {
    if (-not $existing.ETag) { Refuse "the bucket gave no ETag for $Versioned, so the replace cannot be pinned to the object just read. Nothing was written." }
    $putExtra = @{ 'cache-control' = 'no-cache'; 'if-match' = $existing.ETag }
  }
  Put-Object $Versioned $null $ZipPath $Sha 'application/zip' $putExtra
  if (-not $DryRun) { $script:AfterNote = " (staging writes had begun: $Versioned is up; latest-win-staging.json still names the previous build unless the run said it was written. Re-run the same command to finish.)" }
  $zipPut = $script:LastPut
  if ($replacing -and -not $DryRun) {
    # A promote of this version may have landed between the prod read above and this upload
    # (prod would now name sha A over zip B, and every updater would refuse). Read prod again:
    # if it names this version, put the previous bytes back and refuse. A promote landing
    # AFTER this read is refused by its own gates (the zip no longer has the approved sha).
    $prodNow = Get-Object 'latest-win.json'
    $pfNow = if ($prodNow) { Read-PointerFields $prodNow.Bytes } else { $null }
    if ($prodNow -and (-not $pfNow -or $pfNow.versioned -ceq $Versioned)) {
      $back = Invoke-R2 -Method PUT -Key "$KeyPrefix$Versioned" -Body $existing.Bytes -PayloadSha (Sha256-Bytes $existing.Bytes) -ContentType 'application/zip' -Extra @{ 'cache-control' = 'no-cache'; 'if-match' = $zipPut.ETag }
      $how = if ($back.Status -eq 200) { "the previous bytes ($existingSha) were put back" } else { "PUTTING THE PREVIOUS BYTES BACK FAILED ($($back.Status)): prod names $Versioned but it now holds $Sha; restore it by hand" }
      $script:AfterNote = ''
      Refuse "prod's latest-win.json named $Versioned while this replace ran (a promote landed in between); $how. The replace did not happen."
    }
  }
  $side = New-SidecarBytes $Sha $Versioned
  Put-Object "$Versioned.sha256" $side $null (Sha256-Bytes $side) 'text/plain; charset=utf-8' $NoCache
  $ptr = New-PointerBytes $Version $Sha $Versioned
  Put-Object 'latest-win-staging.json' $ptr $null (Sha256-Bytes $ptr) 'application/json' $NoCache

  if ($DryRun) { Say "DRY RUN complete: nothing was written."; exit 0 }
  $script:AfterNote = " (latest-win-staging.json WAS written: staging names $Version. Re-run the same command to finish the checks.)"
  Assert-Served $Versioned $Sha
  Assert-Served "$Versioned.sha256" (Sha256-Bytes $side)
  Assert-Served 'latest-win-staging.json' (Sha256-Bytes $ptr)
  $script:AfterNote = ''
  if ($FakeDir) { Say "TEST TRANSPORT, NOTHING PUBLISHED:" }
  Say "STAGED $Version ($Sha). Prod is untouched. Next: verify it on this PC with node tools/win-staging-verify.js (it writes the verification record), then send Josh the version and sha above, and ONLY on his go:"
  # The sha is deliberately NOT filled in: the one to promote is the one in HIS message
  # (promote-channel.sh never prints it for the same reason).
  Say "  pwsh tools/windows/publish-r2.ps1 -Promote -ApprovedVersion <v from his go> -ApprovedSha <sha from his go> -ApprovalRef <his message's Slack ts or permalink>"
  exit 0
}

# ========================================== PROMOTE ============================================
# Promote is a deliberate act: the approval arguments alone must not select it (a mandatory
# switch would make PowerShell PROMPT for it and one keypress would pick the prod path).
if (-not $Promote) { Refuse "-ApprovedVersion/-ApprovedSha/-ApprovalRef are for -Promote; pass -Promote explicitly" }
Assert-Version 'approved version' $ApprovedVersion
Assert-Sha '-ApprovedSha' $ApprovedSha
# A bare Slack ts is exactly 10 digits, a dot and 6 digits. Unquoted at a PowerShell prompt it
# is read as a NUMBER and rounded (1789228393.821399 -> 1789228393.8214); that must refuse,
# not be logged as Josh's go. A permalink is https://.
if (-not ($ApprovalRef -cmatch '^[0-9]{10}\.[0-9]{6}\z' -or $ApprovalRef -cmatch '^https://[A-Za-z0-9._:/?=&%#+-]+\z')) { Refuse "-ApprovalRef '$ApprovalRef' is not a Slack message ts (10 digits . 6 digits) or an https:// permalink. Quote it: -ApprovalRef '<ts or permalink>'. Nothing was written." }
$Cred = Read-Credentials
$Versioned = "kosmos-$ApprovedVersion-win-$Arch.zip"

$staging = Get-Object 'latest-win-staging.json'
if (-not $staging) { Refuse "the bucket has no latest-win-staging.json. Nothing was written." }
$sp = Read-PointerFields $staging.Bytes
if (-not $sp) { Refuse "latest-win-staging.json is not a usable pointer. Re-stage with this script. Nothing was written." }
if ($sp.version -cne $ApprovedVersion -or $sp.sha256 -cne $ApprovedSha) {
  # The staged sha is not printed: the approved one must come from Josh's message, not from here.
  Refuse "the staging pointer names version $($sp.version) and a sha other than the approved $ApprovedVersion ($ApprovedSha), or both differ. Josh's go covers one exact build; check his message. Nothing was written."
}
# Canonical bytes, not just the right fields: latest-win.json becomes these bytes verbatim.
if ((Sha256-Bytes $staging.Bytes) -cne (Sha256-Bytes (New-PointerBytes $ApprovedVersion $ApprovedSha $Versioned))) {
  Refuse "latest-win-staging.json is not in the canonical pointer shape (artifact must be $Alias, versioned $Versioned, arch $Arch, in write-latest-win-pointer.js's byte form). Re-stage with this script. Nothing was written."
}
# The staged bytes themselves, and the sidecar the updater reads first (engine/win32update.js).
$staged = Assert-Object $Versioned $ApprovedSha
[void](Assert-Object "$Versioned.sha256" (Sha256-Bytes (New-SidecarBytes $ApprovedSha $Versioned)))
if (-not $staged.ETag) { Refuse "the bucket gave no ETag for $Versioned, so the copy cannot be pinned to the bytes just checked. Nothing was written." }

# The verification record for this sha on this PC, validated by the one spec the writer uses.
$spec = Join-Path (Split-Path -Parent $PSScriptRoot) 'lib/win-staging-record.js'
# An executable node, not a node.cmd shim (cmd.exe would mangle the script), and the script is
# passed as a file rather than on the command line.
$nodeExe = Get-Command node -CommandType Application -ErrorAction SilentlyContinue | Where-Object { $_.Source -notmatch '\.(cmd|bat)\z' } | Select-Object -First 1
if (-not $nodeExe) { Refuse "node (an executable, not a .cmd shim) is required to validate the verification record. Nothing was written." }
if (-not (Test-Path -LiteralPath $spec)) { Refuse "the record spec $spec is missing. Nothing was written." }
$verdictJs = @'
// Any crash says why on STDOUT (the only stream read), as AMBIGUOUS, so a refusal is never blank.
process.on('uncaughtException', (e) => { console.log('AMBIGUOUS node crashed: ' + (e && e.message)); process.exit(3); });
const [specFile, wantVersion, wantSha] = process.argv.slice(2);   // `node - a b c`: argv[1] is '-'
const spec = require(specFile); const fs = require('node:fs');
const file = spec.recordPath(process.env, wantSha);
let bytes; try { bytes = fs.readFileSync(file); } catch { console.log('HOLD no verification record at ' + file); process.exit(2); }
const sha = require('node:crypto').createHash('sha256').update(bytes).digest('hex');
let record; try { record = JSON.parse(bytes.toString('utf8')); } catch (e) { console.log('AMBIGUOUS unreadable record ' + file); process.exit(3); }
const { problems, verdict } = spec.validateRecord(record, { version: wantVersion, sha256: wantSha });
if (problems.length) { console.log('AMBIGUOUS ' + problems.join('; ')); process.exit(3); }
console.log((verdict === 'pass' ? 'PASS ' : 'FAIL ') + sha + ' ' + file); process.exit(verdict === 'pass' ? 0 : 4);
'@
$prevEnc = [Console]::OutputEncoding
$rc = -1
# The script goes to node on STDIN (`node -`), so there is no temp file another process could swap.
# Both directions UTF-8: $OutputEncoding is what PowerShell writes to node's STDIN (5.1
# defaults it to a legacy code page), [Console]::OutputEncoding what it reads back.
$prevPipeEnc = $OutputEncoding
try { [Console]::OutputEncoding = $Utf8; $OutputEncoding = $Utf8; $verdict = ($verdictJs | & $nodeExe.Source - $spec $ApprovedVersion $ApprovedSha) -join ' '; $rc = $LASTEXITCODE }
finally { [Console]::OutputEncoding = $prevEnc; $OutputEncoding = $prevPipeEnc }
if ($rc -ne 0) { Refuse "the verification record does not pass ($verdict). Verify the staged build on this PC first (node tools/win-staging-verify.js). Nothing was written." }
$recordSha = ($verdict -split ' ')[1]; $recordPath = ($verdict -split ' ', 3)[2]
Say "verification record: $verdict"

# The staging pointer must not have moved while the checks ran (promote-channel.sh's snapshot
# rule): Josh's go and the record cover the build it named at the start.
$again = Get-Object 'latest-win-staging.json'
if (-not $again -or (Sha256-Bytes $again.Bytes) -cne (Sha256-Bytes $staging.Bytes)) { Refuse "latest-win-staging.json changed while the promote was checking it. Nothing was written; start the promote again." }

# Josh's go is logged BEFORE any write; a go that is not logged is not given. bucket= and
# prefix= tell a real promote from a self-test in the one log.
$Where = "bucket=$Bucket prefix=$(if ($KeyPrefix) { $KeyPrefix } else { '-' })$(if ($FakeDir) { ' transport=test' })"
Write-ApprovalLine "$(Stamp) family=win path=promote-r2 version=$ApprovedVersion sha256=$ApprovedSha approval_ref=$ApprovalRef record_sha256=$recordSha approval=given $Where record=$recordPath"   # record= LAST: the path may hold spaces (promote-channel.sh does the same)

# What prod is BEFORE this promote writes anything, so a promote that finds itself raced can
# put it back: the pointer, and the alias sidecar (the alias zip is restored from the previous
# pointer's versioned zip).
$prodBefore = Get-Object 'latest-win.json'
$aliasSideBefore = Get-Object "$Alias.sha256"
function Test-StagedIntact {
  $z = Get-Object $Versioned; $zs = Get-Object "$Versioned.sha256"
  return [bool]($z -and $zs -and (Sha256-Bytes $z.Bytes) -ceq $ApprovedSha -and (Sha256-Bytes $zs.Bytes) -ceq (Sha256-Bytes (New-SidecarBytes $ApprovedSha $Versioned)))
}
# Undo this promote's prod writes (a -ReplaceVersioned changed the versioned zip under it).
function Undo-Promote([string] $pointerEtag) {
  $done = @()
  # latest-win.json is put back only if THIS run wrote it (an empty ETag means it did not).
  if (-not $pointerEtag) { }
  elseif ($prodBefore) {
    $r = Invoke-R2 -Method PUT -Key "${KeyPrefix}latest-win.json" -Body $prodBefore.Bytes -PayloadSha (Sha256-Bytes $prodBefore.Bytes) -ContentType 'application/json' -Extra @{ 'cache-control' = 'no-cache'; 'if-match' = $pointerEtag }
    $done += $(if ($r.Status -eq 200) { 'latest-win.json put back' } else { "PUTTING latest-win.json BACK FAILED ($($r.Status))" })
    $pf = Read-PointerFields $prodBefore.Bytes
    if ($pf) {
      $c = Invoke-R2 -Method PUT -Key "$KeyPrefix$Alias" -ContentType 'application/zip' -Extra @{ 'x-amz-copy-source' = "/$Bucket/$KeyPrefix$($pf.versioned)"; 'x-amz-metadata-directive' = 'REPLACE'; 'cache-control' = 'no-cache' }
      $done += $(if ($c.Status -eq 200 -and $c.Body -cnotmatch '<Error>') { "the alias restored from $($pf.versioned)" } else { "RESTORING THE ALIAS FAILED ($($c.Status))" })
    }
  } else { $done += 'there was no previous latest-win.json to put back' }
  if (-not $pointerEtag -and $prodBefore) {
    $pf = Read-PointerFields $prodBefore.Bytes
    if ($pf) {
      $c = Invoke-R2 -Method PUT -Key "$KeyPrefix$Alias" -ContentType 'application/zip' -Extra @{ 'x-amz-copy-source' = "/$Bucket/$KeyPrefix$($pf.versioned)"; 'x-amz-metadata-directive' = 'REPLACE'; 'cache-control' = 'no-cache' }
      $done += $(if ($c.Status -eq 200 -and $c.Body -cnotmatch '<Error>') { "the alias restored from $($pf.versioned)" } else { "RESTORING THE ALIAS FAILED ($($c.Status))" })
    }
  }
  if ($aliasSideBefore) {
    $r2 = Invoke-R2 -Method PUT -Key "$KeyPrefix$Alias.sha256" -Body $aliasSideBefore.Bytes -PayloadSha (Sha256-Bytes $aliasSideBefore.Bytes) -ContentType 'text/plain; charset=utf-8' -Extra @{ 'cache-control' = 'no-cache' }
    $done += $(if ($r2.Status -eq 200) { 'the alias sidecar put back' } else { "PUTTING THE ALIAS SIDECAR BACK FAILED ($($r2.Status))" })
  }
  $done -join '; '
}

# The alias (a copy pinned to the exact object checked above) and its sidecar, both read back from
# the bucket BEFORE prod's pointer moves; then latest-win.json LAST, the staging bytes verbatim.
# From the first prod-facing write on, a failure says what may already have changed.
# (The partial-state note is set once the first prod-facing write has succeeded, below.)
# For a moment the alias holds the new zip while its sidecar still names the old one. The
# updater never sees that (its alias fallback pins the sha from latest-win.json, written LAST),
# but the website's download button fetches the alias directly: a run that dies between these
# two writes leaves web downloads on the new zip with a stale sidecar. Re-run to finish.
Copy-Object $Versioned $Alias $staged.ETag
if (-not $DryRun) { $script:AfterNote = " (prod-facing writes had begun: the alias, its sidecar or latest-win.json may already have changed. Re-run the same -Promote command to finish; it re-checks everything first.)" }
$aliasSide = New-SidecarBytes $ApprovedSha $Alias
Put-Object "$Alias.sha256" $aliasSide $null (Sha256-Bytes $aliasSide) 'text/plain; charset=utf-8' $NoCache
if (-not $DryRun) {
  [void](Assert-Object $Alias $ApprovedSha)
  [void](Assert-Object "$Alias.sha256" (Sha256-Bytes $aliasSide))
  # A -ReplaceVersioned may have landed since the checks: never let the pointer name it.
  if (-not (Test-StagedIntact)) { $how = Undo-Promote ''; $script:AfterNote = ''; Refuse "$Versioned or its sidecar changed while this promote ran (a -ReplaceVersioned landed); latest-win.json was NOT written; $how." }
}
Put-Object 'latest-win.json' $staging.Bytes $null (Sha256-Bytes $staging.Bytes) 'application/json' $NoCache
if ($DryRun) { Say "DRY RUN complete: nothing was written."; exit 0 }
$pointerPut = $script:LastPut
$script:AfterNote = " (latest-win.json was written: prod points at $ApprovedVersion. To finish the checks, re-run the full -Promote (it refuses if staging has moved since), or compare the served files with the approved sha.)"
# The versioned zip and its sidecar again, AFTER the pointer names them. Each side of a race
# writes its key and then reads the other's (the replace re-reads prod after its upload), so at
# least one of them sees the other: if this one does, it puts prod back.
if (-not (Test-StagedIntact)) {
  $how = Undo-Promote $pointerPut.ETag
  $script:AfterNote = ''
  Refuse "$Versioned or its sidecar changed right after latest-win.json named it (a -ReplaceVersioned landed); $how. Prod was not left naming bytes it does not hold."
}
Assert-Served $Alias $ApprovedSha
Assert-Served "$Alias.sha256" (Sha256-Bytes $aliasSide)
Assert-Served 'latest-win.json' (Sha256-Bytes $staging.Bytes)
Assert-Served $Versioned $ApprovedSha
Assert-Served "$Versioned.sha256" (Sha256-Bytes (New-SidecarBytes $ApprovedSha $Versioned))
Write-ApprovalLine "$(Stamp) family=win path=promote-r2 version=$ApprovedVersion sha256=$ApprovedSha approval_ref=$ApprovalRef promoted=yes $Where" -Outcome
if ($FakeDir) { Say "TEST TRANSPORT, NOTHING PUBLISHED:" }
Say "PROMOTED $ApprovedVersion ($ApprovedSha) to prod; the bucket and the served bytes both verified."
exit 0
