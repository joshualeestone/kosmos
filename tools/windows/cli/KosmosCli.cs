// kosmos.exe: the Windows agent's `kosmos` command for callers that are NOT a shell
// with its own shim (kosmos#8770). Shipped as <zip>\bin\kosmos.exe beside kosmos.ps1
// (PowerShell) and the extensionless kosmos (Git Bash), by tools/build-kosmos-windows.sh.
//
// WHO RUNS THIS ONE (measured on the Windows box, all three files in one folder):
// Windows PowerShell 5.1 and pwsh 7 still resolve a bare `kosmos` to kosmos.ps1, and
// Git Bash to the extensionless shim. cmd.exe, a scheduled task, and node's
// child_process spawn('kosmos', args) WITHOUT a shell resolve to this exe. Before it,
// all of those failed with "'kosmos' is not recognized", and a script that read that
// failure as an empty answer took "no agents" for the truth.
//
// WHY AN EXE AND NOT A .cmd: cmd re-parses %* inside a batch file, so a caller that
// escaped correctly for ONE parse (`kosmos msg x a^&calc`) has the caret eaten by its
// own parse and the batch line then runs `calc` (the "BatBadBut" class; node refuses
// to spawn a .cmd without a shell for this reason). A .cmd was shipped once and
// removed for exactly this. This program is started by CreateProcess with the
// caller's argv; the CLR splits it by the Windows rules every launcher writes for.
//
// WHAT IT DOES, and nothing more: the words go to kosmos-cli.js as JSON in a private
// temp file named by --kosmos-argv-file, exactly as kosmos.ps1 sends them, so no
// second command line ever carries them (a message may hold quotes, &, %, newlines).
// node runs with this process's own stdin, stdout and stderr, so piped input and
// captured output both work, and the CLI's exit code comes back unchanged (0, 1, 2,
// 3 for "maybe"). A failure here is exit 1 with a sentence on stderr.
//
// COMMITTED, NOT BUILT DURING THE CUT, and signed, like Kosmos.exe: see
// tools/windows/README.md ("The kosmos command for other launchers").
//
// THE CHILD DIES WITH THIS PROCESS (review round 1). A caller's timeout (spawnSync's
// `timeout`, child.kill(), a scheduled task's time limit) kills only this exe; node
// would live on holding the caller's stdout and stderr, so a caller waiting for those
// pipes to close would hang. node runs in a job object that is closed, and so killed,
// when this process ends for any reason. And Ctrl+C is left to node: the console sends
// it to both, and this process waits for node's own exit instead of returning first.
// ⚠️ EVERYTHING node starts is in the job too, so it ends with the command. No verb
// of kosmos-cli.js starts anything meant to outlive it today (restarts go through the
// board over HTTP). A verb that ever does must leave the job (a breakaway flag on the
// job and CREATE_BREAKAWAY_FROM_JOB on that child), or it will be killed silently.
using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

static class KosmosCli
{
    static int Main(string[] args)
    {
        string argvFile = null;
        // Ctrl+C only: Ctrl+Break still ends this process, and the job then ends node, so a
        // node that ever handles SIGBREAK cannot leave this waiting (review round 2).
        Console.CancelKeyPress += (s, e) => { if (e.SpecialKey == ConsoleSpecialKey.ControlC) e.Cancel = true; };
        try
        {
            string bin = AppDomain.CurrentDomain.BaseDirectory;
            string node = Path.GetFullPath(Path.Combine(bin, @"..\runtime\node.exe"));
            string cli = Path.Combine(bin, "kosmos-cli.js");
            if (!File.Exists(node)) return Fail("the runtime is missing (" + node + ")");
            if (!File.Exists(cli)) return Fail("the command is missing (" + cli + ")");

            argvFile = Path.Combine(Path.GetTempPath(), "kosmos-argv-" + Guid.NewGuid().ToString("N") + ".json");
            // Throws on a lone surrogate rather than writing U+FFFD: a word that would
            // change is refused (exit 1), never sent different (review round 1).
            File.WriteAllText(argvFile, JsonArray(args), new UTF8Encoding(false, true));
            // This process joins the job BEFORE node starts, so node is in it from its first
            // instruction: no gap in which a kill of this exe leaves node outside (review
            // round 2). Best effort: a job that cannot be made or joined leaves the command
            // working as before. The handle is never closed here; this process's exit does it.
            IntPtr job = KillOnCloseJob();
            if (job != IntPtr.Zero) AssignProcessToJobObject(job, GetCurrentProcess());

            // Two paths only, each quoted; a Windows path cannot contain a quote, and
            // neither ends in a backslash, so this line needs no further escaping.
            string commandLine = "\"" + node + "\" \"" + cli + "\" --kosmos-argv-file \"" + argvFile + "\"";
            return RunWithOurStdio(node, commandLine);
        }
        catch (Exception e)
        {
            return Fail(e.Message);
        }
        finally
        {
            // kosmos-cli.js deletes the file as soon as it has read it; this is the backstop.
            if (argvFile != null) { try { File.Delete(argvFile); } catch { } }
        }
    }

    // node gets EXACTLY this process's stdin, stdout and stderr, whatever they are: a
    // console, pipes, files, or nothing (review round 3). .NET's Process.Start passes no
    // standard handles when nothing is redirected, so under a caller that started this
    // exe with no console (node spawn with detached: true, piped) node opened a console
    // of its own and every word it wrote was lost: exit code right, output empty
    // (measured). CreateProcess with STARTF_USESTDHANDLES hands over inheritable copies
    // of our three handles; with no console of our own, node gets none either
    // (CREATE_NO_WINDOW), so no window flashes. Returns node's exit code.
    static int RunWithOurStdio(string node, string commandLine)
    {
        IntPtr self = GetCurrentProcess();
        var si = new STARTUPINFO();
        si.cb = Marshal.SizeOf(typeof(STARTUPINFO));
        si.dwFlags = STARTF_USESTDHANDLES;
        si.hStdInput = InheritableCopy(self, GetStdHandle(STD_INPUT_HANDLE));
        si.hStdOutput = InheritableCopy(self, GetStdHandle(STD_OUTPUT_HANDLE));
        si.hStdError = InheritableCopy(self, GetStdHandle(STD_ERROR_HANDLE));
        // No console at all (not merely no window: a console started hidden still counts,
        // review round 4): node must not get a fresh one of its own.
        uint flags = 0;
        if (GetConsoleCP() == 0) flags |= CREATE_NO_WINDOW;
        PROCESS_INFORMATION pi;
        try
        {
            if (!CreateProcess(node, new StringBuilder(commandLine), IntPtr.Zero, IntPtr.Zero, true, flags,
                    IntPtr.Zero, null, ref si, out pi))
                throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        }
        finally
        {
            // node holds its own copies now; ours are closed whether or not it started.
            CloseIfSet(si.hStdInput); CloseIfSet(si.hStdOutput); CloseIfSet(si.hStdError);
        }
        try
        {
            if (WaitForSingleObject(pi.hProcess, INFINITE) != WAIT_OBJECT_0)
                throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
            uint code;
            if (!GetExitCodeProcess(pi.hProcess, out code)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
            return unchecked((int)code);
        }
        finally
        {
            CloseHandle(pi.hThread);
            CloseHandle(pi.hProcess);
        }
    }

    // An inheritable duplicate of a standard handle. When there is none (a process started
    // with that stream closed), an inheritable handle to NUL instead, as libuv does for an
    // ignored stream: with no stream at all, node falls back to a console nobody can see
    // and reports stdin as a terminal, so a yes/no prompt would wait there for good
    // (review round 4, measured). Zero only if even NUL cannot be opened.
    static IntPtr InheritableCopy(IntPtr self, IntPtr h)
    {
        IntPtr dup;
        if (h != IntPtr.Zero && h != new IntPtr(-1) && DuplicateHandle(self, h, self, out dup, 0, true, DUPLICATE_SAME_ACCESS)) return dup;
        var sa = new SECURITY_ATTRIBUTES();
        sa.nLength = Marshal.SizeOf(typeof(SECURITY_ATTRIBUTES));
        sa.bInheritHandle = true;
        IntPtr nul = CreateFile("NUL", GENERIC_READ | GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE, ref sa, OPEN_EXISTING, 0, IntPtr.Zero);
        return nul == new IntPtr(-1) ? IntPtr.Zero : nul;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct SECURITY_ATTRIBUTES
    {
        public int nLength;
        public IntPtr lpSecurityDescriptor;
        public bool bInheritHandle;
    }

    const uint GENERIC_READ = 0x80000000, GENERIC_WRITE = 0x40000000;
    const uint FILE_SHARE_READ = 1, FILE_SHARE_WRITE = 2, OPEN_EXISTING = 3, WAIT_OBJECT_0 = 0;

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern IntPtr CreateFile(string name, uint access, uint share, ref SECURITY_ATTRIBUTES security,
        uint creation, uint flags, IntPtr template);

    [DllImport("kernel32.dll")]
    static extern uint GetConsoleCP();

    static void CloseIfSet(IntPtr h) { if (h != IntPtr.Zero) CloseHandle(h); }

    const int STD_INPUT_HANDLE = -10, STD_OUTPUT_HANDLE = -11, STD_ERROR_HANDLE = -12;
    const int STARTF_USESTDHANDLES = 0x100;
    const uint CREATE_NO_WINDOW = 0x08000000;
    const uint DUPLICATE_SAME_ACCESS = 2, INFINITE = 0xFFFFFFFF;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct STARTUPINFO
    {
        public int cb;
        public string lpReserved, lpDesktop, lpTitle;
        public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
        public short wShowWindow, cbReserved2;
        public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct PROCESS_INFORMATION
    {
        public IntPtr hProcess, hThread;
        public int dwProcessId, dwThreadId;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool CreateProcess(string applicationName, StringBuilder commandLine, IntPtr processAttributes,
        IntPtr threadAttributes, bool inheritHandles, uint creationFlags, IntPtr environment, string currentDirectory,
        ref STARTUPINFO startupInfo, out PROCESS_INFORMATION processInformation);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr GetStdHandle(int which);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool DuplicateHandle(IntPtr sourceProcess, IntPtr source, IntPtr targetProcess, out IntPtr target,
        uint access, bool inherit, uint options);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool CloseHandle(IntPtr handle);

    // A job whose processes are killed when its last handle closes, which is when this
    // process exits. Zero when Windows will not make one.
    static IntPtr KillOnCloseJob()
    {
        IntPtr job = CreateJobObject(IntPtr.Zero, null);
        if (job == IntPtr.Zero) return IntPtr.Zero;
        var info = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        int size = Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
        IntPtr ptr = Marshal.AllocHGlobal(size);
        try
        {
            Marshal.StructureToPtr(info, ptr, false);
            if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, ptr, (uint)size)) { CloseHandle(job); return IntPtr.Zero; }
        }
        finally { Marshal.FreeHGlobal(ptr); }
        return job;
    }

    const int JobObjectExtendedLimitInformation = 9;
    const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000;

    [StructLayout(LayoutKind.Sequential)]
    struct JOBOBJECT_BASIC_LIMIT_INFORMATION
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct IO_COUNTERS
    {
        public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount;
        public ulong ReadTransferCount, WriteTransferCount, OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern IntPtr CreateJobObject(IntPtr attributes, string name);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool SetInformationJobObject(IntPtr job, int infoClass, IntPtr info, uint length);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

    [DllImport("kernel32.dll")]
    static extern IntPtr GetCurrentProcess();

    static int Fail(string why)
    {
        Console.Error.WriteLine("kosmos could not run: " + why);
        return 1;
    }

    // A JSON array of strings. Every character JSON requires escaped is escaped; the
    // rest go as UTF-8 text, which the file is written in.
    static string JsonArray(string[] words)
    {
        var sb = new StringBuilder("[");
        for (int i = 0; i < words.Length; i++)
        {
            if (i > 0) sb.Append(',');
            sb.Append('"');
            foreach (char c in words[i] ?? "")
            {
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4"));
                        else sb.Append(c);
                        break;
                }
            }
            sb.Append('"');
        }
        return sb.Append(']').ToString();
    }
}
