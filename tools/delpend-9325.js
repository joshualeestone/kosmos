// kosmos#9325 MEASUREMENT ONLY (never merged): what a 'wx' create meets at a delete-pending name on Windows.
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'delpend-'));
const probe = (label, name) => {
  const p = path.join(dir, name);
  const listed = fs.readdirSync(dir).includes(name);
  let lst; try { fs.lstatSync(p); lst = 'ok'; } catch (e) { lst = e.code; }
  let wx; try { const fd = fs.openSync(p, 'wx', 0o600); fs.closeSync(fd); wx = 'created'; } catch (e) { wx = e.code; }
  console.log(`MEASURED ${label}: listed=${listed} lstat=${lst} wx=${wx}`);
};
// Control: a plain file, and a free name.
fs.writeFileSync(path.join(dir, 'plain'), 'x'); probe('control plain file', 'plain');
probe('control free name', 'free');
// A: Node holds the file open, then unlinks it (DeleteFileW).
const a = path.join(dir, 'held-unlinked'); fs.writeFileSync(a, 'x');
const fa = fs.openSync(a, 'r');
let un; try { fs.unlinkSync(a); un = 'ok'; } catch (e) { un = e.code; }
console.log(`MEASURED A unlink while held: ${un}`);
probe('A held then unlinked', 'held-unlinked');
fs.closeSync(fa);
probe('A after close', 'held-unlinked');
// B: PowerShell opens with DeleteOnClose and holds it for 20 s.
const b = path.join(dir, 'delete-on-close');
const ps2 = `$s=New-Object System.IO.FileStream('${b}',[System.IO.FileMode]::CreateNew,[System.IO.FileAccess]::ReadWrite,[System.IO.FileShare]'ReadWrite, Delete',4096,[System.IO.FileOptions]::DeleteOnClose); Start-Sleep 20; $s.Close()`;
if (process.platform === 'win32') {
  const child = cp.spawn('powershell', ['-NoProfile', '-Command', ps2], { stdio: 'inherit' });
  const t0 = Date.now(); while (!fs.existsSync(b) && Date.now() - t0 < 15000) cp.execSync('ping -n 2 127.0.0.1 >NUL');
  probe('B DeleteOnClose held (not yet deleted)', 'delete-on-close');
  // Mark it for deletion through a second handle while the first stays open: Node unlink.
  let un2; try { fs.unlinkSync(b); un2 = 'ok'; } catch (e) { un2 = e.code; }
  console.log(`MEASURED B unlink of the held DeleteOnClose file: ${un2}`);
  probe('B after unlink, still held by PowerShell', 'delete-on-close');
  child.on('exit', () => {
    probe('B after PowerShell exits', 'delete-on-close');
    // C: the classic (non-POSIX) delete disposition, set by SetFileInformationByHandle(FileDispositionInfo) on a held
    // handle: the name should stay, delete-pending, until the handle closes. The shape an attacker would choose.
    const c = path.join(dir, 'legacy-pending');
    const cs = `Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices; using Microsoft.Win32.SafeHandles;
public static class D { [StructLayout(LayoutKind.Sequential)] public struct FDI { public byte Delete; }
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool SetFileInformationByHandle(SafeFileHandle h, int cls, ref FDI info, int size);
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)] public static extern SafeFileHandle CreateFileW(string n, uint a, uint s, IntPtr sec, uint d, uint f, IntPtr t); }
'@
$h=[D]::CreateFileW('${c}', [uint32]2147549184, 7, [IntPtr]::Zero, 1, 128, [IntPtr]::Zero); Write-Output ("MEASURED C CreateFileW invalid=" + $h.IsInvalid + " err " + [Runtime.InteropServices.Marshal]::GetLastWin32Error());
$i=New-Object D+FDI; $i.Delete=1; $ok=[D]::SetFileInformationByHandle($h,4,[ref]$i,1); Write-Output ("MEASURED C SetFileInformationByHandle " + $ok + " err " + [Runtime.InteropServices.Marshal]::GetLastWin32Error());
New-Item -ItemType File -Path '${c}.ready' | Out-Null; Start-Sleep 20; $h.Close()`;
    const cc = cp.spawn('powershell', ['-NoProfile', '-Command', cs], { stdio: 'inherit' });
    const t1 = Date.now(); while (!fs.existsSync(c + '.ready') && Date.now() - t1 < 30000) cp.execSync('ping -n 2 127.0.0.1 >NUL');
    probe('C classic delete disposition, held', 'legacy-pending');
    cc.on('exit', () => { probe('C after PowerShell exits', 'legacy-pending'); console.log('MEASURED os ' + os.release() + ' node ' + process.version); });
  });
} else { console.log('MEASURED not win32: ' + process.platform); }
