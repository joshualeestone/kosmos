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
    kosmos-<v>-win-x64.zip, its .sha256 sidecar, its SIGNED release manifest
    (kosmos-<v>-win-x64.manifest.json and .sig, #6466, read from beside the zip), the one-line
    installer this tree carries (tools/windows/setup.ps1, exactly as committed) as setup-<v>.ps1 and its
    .sha256 (kosmos#7883), then latest-win-staging.json LAST (the pointer is the go-live, so it never names bytes that are not
    already up). Prod readers are untouched. A build whose updater checks signed manifests (its
    app/engine/win32update.js carries the capability line) is refused without a manifest that
    verifies under the pinned release key and matches the zip file for file, and the manifest and
    its .sig must be SERVED through installkosmos.com before the pointer moves: installs of that
    build fetch them from there and refuse an update without them.

    pwsh tools/windows/publish-r2.ps1 -Zip .\dist\kosmos-win-x64.zip

  For signing (-ForSigning, #6466). The release key stays on a fleet Mac, and its holder signs the
  manifest of a build that is already up. So, before the stage: the same checks on the zip, then
  ONLY kosmos-<v>-win-x64.zip, its .sha256 and the UNSIGNED manifest (checked against the zip,
  file for file) are uploaded and read back. latest-win-staging.json, latest-win.json and the
  alias are never touched. It prints the version and the manifest's sha256 to send the key
  holder, who uploads kosmos-<v>-win-x64.manifest.json.sig beside it (or sends the file: pass it
  to the stage with -Sig <path>). The stage then takes the .sig from -Sig, from beside the zip,
  or from the bucket, in that order.

    pwsh tools/windows/publish-r2.ps1 -Zip .\dist\kosmos-win-x64.zip -ForSigning

  Promote (prod, ONLY on Josh's go). Moves prod onto the staged build, the R2 twin of
  promote-channel.sh --family win. It refuses unless ALL of these hold, checked case-sensitively:
    - the staging pointer names exactly -ApprovedVersion and -ApprovedSha, in the one canonical
      pointer shape, and the staged zip and its sidecar hold exactly those bytes;
    - -ApprovalRef is a Slack ts or permalink of Josh's message, and is logged before any write;
    - this PC holds a passing verification record for that sha (tools/win-staging-verify.js
      writes it; tools/lib/win-staging-record.js validates it, through node);
    - #6466: the staged version's signed manifest in the bucket verifies against the staged zip, or,
      when it has none, prod's current build has none either (so prod's installs do not check one).
  Then: the alias kosmos-win-x64.zip becomes a server-side copy of the staged zip (pinned to the
  exact object just verified), its sidecar is rewritten to name the alias, both are read back, and
  only then latest-win.json becomes the staging pointer's bytes verbatim, LAST (of the release).
  kosmos#7883: after it, the build's staged setup-<v>.ps1 becomes setup.ps1 (and its .sha256), the script
  installkosmos.com/setup.ps1 serves, so the installer moves with the Windows promote. A build staged
  without one leaves setup.ps1 as it is. Both modes read the installer from git at the commit the zip records
  (manifest.json source_sha), so the checkout they run from must contain that commit (git fetch origin).
  kosmos#7890: a zip that records no commit has its staged installer compared with this tree's HEAD at -Promote
  (defence in depth: such a zip already fails the verification record's manifest check, so a real release never gets here);
  one that is not HEAD's (or a HEAD git cannot read) is refused, as a missing commit is. Josh's approval line says
  where the installer was checked: setup_source=commit, head (with setup_head=<the commit>), or none (with setup_left=,
  the setup.ps1 left live).

    pwsh tools/windows/publish-r2.ps1 -Promote -ApprovedVersion 0.6.94 -ApprovedSha <sha> -ApprovalRef <ref>

  -DryRun on either mode does every read and check and prints what it would write, writing nothing.
  -NodeTimeoutSec <n> gives each node check and each git read n seconds, up to 600 (default 300). One past that refuses as undecided.
  node (for the signed-manifest and verification-record checks): a real node.exe on PATH; else the installed Kosmos
  app's own, %LOCALAPPDATA%\Programs\Kosmos\runtime\node.exe (kosmos#8285), said on stderr when used. That node came
  with an earlier Kosmos release, so the build is then checked by a binary from the same channel it is checking: to
  check with an independent node, put one on PATH (it always wins).

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
  # #6466: upload the zip, its sidecar and the unsigned manifest for the key holder to sign; no pointer moves.
  [Parameter(ParameterSetName = 'Staging')] [switch] $ForSigning,
  # #6466: the manifest's .sig as a file the key holder sent (else beside the zip, else the one in the bucket).
  [Parameter(ParameterSetName = 'Staging')] [string] $Sig,

  [Parameter(ParameterSetName = 'Promote')] [switch] $Promote,
  [Parameter(ParameterSetName = 'Promote', Mandatory = $true)] [string] $ApprovedVersion,
  [Parameter(ParameterSetName = 'Promote', Mandatory = $true)] [string] $ApprovedSha,
  [Parameter(ParameterSetName = 'Promote', Mandatory = $true)] [string] $ApprovalRef,

  [string] $Bucket = 'kosmos-dist-win',
  [string] $CredentialFile = $(if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA 'Kosmos\release-secrets\r2-dist-win.env' } else { '' }),
  # Where users are served from; read only to confirm a write reached them.
  [string] $ServedBase = 'https://installkosmos.com/dist',
  # The bucket's own public address (what installkosmos.com/dist redirects to). Read for names the site does not
  # redirect yet: -ForSigning's manifest (#6466), and the installer script staging and -Promote write (#7883). Names under it carry -KeyPrefix.
  [string] $BucketBase = 'https://dl.chaoskosmos.com',
  # For tests only: write every key under this prefix (e.g. "_selftest/abc/"). A non-default
  # -ServedBase is refused without it, so no stand-in server can speak for prod. -ServedBase
  # must then ALREADY END IN the prefix (the bucket's public URL + "/_selftest/abc"): names are
  # appended to it as they are, so the served checks read the prefixed objects.
  [string] $KeyPrefix = '',
  # #7951: seconds one node check may take.
  [ValidateRange(1, 600)] [int] $NodeTimeoutSec = 300,
  # Removes a publish.lock left by a run that died (it says whose and when), then proceeds.
  # Only when no other run of this script is active.
  [switch] $BreakLock,
  [switch] $DryRun
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
Add-Type -AssemblyName System.Net.Http
Add-Type -AssemblyName System.IO.Compression   # kosmos#7883: ZipArchive over a byte stream (5.1 does not load it with FileSystem)
Add-Type -AssemblyName System.IO.Compression.FileSystem
# kosmos#7883: the one-line installer's name, in one place. Kept as data: this script reads and uploads it, never runs it.
$SetupName = 'setup.ps1'
$SetupExt = '.ps1'
$Invariant = [Globalization.CultureInfo]::InvariantCulture

# Anything that goes wrong after latest-win.json is written must say so (set just before it).
$script:AfterNote = ''
function Say([string] $m) { [Console]::Out.WriteLine("publish-r2: $m") }
# Anything unexpected still ends in the same clear shape, with the partial-state note.
$script:LockHead = ''
$script:LockEtag = ''   # set while this run holds publish.lock (see Lock-Publish; non-empty only
                        # after that function is defined, so an early refusal never calls it)
trap { [Console]::Error.WriteLine("publish-r2: UNEXPECTED - $($_.Exception.Message)$script:AfterNote"); if ($script:LockEtag) { Unlock-Publish }; exit 1 }
function Refuse([string] $m) { [Console]::Error.WriteLine("publish-r2: REFUSING - $m$script:AfterNote"); if ($script:LockEtag) { Unlock-Publish }; exit 1 }

# ---------- names -------------------------------------------------------------------------------
# All comparisons below are CASE-SENSITIVE (-c...), because R2 keys are: PowerShell's plain -eq
# would let X64 pass as x64 and then write a key nobody reads. \z, not $, so a trailing newline
# cannot slip through.
$Arch = 'x64'
$Alias = "kosmos-win-$Arch.zip"
function Assert-Version([string] $what, [string] $v) {
  if ($v -cnotmatch '^[0-9]+\.[0-9]+\.[0-9]+\z') { Refuse "an implausible $what '$v' (x.y.z, what the updater accepts)" }
  # From the 0.6 line on the patch is exactly two digits (Josh, 2026-08-28), the same guard as
  # tools/release.sh. engine/update.js reads a version as three NUMBERS, so 0.7.0 and 0.7.00 are one
  # version to every install: publishing the other spelling is an update no machine ever sees.
  $p = $v.Split('.')
  if ($p[0] -ceq '0' -and [int]$p[1] -ge 6) {
    if ($p[2].Length -eq 1) { Refuse "$what '$v': from the 0.$($p[1]) line on the patch is two digits, so this is spelled 0.$($p[1]).0$($p[2]) (the same version to every install; only one spelling may be published)" }
    if ($p[2].Length -gt 2) { Refuse "$what '$v' is past the end of the 0.$($p[1]) line: 0.$($p[1]).99 is the last one, then 0.$([int]$p[1] + 1).00" }
  }
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
$ServedBase = $ServedBase.TrimEnd('/')   # a trailing slash names the same place
if ($ServedBase -cne 'https://installkosmos.com/dist' -and -not $KeyPrefix) { Refuse "-ServedBase is for tests and needs -KeyPrefix; users are served from https://installkosmos.com/dist" }
if ($KeyPrefix -and $ServedBase -match '^https?://([a-z0-9-]+\.)*installkosmos\.com(/|:|$)' -and -not $FakeDir) { Refuse "-KeyPrefix needs a -ServedBase that serves that prefix; otherwise the checks after writing would read prod's objects" }
# The served base must END in the prefix it serves (iteration 24), or the checks after writing
# read un-prefixed objects and can pass on bytes this run never wrote.
if ($KeyPrefix -and -not $FakeDir -and -not ($ServedBase -clike "*/$($KeyPrefix.TrimEnd('/'))")) { Refuse "-ServedBase $ServedBase must end in the -KeyPrefix it serves ($($KeyPrefix.TrimEnd('/')))" }

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

# kosmos#7883: the commit a Windows zip was built from (its root manifest.json, tools/build-kosmos-windows.sh), or ''
# when it records none. Takes the zip's bytes, so staging (a file) and -Promote (the staged object) read it the same way.
function Get-ZipSourceSha([byte[]] $ZipBytes) {
  $zs = New-Object IO.MemoryStream (, $ZipBytes)
  try {
    $za = New-Object IO.Compression.ZipArchive ($zs, [IO.Compression.ZipArchiveMode]::Read)
    try {
      $me = $za.GetEntry('manifest.json'); if (-not $me) { return '' }
      $mr = New-Object IO.StreamReader ($me.Open())
      try { $bm = $mr.ReadToEnd() | ConvertFrom-Json } catch { return '' } finally { $mr.Dispose() }
      if ($bm -and ($bm.PSObject.Properties.Name -ccontains 'source_sha') -and ([string]$bm.source_sha -cmatch '^[0-9a-f]{40}\z')) { return [string]$bm.source_sha }
      return ''
    } finally { $za.Dispose() }
  } finally { $zs.Dispose() }
}
# kosmos#7890: whether the zip says it was built from a tree with uncommitted changes (manifest.json source_dirty), so
# staging can say the build is not exactly the commit it names. $false when the zip says nothing.
function Get-ZipSourceDirty([byte[]] $ZipBytes) {
  $zs = New-Object IO.MemoryStream (, $ZipBytes)
  try {
    $za = New-Object IO.Compression.ZipArchive ($zs, [IO.Compression.ZipArchiveMode]::Read)
    try {
      $me = $za.GetEntry('manifest.json'); if (-not $me) { return $false }
      $mr = New-Object IO.StreamReader ($me.Open())
      try { $bm = $mr.ReadToEnd() | ConvertFrom-Json } catch { return $false } finally { $mr.Dispose() }
      return [bool]($bm -and ($bm.PSObject.Properties.Name -ccontains 'source_dirty') -and $bm.source_dirty -eq $true)
    } finally { $za.Dispose() }
  } finally { $zs.Dispose() }
}
# kosmos#7890: git's object id for these exact bytes as a blob (sha1 of "blob <len>", a NUL, then the bytes), so what is
# compared with HEAD's blob is what is staged, not a second read of the file.
# Assumes git's default SHA-1 object format; a sha256 repository's 64-hex blob id would not match, and is refused.
function Get-GitBlobSha([byte[]] $Bytes) {
  $head = [Text.Encoding]::ASCII.GetBytes("blob $($Bytes.Length)" + [char]0)
  $all = New-Object byte[] ($head.Length + $Bytes.Length)
  [Array]::Copy($head, $all, $head.Length); [Array]::Copy($Bytes, 0, $all, $head.Length, $Bytes.Length)
  $h = [Security.Cryptography.SHA1]::Create()
  try { return (($h.ComputeHash($all) | ForEach-Object { $_.ToString('x2') }) -join '') } finally { $h.Dispose() }
}
# The installer at a commit, as git stores it: raw bytes through a process stream (PowerShell's pipeline would decode
# and re-encode them). Returns @{ Bytes; Error }: Bytes is $null when git cannot read it, and Error says why.
function Get-SetupAtCommit([string] $Commit) {
  $g = Get-Command git -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $g) { return @{ Bytes = $null; Error = 'git is not installed'; Stopped = $false } }
  # #7959: under the same limit as node. A promote runs this holding publish.lock, so a git that hangs would hold it too.
  $r = Invoke-ChildBounded $g.Source @('-C', $PSScriptRoot.TrimEnd([char]92, [char]47), 'cat-file', 'blob', ($Commit + ':tools/windows/' + $SetupName)) -Raw -HoldStderr
  if ($r.Undecided) { return @{ Bytes = $null; Error = "git: $($r.Undecided)"; Stopped = $true } }
  if ($r.Rc -ne 0) { return @{ Bytes = $null; Error = $r.Err.Trim(); Stopped = $false } }
  @{ Bytes = $r.Bytes; Error = ''; Stopped = $false }
}
# #7959: the first word of git's output (the callers read one hex id), '' on any failure, under the same limit. A git that
# was stopped says so here, since '' alone reads as "git cannot say"; the refusals that follow also name it as a cause.
function Get-GitLine([string[]] $GitArgs) {
  $g = Get-Command git -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $g) { return '' }
  $r = Invoke-ChildBounded $g.Source (@('-C', $PSScriptRoot.TrimEnd([char]92, [char]47)) + $GitArgs) -HoldStderr
  if ($r.Undecided) { [Console]::Error.WriteLine("publish-r2: git: $($r.Undecided)"); return '' }
  if ($r.Rc -ne 0 -or -not $r.Out) { return '' }
  (($r.Out -split ' ')[0]).Trim()
}
# An executable node, not a node.cmd shim (cmd.exe would mangle the script's arguments). PATH's comes first, so a node
# put there on purpose always wins. kosmos#8285: when PATH has none, the installed Kosmos app's own runtime\node.exe,
# so a release PC with Kosmos on it needs no separate node. Only the app's copy, put there by its installer: not the
# board runtime's copy under %LOCALAPPDATA%\Kosmos\runtime, which the running Kosmos writes and its agents can too
# (challenge-loop iteration 2). Either way that node came through the Kosmos release channel this script checks; the
# help says so, and how to check with an independent one. Said on stderr (once per run), so the run's log shows which
# binary checked the build. A file there that is not a working node is still "found": its check then reaches no
# answer and the run refuses as undecided, so it fails safe. Returns an object with .Source, or $null.
$KosmosRuntimeNodes = @('Programs\Kosmos\runtime\node.exe')
$script:SaidRuntimeNode = $false   # declared for StrictMode, as the script's other run-wide flags
function Get-NodeExe {
  $onPath = Get-Command node -CommandType Application -ErrorAction SilentlyContinue | Where-Object { $_.Source -notmatch '\.(cmd|bat)\z' } | Select-Object -First 1
  if ($onPath) { return $onPath }
  if (-not $env:LOCALAPPDATA) { return $null }
  foreach ($rel in $KosmosRuntimeNodes) {
    $p = Join-Path $env:LOCALAPPDATA $rel
    if (Test-Path -LiteralPath $p -PathType Leaf) {
      if (-not $script:SaidRuntimeNode) {
        [Console]::Error.WriteLine("publish-r2: no node executable on PATH (a .cmd shim does not count); using the installed Kosmos app's own: $p")
        $script:SaidRuntimeNode = $true   # once per run: a run checks with node two or three times
      }
      return [pscustomobject]@{ Source = $p }
    }
  }
  $null
}
# The words for a refusal when Get-NodeExe found none: where it looked, so the fix is plain.
$NoNodeWhere = if ($env:LOCALAPPDATA) { "none on PATH, and no installed Kosmos app's node under %LOCALAPPDATA% ($($KosmosRuntimeNodes -join ', '))" } else { 'none on PATH (and no %LOCALAPPDATA% here to look for the Kosmos app''s node in)' }
# One argument as a Windows command line needs it (.NET parses the same rules elsewhere): 5.1 has no ArgumentList.
function ConvertTo-NativeArg([string] $a) {
  if ($a -and $a -notmatch '[\s"]') { return $a }
  '"' + (($a -replace '(\\*)"', '$1$1\"') -replace '(\\+)\z', '$1$1') + '"'
}
# #7951: runs a child (node, and git since #7959) with its own stdin (StdinText, then closed) and a time limit covering the
# stdin write too. `& node` inherits this process's stdin: launched from Git Bash, a node had printed its verdict and never
# exited, and a prod promote sat holding publish.lock for 10 minutes. Returns @{ Rc; Out; Bytes; Err; Undecided }. Out is its
# STDOUT lines joined by spaces. -Raw: STDOUT's exact bytes in Bytes instead, since decoding would change them (Out is ''),
# and Bytes is $null otherwise. -HoldStderr: its STDERR comes back in Err rather than to this script's own. Undecided is ''
# for a run that reached an answer, otherwise why it did not (Rc is then 97, 98 or 99).
function Invoke-ChildBounded([string] $Exe, [string[]] $Arguments, [string] $StdinText = '', [switch] $Raw, [switch] $HoldStderr) {
  $psi = New-Object Diagnostics.ProcessStartInfo
  $psi.FileName = $Exe
  $psi.Arguments = @($Arguments | ForEach-Object { ConvertTo-NativeArg $_ }) -join ' '
  # A .NET process starts in the .NET current directory, which does not follow Set-Location; `&` used the location.
  $psi.WorkingDirectory = (Get-Location -PSProvider FileSystem).ProviderPath
  $psi.UseShellExecute = $false; $psi.CreateNoWindow = $true
  $psi.RedirectStandardInput = $true; $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true
  $psi.StandardOutputEncoding = $Utf8; $psi.StandardErrorEncoding = $Utf8
  $p = New-Object Diagnostics.Process
  $p.StartInfo = $psi
  try { [void] $p.Start() } catch { $p.Dispose(); return @{ Rc = 99; Out = ''; Bytes = $null; Err = ''; Undecided = "it did not start: $($_.Exception.Message)" } }
  try {
    $ms = $null
    if ($Raw) { $ms = New-Object IO.MemoryStream; $outTask = $p.StandardOutput.BaseStream.CopyToAsync($ms) } else { $outTask = $p.StandardOutput.ReadToEndAsync() }
    $errTask = $p.StandardError.ReadToEndAsync()
    $limit = $NodeTimeoutSec
    $clock = [Diagnostics.Stopwatch]::StartNew()
    $left = { [Math]::Max(0, ($limit * 1000) - [int] $clock.ElapsedMilliseconds) }
    # Short waits, not one long one: PowerShell cannot act on Ctrl+C during a blocking .NET call.
    $waitFor = { param($until) while (-not (& $until 250)) { if ((& $left) -le 0) { return $false } }; $true }
    # Bytes on the base stream: 5.1 has no StandardInputEncoding. A node that exits without reading it throws here, and
    # its exit is still waited for below.
    $written = $true
    try {
      $in = $Utf8.GetBytes($StdinText)
      if ($in.Length) { $w = $p.StandardInput.BaseStream.WriteAsync($in, 0, $in.Length); $written = & $waitFor { param($ms) $w.Wait($ms) } }
      if ($written) { $p.StandardInput.Close() }
    } catch { }
    $undecided = ''
    if ($written -and (& $waitFor { param($ms) $p.WaitForExit($ms) })) { $rc = $p.ExitCode } else {
      try { $p.Kill() } catch { }
      [void] $p.WaitForExit(5000)
      $rc = 98; $undecided = "it did not finish within $limit seconds and was stopped"
    }
    # Bounded: something node started can hold the pipe open after node has gone.
    $text = ''; $whole = $false
    try { if ($outTask.Wait(5000)) { if (-not $Raw) { $text = $outTask.Result }; $whole = $true } } catch { }
    if (-not $whole -and -not $undecided) { $rc = 97; $undecided = 'it exited, but its output never closed, so its verdict was not read' }
    $errText = ''
    try { if ($errTask.Wait(1000)) { $errText = [string] $errTask.Result } } catch { }
    if ($errText -and -not $HoldStderr) { [Console]::Error.Write($errText) }
    $bytes = $null
    # Only a run that finished and exited 0: bytes from a stopped or failed read must never be taken for the file.
    if ($Raw -and $whole -and -not $undecided -and $rc -eq 0) { $bytes = $ms.ToArray() }
    if ($ms) { $ms.Dispose() }
    @{ Rc = $rc; Out = (@($text -split '\r?\n' | Where-Object { $_ -ne '' }) -join ' '); Bytes = $bytes; Err = $errText; Undecided = $undecided }
  } finally {
    # Reached with node still running only when the wait was interrupted (Ctrl+C).
    try { if (-not $p.HasExited) { $p.Kill() } } catch { }
    $p.Dispose()
  }
}
# #6466: tools/lib/win-release-manifest.js, run with node. It prints its one-line verdict on STDOUT; returns @{ Rc; Out }.
# #7951: a check that reached no answer decided nothing about the build, whatever it printed, so it refuses here rather
# than reading as a verdict at each caller. Every caller is before the run's first write.
function Invoke-WinManifest([string[]] $Arguments) {
  $node = Get-NodeExe
  if (-not $node) { Refuse "node (an executable, not a .cmd shim) is required to check the signed release manifest (#6466): $NoNodeWhere. Nothing was written." }
  $js = Join-Path (Split-Path -Parent $PSScriptRoot) 'lib/win-release-manifest.js'
  $r = Invoke-ChildBounded $node.Source (@($js) + $Arguments)
  if ($r.Undecided) { Refuse "the manifest check ($($Arguments[0])) decided nothing about this build: $($r.Undecided)$(if ($r.Out) { " (it had printed: $($r.Out))" }). Run it again. Nothing was written." }
  @{ Rc = $r.Rc; Out = $r.Out }
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
        [string] $PayloadSha = $null, [string] $ContentType = $null, [hashtable] $Extra = @{}, [switch] $Soft)
  # -Soft: a network error comes back as Status -1 instead of exiting, for the undo path, which
  # must attempt every step and report each one rather than die after the first.
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
    if ($Soft) { return [pscustomobject]@{ Status = -1; CacheControl = ''; Bytes = [byte[]]@(); Body = $why; ETag = '' } }
    if ($Method -ceq 'GET') { Refuse $why }
    Refuse "$why. This write and earlier ones may have landed: re-run with -DryRun to see the bucket's state before re-running for real."
  } finally { if ($stream) { $stream.Dispose() }; $req.Dispose() }
}

# The test stand-in: a directory with S3's semantics for the four requests this script makes.
# Test seams, each one environment variable (all under the test transport only). There are five:
#   KOSMOS_PUBLISH_R2_FAKE_GET_STATUS=<key suffix>:<status>   a GET of that key answers <status>
#   KOSMOS_PUBLISH_R2_FAKE_AFTER=<METHOD> <key suffix>|<key>|<file>
#     EVERY time a matching request is answered (not only the first), <key> is overwritten with
#     <file>'s bytes (a concurrent writer landing between two of this script's steps). Several
#     entries may be given, one per line; each is applied in order.
#   KOSMOS_PUBLISH_R2_FAKE_FAIL=<key suffix>        every write (PUT, COPY, DELETE) to it answers 500
#   KOSMOS_PUBLISH_R2_FAKE_NO_ETAG=<key suffix>     a GET of it answers with no ETag
#   KOSMOS_PUBLISH_R2_FAKE_RESTAGE_BEFORE_COPY=<file>   the copy's SOURCE becomes <file> first
function Invoke-FakeR2([string] $Method, [string] $Key, [byte[]] $Body, [string] $BodyFile, [hashtable] $Extra, [string] $PayloadSha) {
  $gs = [Environment]::GetEnvironmentVariable('KOSMOS_PUBLISH_R2_FAKE_GET_STATUS')
  if ($Method -ceq 'GET' -and $gs -and $Key.EndsWith($gs.Split(':')[0])) {
    [IO.File]::AppendAllText((Join-Path $FakeDir '.calls'), "GET $Key | status=$($gs.Split(':')[1])`n", $Utf8)
    return [pscustomobject]@{ Status = [int]$gs.Split(':')[1]; Bytes = [byte[]]@(); Body = 'injected'; ETag = '' }
  }
  $r = Invoke-FakeR2Core $Method $Key $Body $BodyFile $Extra $PayloadSha
  $after = [Environment]::GetEnvironmentVariable('KOSMOS_PUBLISH_R2_FAKE_AFTER')
  if ($after) {
    foreach ($entry in ($after -split "`n")) {
      if (-not $entry) { continue }
      $parts = $entry.Split('|'); $trig = $parts[0].Split(' ')
      if ($Method -ceq $trig[0] -and $Key.EndsWith($trig[1])) { [IO.File]::Copy($parts[2], (Join-Path $FakeDir $parts[1]), $true) }
    }
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
  if ($Method -ceq 'GET' -or $Method -ceq 'HEAD') {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return [pscustomobject]@{ Status = 404; Bytes = [byte[]]@(); Body = ''; ETag = '' } }
    $b = [IO.File]::ReadAllBytes($path)
    $cc = if (Test-Path -LiteralPath "$path.cc") { [IO.File]::ReadAllText("$path.cc") } else { '' }
    $noEtag = [Environment]::GetEnvironmentVariable('KOSMOS_PUBLISH_R2_FAKE_NO_ETAG')
    $et = if ($noEtag -and $Key.EndsWith($noEtag)) { '' } else { (& $tag $path) }
    if ($Method -ceq 'HEAD') { $b = [byte[]]@() }
    return [pscustomobject]@{ Status = 200; CacheControl = $cc; Bytes = $b; Body = $Utf8.GetString($b); ETag = $et }
  }
  $fail = [Environment]::GetEnvironmentVariable('KOSMOS_PUBLISH_R2_FAKE_FAIL')
  if ($fail -and $Key.EndsWith($fail)) { return [pscustomobject]@{ Status = 500; Bytes = [byte[]]@(); Body = 'injected failure'; ETag = '' } }
  # Like R2 (measured 2026-09-25): a DELETE ignores If-Match, and so does a COPY's destination.
  if ($Method -ceq 'DELETE') {
    Remove-Item -LiteralPath $path, "$path.cc" -Force -ErrorAction SilentlyContinue
    return [pscustomobject]@{ Status = 204; Bytes = [byte[]]@(); Body = ''; ETag = '' }
  }
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
# Cache-Control: no-cache, so no cache between R2 and a user can keep serving the old bytes. So
# does every versioned SIDECAR, always: a -ReplaceVersioned rewrites it, and it is a few bytes.
$NoCache = @{ 'cache-control' = 'no-cache' }
$script:LastPut = $null   # set by Put-Object; initialised for StrictMode (a dry run sets nothing)
function Put-Object([string] $Name, [byte[]] $Body, [string] $File, [string] $Sha, [string] $Type, [hashtable] $Extra = @{}) {
  $key = "$KeyPrefix$Name"
  if ($DryRun) { Say "DRY RUN: would PUT $key ($Type, sha256 $Sha)"; return }
  Touch-Lock
  $r = Invoke-R2 -Method PUT -Key $key -Body $Body -BodyFile $File -PayloadSha $Sha -ContentType $Type -Extra $Extra
  if ($r.Status -ne 200) { Refuse "PUT $key answered $($r.Status): $($r.Body)" }
  Say "wrote $key"
  $script:LastPut = $r   # the response (its ETag), without emitting it into the output stream
}
function Copy-Object([string] $FromName, [string] $ToName, [string] $IfMatch) {
  $from = "$KeyPrefix$FromName"; $to = "$KeyPrefix$ToName"
  if ($DryRun) { Say "DRY RUN: would COPY $from -> $to (server side, only if it is still $IfMatch)"; return }
  Touch-Lock
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

# ---------- one run at a time ---------------------------------------------------------------------
# Every write run (a stage, a replace, a promote) holds publish.lock, created with If-None-Match
# (honoured by R2, measured) before the first read it decides on, and removed on every exit.
# The races the rest of this script detects and undoes were all between two runs of it; the
# lock makes those impossible unless it is broken by hand. The detection stays, as a second
# line. A lock left by a run that died is removed only with -BreakLock, which says whose it was.
function Lock-Publish([string] $Mode) {
  $key = "${KeyPrefix}publish.lock"
  if ($DryRun) {
    # A dry run takes no lock, but says whether the real run would be refused by one.
    $held = Invoke-R2 -Soft -Method GET -Key $key
    if ($held.Status -eq 200) { Say "DRY RUN: another publish run holds $key ($($held.Body.Trim())); the real run would refuse (or need -BreakLock)." }
    return
  }
  if ($BreakLock) {
    $old = Invoke-R2 -Soft -Method GET -Key $key
    if ($old.Status -eq 200) {
      # Only a lock older than any live run can be (every request times out at 30 minutes):
      # a younger one may belong to a run that is still working.
      # Age from the last HEARTBEAT (touched=, refreshed before every write), not the start: a
      # slow run can be alive long after it started (iteration 22).
      $age = $null
      if ($old.Body -cmatch 'touched=(\S+)' -or $old.Body -cmatch 'started=(\S+)') { try { $age = ([DateTime]::UtcNow - [DateTime]::Parse($Matches[1], $Invariant, [Globalization.DateTimeStyles]::AdjustToUniversal)).TotalMinutes } catch { $age = $null } }
      if ($null -eq $age) { Refuse "-BreakLock: $key ($($old.Body.Trim())) carries no readable time, so its age cannot be told; remove it by hand only if you know no run is active. Nothing was written." }
      if ($age -lt 35) { Refuse "-BreakLock: $key ($($old.Body.Trim())) was last touched $('{0:N0}' -f $age) minutes ago; a run touched less than 35 minutes ago may still be working. Wait, or remove it by hand only if you know that run is dead. Nothing was written." }
      # Delete only the lock just read (R2 ignores If-Match on DELETE): a second -BreakLock may
      # have replaced it with its own live lock in the meantime (iteration 22).
      $again = Invoke-R2 -Soft -Method HEAD -Key $key
      if ($again.Status -ne 200 -or $again.ETag -cne $old.ETag) { Refuse "-BreakLock: $key changed while it was being broken (another run took it). Nothing was written." }
      Say "breaking the lock ($('{0:N0}' -f $age) minutes old): $($old.Body.Trim())"
      $d = Invoke-R2 -Soft -Method DELETE -Key $key
      if ($d.Status -ne 200 -and $d.Status -ne 204) { Refuse "-BreakLock could not remove $key ($($d.Status)). Nothing was written." }
    }
  }
  $script:LockHead = "run=$([Guid]::NewGuid().ToString('N')) mode=$Mode started=$(Stamp) host=$([Environment]::MachineName)"
  $body = $Utf8.GetBytes("$($script:LockHead) touched=$(Stamp)`n")
  $r = Invoke-R2 -Method PUT -Key $key -Body $body -PayloadSha (Sha256-Bytes $body) -ContentType 'text/plain; charset=utf-8' -Extra @{ 'if-none-match' = '*'; 'cache-control' = 'no-cache' }
  if ($r.Status -eq 412) {
    $held = Invoke-R2 -Soft -Method GET -Key $key
    $who = if ($held.Status -eq 200) { $held.Body.Trim() } else { 'unreadable' }
    Refuse "another publish run holds $key ($who). Wait for it to finish. If no other run is active (it died), re-run with -BreakLock. Nothing was written."
  }
  if ($r.Status -ne 200 -or -not $r.ETag) { Refuse "could not take $key ($($r.Status)). Nothing was written." }
  $script:LockEtag = $r.ETag
}
# The heartbeat and ownership check before every write: rewrite this run's lock, pinned to its
# own ETag, with a fresh touched= time. A 412 means the lock is no longer this run's (it was
# broken), so this run stops before writing anything more.
function Touch-Lock {
  if (-not $script:LockEtag) { return }
  $key = "${KeyPrefix}publish.lock"
  $body = $Utf8.GetBytes("$($script:LockHead) touched=$(Stamp)`n")
  $r = Invoke-R2 -Soft -Method PUT -Key $key -Body $body -PayloadSha (Sha256-Bytes $body) -ContentType 'text/plain; charset=utf-8' -Extra @{ 'if-match' = $script:LockEtag; 'cache-control' = 'no-cache' }
  if ($r.Status -eq 200 -and $r.ETag) { $script:LockEtag = $r.ETag; return }
  $script:LockEtag = ''   # not ours any more: never delete it on the way out
  Refuse "this run's $key was taken from it ($($r.Status)): another run broke the lock, so this one stops before writing more."
}
# The same heartbeat for a best-effort RESTORE (the undo, the replace put-back): it must not
# write once the lock is not this run's, but it must not abort half-way either, so it answers
# instead of refusing. $true: the lock is still ours (and refreshed); $false: skip the write.
function Test-LockStillOurs {
  if (-not $script:LockEtag) { $script:LockLostNote = "SKIPPED, this run no longer holds publish.lock: check the bucket"; return $false }
  $key = "${KeyPrefix}publish.lock"
  $body = $Utf8.GetBytes("$($script:LockHead) touched=$(Stamp)`n")
  $r = Invoke-R2 -Soft -Method PUT -Key $key -Body $body -PayloadSha (Sha256-Bytes $body) -ContentType 'text/plain; charset=utf-8' -Extra @{ 'if-match' = $script:LockEtag; 'cache-control' = 'no-cache' }
  if ($r.Status -eq 200 -and $r.ETag) { $script:LockEtag = $r.ETag; return $true }
  # Say what actually happened (iteration 24): only a 412 means another run took the lock; a
  # network error or a 5xx means this run could not CONFIRM it, which is a different thing to
  # go and check.
  if ($r.Status -eq 412) {
    $script:LockEtag = ''
    $script:LockLostNote = "SKIPPED, this run's publish.lock was taken by another run before it (another run may be writing): check the bucket"
  } else {
    $script:LockLostNote = "SKIPPED, this run could not confirm it still holds publish.lock (status $($r.Status)), so it did not write: check the bucket"
  }
  return $false
}
$LockLostNote = "SKIPPED, this run's publish.lock was lost before it: check the bucket"
function Unlock-Publish {
  if (-not $script:LockEtag) { return }
  $etag = $script:LockEtag; $script:LockEtag = ''
  $key = "${KeyPrefix}publish.lock"
  # R2 ignores If-Match on a DELETE (measured): check it is still this run's lock first.
  $h = Invoke-R2 -Soft -Method HEAD -Key $key
  if ($h.Status -eq 200 -and $h.ETag -ceq $etag) {
    $d = Invoke-R2 -Soft -Method DELETE -Key $key
    if ($d.Status -ne 200 -and $d.Status -ne 204) { [Console]::Error.WriteLine("publish-r2: WARNING could not remove $key ($($d.Status)); the next run will be refused until it is removed (-BreakLock after 35 minutes).") }
  } elseif ($h.Status -eq 404 -or $h.Status -eq 200) {
    [Console]::Error.WriteLine("publish-r2: WARNING $key was $(if ($h.Status -eq 404) { 'gone' } else { 'someone else''s' }) when this run finished: its lock was broken while it ran, so another run may have written at the same time. Check the bucket.")
  } else {
    [Console]::Error.WriteLine("publish-r2: WARNING could not check $key before removing it ($($h.Status)); if it is still there, the next run will be refused until it is removed (-BreakLock after 35 minutes).")
  }
}

# ---------- confirming what users are served (after writing) ------------------------------------
function Get-Served([string] $Name, [switch] $Bucket) {
  if ($FakeDir) {
    # Test transport: KOSMOS_PUBLISH_R2_FAKE_SITE_404 names files the SITE answers 404 for (its redirect missing);
    # the bucket's own address still serves them.
    if (-not $Bucket -and $env:KOSMOS_PUBLISH_R2_FAKE_SITE_404 -and (@($env:KOSMOS_PUBLISH_R2_FAKE_SITE_404 -split ',') -ccontains $Name)) {
      return [pscustomobject]@{ Status = 404; Bytes = [byte[]]@(); Url = "fake-site:$KeyPrefix$Name" }
    }
    $p = Join-Path $FakeDir "$KeyPrefix$Name"
    if (Test-Path -LiteralPath $p -PathType Leaf) { return [pscustomobject]@{ Status = 200; Bytes = [IO.File]::ReadAllBytes($p); Url = "fake:$KeyPrefix$Name" } }
    return [pscustomobject]@{ Status = 404; Bytes = [byte[]]@(); Url = "fake:$KeyPrefix$Name" }
  }
  $url = if ($Bucket) { "$($BucketBase.TrimEnd('/'))/$KeyPrefix$Name" } else { "$($ServedBase.TrimEnd('/'))/$Name" }
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
function Assert-Served([string] $Name, [string] $WantSha, [switch] $Bucket) {
  # The edge can lag a write by a moment; retry briefly before calling it a failure.
  for ($i = 1; $i -le 6; $i++) {
    $s = Get-Served $Name -Bucket:$Bucket
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
    # Always checked (iteration 24): a zip with no baked version cannot be shown to be the
    # version it would be published as, so -Version alone is not accepted for it.
    if (-not $baked) { Refuse "$ZipPath has no version in app/package.json, so its version cannot be checked; rebuild it with tools/build-kosmos-windows.sh" }
    if (-not $Version) { $Version = $baked }
    elseif ($baked -cne $Version) { Refuse "-Version $Version is not the version this zip was built as ($baked)" }
    # The launcher must BE the committed, signed Kosmos.exe (#3677): a validly signed exe from
    # anyone else, or an older launcher, is not the one we ship.
    # A zip with two entries of one name: the check below would read the first while Explorer
    # extracts the last, so a different launcher could pass. Refuse it.
    # Windows paths are case-insensitive and take either slash, so 'Kosmos.exe', 'KOSMOS.EXE' and
    # a backslash spelling of one path all land on the same file when extracted.
    $dups = @($archive.Entries | Group-Object -Property { $_.FullName.Replace('\', '/').ToLowerInvariant() } | Where-Object { $_.Count -gt 1 })
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
    # kosmos#4597: the Plus connector ships in every Windows build, signed, or Kosmos Plus cannot
    # sign in on Windows. The build refuses one without it; this is the same check at the door.
    $tun = $archive.GetEntry('app/bin/kosmos-tunnel.exe')
    if (-not $tun) { Refuse "$ZipPath carries no Plus connector (app/bin/kosmos-tunnel.exe)" }
    $tmpTun = Join-Path ([IO.Path]::GetTempPath()) ("kosmos-tunnel-" + [Guid]::NewGuid().ToString('N') + '.exe')
    [IO.Compression.ZipFileExtensions]::ExtractToFile($tun, $tmpTun)
    try {
      if (Get-Command Get-AuthenticodeSignature -ErrorAction SilentlyContinue) {
        $tunSig = Get-AuthenticodeSignature -LiteralPath $tmpTun
        if ($tunSig.Status.ToString() -cne 'Valid') { Refuse "the Plus connector's Authenticode status on this PC is '$($tunSig.Status)', not Valid" }
        if ($tunSig.SignerCertificate.Subject -notlike '*CN="Kosmos Agent Manager, Inc."*') { Refuse "the Plus connector is signed by '$($tunSig.SignerCertificate.Subject)', not Kosmos Agent Manager, Inc." }
        Say "connector: app/bin/kosmos-tunnel.exe, Authenticode Valid"
      } else { Say "connector: app/bin/kosmos-tunnel.exe present (Authenticode is checked on Windows only)" }
    } finally { Remove-Item -LiteralPath $tmpTun -Force -ErrorAction SilentlyContinue }
  } finally { $archive.Dispose() }
  Assert-Version 'version' $Version
  $Versioned = "kosmos-$Version-win-$Arch.zip"
  $Sha = Sha256-File $ZipPath
  $zipBytesForManifest = [IO.File]::ReadAllBytes($ZipPath)   # one read for both manifest answers
  $BuiltFrom = Get-ZipSourceSha $zipBytesForManifest   # kosmos#7883
  # kosmos#7890: a build from a tree with uncommitted changes is not exactly the commit it names; said, not refused.
  if (Get-ZipSourceDirty $zipBytesForManifest) {
    Say ("NOTICE (#7890): $ZipPath was built from a tree with uncommitted changes (manifest.json source_dirty), so it is not exactly " + $(if ($BuiltFrom) { "commit $BuiltFrom" } else { 'any one commit' }) + '.' + $(if (-not $ForSigning) { ' The installer staged with it is still the committed script.' } else { '' }) + ' Its verification record will fail the manifest check (V1 needs a clean build), so it cannot be promoted.')
  }
  $zipBytesForManifest = $null
  Say "staging $Versioned ($Sha) from $ZipPath"

  # #6466: the release manifest, beside the zip (tools/build-kosmos-windows.sh writes it there). The key holder signs
  # it on a fleet Mac (tools/lib/manifest-sign.js), after -ForSigning has put the zip and the manifest up. Its .sig
  # comes from -Sig, from beside the zip, or from the bucket (checked under the lock, below), in that order.
  $ManifestName = "kosmos-$Version-win-$Arch.manifest.json"
  $ManifestPath = Join-Path (Split-Path -Parent $ZipPath) $ManifestName
  $SigPath = "$ManifestPath.sig"
  if ($Sig) {
    if ($ForSigning) { Refuse "-Sig is for the stage after signing, not for -ForSigning. Nothing was written." }
    if (-not (Test-Path -LiteralPath $Sig -PathType Leaf)) { Refuse "no such signature file: $Sig. Nothing was written." }
    $SigPath = (Resolve-Path -LiteralPath $Sig).ProviderPath
  }
  $ManifestBytes = $null; $SigBytes = $null; $SigFromBucket = $false
  $checker = Invoke-WinManifest @('ships-checker', $ZipPath)
  if ($checker.Rc -ne 0 -and $checker.Rc -ne 1) { Refuse "could not tell whether the updater inside $ZipPath checks signed release manifests ($($checker.Out)) (exit $($checker.Rc)). Nothing was written." }
  $hasM = Test-Path -LiteralPath $ManifestPath -PathType Leaf
  $hasS = Test-Path -LiteralPath $SigPath -PathType Leaf
  if ($ForSigning) {
    if (-not $hasM) { Refuse "-ForSigning needs the manifest the build wrote beside the zip ($ManifestName), and there is none. Rebuild with tools/build-kosmos-windows.sh. Nothing was written." }
    $mc = Invoke-WinManifest @('check-unsigned', $ManifestPath, $ZipPath, $Version, $Arch)
    if ($mc.Rc -ne 0) { Refuse "the manifest $ManifestName does not describe this zip ($($mc.Out)) (exit $($mc.Rc)), so it must not be signed. Nothing was written." }
    $ManifestBytes = [IO.File]::ReadAllBytes($ManifestPath)
    Say "manifest for signing: $($mc.Out)"
  } elseif ($hasM -and $hasS) {
    $mc = Invoke-WinManifest @('check', $ManifestPath, $SigPath, $ZipPath, $Version, $Arch)
    if ($mc.Rc -ne 0) { Refuse "the signed release manifest $ManifestName does not check out against this zip ($($mc.Out)) (exit $($mc.Rc)). Nothing was written." }
    $ManifestBytes = [IO.File]::ReadAllBytes($ManifestPath); $SigBytes = [IO.File]::ReadAllBytes($SigPath)
    Say "signed manifest: $($mc.Out)"
  } elseif ($hasM) {
    # No .sig given or beside the zip: the key holder's, in the bucket, is read and checked under the lock.
    $ManifestBytes = [IO.File]::ReadAllBytes($ManifestPath); $SigFromBucket = $true
  } elseif ($hasS) {
    Refuse "$ManifestName.sig is there but the manifest it signs is not beside the zip. Nothing was written."
  } elseif ($checker.Rc -eq 0) {
    Refuse "this build's updater refuses any update without a signed release manifest (#6466), and there is no $ManifestName beside $ZipPath. Run this with -ForSigning first, have the key holder sign it, then stage. Nothing was written."
  } else {
    Say "NOTICE (#6466): no release manifest beside the zip. This build's updater does not check one, so it is staged without it; the next build's installs will require one."
  }

  # kosmos#7883: the one-line installer (installkosmos.com/setup.ps1) travels with the build it was cut with. Staging
  # puts the build's tools/windows/setup.ps1 up as setup-<v>.ps1 (and its sidecar); -Promote copies it to setup.ps1.
  # The bytes are the committed blob, never a working file that could carry an uncommitted edit or converted line
  # endings (the site's drift alarm compares against main's bytes).
  #   - A zip that records the commit it was built from (manifest.json source_sha) gets that commit's blob, read from
  #     git, wherever this script runs (review 2): the zip's sha then pins the installer, so Josh's go covers it.
  #   - A zip that records none (an old or hand-made one) gets this tree's HEAD, and only if the working file is
  #     exactly HEAD's blob; that is said.
  if (-not $ForSigning) {
    $git = Get-Command git -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $git) { Refuse "git is needed to read the committed installer script. Nothing was written." }
    if ($BuiltFrom) {
      $got = Get-SetupAtCommit $BuiltFrom
      if ($null -eq $got.Bytes) { Refuse "$ZipPath was built from $BuiltFrom, and this repository cannot read tools/windows/$SetupName at that commit ($($got.Error)). $(if ($got.Stopped) { 'Run it again.' } else { 'Fetch it (git fetch origin), then stage again.' }) Nothing was written." }
      $SetupBytes = [byte[]]$got.Bytes
      $SetupFrom = "the build's commit $BuiltFrom"
    } else {
      $SetupPath = Join-Path $PSScriptRoot $SetupName
      if (-not (Test-Path -LiteralPath $SetupPath -PathType Leaf)) { Refuse "the installer script $SetupPath is missing. Nothing was written." }
      $head = Get-GitLine @('rev-parse', 'HEAD')
      # HEAD resolved once (above), so the blob checked and the commit the NOTICE names are the same commit.
      $blobHead = if ($head) { Get-GitLine @('rev-parse', "${head}:tools/windows/$SetupName") } else { '' }
      # kosmos#7890: one read; these bytes are hashed as a blob and are the bytes staged.
      $SetupBytes = [IO.File]::ReadAllBytes($SetupPath)
      $blobFile = Get-GitBlobSha $SetupBytes
      if (-not $blobHead) { Refuse "git cannot read tools/windows/$SetupName at this tree's HEAD, so the installer cannot be checked against it. Stage from a git checkout that has it committed, or run it again if git was stopped at the limit. Nothing was written." }
      if ($blobHead.Length -ne 40) { Refuse "this repository uses $($blobHead.Length * 4)-bit object ids, and this script compares the installer as a SHA-1 git blob, so it cannot check it here. Stage from a SHA-1 checkout. Nothing was written." }
      if ($blobHead -cne $blobFile) { Refuse "$SetupPath is not byte for byte the script committed at this tree's HEAD (an uncommitted edit, or line endings converted by an older checkout: re-check it out with git rm --cached tools/windows/$SetupName and git checkout -- tools/windows/$SetupName). Nothing was written." }
      Say "NOTICE (#7883): $ZipPath records no source commit (manifest.json source_sha), so the installer staged with it is this tree's HEAD ($head)."
      $SetupFrom = "this tree's HEAD $head"
    }
    if ($SetupBytes.Length -eq 0) { Refuse "the installer script from $SetupFrom is empty. Nothing was written." }
    $SetupSha = Sha256-Bytes $SetupBytes
    $SetupVersioned = "setup-$Version$SetupExt"
    Say "installer: tools/windows/$SetupName from $SetupFrom ($SetupSha), staged as $SetupVersioned"
  }

  # The versioned name is IMMUTABLE once published (the same promise publish-kosmos-windows.sh
  # keeps): republishing different bytes under it hands two builds one name, which is how 0.6.94
  # staging was served with bytes nobody had announced (2026-09-25). Read from the bucket itself,
  # and keyed on the ZIP, so an earlier run cut off before its sidecar still counts.
  # WHATEVER the path (create, same bytes, replace): prod must not be naming this version at a
  # different sha, or the sidecar written below would pin bytes prod's updaters then refuse.
  Lock-Publish $(if ($ForSigning) { 'for-signing' } else { 'stage' })
  if ($SigFromBucket) {
    # The key holder's .sig, uploaded beside the manifest -ForSigning put up. Checked against THIS zip and the
    # manifest beside it: a .sig for other manifest bytes (a rebuild since) is refused.
    $bucketSig = Get-Object "$ManifestName.sig"
    if (-not $bucketSig) { Refuse "there is no $ManifestName.sig beside the zip, from -Sig, or in the bucket. Run -ForSigning, have the key holder sign it, then stage again. Nothing was written." }
    $sdir = Join-Path ([IO.Path]::GetTempPath()) ('kosmos-stage-sig-' + [Guid]::NewGuid().ToString('N'))
    [void] (New-Item -ItemType Directory -Path $sdir)
    try {
      [IO.File]::WriteAllBytes((Join-Path $sdir "$ManifestName.sig"), $bucketSig.Bytes)
      $mc = Invoke-WinManifest @('check', $ManifestPath, (Join-Path $sdir "$ManifestName.sig"), $ZipPath, $Version, $Arch)
    } finally { Remove-Item -LiteralPath $sdir -Recurse -Force -ErrorAction SilentlyContinue }
    if ($mc.Rc -ne 0) { Refuse "the $ManifestName.sig in the bucket does not check out against this zip and its manifest ($($mc.Out)) (exit $($mc.Rc)). Nothing was written." }
    $SigBytes = $bucketSig.Bytes
    Say "signed manifest (its .sig from the bucket): $($mc.Out)"
  }
  $prodNamed = Get-Object 'latest-win.json'
  if ($prodNamed) {
    $pn = Read-PointerFields $prodNamed.Bytes
    if (-not $pn) { Refuse "prod's latest-win.json cannot be read, so it cannot be ruled out that prod names $Versioned. Nothing was written." }
    if ($pn.versioned -ceq $Versioned -and $pn.sha256 -cne $Sha) { Refuse "PROD's latest-win.json names $Versioned at $($pn.sha256); these bytes are $Sha. Staging different bytes under prod's version would break every updater. Bump the version. Nothing was written." }
  }
  $existing = Get-Object $Versioned
  $putExtra = @{}
  if ($existing) {
    $existingSha = Sha256-Bytes $existing.Bytes
    if ($existingSha -ceq $Sha) { Say "$Versioned is already in the bucket with these bytes; it is uploaded again unchanged" }
    elseif (-not $ReplaceVersioned) { Refuse "$Versioned is already in the bucket with DIFFERENT bytes ($existingSha). Versioned names are immutable: bump the version, or pass -ReplaceVersioned if the published one was never announced." }
    else {
      $prod = $prodNamed   # read once, above: the upload's race re-read compares against it
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
  # kosmos#7883 (reviews 1-2): setup-<v>.ps1 keeps the zip's promise. Created only if absent; the same bytes again
  # are pinned to what is there; different bytes only together with a replaced zip (-ReplaceVersioned, which never
  # touches the version prod names). The zip's sha is what Josh's go names, so an installer that changed under an
  # unchanged zip would reach prod with nobody having approved or verified it.
  $setupPutExtra = $null
  if (-not $ForSigning) {
    $setupExisting = Get-Object $SetupVersioned
    if (-not $setupExisting) { $setupPutExtra = @{ 'cache-control' = 'no-cache'; 'if-none-match' = '*' } }
    else {
      if (-not $setupExisting.ETag) { Refuse "the bucket gave no ETag for $SetupVersioned, so its write cannot be pinned. Nothing was written." }
      $setupExistingSha = Sha256-Bytes $setupExisting.Bytes
      if ($setupExistingSha -cne $SetupSha) {
        $zipChanging = [bool]($existing -and (Sha256-Bytes $existing.Bytes) -cne $Sha)
        # Review 4: finishing a -ReplaceVersioned that died after its zip but before this write. The zip is then
        # already the new one, but an installer read from the zip's own recorded commit is still pinned by the zip's
        # sha, so with -ReplaceVersioned it may follow, never for the version prod names.
        if (-not $zipChanging -and $ReplaceVersioned -and $BuiltFrom) {
          $pf7883 = if ($prodNamed) { Read-PointerFields $prodNamed.Bytes } else { $null }
          if ($prodNamed -and (-not $pf7883 -or $pf7883.versioned -ceq $Versioned)) { Refuse "$SetupVersioned belongs to the version PROD's latest-win.json names (or prod cannot be read), so -ReplaceVersioned cannot change it. Bump the version. Nothing was written." }
          $zipChanging = $true
        }
        if (-not $zipChanging) { Refuse "$SetupVersioned is already in the bucket with DIFFERENT bytes ($setupExistingSha; these are $SetupSha), and its zip is not being replaced. The installer changes only with its build: bump the version, or replace the zip itself (-ReplaceVersioned) if this version was never promoted. Nothing was written." }
        Say "NOTICE -ReplaceVersioned: $SetupVersioned changes from $setupExistingSha to $SetupSha"
      }
      $setupPutExtra = @{ 'cache-control' = 'no-cache'; 'if-match' = $setupExisting.ETag }
    }
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
      # A best-effort restore: checked against the lock first, never written blind.
      $back = if (Test-LockStillOurs) { Invoke-R2 -Soft -Method PUT -Key "$KeyPrefix$Versioned" -Body $existing.Bytes -PayloadSha (Sha256-Bytes $existing.Bytes) -ContentType 'application/zip' -Extra @{ 'cache-control' = 'no-cache'; 'if-match' = $zipPut.ETag } } else { [pscustomobject]@{ Status = "not attempted: $LockLostNote" } }
      if ($back.Status -eq 200) { $how = "the previous bytes ($existingSha) were put back" }
      else {
        # Say what the key holds NOW (a 412 means someone else wrote it since), not what it
        # should hold.
        $nowK = Invoke-R2 -Soft -Method GET -Key "$KeyPrefix$Versioned"
        $held = if ($nowK.Status -eq 200) { Sha256-Bytes $nowK.Bytes } else { "unknown (read answered $($nowK.Status))" }
        $how = "PUTTING THE PREVIOUS BYTES BACK FAILED ($($back.Status)): the key now holds $held; restore it by hand"
      }
      $script:AfterNote = ''
      $said = if ($pfNow) { "prod's latest-win.json named $Versioned while this replace ran (a promote landed in between)" } else { "prod's latest-win.json could not be read after this replace's upload, so it may name $Versioned" }
      # The closing sentence only when it is true: a failed put-back means the replace DID land.
      Refuse "$said; $how.$(if ($back.Status -eq 200) { ' The replace was undone (for a moment the key held the new bytes).' })"
    }
  }
  $side = New-SidecarBytes $Sha $Versioned
  Put-Object "$Versioned.sha256" $side $null (Sha256-Bytes $side) 'text/plain; charset=utf-8' $NoCache
  if ($ForSigning) {
    # #6466: the manifest for the key holder, and NOTHING that moves a channel: no pointer, no alias, no .sig.
    $ManifestSha = Sha256-Bytes $ManifestBytes
    Put-Object $ManifestName $ManifestBytes $null $ManifestSha 'application/json' $NoCache
    if ($DryRun) { Say "DRY RUN complete: nothing was written."; exit 0 }
    $script:AfterNote = " (the zip, its sidecar and the manifest may be up; no pointer was touched. Re-run the same command to finish the checks.)"
    Assert-Served $Versioned $Sha
    Assert-Served "$Versioned.sha256" (Sha256-Bytes $side)
    # The site redirects the manifest names only once its /dist rule covers them; until then the bucket's own address
    # is read, and that is said, since installs read the site.
    $first = Get-Served $ManifestName
    if ($first.Status -eq 404) {
      Say "NOTICE (#6466): $($first.Url) answers 404 (installkosmos.com does not redirect this name yet); reading it from the bucket's own address instead. Installs need the site to serve it before this build is staged."
      Assert-Served $ManifestName $ManifestSha -Bucket
    } else { Assert-Served $ManifestName $ManifestSha }
    $script:AfterNote = ''
    if ($FakeDir) { Say "TEST TRANSPORT, NOTHING PUBLISHED:" }
    Say "UP FOR SIGNING: version $Version, manifest $ManifestName sha256 $ManifestSha (zip sha256 $Sha). No pointer was touched."
    Say "Send the key holder the version and the manifest sha256 above. They sign it with tools/lib/manifest-sign.js and upload $ManifestName.sig beside it (or send the file). Then stage:"
    Say "  pwsh tools/windows/publish-r2.ps1 -Zip $Zip   [-Sig <the .sig file, if it was sent rather than uploaded>]"
    Unlock-Publish
    exit 0
  }
  if ($ManifestBytes) {
    # #6466: up, and SERVED, before the pointer names this build. Installs fetch both through installkosmos.com
    # (whose /dist redirect must cover these names); one that cannot fetch them refuses the update. A .sig the key
    # holder already put in the bucket is not written again.
    Put-Object $ManifestName $ManifestBytes $null (Sha256-Bytes $ManifestBytes) 'application/json' $NoCache
    if (-not $SigFromBucket) { Put-Object "$ManifestName.sig" $SigBytes $null (Sha256-Bytes $SigBytes) 'text/plain; charset=utf-8' $NoCache }
    if (-not $DryRun) {
      Assert-Served $ManifestName (Sha256-Bytes $ManifestBytes)
      Assert-Served "$ManifestName.sig" (Sha256-Bytes $SigBytes)
    }
  }
  # kosmos#7883: the installer script for this build, up and read back before the pointer names the build, so a
  # promote of what staging names always finds it. No site name redirects to setup-<v>.ps1, so it is read back from
  # the bucket's own address; only setup.ps1 (written by -Promote) is what people run.
  $SetupSide = New-SidecarBytes $SetupSha $SetupVersioned
  Put-Object $SetupVersioned $SetupBytes $null $SetupSha 'text/plain; charset=utf-8' $setupPutExtra
  Put-Object "$SetupVersioned.sha256" $SetupSide $null (Sha256-Bytes $SetupSide) 'text/plain; charset=utf-8' $NoCache
  if (-not $DryRun) {
    [void](Assert-Object $SetupVersioned $SetupSha)
    [void](Assert-Object "$SetupVersioned.sha256" (Sha256-Bytes $SetupSide))
    Assert-Served $SetupVersioned $SetupSha -Bucket
  }
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
  Unlock-Publish
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

Lock-Publish 'promote'
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

# #6466: the staged version's signed manifest, checked against the staged zip's own bytes. With none, the promote
# goes on only while prod's current build has none either: prod installs that check would refuse this update.
$ManifestName = "kosmos-$ApprovedVersion-win-$Arch.manifest.json"
$stagedManifest = Get-Object $ManifestName
$stagedSig = Get-Object "$ManifestName.sig"
if ($stagedManifest -or $stagedSig) {
  if (-not ($stagedManifest -and $stagedSig)) { Refuse "the bucket holds only one of $ManifestName and its .sig. Re-stage with this script. Nothing was written." }
  $mdir = Join-Path ([IO.Path]::GetTempPath()) ('kosmos-promote-manifest-' + [Guid]::NewGuid().ToString('N'))
  [void] (New-Item -ItemType Directory -Path $mdir)
  try {
    [IO.File]::WriteAllBytes((Join-Path $mdir $ManifestName), $stagedManifest.Bytes)
    [IO.File]::WriteAllBytes((Join-Path $mdir "$ManifestName.sig"), $stagedSig.Bytes)
    [IO.File]::WriteAllBytes((Join-Path $mdir $Versioned), $staged.Bytes)
    $mc = Invoke-WinManifest @('check', (Join-Path $mdir $ManifestName), (Join-Path $mdir "$ManifestName.sig"), (Join-Path $mdir $Versioned), $ApprovedVersion, $Arch)
  } finally { Remove-Item -LiteralPath $mdir -Recurse -Force -ErrorAction SilentlyContinue }
  if ($mc.Rc -ne 0) { Refuse "the staged signed manifest does not check out against the staged zip ($($mc.Out)) (exit $($mc.Rc)). Nothing was written." }
  Say "signed manifest: $($mc.Out)"
  # Installs fetch both through installkosmos.com. A site deploy since the stage could have dropped the redirect that
  # serves them, and prod's installs would then refuse this update, so they are read back again before prod moves.
  if (-not $DryRun) {
    Assert-Served $ManifestName (Sha256-Bytes $stagedManifest.Bytes)
    Assert-Served "$ManifestName.sig" (Sha256-Bytes $stagedSig.Bytes)
  }
} else {
  # "Prod's installs check" is read from whether prod's current build was published with a manifest, which every build
  # that checks is (staging refuses one without). A build published with one that does not check reads as checking:
  # the safe direction, a refusal here rather than stranded installs.
  $prodNow = Get-Object 'latest-win.json'
  $pnow = if ($prodNow) { Read-PointerFields $prodNow.Bytes } else { $null }
  if ($prodNow -and -not $pnow) { Refuse "the staged build has no signed manifest, and prod's latest-win.json cannot be read to tell whether prod's installs require one. Nothing was written." }
  if ($pnow -and (Get-Object "kosmos-$($pnow.version)-win-$Arch.manifest.json")) {
    Refuse "the staged build has no signed manifest, and prod's current build ($($pnow.version)) was published with one, so its installs check signatures and would refuse this update (#6466). Nothing was written."
  }
  Say "NOTICE (#6466): the staged build has no signed manifest; prod's current build has none either, so its installs do not require one."
}

# kosmos#7883: the installer script staged with this build (setup-<v>.ps1 and its sidecar), which becomes setup.ps1
# once prod names the build. A build staged before staging carried one leaves setup.ps1 as it is, and says so.
$SetupVersioned = "setup-$ApprovedVersion$SetupExt"
$stagedSetup = Get-Object $SetupVersioned
$stagedSetupSide = Get-Object "$SetupVersioned.sha256"
$SetupBytes = $null; $SetupSha = ''
# kosmos#7890: where the installer that goes up was checked (commit or head), or none; setup_head names the HEAD that
# vouched for a head one, and setup_left the setup.ps1 left live when none goes up. All three go on the approval line.
$SetupSource = 'none'; $SetupLeft = ''; $SetupHead = ''
function Get-LiveSetupSha { $live = Get-Object $SetupName; if ($live) { Sha256-Bytes $live.Bytes } else { 'absent' } }
# The commit HEAD names, for the approval line (setup_head), or 'unknown'.
function Get-SetupHeadCommit {
  $line = Get-GitLine @('rev-parse', 'HEAD')
  if ($line) { $line } else { 'unknown' }
}
if ($stagedSetup -or $stagedSetupSide) {
  if (-not ($stagedSetup -and $stagedSetupSide)) { Refuse "the bucket holds only one of $SetupVersioned and its .sha256. Re-stage with this script. Nothing was written." }
  $SetupBytes = [byte[]]$stagedSetup.Bytes; $SetupSha = Sha256-Bytes $SetupBytes
  if ($SetupBytes.Length -eq 0) { Refuse "$SetupVersioned in the bucket is empty. Re-stage with this script. Nothing was written." }
  if ((Sha256-Bytes $stagedSetupSide.Bytes) -cne (Sha256-Bytes (New-SidecarBytes $SetupSha $SetupVersioned))) { Refuse "$SetupVersioned.sha256 does not name $SetupVersioned's bytes ($SetupSha). Re-stage with this script. Nothing was written." }
  # Review 3: the staged copy is not taken on trust. When the staged zip (the bytes Josh approved) records the commit
  # it was built from, the installer is read again from that commit and must be these exact bytes.
  $promoteFrom = Get-ZipSourceSha $staged.Bytes
  if ($promoteFrom) {
    $want = Get-SetupAtCommit $promoteFrom
    if ($null -eq $want.Bytes) { Refuse "the staged zip was built from $promoteFrom, and this repository cannot read tools/windows/$SetupName at that commit ($($want.Error)), so the staged installer cannot be checked. $(if ($want.Stopped) { 'Run it again.' } else { 'Fetch it (git fetch origin), then promote again.' }) Nothing was written." }
    if ((Sha256-Bytes ([byte[]]$want.Bytes)) -cne $SetupSha) { Refuse "$SetupVersioned in the bucket ($SetupSha) is not tools/windows/$SetupName at $promoteFrom, the commit the approved zip was built from ($(Sha256-Bytes ([byte[]]$want.Bytes))). Re-stage with this script. Nothing was written." }
    Say "installer: $SetupVersioned ($SetupSha) is tools/windows/$SetupName at the approved build's commit $promoteFrom; it becomes $SetupName after latest-win.json"
    $SetupSource = 'commit'
  } else {
    # kosmos#7890: the zip names no commit to read the installer from, so it is checked against this tree's HEAD. One
    # that cannot be checked is refused, as a missing commit is: promoting the app while setup.ps1 stays older is the
    # outcome the refusal exists to prevent.
    # One commit is both checked and logged: HEAD is resolved first, then read at that commit.
    $SetupHead = Get-SetupHeadCommit
    if ($SetupHead -ceq 'unknown') { Refuse "the staged zip records no source commit, so $SetupVersioned is checked against this tree's HEAD, and git cannot say which commit HEAD is (git is not installed, this is not a git checkout, or git was stopped at the limit). Promote from a checkout git can read, or run it again if it was stopped. Nothing was written." }
    $headSetup = Get-SetupAtCommit $SetupHead
    # What works when it cannot be checked: setup-<v>.ps1 cannot be replaced for a zip that names no commit, so the fix
    # is a checkout whose setup.ps1 is the staged bytes (staging named it as "this tree's HEAD (<sha>)"), or a new build.
    $fix = "Promote from a checkout of the commit staging named for it (its NOTICE says this tree's HEAD and the commit), or rebuild under a new version."
    if ($null -eq $headSetup.Bytes) { Refuse "the staged zip records no source commit, so $SetupVersioned is checked against this tree's HEAD, and git cannot read tools/windows/$SetupName there ($($headSetup.Error)). $(if ($headSetup.Stopped) { 'Run it again.' } else { $fix }) Nothing was written." }
    if ((Sha256-Bytes ([byte[]]$headSetup.Bytes)) -cne $SetupSha) { Refuse "the staged zip records no source commit, and $SetupVersioned ($SetupSha) is not tools/windows/$SetupName at this tree's HEAD $SetupHead ($(Sha256-Bytes ([byte[]]$headSetup.Bytes))), so it cannot be checked. $fix Nothing was written." }
    $SetupSource = 'head'
    Say "installer: $SetupVersioned ($SetupSha) is tools/windows/$SetupName at this tree's HEAD $SetupHead (the staged zip records no source commit); it becomes $SetupName after latest-win.json"
  }
} else {
  $SetupLeft = Get-LiveSetupSha
  Say "NOTICE (#7883): no $SetupVersioned was staged with this build (it was staged before staging carried one), so $SetupName is left as it is ($SetupLeft): it stays the installer of the build promoted before, which may be newer than this one."
}

# The verification record for this sha on this PC, validated by the one spec the writer uses.
$spec = Join-Path (Split-Path -Parent $PSScriptRoot) 'lib/win-staging-record.js'
# An executable node, not a node.cmd shim (cmd.exe would mangle the script). The script goes to
# node on STDIN, never on the command line or in a temp file.
$nodeExe = Get-NodeExe
if (-not $nodeExe) { Refuse "node (an executable, not a .cmd shim) is required to validate the verification record: $NoNodeWhere. Nothing was written." }
if (-not (Test-Path -LiteralPath $spec)) { Refuse "the record spec $spec is missing. Nothing was written." }
$verdictJs = @'
// Any crash says why on STDOUT (where the verdict is read), as AMBIGUOUS, so a refusal is never blank.
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
# The script goes to node on STDIN (`node -`), so there is no temp file another process could swap.
# Both directions UTF-8 (Invoke-ChildBounded), and a limit (#7951): a stopped run decided nothing, whatever it printed.
$vr = Invoke-ChildBounded $nodeExe.Source @('-', $spec, $ApprovedVersion, $ApprovedSha) $verdictJs
$verdict = $vr.Out; $rc = $vr.Rc
if ($vr.Undecided) { Refuse "the verification record check decided nothing: $($vr.Undecided)$(if ($verdict) { " (it had printed: $verdict)" }). Run it again. Nothing was written." }
if ($rc -ne 0) { Refuse "the verification record does not pass ($verdict) (exit $rc). Verify the staged build on this PC first (node tools/win-staging-verify.js). Nothing was written." }
$recordSha = ($verdict -split ' ')[1]; $recordPath = ($verdict -split ' ', 3)[2]
Say "verification record: $verdict"

# The staging pointer must not have moved while the checks ran (promote-channel.sh's snapshot
# rule): Josh's go and the record cover the build it named at the start.
$again = Get-Object 'latest-win-staging.json'
if (-not $again -or (Sha256-Bytes $again.Bytes) -cne (Sha256-Bytes $staging.Bytes)) { Refuse "latest-win-staging.json changed while the promote was checking it. Nothing was written; start the promote again." }

# Josh's go is logged BEFORE any write; a go that is not logged is not given. bucket= and
# prefix= tell a real promote from a self-test in the one log.
$Where = "bucket=$Bucket prefix=$(if ($KeyPrefix) { $KeyPrefix } else { '-' })$(if ($FakeDir) { ' transport=test' })"
Write-ApprovalLine "$(Stamp) family=win path=promote-r2 version=$ApprovedVersion sha256=$ApprovedSha approval_ref=$ApprovalRef record_sha256=$recordSha setup_source=$SetupSource$(if ($SetupHead) { " setup_head=$SetupHead" })$(if ($SetupLeft) { " setup_left=$SetupLeft" }) setup_sha256=$(if ($null -ne $SetupBytes) { $SetupSha } else { 'none' }) approval=given $Where record=$recordPath"   # record= LAST: the path may hold spaces (promote-channel.sh does the same)

# What prod is BEFORE this promote writes anything, so a promote that finds itself raced can
# put it back: the pointer, and the alias sidecar (the alias zip is restored from the previous
# pointer's versioned zip).
$prodBefore = Get-Object 'latest-win.json'
$aliasSideBefore = Get-Object "$Alias.sha256"
# Both are pinned to below (the sidecar write, the pointer write, an undo): an object with no
# ETag cannot be pinned, and an empty If-Match is not a pin.
if (($prodBefore -and -not $prodBefore.ETag) -or ($aliasSideBefore -and -not $aliasSideBefore.ETag)) { Refuse "the bucket answered latest-win.json or $Alias.sha256 with no ETag, so this promote cannot pin its writes to them. Nothing was written." }
# kosmos#7883: setup.ps1 and its sidecar as they are now, so their writes (after the pointer) are pinned to them.
$setupBefore = $null; $setupSideBefore = $null
if ($null -ne $SetupBytes) {
  $setupBefore = Get-Object $SetupName; $setupSideBefore = Get-Object "$SetupName.sha256"
  if (($setupBefore -and -not $setupBefore.ETag) -or ($setupSideBefore -and -not $setupSideBefore.ETag)) { Refuse "the bucket answered $SetupName or $SetupName.sha256 with no ETag, so this promote cannot pin its writes to them. Nothing was written." }
}
function Test-StagedIntact {
  $z = Get-Object $Versioned; $zs = Get-Object "$Versioned.sha256"
  return [bool]($z -and $zs -and (Sha256-Bytes $z.Bytes) -ceq $ApprovedSha -and (Sha256-Bytes $zs.Bytes) -ceq (Sha256-Bytes (New-SidecarBytes $ApprovedSha $Versioned)))
}
# Undo this promote's prod writes (someone else's write landed under it).
# Every step is pinned to what THIS run wrote: PUTs by If-Match; the DELETEs and the COPY by a
# HEAD check first (R2 ignores If-Match on those, measured), so a newer write by someone else is
# left alone. Every step is -Soft, so one failure does not hide the rest. The report says what
# the undo did, step by step, and $script:UndoClean says whether prod is back to one consistent
# previous release (pointer, alias and sidecar); a caller claims that only when it is true.
# (An R2 ETag is a hash of the content, so a byte-identical write by someone else reads as ours.)
$script:UndoClean = $false
function Undo-Promote([switch] $PointerWritten, [string] $PointerEtag, [string] $AliasEtag, [string] $SideEtag) {
  $script:UndoClean = $false
  $done = @()
  if ($PointerWritten -and -not $PointerEtag) { return 'NOTHING was undone: the pointer write answered no ETag to pin an undo to, SO PROD STILL NAMES ' + $Versioned }
  if ($PointerWritten) {
    $pointerOk = $false
    if (-not (Test-LockStillOurs)) { return "NOTHING was undone ($LockLostNote), SO PROD STILL NAMES $Versioned" }
    if ($prodBefore) {
      $r = Invoke-R2 -Soft -Method PUT -Key "${KeyPrefix}latest-win.json" -Body $prodBefore.Bytes -PayloadSha (Sha256-Bytes $prodBefore.Bytes) -ContentType 'application/json' -Extra @{ 'cache-control' = 'no-cache'; 'if-match' = $PointerEtag }
      if ($r.Status -eq 200) { $pointerOk = $true; $done += 'latest-win.json put back' }
      elseif ($r.Status -eq 412) { $done += 'latest-win.json was rewritten by someone else since, and is left as it is (prod does not name this build through it)' }
      else { $done += "PUTTING latest-win.json BACK FAILED ($($r.Status)), SO PROD STILL NAMES $Versioned" }
    } else {
      # The first promote ever: there is no previous pointer to put back, so the undo removes this one.
      $h = Invoke-R2 -Soft -Method HEAD -Key "${KeyPrefix}latest-win.json"
      if ($h.Status -eq 404) { $done += 'latest-win.json is already gone' }
      elseif ($h.Status -eq 200 -and $h.ETag -cne $PointerEtag) { $done += 'latest-win.json was rewritten by someone else since, and is left as it is (prod does not name this build through it)' }
      elseif ($h.Status -ne 200) { $done += "REMOVING latest-win.json FAILED (HEAD answered $($h.Status)), SO PROD STILL NAMES $Versioned" }
      else {
        $r = Invoke-R2 -Soft -Method DELETE -Key "${KeyPrefix}latest-win.json"
        if ($r.Status -eq 200 -or $r.Status -eq 204) { $pointerOk = $true; $done += 'latest-win.json removed (there was no previous one)' }
        else { $done += "REMOVING latest-win.json FAILED ($($r.Status)), SO PROD STILL NAMES $Versioned" }
      }
    }
    # The alias follows the pointer this run wrote. If that could not be undone, the alias and
    # its sidecar stay as written: they match whatever is live, or were never this run's to fix.
    if (-not $pointerOk) { $done += 'the alias and its sidecar left as written'; return ($done -join '; ') }
  }
  if (-not $prodBefore) { $done += 'the alias and its sidecar still hold this build: there was no previous release to restore them from'; return ($done -join '; ') }
  $pf = Read-PointerFields $prodBefore.Bytes
  if (-not $pf) { $done += 'the alias and its sidecar still hold this build: the previous latest-win.json could not be read, so there is nothing to restore them from'; return ($done -join '; ') }
  if (-not $AliasEtag -or -not $SideEtag) { $done += 'the alias and its sidecar left as written (no ETag to pin an undo to)'; return ($done -join '; ') }
  # The alias first: if it is not ours any more, both are left alone and the report says the
  # alias is someone else's. (Its sidecar may still be this run's, so the pair may disagree: with
  # publish.lock held that needs a second run that broke the lock, and the refusal says so.)
  $h = Invoke-R2 -Soft -Method HEAD -Key "$KeyPrefix$Alias"
  if ($h.Status -ne 200 -or $h.ETag -cne $AliasEtag) { $done += "the alias and its sidecar left as they are (the alias is not ours any more: HEAD answered $($h.Status) $($h.ETag); its sidecar may still name $ApprovedVersion, so check they agree)"; return ($done -join '; ') }
  # The previous release's zip must still be what its pointer says, or the restore would put
  # unannounced bytes on the alias; the copy is pinned to it.
  $old = Invoke-R2 -Soft -Method GET -Key "$KeyPrefix$($pf.versioned)"
  if ($old.Status -ne 200 -or (Sha256-Bytes $old.Bytes) -cne $pf.sha256 -or -not $old.ETag) { $done += "the alias and its sidecar left as written ($($pf.versioned) is not the previous release's bytes any more: $($old.Status))"; return ($done -join '; ') }
  # The sidecar is REBUILT from the previous pointer, not copied from what was read at the start:
  # a sidecar left by an earlier, interrupted promote can name a different release, and the
  # pair must agree by construction (iteration 18). Pinned to the sidecar this run wrote.
  $oldSide = New-SidecarBytes $pf.sha256 $Alias
  if (-not (Test-LockStillOurs)) { $done += "the alias and its sidecar: $LockLostNote"; return ($done -join '; ') }
  $r2 = Invoke-R2 -Soft -Method PUT -Key "$KeyPrefix$Alias.sha256" -Body $oldSide -PayloadSha (Sha256-Bytes $oldSide) -ContentType 'text/plain; charset=utf-8' -Extra @{ 'cache-control' = 'no-cache'; 'if-match' = $SideEtag }
  $sideOk = $r2.Status -eq 200
  $done += $(if ($sideOk) { "the alias sidecar put back (naming $($pf.versioned)'s sha)" } elseif ($r2.Status -eq 412) { 'the alias sidecar left as it is (someone else rewrote it since)' } else { "PUTTING THE ALIAS SIDECAR BACK FAILED ($($r2.Status))" })
  if (-not $sideOk) { $done += "the alias left as written ($Versioned)"; return ($done -join '; ') }
  if (-not (Test-LockStillOurs)) { $done += "the alias (its sidecar was put back): $LockLostNote, SO ITS SIDECAR AND IT DISAGREE"; return ($done -join '; ') }
  $c = Invoke-R2 -Soft -Method PUT -Key "$KeyPrefix$Alias" -ContentType 'application/zip' -Extra @{ 'x-amz-copy-source' = "/$Bucket/$KeyPrefix$($pf.versioned)"; 'x-amz-copy-source-if-match' = $old.ETag; 'x-amz-metadata-directive' = 'REPLACE'; 'cache-control' = 'no-cache' }
  if ($c.Status -eq 200 -and $c.Body -cnotmatch '<Error>') { $done += "the alias restored from $($pf.versioned)"; $script:UndoClean = $true }
  else { $done += "RESTORING THE ALIAS FAILED ($($c.Status)), SO ITS SIDECAR AND IT DISAGREE" }
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
# Pinned to the sidecar this promote read at its start, or to its absence. (The alias copy
# cannot be pinned: R2 ignores a COPY's destination If-Match. It is read back just below.)
$sidePin = if ($aliasSideBefore) { @{ 'cache-control' = 'no-cache'; 'if-match' = $aliasSideBefore.ETag } } else { @{ 'cache-control' = 'no-cache'; 'if-none-match' = '*' } }
Put-Object "$Alias.sha256" $aliasSide $null (Sha256-Bytes $aliasSide) 'text/plain; charset=utf-8' $sidePin
$aliasEtag = ''; $sideEtag = ''
if (-not $DryRun) {
  # Their ETags as read back are what an undo pins to (a COPY answers its ETag in the XML body,
  # not a header, so the read-back is the reliable source).
  $aliasObj = Get-Object $Alias; $sideObj = Get-Object "$Alias.sha256"
  $aliasEtag = if ($aliasObj) { $aliasObj.ETag } else { '' }
  $sideEtag = if ($sideObj) { $sideObj.ETag } else { '' }
  # A read-back that is not what was written (someone else wrote in between): the pointer has
  # not moved, so the alias and its sidecar go back to match it, pinned to what is there now.
  $aliasGot = if ($aliasObj) { Sha256-Bytes $aliasObj.Bytes } else { '(absent)' }
  $sideGot = if ($sideObj) { Sha256-Bytes $sideObj.Bytes } else { '(absent)' }
  if ($aliasGot -cne $ApprovedSha -or $sideGot -cne (Sha256-Bytes $aliasSide)) {
    $how = Undo-Promote -AliasEtag $aliasEtag -SideEtag $sideEtag; $script:AfterNote = ''
    Refuse "the bucket holds $Alias as $aliasGot and its sidecar as $sideGot, not what this promote wrote; latest-win.json was NOT written; $how."
  }
  # A -ReplaceVersioned may have landed since the checks: never let the pointer name it.
  if (-not (Test-StagedIntact)) { $how = Undo-Promote -AliasEtag $aliasEtag -SideEtag $sideEtag; $script:AfterNote = ''; Refuse "$Versioned or its sidecar changed while this promote ran (a -ReplaceVersioned landed); latest-win.json was NOT written; $how." }
}
if ($DryRun) {
  Put-Object 'latest-win.json' $staging.Bytes $null (Sha256-Bytes $staging.Bytes) 'application/json' $NoCache
  if ($null -ne $SetupBytes) { Put-Object $SetupName $SetupBytes $null $SetupSha 'text/plain; charset=utf-8' $NoCache; $ss = New-SidecarBytes $SetupSha $SetupName; Put-Object "$SetupName.sha256" $ss $null (Sha256-Bytes $ss) 'text/plain; charset=utf-8' $NoCache }
  Say "DRY RUN complete: nothing was written."; exit 0
}
# Pinned to the pointer read at the start (or its absence): a pointer someone else wrote during
# this promote is never overwritten, and the alias writes are undone instead.
$pointerPin = if ($prodBefore) { @{ 'cache-control' = 'no-cache'; 'if-match' = $prodBefore.ETag } } else { @{ 'cache-control' = 'no-cache'; 'if-none-match' = '*' } }
Touch-Lock
$pointerPut = Invoke-R2 -Method PUT -Key "${KeyPrefix}latest-win.json" -Body $staging.Bytes -PayloadSha (Sha256-Bytes $staging.Bytes) -ContentType 'application/json' -Extra $pointerPin
# A 412 means someone else's release is live now: rebuilding the alias from the pointer read at
# the start would make it disagree with that live pointer, so the alias and sidecar are left and
# the refusal says what they hold (iteration 18).
if ($pointerPut.Status -eq 412) { $script:AfterNote = ''; Refuse "latest-win.json changed while this promote ran (someone else wrote it), so it was NOT overwritten. The alias and its sidecar still hold THIS build ($ApprovedVersion), which the live latest-win.json may not name: re-read latest-win.json and re-run the promote of the build it should name." }
if ($pointerPut.Status -ne 200) { Refuse "PUT ${KeyPrefix}latest-win.json answered $($pointerPut.Status): $($pointerPut.Body)" }
Say "wrote ${KeyPrefix}latest-win.json"
$script:AfterNote = " (latest-win.json was written: prod points at $ApprovedVersion. To finish the checks, re-run the full -Promote (it refuses if staging has moved since), or compare the served files with the approved sha.)"
# The versioned zip and its sidecar again, AFTER the pointer names them. Each side of a race
# writes its key and then reads the other's (the replace re-reads prod after its upload), so at
# least one of them sees the other: if this one does, it puts prod back.
# The alias and its sidecar too (a HEAD each: same ETag, same bytes).
$aliasHead = Invoke-R2 -Method HEAD -Key "$KeyPrefix$Alias"; $sideHead = Invoke-R2 -Method HEAD -Key "$KeyPrefix$Alias.sha256"
$aliasIntact = $aliasHead.Status -eq 200 -and $aliasHead.ETag -ceq $aliasEtag -and $sideHead.Status -eq 200 -and $sideHead.ETag -ceq $sideEtag
if (-not (Test-StagedIntact) -or -not $aliasIntact) {
  $how = Undo-Promote -PointerWritten -PointerEtag $pointerPut.ETag -AliasEtag $aliasEtag -SideEtag $sideEtag
  $script:AfterNote = ''
  # The closing sentence only when the undo put ONE consistent previous release back.
  Refuse "$Versioned, the alias or a sidecar changed right after latest-win.json named them (someone else's write landed); $how.$(if ($script:UndoClean) { ' Prod is back on the previous release, consistently.' })"
}
Assert-Served $Alias $ApprovedSha
Assert-Served "$Alias.sha256" (Sha256-Bytes $aliasSide)
Assert-Served 'latest-win.json' (Sha256-Bytes $staging.Bytes)
Assert-Served $Versioned $ApprovedSha
Assert-Served "$Versioned.sha256" (Sha256-Bytes (New-SidecarBytes $ApprovedSha $Versioned))
Write-ApprovalLine "$(Stamp) family=win path=promote-r2 version=$ApprovedVersion sha256=$ApprovedSha approval_ref=$ApprovalRef promoted=yes $Where" -Outcome
# kosmos#7883: the installer moves only once prod names its build, that has held, and the release is verified and
# logged as promoted (review 1), so an undo never has to put it back and a failure here leaves a promoted release.
# The script reads latest-win.json when it runs, so until it is written a new install gets the previous script on
# the new build: the pair that was live a moment before, not a new script on an old build. Each write is pinned to
# what this promote read at its start (412: someone else wrote it); a re-run of the full -Promote finishes it.
if ($null -ne $SetupBytes) {
  $script:AfterNote = " (latest-win.json was written: prod points at $ApprovedVersion. $SetupName or its sidecar may still be the previous ones: re-run the full -Promote to finish.)"
  $setupPin = if ($setupBefore) { @{ 'cache-control' = 'no-cache'; 'if-match' = $setupBefore.ETag } } else { @{ 'cache-control' = 'no-cache'; 'if-none-match' = '*' } }
  Put-Object $SetupName $SetupBytes $null $SetupSha 'text/plain; charset=utf-8' $setupPin
  $setupSide = New-SidecarBytes $SetupSha $SetupName
  $setupSidePin = if ($setupSideBefore) { @{ 'cache-control' = 'no-cache'; 'if-match' = $setupSideBefore.ETag } } else { @{ 'cache-control' = 'no-cache'; 'if-none-match' = '*' } }
  Put-Object "$SetupName.sha256" $setupSide $null (Sha256-Bytes $setupSide) 'text/plain; charset=utf-8' $setupSidePin
  [void](Assert-Object $SetupName $SetupSha)
  [void](Assert-Object "$SetupName.sha256" (Sha256-Bytes $setupSide))
  # installkosmos.com/setup.ps1 is the site's to redirect here; this checks the bucket's own address.
  Assert-Served $SetupName $SetupSha -Bucket
  Assert-Served "$SetupName.sha256" (Sha256-Bytes $setupSide) -Bucket
  $script:AfterNote = ''
  Write-ApprovalLine "$(Stamp) family=win path=promote-r2 version=$ApprovedVersion sha256=$ApprovedSha installer=published setup_sha256=$SetupSha $Where" -Outcome
}
if ($FakeDir) { Say "TEST TRANSPORT, NOTHING PUBLISHED:" }
Say "PROMOTED $ApprovedVersion ($ApprovedSha) to prod; the bucket and the served bytes both verified."
Unlock-Publish
exit 0
