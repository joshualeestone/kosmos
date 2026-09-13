// Kosmos.exe -- the Windows launcher, as a SIGNABLE binary.
//
// WHY THIS EXISTS. The shipped entry point is Kosmos.cmd, and a .cmd file
// CANNOT carry an Authenticode signature -- measured, not assumed:
// Get-AuthenticodeSignature on a .cmd returns UnknownError, because batch files
// have nowhere to put one. So the certificate Josh is buying would have had
// nothing to sign: the only file a user double-clicks is the one file in the
// package that is structurally unsignable. A PE binary can be signed, so the
// entry point has to become one before a certificate buys anything.
//
// WHAT IT DOES:
//   1. launch open-board.js (the #2007 authenticated-open helper) detached
//   2. run app/server.js, which hands the board to its logon task and exits
//   3. propagate its exit code
// Those three are exactly what Kosmos.cmd did, with the same arguments. The rest
// is how a Windows program presents itself (win32-launcher-native): it is a GUI
// app, so a double-click opens no console window, and a problem is a message
// box titled "Kosmos" instead of console text. `--console` keeps the console
// behaviour for support. It still does no thinking of its own about the board:
// a launcher that does is a second place for Windows-only bugs to live.
//
// AND IT DOES AN INSTALLER'S JOB (win32-installer-native), a deliberate reversal of
// "does nothing more than the .cmd did": the zip has no installer, so the launcher
// gives Kosmos a Start menu entry, an entry in Settings > Apps whose Uninstall runs
// `--uninstall`, and an offer to move out of Downloads. Only the Windows-shell half
// lives here (IShellLink, the registry, Known Folders, the questions). Everything
// that is already a fact in the engine -- the tasks, the data folders, what a build
// is made of, whether a board serves from this folder -- is asked of the engine's
// own helpers (app\engine\win32uninstall.js, win32relocate.js), so there is still
// one copy of each.
//
// It is a .NET Framework app because every Windows 10/11 machine ships the 4.x
// runtime -- no dependency to install, no bundled runtime to sign.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using Microsoft.Win32;

// FileDescription (AssemblyTitle) is the name Task Manager, the taskbar and
// SmartScreen's "App:" line show. AssemblyCompany is deliberately absent: it has
// to match the subject of the code-signing certificate, which is not issued yet.
[assembly: AssemblyTitle("Kosmos")]
[assembly: AssemblyProduct("Kosmos")]
[assembly: AssemblyVersion(KosmosLauncher.LauncherVersion)]
[assembly: AssemblyFileVersion(KosmosLauncher.LauncherVersion)]
[assembly: AssemblyInformationalVersion(KosmosLauncher.LauncherProductVersion)]

class KosmosLauncher
{
    // The LAUNCHER's version, not the app's. This binary is committed and copied
    // into every zip unchanged (tools/windows/README.md), so an app version
    // stamped here would be wrong from the next release on. It moves only when
    // this file does. 1 was the #2086 console launcher; 2 is the GUI one; 3 does
    // an installer's job (win32-installer-native).
    public const string LauncherVersion = "3.0.0.0";
    // Explorer's "Product version". Worded so nobody reads it as the Kosmos
    // version, which lives in manifest.json and on the board.
    public const string LauncherProductVersion = "launcher 3.0";

    // Kept in step with tools/build-kosmos-windows.sh, which reads the board's
    // default out of server.js and refuses the build if this disagrees. If it
    // ever drifts, the launcher opens a port nothing serves.
    const int DefaultPort = 16180;

    // Every message box this program shows carries this title, so the person
    // can tell which program is speaking.
    const string WindowTitle = "Kosmos";

    const string ConsoleFlag = "--console";

    // What Settings > Apps > Installed apps > Uninstall runs (see Uninstall).
    const string UninstallFlag = "--uninstall";

    // The engine helpers' word that the person confirmed: engine/win32uninstall.js and
    // win32relocate.js are dry runs without it. Passed only after the question was answered.
    const string ConfirmedFlag = "--yes";
    const string UninstallHelperScript = "win32uninstall.js";
    const string RelocateHelperScript = "win32relocate.js";

    // When to start asking whether the board started here is serving from here,
    // counted from its own start: engine/win32handoff.js's
    // HANDOFF_CHECK_FOR_SERVING_AFTER_MS (the budget plus its floors), pinned
    // equal by tools.win-launcher-native.test.js. It is NOT a worst case: the
    // hand-off's schtasks calls and a slow first boot can both run past it. So
    // time alone never shows the box. From this mark the launcher polls, and the
    // box waits for the board to be listening, which it does only once it has
    // decided to serve here.
    const int CheckForServingAfterMs = 18000;

    // How often, from that mark, the launcher looks for the board's listener:
    // quick enough that the box follows the board within a moment, rare enough
    // that reading the TCP table costs nothing noticeable.
    const int ServingPollMs = 300;

    // When the TCP table cannot be read at all (every poll so far failed), there is
    // no listener proof, so the box falls back to time -- but a time no successful
    // hand-off reaches: CheckForServingAfterMs, plus win32board's schtasks call
    // timeout, plus a margin. That is engine/win32handoff.js's
    // HANDOFF_UNREADABLE_LISTENER_FALLBACK_MS, pinned equal by the test. The
    // slowest hand-off that still succeeds (the 12s budget, a /Run that takes its
    // whole 20s timeout, and a 2s confirming probe) has exited by then.
    const int UnreadableTableFallbackMs = 45000;

    // Shown once the board is listening from here: it did not move to its logon
    // task and is serving from this launcher, which has no window, so this box
    // is the person's handle on it.
    const string RunningHereMessage =
        "Kosmos couldn't move to the background, so it's running from here instead. Keep this box open while you use Kosmos. Click OK to stop Kosmos. To see why, run Kosmos.exe --console.";

    // The window class of every Windows message box, ours included.
    const string DialogWindowClass = "#32770";

    // How often the box is asked to close once the board has ended: short
    // enough that the box goes away with the board, not noticeably after.
    const int CloseBoxRetryMs = 100;

    // The most common Windows mistake: double-clicking Kosmos.exe inside the zip
    // in Explorer, which runs that one file from a temp folder with nothing
    // beside it. The words are Explorer's own ("Extract All...").
    const string InsideZipMessage =
        "Kosmos is still inside the zip file. Close this window, right-click the zip in your Downloads folder, choose Extract All..., then open the extracted folder and double-click Kosmos.exe.";

    const string PartialExtractAdvice =
        "Some of its files are missing, which usually means the zip was only partly extracted. Extract the whole zip again with Extract All..., keeping the folders together, then double-click Kosmos.exe in the extracted folder.";

    // True for a person at a visible desktop who did not ask for --console.
    // False for --console, and for any non-interactive context (a service, or a
    // task set to run whether or not the user is signed in): there, a message
    // box would wait forever on a desktop nobody can see, so text goes to stderr.
    // internal only so the probe a test compiles beside this file can play a person at a desktop.
    internal static bool showMessageBoxes;

    static string Here()
    {
        // The EXE's own directory, not the working directory: a user can launch
        // this from a shortcut, from Explorer, or from a shell sitting anywhere,
        // and %~dp0's equivalent has to be the binary's location in all three.
        return Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
    }

    // STA: the move dialog is Windows Forms and the Start menu shortcut is COM, and both
    // expect the thread a GUI program's Main runs on.
    [STAThread]
    static int Main(string[] args)
    {
        bool wantsConsole = Array.Exists(args, a => string.Equals(a, ConsoleFlag, StringComparison.OrdinalIgnoreCase));
        bool wantsUninstall = Array.Exists(args, a => string.Equals(a, UninstallFlag, StringComparison.OrdinalIgnoreCase));
        showMessageBoxes = !wantsConsole && Environment.UserInteractive;
        if (!showMessageBoxes) ConnectToAConsole();

        string here = Here();
        string node = Path.Combine(here, "runtime\\node.exe");
        string server = Path.Combine(here, "app\\server.js");
        string opener = Path.Combine(here, "open-board.js");
        string app = Path.Combine(here, "app");

        // --uninstall is its own errand, decided before anything else: it asks first, never
        // starts the board, never offers a move or refreshes the Start menu, and checks for
        // the two files it needs itself (Uninstall, RunEngineHelper).
        if (wantsUninstall) return Uninstall(here, node);

        // 🛑 NOTHING OF THE BOARD'S IS STARTED ABOVE THESE TWO CHECKS. The board's hand-off to its
        // logon task happens inside server.js, so a folder without the runtime
        // provably never reaches it -- which is what lets the tests run this exe.
        if (!File.Exists(node))
        {
            if (RunningFromInsideAZip(here)) return FailInsideZip();
            return Fail("the bundled runtime is missing (runtime\\node.exe).");
        }
        if (!File.Exists(server)) return Fail("the application is missing (app\\server.js).");

        int port = BoardPort();

        // win32-installer-native: a real build (manifest.json, see IsKosmosBuild) running from
        // Downloads, the Desktop, OneDrive or a temporary folder hands off to the Kosmos already
        // installed in its own folder, or is offered a move there; then it points its Start menu
        // shortcut and its Settings > Apps entry at wherever it runs from (RunInstallerDuties). A
        // folder without the manifest -- a partial extract, or any test's scratch folder -- does
        // none of it, so it never touches the Start menu or the registry.
        int? endedByInstallerDuties = RunInstallerDuties(here, node, port);
        if (endedByInstallerDuties.HasValue) return endedByInstallerDuties.Value;

        // The opener waits for the board itself and falls back to the plain url,
        // so it is safe to start BEFORE the server is listening -- that is the
        // #2031 design and the .cmd relied on it too.
        string browserProblem = null;
        if (File.Exists(opener))
        {
            try
            {
                ProcessStartInfo o = new ProcessStartInfo(node,
                    "\"" + opener + "\" --port " + port + " --app \"" + app + "\"");
                o.UseShellExecute = false;
                o.CreateNoWindow = true;
                o.WorkingDirectory = here;
                Process.Start(o);
            }
            catch (Exception e)
            {
                // Not fatal: the board is what matters, and the user can reach it
                // by hand. Say so rather than dying with the board about to work.
                browserProblem = "Kosmos could not open your browser (" + e.Message + ").";
                if (!showMessageBoxes)
                {
                    Console.Error.WriteLine(browserProblem);
                    Console.Error.WriteLine("Open http://127.0.0.1:" + port + " yourself.");
                }
            }
        }

        if (!showMessageBoxes)
        {
            Console.WriteLine("Starting Kosmos. A browser will open in a moment.");
            Console.WriteLine("If it does not, open http://127.0.0.1:" + port + " yourself.");
            Console.WriteLine();
        }

        ProcessStartInfo s = new ProcessStartInfo(node, "\"" + server + "\"");
        s.UseShellExecute = false;
        s.WorkingDirectory = here;
        // With --console the server shares this console, whose output IS the
        // status. Without it there is no console to share, so the server runs on
        // a hidden one -- as the opener does, and as the logon task's
        // `conhost --headless` board does. Its stdio is NOT redirected: a pipe
        // would change what the server sees, and WaitForExit would wait for every
        // grandchild holding the pipe open.
        s.CreateNoWindow = showMessageBoxes;

        Process p;
        try { p = Process.Start(s); }
        catch (Exception e) { return Fail("the runtime would not start (" + e.Message + ")."); }

        Stopwatch sinceServerStarted = Stopwatch.StartNew();

        if (browserProblem != null && showMessageBoxes)
        {
            ShowMessageBox(browserProblem + "\n\nOpen http://127.0.0.1:" + port + " in your browser yourself.", false);
        }

        // A board that hands off to its logon task exits 0. One that serves from
        // here does so on a console nobody can see, so the person gets a box to
        // keep it by (see KeepBoardUntilPersonStopsIt). Time alone cannot tell the
        // two apart, so the box waits for proof: the board LISTENING, which it
        // does only once it has decided to serve here. If the TCP table has never
        // once been readable, there can be no proof, and the box falls back to a
        // time past any successful hand-off (UnreadableTableFallbackMs); a single
        // readable poll puts the listener rule back in charge. With --console, or
        // with nobody at the desktop, the launcher just waits, as it always did.
        bool stoppedByPerson = false;
        if (showMessageBoxes)
        {
            int stillToWaitMs = CheckForServingAfterMs - (int)sinceServerStarted.ElapsedMilliseconds;
            if (!p.WaitForExit(Math.Max(0, stillToWaitMs)))
            {
                bool everyReadFailed = true;
                while (!p.WaitForExit(ServingPollMs))
                {
                    ListenerAnswer answer = ListenerStateOf(p.Id);
                    if (answer != ListenerAnswer.CouldNotRead) everyReadFailed = false;
                    bool provablyServingHere = answer == ListenerAnswer.Listening;
                    bool unreadableLongPastAnyHandOff = everyReadFailed && sinceServerStarted.ElapsedMilliseconds >= UnreadableTableFallbackMs;
                    if (provablyServingHere || unreadableLongPastAnyHandOff) { stoppedByPerson = KeepBoardUntilPersonStopsIt(p); break; }
                }
            }
        }

        p.WaitForExit();
        if (p.ExitCode != 0 && !stoppedByPerson)
        {
            if (showMessageBoxes)
            {
                ShowMessageBox("Kosmos stopped unexpectedly (exit code " + p.ExitCode + ").\n\n"
                    + "Double-click Kosmos.exe to try again. To see why it stopped, open its folder in File Explorer (" + here + "), click the address bar, type cmd, press Enter, then run:\n\n"
                    + "start /wait Kosmos.exe " + ConsoleFlag, true);
            }
            else
            {
                Console.Error.WriteLine();
                Console.Error.WriteLine("Kosmos stopped. The lines above say why.");
                Hold();
            }
        }
        return p.ExitCode;
    }

    // The board's port: PORT when it is a usable number, the board's default otherwise. ONE
    // derivation, read by the browser opener, the move, and the uninstall's "is Kosmos still open"
    // check (engine/win32uninstall.js asks this port who answers before it changes anything).
    static int BoardPort()
    {
        int port = DefaultPort;
        string env = Environment.GetEnvironmentVariable("PORT");
        if (!string.IsNullOrEmpty(env))
        {
            int parsed;
            // ⚠️ A bad PORT is IGNORED, not fatal. The server reads PORT itself and
            // applies its own default; refusing to start here would turn a stray
            // environment variable into "Kosmos is broken" on a machine where the
            // server would have come up fine.
            if (int.TryParse(env, out parsed) && parsed > 0 && parsed < 65536) port = parsed;
        }
        return port;
    }

    static int Fail(string what)
    {
        if (showMessageBoxes)
        {
            ShowMessageBox("Kosmos could not start: " + what + "\n\n" + PartialExtractAdvice, true);
            return 1;
        }
        Console.Error.WriteLine();
        Console.Error.WriteLine("Kosmos could not start: " + what);
        Console.Error.WriteLine();
        Console.Error.WriteLine(PartialExtractAdvice);
        Hold();
        return 1;
    }

    static int FailInsideZip()
    {
        if (showMessageBoxes)
        {
            ShowMessageBox(InsideZipMessage, false);
            return 1;
        }
        Console.Error.WriteLine();
        Console.Error.WriteLine(InsideZipMessage);
        Hold();
        return 1;
    }

    // ---- where is this running from? ------------------------------------------

    // Explorer runs an exe double-clicked inside a zip from
    // %TEMP%\Temp1_<zip name>.zip\, and 7-Zip and WinRAR extract to %TEMP% too.
    // So: any path segment ending in .zip, or anywhere under a temp folder.
    // Only consulted once the runtime is known to be missing, so the worst a
    // false match can do is choose between two "extract it again" messages.
    static bool RunningFromInsideAZip(string exeDirectory)
    {
        string directory = FullPathOrNull(exeDirectory) ?? exeDirectory;
        foreach (string segment in directory.Split('\\', '/'))
        {
            if (segment.EndsWith(".zip", StringComparison.OrdinalIgnoreCase)) return true;
        }
        foreach (string temp in TempFolders())
        {
            if (IsSameOrInside(directory, temp)) return true;
        }
        return false;
    }

    static string[] TempFolders()
    {
        string[] candidates = {
            SafeTempPath(),
            Environment.GetEnvironmentVariable("TEMP"),
            Environment.GetEnvironmentVariable("TMP"),
        };
        string[] resolved = new string[candidates.Length];
        for (int i = 0; i < candidates.Length; i++) resolved[i] = FullPathOrNull(candidates[i]);
        return resolved;
    }

    static string SafeTempPath()
    {
        try { return Path.GetTempPath(); } catch { return null; }
    }

    static bool IsSameOrInside(string directory, string root)
    {
        if (string.IsNullOrEmpty(root)) return false;
        root = root.TrimEnd('\\', '/');
        // A temp folder set to a whole drive (TEMP=C:\) would claim every folder
        // on it, so a drive root never counts.
        if (root.Length == 0 || root.EndsWith(":")) return false;
        directory = directory.TrimEnd('\\', '/');
        return string.Equals(directory, root, StringComparison.OrdinalIgnoreCase)
            || directory.StartsWith(root + "\\", StringComparison.OrdinalIgnoreCase);
    }

    // Raw TEMP and TMP values are compared in the same full-path form
    // Path.GetTempPath() returns. An 8.3 short name on either side (a profile
    // whose name is long or has a space) already matches: measured on .NET 4.8,
    // GetTempPath() returns the long form of a short TEMP, and the exe's
    // Assembly.Location is long even when it was launched by its short path.
    // tools.win-launcher-native runs both mixes.
    static string FullPathOrNull(string path)
    {
        if (string.IsNullOrEmpty(path)) return null;
        try { return Path.GetFullPath(path); }
        catch { return null; /* a malformed value is not a folder to compare */ }
    }

    // ---- is the board serving from here? ------------------------------------

    internal enum ListenerAnswer { Listening, NotListening, CouldNotRead }

    // Whether the process owns a TCP socket in LISTEN state, over IPv4 or IPv6,
    // or that the table could not be read. The board's only TCP listener is its
    // http server, which server.js starts only after deciding not to hand off
    // (named pipes, which agents use, are not in this table).
    // Never throws: a missing iphlpapi entry point, a buffer that cannot be
    // allocated, anything, is CouldNotRead, because a crash here would take the
    // person's only handle on the board with it. internal rather than private
    // only so that a probe compiled beside this file in a test's scratch folder
    // can call it.
    internal static ListenerAnswer ListenerStateOf(int processId)
    {
        try
        {
            ListenerAnswer overIPv4 = TcpListenerStateOf(processId, AF_INET, IPV4_ROW_BYTES, IPV4_ROW_OWNING_PID_OFFSET);
            if (overIPv4 == ListenerAnswer.Listening) return overIPv4;
            ListenerAnswer overIPv6 = TcpListenerStateOf(processId, AF_INET6, IPV6_ROW_BYTES, IPV6_ROW_OWNING_PID_OFFSET);
            if (overIPv6 == ListenerAnswer.Listening) return overIPv6;
            bool eitherUnreadable = overIPv4 == ListenerAnswer.CouldNotRead || overIPv6 == ListenerAnswer.CouldNotRead;
            return eitherUnreadable ? ListenerAnswer.CouldNotRead : ListenerAnswer.NotListening;
        }
        catch { return ListenerAnswer.CouldNotRead; }
    }

    static ListenerAnswer TcpListenerStateOf(int processId, int addressFamily, int rowBytes, int owningPidOffset)
    {
        int bufferBytes = 0;
        for (int attempt = 0; attempt < TCP_TABLE_READ_ATTEMPTS; attempt++)
        {
            IntPtr table = bufferBytes > 0 ? Marshal.AllocHGlobal(bufferBytes) : IntPtr.Zero;
            try
            {
                uint result = readTcpTable(table, ref bufferBytes, addressFamily);
                // Too small (or the first, sizing call): bufferBytes now holds the
                // size needed, and the table may grow again before the next read.
                if (result == ERROR_INSUFFICIENT_BUFFER) continue;
                if (result != NO_ERROR || table == IntPtr.Zero) return ListenerAnswer.CouldNotRead;
                int rows = Marshal.ReadInt32(table);
                for (int row = 0; row < rows; row++)
                {
                    if (Marshal.ReadInt32(table, TCP_TABLE_ROWS_OFFSET + row * rowBytes + owningPidOffset) == processId) return ListenerAnswer.Listening;
                }
                return ListenerAnswer.NotListening;
            }
            finally
            {
                if (table != IntPtr.Zero) Marshal.FreeHGlobal(table);
            }
        }
        return ListenerAnswer.CouldNotRead;
    }

    const int AF_INET = 2;
    const int AF_INET6 = 23;
    // Only rows in LISTEN state, each with its owning process id.
    const int TCP_TABLE_OWNER_PID_LISTENER = 3;
    const uint NO_ERROR = 0;
    const uint ERROR_INSUFFICIENT_BUFFER = 122;
    // MIB_TCPTABLE_OWNER_PID and MIB_TCP6TABLE_OWNER_PID: a DWORD row count, then the rows.
    const int TCP_TABLE_ROWS_OFFSET = 4;
    // MIB_TCPROW_OWNER_PID: six DWORDs -- state, local address, local port,
    // remote address, remote port, owning pid.
    const int IPV4_ROW_BYTES = 24;
    const int IPV4_ROW_OWNING_PID_OFFSET = 20;
    // MIB_TCP6ROW_OWNER_PID: local address (16 bytes), local scope, local port,
    // remote address (16 bytes), remote scope, remote port, state, owning pid.
    const int IPV6_ROW_BYTES = 56;
    const int IPV6_ROW_OWNING_PID_OFFSET = 52;
    // The table can grow between the sizing call and the read; a few tries cover it.
    const int TCP_TABLE_READ_ATTEMPTS = 5;

    [DllImport("iphlpapi.dll", SetLastError = true)]
    static extern uint GetExtendedTcpTable(IntPtr table, ref int bufferBytes, bool sorted, int addressFamily, int tableClass, uint reserved);

    // The one call that reads the table, as a replaceable delegate. The launcher
    // never replaces it; the listener probe a test compiles beside this file swaps
    // in a failing or throwing reader, to prove both come back as CouldNotRead.
    internal delegate uint TcpTableReader(IntPtr table, ref int bufferBytes, int addressFamily);
    internal static TcpTableReader readTcpTable = ReadTcpTableFromWindows;

    static uint ReadTcpTableFromWindows(IntPtr table, ref int bufferBytes, int addressFamily)
    {
        return GetExtendedTcpTable(table, ref bufferBytes, false, addressFamily, TCP_TABLE_OWNER_PID_LISTENER, 0);
    }

    // ---- presenting to a person ----------------------------------------------

    // In its own method, and never inlined, so the ordinary launch -- which
    // shows no box -- never loads Windows Forms at all.
    [MethodImpl(MethodImplOptions.NoInlining)]
    static void ShowMessageBox(string text, bool isError)
    {
        try { SetProcessDPIAware(); } catch { /* blurry text is better than no text */ }
        try
        {
            // Visual styles make it a current Windows dialog, not a Windows 95 one.
            System.Windows.Forms.Application.EnableVisualStyles();
            System.Windows.Forms.MessageBox.Show(text, WindowTitle,
                System.Windows.Forms.MessageBoxButtons.OK,
                isError ? System.Windows.Forms.MessageBoxIcon.Error : System.Windows.Forms.MessageBoxIcon.Warning);
        }
        catch
        {
            // Windows Forms ships with every .NET 4 install, but a message that
            // never shows is how a real error becomes "it just didn't do
            // anything", so fall back to the plain user32 box.
            MessageBoxW(IntPtr.Zero, text, WindowTitle, isError ? MB_ICONERROR : MB_ICONWARNING);
        }
    }

    // Set once the running-here box has returned, so the thread closing it stops.
    // Read and written only under runningHereBoxLock.
    static bool boxIsClosed;
    static readonly object runningHereBoxLock = new object();

    // The board did not move to its logon task, so it is serving from this
    // launcher's hidden console. Nothing about that is visible or closable, so
    // this box is the person's handle on it: OK stops the board, and the box
    // closes by itself if the board ends first. True when the person stopped it.
    static bool KeepBoardUntilPersonStopsIt(Process server)
    {
        uint boxThread = GetCurrentThreadId();
        boxIsClosed = false;
        Thread closeBoxWhenBoardEnds = new Thread(() =>
        {
            server.WaitForExit();
            EnumWindowsProc closeDialogs = (window, unused) =>
            {
                StringBuilder className = new StringBuilder(64);
                GetClassName(window, className, className.Capacity);
                if (className.ToString() == DialogWindowClass) PostMessage(window, WM_CLOSE, IntPtr.Zero, IntPtr.Zero);
                return true;
            };
            // Retried until the box has returned: the board can end in the moment
            // before the box's window exists, and a WM_CLOSE then lands nowhere.
            // The check and the enumeration happen under the lock the main thread
            // takes to mark the box closed, so a box shown after this one (the
            // crash box) can never be sent a WM_CLOSE meant for this one.
            while (true)
            {
                lock (runningHereBoxLock)
                {
                    if (boxIsClosed) return;
                    EnumThreadWindows(boxThread, closeDialogs, IntPtr.Zero);
                }
                Thread.Sleep(CloseBoxRetryMs);
            }
        });
        closeBoxWhenBoardEnds.IsBackground = true;
        closeBoxWhenBoardEnds.Start();

        ShowMessageBox(RunningHereMessage, false);
        lock (runningHereBoxLock) { boxIsClosed = true; }
        if (server.HasExited) return false;
        StopServerAndEverythingItStarted(server);
        return true;
    }

    // taskkill /T ends the board and every process still descended from it (its
    // hidden console, anything it spawned). Agents are not among them: each runs
    // under its own Scheduled Task, as does the logon task's board. There is no
    // window to report a failed taskkill in, so it falls back to ending the
    // board process itself.
    static void StopServerAndEverythingItStarted(Process server)
    {
        try
        {
            ProcessStartInfo stop = new ProcessStartInfo(Path.Combine(Environment.SystemDirectory, "taskkill.exe"), "/PID " + server.Id + " /T /F");
            stop.UseShellExecute = false;
            stop.CreateNoWindow = true;
            using (Process taskkill = Process.Start(stop)) { taskkill.WaitForExit(); }
        }
        catch { /* fall through to ending the board itself */ }
        try { if (!server.HasExited) server.Kill(); }
        catch { /* it ended between the check and the kill */ }
    }

    const uint WM_CLOSE = 0x0010;

    delegate bool EnumWindowsProc(IntPtr window, IntPtr parameter);

    [DllImport("user32.dll")]
    static extern bool EnumThreadWindows(uint threadId, EnumWindowsProc callback, IntPtr parameter);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern int GetClassName(IntPtr window, StringBuilder className, int capacity);

    [DllImport("user32.dll")]
    static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);

    [DllImport("kernel32.dll")]
    static extern uint GetCurrentThreadId();

    const uint MB_ICONERROR = 0x10;
    const uint MB_ICONWARNING = 0x30;

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern int MessageBoxW(IntPtr owner, string text, string caption, uint type);

    [DllImport("user32.dll")]
    static extern bool SetProcessDPIAware();

    // A yes/no question, No by default: every question this launcher asks with it is about
    // removing something, and Enter on a default Yes would be the dangerous slip.
    [MethodImpl(MethodImplOptions.NoInlining)]
    static bool AskYesNo(string question)
    {
        try { SetProcessDPIAware(); } catch { /* blurry text is better than no text */ }
        try
        {
            System.Windows.Forms.Application.EnableVisualStyles();
            return System.Windows.Forms.MessageBox.Show(question, WindowTitle,
                System.Windows.Forms.MessageBoxButtons.YesNo, System.Windows.Forms.MessageBoxIcon.Question,
                System.Windows.Forms.MessageBoxDefaultButton.Button2) == System.Windows.Forms.DialogResult.Yes;
        }
        catch
        {
            return MessageBoxW(IntPtr.Zero, question, WindowTitle, MB_YESNO | MB_ICONQUESTION | MB_DEFBUTTON2) == IDYES;
        }
    }

    // A finished piece of news, not a problem: the removal that worked.
    [MethodImpl(MethodImplOptions.NoInlining)]
    static void ShowNotice(string text)
    {
        try { SetProcessDPIAware(); } catch { /* blurry text is better than no text */ }
        try
        {
            System.Windows.Forms.Application.EnableVisualStyles();
            System.Windows.Forms.MessageBox.Show(text, WindowTitle,
                System.Windows.Forms.MessageBoxButtons.OK, System.Windows.Forms.MessageBoxIcon.Information);
        }
        catch
        {
            MessageBoxW(IntPtr.Zero, text, WindowTitle, MB_ICONINFORMATION);
        }
    }

    internal enum MoveAnswer { Move, Keep, NoAnswer }

    // The move question needs two named buttons, which a MessageBox cannot have, so it is a
    // small dialog. Closing it is no answer: nothing is remembered and it asks again next time.
    [MethodImpl(MethodImplOptions.NoInlining)]
    static MoveAnswer AskMoveOrKeep(string question)
    {
        try { SetProcessDPIAware(); } catch { /* blurry text is better than no text */ }
        try
        {
            System.Windows.Forms.Application.EnableVisualStyles();
            using (System.Windows.Forms.Form form = new System.Windows.Forms.Form())
            {
                form.Text = WindowTitle;
                form.FormBorderStyle = System.Windows.Forms.FormBorderStyle.FixedDialog;
                form.MaximizeBox = false;
                form.MinimizeBox = false;
                form.StartPosition = System.Windows.Forms.FormStartPosition.CenterScreen;
                form.Font = System.Drawing.SystemFonts.MessageBoxFont;
                form.AutoScaleMode = System.Windows.Forms.AutoScaleMode.Font;
                form.AutoSize = true;
                form.AutoSizeMode = System.Windows.Forms.AutoSizeMode.GrowAndShrink;
                try { form.Icon = System.Drawing.Icon.ExtractAssociatedIcon(Assembly.GetExecutingAssembly().Location); }
                catch { /* the default window icon */ }

                System.Windows.Forms.Label text = new System.Windows.Forms.Label();
                text.AutoSize = true;
                text.MaximumSize = new System.Drawing.Size(420, 0);
                text.Text = question;
                text.Margin = new System.Windows.Forms.Padding(0, 0, 0, 18);

                System.Windows.Forms.Button move = new System.Windows.Forms.Button();
                move.Text = MoveButton;
                move.AutoSize = true;
                move.DialogResult = System.Windows.Forms.DialogResult.Yes;
                System.Windows.Forms.Button keep = new System.Windows.Forms.Button();
                keep.Text = KeepButton;
                keep.AutoSize = true;
                keep.DialogResult = System.Windows.Forms.DialogResult.No;

                System.Windows.Forms.FlowLayoutPanel buttons = new System.Windows.Forms.FlowLayoutPanel();
                buttons.FlowDirection = System.Windows.Forms.FlowDirection.RightToLeft;
                buttons.AutoSize = true;
                buttons.Dock = System.Windows.Forms.DockStyle.Fill;
                buttons.WrapContents = false;
                buttons.Controls.Add(keep);
                buttons.Controls.Add(move);

                System.Windows.Forms.TableLayoutPanel layout = new System.Windows.Forms.TableLayoutPanel();
                layout.AutoSize = true;
                layout.AutoSizeMode = System.Windows.Forms.AutoSizeMode.GrowAndShrink;
                layout.ColumnCount = 1;
                layout.RowCount = 2;
                layout.Padding = new System.Windows.Forms.Padding(18);
                layout.Controls.Add(text, 0, 0);
                layout.Controls.Add(buttons, 0, 1);
                form.Controls.Add(layout);
                form.AcceptButton = move;

                System.Windows.Forms.DialogResult result = form.ShowDialog();
                if (result == System.Windows.Forms.DialogResult.Yes) return MoveAnswer.Move;
                if (result == System.Windows.Forms.DialogResult.No) return MoveAnswer.Keep;
                return MoveAnswer.NoAnswer;
            }
        }
        catch
        {
            // The plain user32 box, for ShowMessageBox's reason: a question that never shows is
            // worse than one with plainer buttons.
            int said = MessageBoxW(IntPtr.Zero, question + "\n\nYes: " + MoveButton + ". No: " + KeepButton + ".", WindowTitle, MB_YESNOCANCEL | MB_ICONQUESTION);
            if (said == IDYES) return MoveAnswer.Move;
            if (said == IDNO) return MoveAnswer.Keep;
            return MoveAnswer.NoAnswer;
        }
    }

    const uint MB_YESNOCANCEL = 0x03;
    const uint MB_YESNO = 0x04;
    const uint MB_ICONQUESTION = 0x20;
    const uint MB_ICONINFORMATION = 0x40;
    const uint MB_DEFBUTTON2 = 0x100;
    const int IDYES = 6;
    const int IDNO = 7;

    // ---- an installer's job, without an installer (win32-installer-native) ----

    // What Windows lists Kosmos as, in the Start menu and in Settings > Apps.
    const string DisplayName = "Kosmos";

    // 🛑 EMPTY UNTIL JOSH NAMES IT. Settings > Apps shows a Publisher, and it has to be the
    // legal company name on the code-signing certificate -- the same name AssemblyCompany
    // waits for. A guessed name would contradict the signature once it lands. Written only
    // when non-empty; a stale value is deleted while it is empty.
    internal const string PublisherLegalName = "";

    const string ManifestFileName = "manifest.json";
    const string ShortcutFileName = "Kosmos.lnk";
    const string ShortcutDescription = "Open Kosmos";
    const string UninstallKeyName = "Kosmos";

    // Where Windows keeps per-user uninstall entries: HKCU, so no admin prompt. Not const
    // only so the probe a test compiles beside this file can point it at
    // HKCU\Software\KosmosTest\<guid>; the launcher itself never changes it.
    internal static string uninstallKeyParent = @"Software\Microsoft\Windows\CurrentVersion\Uninstall";

    // The per-user Start menu's Programs folder (%APPDATA%\Microsoft\Windows\Start Menu\Programs).
    // A seam for the same probe, which points it at a temp folder.
    internal static Func<string> startMenuProgramsFolder = () => Environment.GetFolderPath(Environment.SpecialFolder.Programs);

    // The build's folders whose size Settings > Apps shows, with this exe. Only these, never
    // the whole folder: a zip extracted straight into Downloads would otherwise be walked on
    // every launch. They are engine/win32update.js ENTRIES' folders, pinned equal by
    // tools.win-installer-native.test.js.
    static readonly string[] SizedFolders = { "app", "bin", "runtime" };

    // A real Kosmos build: its manifest.json names the product and the platform at its top
    // level. Only a real build is advertised in the Start menu and Settings > Apps, or
    // offered a move.
    internal static bool IsKosmosBuild(string root)
    {
        try
        {
            string manifest = Path.Combine(root, ManifestFileName);
            if (!File.Exists(manifest)) return false;
            string text = File.ReadAllText(manifest, Encoding.UTF8);
            return TopLevelJsonString(text, "product") == "kosmos" && TopLevelJsonString(text, "platform") == "win32";
        }
        catch { return false; }
    }

    // The app version Settings > Apps shows: manifest.json's own top-level "version", never
    // the "version" of the "node" object beside it.
    internal static string AppVersionFromManifest(string manifestText)
    {
        return TopLevelJsonString(manifestText ?? "", "version");
    }

    // The string value of `key` at the top level of a JSON object, or null. A deliberately
    // small reader: .NET Framework has no JSON reader without an extra assembly reference,
    // which would change the build flags verify-launcher.ps1 pins, and manifest.json is the
    // build script's own nearly flat file.
    internal static string TopLevelJsonString(string json, string key)
    {
        int depth = 0;
        for (int i = 0; i < json.Length; i++)
        {
            char c = json[i];
            if (c == '{' || c == '[') { depth++; continue; }
            if (c == '}' || c == ']') { depth--; continue; }
            if (c != '"') continue;
            int end;
            string token = ReadJsonString(json, i, out end);
            if (token == null) return null;
            i = end;
            if (depth != 1 || token != key) continue;
            int j = end + 1;
            while (j < json.Length && char.IsWhiteSpace(json[j])) j++;
            if (j >= json.Length || json[j] != ':') continue;
            j++;
            while (j < json.Length && char.IsWhiteSpace(json[j])) j++;
            if (j >= json.Length || json[j] != '"') return null;
            int valueEnd;
            return ReadJsonString(json, j, out valueEnd);
        }
        return null;
    }

    // One JSON string starting at the quote at `start`; `end` is its closing quote. Null when
    // it never closes.
    static string ReadJsonString(string json, int start, out int end)
    {
        StringBuilder value = new StringBuilder();
        for (int i = start + 1; i < json.Length; i++)
        {
            char c = json[i];
            if (c == '"') { end = i; return value.ToString(); }
            if (c != '\\' || i + 1 >= json.Length) { value.Append(c); continue; }
            char escaped = json[++i];
            switch (escaped)
            {
                case 'n': value.Append('\n'); break;
                case 't': value.Append('\t'); break;
                case 'r': value.Append('\r'); break;
                case 'b': value.Append('\b'); break;
                case 'f': value.Append('\f'); break;
                case 'u':
                    if (i + 4 < json.Length) { value.Append((char)Convert.ToInt32(json.Substring(i + 1, 4), 16)); i += 4; }
                    break;
                default: value.Append(escaped); break;
            }
        }
        end = json.Length;
        return null;
    }

    // Every launch of a real build: point the Start menu shortcut and the Settings > Apps entry
    // at the folder Kosmos runs from now. Refreshing each time is what repairs both after
    // Kosmos is extracted to, or moved to, another folder.
    // No box on a problem: a person who opened Kosmos to use it is not interrupted about its
    // shortcut on every launch, and neither one affects Kosmos running. --console says it.
    static void RefreshWindowsRegistration(string root)
    {
        string exe = Assembly.GetExecutingAssembly().Location;
        string shortcutProblem = RefreshStartMenuShortcut(exe, root);
        string version = null;
        try { version = AppVersionFromManifest(File.ReadAllText(Path.Combine(root, ManifestFileName), Encoding.UTF8)); }
        catch { /* no version is written rather than a wrong one */ }
        string entryProblem = RegisterUninstallEntry(exe, root, version, BuildSizeInKilobytes(root, exe));
        if (showMessageBoxes) return;
        if (shortcutProblem != null) Console.Error.WriteLine("Kosmos could not update its Start menu shortcut: " + shortcutProblem);
        if (entryProblem != null) Console.Error.WriteLine("Kosmos could not update its entry in Settings > Apps: " + entryProblem);
    }

    internal static string StartMenuShortcutPath()
    {
        string programs = startMenuProgramsFolder();
        return string.IsNullOrEmpty(programs) ? null : Path.Combine(programs, ShortcutFileName);
    }

    // The Start menu shortcut, through IShellLink: in-process COM, so no PowerShell and no
    // WScript.Shell process. It points at this exe, starts in the Kosmos folder, and shows the
    // icon compiled into the exe. Null when it was written, or what went wrong.
    internal static string RefreshStartMenuShortcut(string exe, string workingDirectory)
    {
        string at = StartMenuShortcutPath();
        if (at == null) return "Windows did not say where the Start menu is";
        object link = null;
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(at));
            link = new ShellLinkObject();
            IShellLinkW shellLink = (IShellLinkW)link;
            shellLink.SetPath(exe);
            shellLink.SetWorkingDirectory(workingDirectory);
            shellLink.SetIconLocation(exe, 0);
            shellLink.SetDescription(ShortcutDescription);
            ((System.Runtime.InteropServices.ComTypes.IPersistFile)link).Save(at, true);
            return null;
        }
        catch (Exception e) { return e.Message; }
        finally
        {
            if (link != null) Marshal.FinalReleaseComObject(link);
        }
    }

    internal static string RemoveStartMenuShortcut()
    {
        string at = StartMenuShortcutPath();
        if (at == null) return "the Start menu shortcut, because Windows did not say where the Start menu is";
        try
        {
            if (File.Exists(at)) File.Delete(at);
            return null;
        }
        catch (Exception e) { return "the Start menu shortcut (" + at + "), which could not be deleted (" + e.Message + ")"; }
    }

    // The entry in Settings > Apps > Installed apps, per user, so no admin prompt. Its
    // Uninstall button runs this exe with --uninstall. Null when it was written, or what went
    // wrong.
    internal static string RegisterUninstallEntry(string exe, string root, string version, long sizeInKilobytes)
    {
        try
        {
            using (RegistryKey key = Registry.CurrentUser.CreateSubKey(uninstallKeyParent + "\\" + UninstallKeyName))
            {
                if (key == null) return "Windows would not open " + uninstallKeyParent + "\\" + UninstallKeyName;
                string uninstall = "\"" + exe + "\" " + UninstallFlag;
                key.SetValue("DisplayName", DisplayName, RegistryValueKind.String);
                // Windows' own shape: the quoted exe and the icon's index, so a path with spaces
                // or a comma is still read as one path.
                key.SetValue("DisplayIcon", "\"" + exe + "\",0", RegistryValueKind.String);
                if (!string.IsNullOrEmpty(version)) key.SetValue("DisplayVersion", version, RegistryValueKind.String);
                else key.DeleteValue("DisplayVersion", false);
                key.SetValue("InstallLocation", root, RegistryValueKind.String);
                key.SetValue("UninstallString", uninstall, RegistryValueKind.String);
                key.SetValue("QuietUninstallString", uninstall, RegistryValueKind.String);
                key.SetValue("NoModify", 1, RegistryValueKind.DWord);
                key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
                if (sizeInKilobytes > 0) key.SetValue("EstimatedSize", (int)Math.Min(sizeInKilobytes, int.MaxValue), RegistryValueKind.DWord);
                else key.DeleteValue("EstimatedSize", false);
                if (PublisherLegalName.Length > 0) key.SetValue("Publisher", PublisherLegalName, RegistryValueKind.String);
                else key.DeleteValue("Publisher", false);
                return null;
            }
        }
        catch (Exception e) { return e.Message; }
    }

    internal static string RemoveUninstallEntry()
    {
        try
        {
            Registry.CurrentUser.DeleteSubKeyTree(uninstallKeyParent + "\\" + UninstallKeyName, false);
            return null;
        }
        catch (Exception e) { return "the Kosmos entry in Settings > Apps, which could not be removed (" + e.Message + ")"; }
    }

    // What Settings > Apps shows as the size: the build's own folders and this exe. An
    // estimate, and never an error: a folder that cannot be read adds nothing.
    internal static long BuildSizeInKilobytes(string root, string exe)
    {
        long bytes = 0;
        try { bytes += new FileInfo(exe).Length; } catch { /* no size for the exe */ }
        foreach (string name in SizedFolders)
        {
            Stack<DirectoryInfo> pending = new Stack<DirectoryInfo>();
            pending.Push(new DirectoryInfo(Path.Combine(root, name)));
            while (pending.Count > 0)
            {
                DirectoryInfo dir = pending.Pop();
                try
                {
                    foreach (FileInfo f in dir.GetFiles()) bytes += f.Length;
                    foreach (DirectoryInfo d in dir.GetDirectories())
                    {
                        if ((d.Attributes & FileAttributes.ReparsePoint) == 0) pending.Push(d);
                    }
                }
                catch { /* unreadable or missing: it adds nothing to an estimate */ }
            }
        }
        return (bytes + 1023) / 1024;
    }

    // IShellLinkW and the ShellLink coclass (shobjidl.h), in the order the vtable declares them.
    [ComImport, Guid("00021401-0000-0000-C000-000000000046")]
    class ShellLinkObject { }

    [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("000214F9-0000-0000-C000-000000000046")]
    interface IShellLinkW
    {
        void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder file, int capacity, IntPtr findData, uint flags);
        void GetIDList(out IntPtr idList);
        void SetIDList(IntPtr idList);
        void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder name, int capacity);
        void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string name);
        void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder directory, int capacity);
        void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string directory);
        void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder arguments, int capacity);
        void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string arguments);
        void GetHotkey(out short hotkey);
        void SetHotkey(short hotkey);
        void GetShowCmd(out int showCommand);
        void SetShowCmd(int showCommand);
        void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder iconPath, int capacity, out int iconIndex);
        void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string iconPath, int iconIndex);
        void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string relativePath, uint reserved);
        void Resolve(IntPtr window, uint flags);
        void SetPath([MarshalAs(UnmanagedType.LPWStr)] string file);
    }

    // ---- --uninstall (W-27a) --------------------------------------------------

    const string RemoveQuestion = "Remove Kosmos from this PC? Your agents will stop.";
    // Says what goes and what stays: engine/win32uninstall.js keeps every Kosmos's projects and
    // agents' working folders on a yes (round 1, finding 1).
    const string RemoveChatsQuestion = "Also delete your agents' chats and settings? Your projects and your agents' working folders are kept either way.";
    const string CannotDeleteOwnFolder = "Kosmos can't delete the folder it is running from, so that last step is yours.";
    const string UninstallNeedsAPersonMessage =
        "Kosmos is removed only when you confirm it, and there is nobody here to ask. Remove Kosmos from Settings > Apps > Installed apps, or run Kosmos.exe --uninstall without --console.";
    // --uninstall had nobody to confirm it, so it did nothing.
    const int UninstallNotConfirmedExitCode = 2;

    // Kosmos.exe --uninstall: what Settings > Apps > Installed apps > Uninstall runs.
    // 🛑 THE CONFIRM COMES BEFORE ANY ACTION, and without a person there is no confirm, so
    // nothing happens at all -- QuietUninstallString asks too, because a destructive act never
    // runs unconfirmed. The removing is the engine's (engine/win32uninstall.js); this asks,
    // takes away the two things this file made (the shortcut and the Apps entry), and says
    // what happened. It never schedules deleting its own folder.
    internal static int Uninstall(string here, string node)
    {
        if (!showMessageBoxes)
        {
            Console.Error.WriteLine(UninstallNeedsAPersonMessage);
            return UninstallNotConfirmedExitCode;
        }
        if (!askYesNo(RemoveQuestion)) return 0;
        bool alsoDeleteChats = askYesNo(RemoveChatsQuestion);

        List<string> leftBehind = new List<string>();
        List<string> notes = new List<string>();
        string problem;
        string[] report = runEngineHelper(node, here, UninstallHelperScript,
            "--uninstall" + (alsoDeleteChats ? " --delete-data" : "") + " --root " + QuoteArgument(here) + " --port " + BoardPort(), out problem);
        if (report == null)
        {
            leftBehind.Add("Kosmos's startup jobs in Task Scheduler and its folders in AppData, because the removal could not run (" + problem + ")");
        }
        else
        {
            foreach (string line in report)
            {
                if (line.StartsWith("LEFT ", StringComparison.Ordinal)) leftBehind.Add(line.Substring("LEFT ".Length));
                else if (line.StartsWith("NOTE ", StringComparison.Ordinal)) notes.Add(line.Substring("NOTE ".Length));
            }
        }

        // The Start menu entry, the Apps entry and this launcher's own memory are how a person finds
        // Kosmos and removes it again, so they go only once nothing else was left behind (round 1,
        // finding 9). The Apps entry goes last, so a shortcut that would not go still leaves the
        // way to try again.
        if (leftBehind.Count == 0)
        {
            string shortcutProblem = RemoveStartMenuShortcut();
            if (shortcutProblem != null) leftBehind.Add(shortcutProblem);
            string memoryProblem = ForgetKeptPlaces();
            if (memoryProblem != null) leftBehind.Add(memoryProblem);
        }
        if (leftBehind.Count == 0)
        {
            string entryProblem = RemoveUninstallEntry();
            if (entryProblem != null) leftBehind.Add(entryProblem);
        }
        else
        {
            notes.Add("Kosmos is still in the Start menu and in Settings > Apps > Installed apps, so you can remove it again from there.");
        }

        string said = notes.Count > 0 ? "\n\n" + string.Join("\n", notes.ToArray()) : "";
        if (leftBehind.Count == 0)
        {
            tellPerson("Kosmos is removed. You can now delete the folder " + here + ".\n\n" + CannotDeleteOwnFolder + said, false);
            return 0;
        }
        tellPerson("Kosmos could not remove everything. These were left behind:\n\n- " + string.Join("\n- ", leftBehind.ToArray()) + said, true);
        return 1;
    }

    // The folder list "Keep it here" wrote. The engine's removal deletes %LOCALAPPDATA%\Kosmos, which
    // holds it, only when that is the plain folder; this file is the launcher's own, so it goes here.
    internal static string ForgetKeptPlaces()
    {
        string file = keptPlacesFile();
        try
        {
            if (File.Exists(file)) File.Delete(file);
            return null;
        }
        catch (Exception e) { return "the list of folders you chose to keep Kosmos in (" + file + "), which could not be deleted (" + e.Message + ")"; }
    }

    // ---- the launcher's acts, as seams ------------------------------------------

    // Everything the installer duties DO to the world -- run an engine helper, start another
    // Kosmos.exe, ask a person, tell a person, refresh the Start menu and the Apps entry -- is one
    // of these fields. The launcher never replaces them; the probe tools.win-installer-native.test.js
    // compiles beside this file does, so the decisions run in a test without a process, a box or
    // the real registry.
    internal delegate string[] EngineHelperRunner(string node, string here, string script, string arguments, out string problem);
    internal static EngineHelperRunner runEngineHelper = RunEngineHelper;
    internal static Func<string, string, string> startLauncher = StartLauncherAt;
    internal static Func<string, bool> askYesNo = AskYesNo;
    internal static Func<string, MoveAnswer> askMoveOrKeep = AskMoveOrKeep;
    internal static Action<string, bool> tellPerson = TellPerson;
    internal static Action<string> refreshWindowsRegistration = RefreshWindowsRegistration;

    // A message for the person: a box at a desktop, stderr otherwise (never a box nobody can see).
    static void TellPerson(string text, bool isError)
    {
        if (!showMessageBoxes)
        {
            Console.Error.WriteLine(text);
            return;
        }
        if (isError) ShowMessageBox(text, true);
        else ShowNotice(text);
    }

    // Starts another Kosmos.exe (the installed copy, or the one just moved) in its own folder. Null
    // when it started, or what went wrong.
    static string StartLauncherAt(string exe, string folder)
    {
        try
        {
            ProcessStartInfo other = new ProcessStartInfo(exe);
            other.UseShellExecute = false;
            other.WorkingDirectory = folder;
            using (Process.Start(other)) { }
            return null;
        }
        catch (Exception e) { return e.Message; }
    }

    // Runs one of the engine's own helpers with this folder's node and returns the lines it
    // reported, or null with `problem` saying why. The helper writes its outcome to a file,
    // one tagged sentence per line, so nothing is redirected (the board-start rule in Main)
    // and it runs with no window. ConfirmedFlag is what arms it, and every caller runs this
    // only after the person answered.
    static string[] RunEngineHelper(string node, string here, string script, string arguments, out string problem)
    {
        problem = null;
        string helper = Path.Combine(here, "app\\engine\\" + script);
        if (!File.Exists(node)) { problem = "the bundled runtime is missing (runtime\\node.exe)"; return null; }
        if (!File.Exists(helper)) { problem = "a Kosmos file is missing (app\\engine\\" + script + ")"; return null; }
        string report = Path.Combine(Path.GetTempPath(), "kosmos-" + Guid.NewGuid().ToString("N") + ".txt");
        try
        {
            ProcessStartInfo h = new ProcessStartInfo(node,
                QuoteArgument(helper) + " " + arguments + " --report " + QuoteArgument(report) + " " + ConfirmedFlag);
            h.UseShellExecute = false;
            h.CreateNoWindow = true;
            h.WorkingDirectory = here;
            using (Process helperRun = Process.Start(h)) { helperRun.WaitForExit(); }
            if (!File.Exists(report)) { problem = "it finished without saying what it did"; return null; }
            return File.ReadAllLines(report, Encoding.UTF8);
        }
        catch (Exception e) { problem = e.Message; return null; }
        finally
        {
            try { File.Delete(report); } catch { /* a temp file, and its answer is already read */ }
        }
    }

    // One command-line argument, quoted. A trailing backslash is doubled so it cannot escape
    // the closing quote (a quoted C:\ would otherwise read as C:").
    internal static string QuoteArgument(string value)
    {
        return "\"" + (value.EndsWith("\\") ? value + "\\" : value) + "\"";
    }

    // ---- moving out of a folder that gets cleaned up (W-06) -------------------

    internal static readonly Guid FOLDERID_Downloads = new Guid("374DE290-123F-4565-9164-39C4925E467B");
    internal static readonly Guid FOLDERID_Desktop = new Guid("B4BFCC3A-DB2C-424C-B029-7FE99A87C641");
    internal static readonly Guid FOLDERID_UserProgramFiles = new Guid("5CD7AEE2-2219-4A67-B85D-6C9CE15660CB");

    // The folders that get cleaned up, synced or redirected, each resolved when asked. The
    // Known Folder API is what finds a Desktop or Downloads that OneDrive redirected (this
    // box's Desktop is C:\Users\joshu\OneDrive\Desktop). Replaceable only by the probe a test
    // compiles beside this file.
    internal static Func<string> downloadsFolder = () => KnownFolderPath(FOLDERID_Downloads);
    internal static Func<string> desktopFolder = () => KnownFolderPath(FOLDERID_Desktop);
    internal static Func<string, string> environmentVariable = Environment.GetEnvironmentVariable;
    internal static Func<string[]> temporaryFolders = TempFolders;
    // Where Kosmos moves to: the per-user programs folder VS Code, Discord and Slack install
    // into. It is also the one install location the updater's in-place swap can count on.
    internal static Func<string> userProgramsFolder = () =>
        KnownFolderPath(FOLDERID_UserProgramFiles)
        ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs");
    // "Keep it here", remembered per folder, one full path per line, in <LOCALAPPDATA>\Kosmos\launcher.
    // That is engine/win32anchor.js's folder by the same rule it uses without overrides: the
    // LOCALAPPDATA variable, else the account's own Local AppData. The launcher does not ask node on
    // every launch (a process per double-click), so the two differ only when the environment carries
    // AGENT_WORKFORCE_DATA or AGENT_WORKFORCE_HOME (a developer's or a test's sandbox, never a
    // person's). The uninstall deletes this file itself (ForgetKeptPlaces), so the difference can
    // never leave it behind.
    internal static Func<string> keptPlacesFile = () =>
        Path.Combine(LocalAppDataFolder(), "Kosmos\\launcher\\kept-here.txt");

    static string LocalAppDataFolder()
    {
        string fromEnvironment = Environment.GetEnvironmentVariable("LOCALAPPDATA");
        return string.IsNullOrEmpty(fromEnvironment) ? Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData) : fromEnvironment;
    }

    static readonly string[] OneDriveVariables = { "OneDrive", "OneDriveConsumer", "OneDriveCommercial" };
    const string InstallFolderName = "Kosmos";
    const string KeepsWorkingHere = "Kosmos keeps working from here.";
    const string MoveButton = "Move Kosmos";
    const string KeepButton = "Keep it here";

    internal static string MoveQuestion(string place)
    {
        return "Kosmos is running from " + place + ". If that folder is cleaned up, Kosmos stops working. Move Kosmos to its own folder now?";
    }

    // Which cleaned-up or synced place this folder is in, as the question names it, or null.
    // Most specific first: a Desktop inside OneDrive is "your Desktop".
    internal static string TemporaryPlaceOf(string folder)
    {
        string directory = FullPathOrNull(folder) ?? folder;
        string profile = environmentVariable("USERPROFILE");
        if (IsSameOrInside(directory, FullPathOrNull(downloadsFolder()))
            || (!string.IsNullOrEmpty(profile) && IsSameOrInside(directory, FullPathOrNull(profile.TrimEnd('\\', '/') + "\\Downloads"))))
        {
            return "your Downloads folder";
        }
        if (IsSameOrInside(directory, FullPathOrNull(desktopFolder()))) return "your Desktop";
        foreach (string name in OneDriveVariables)
        {
            if (IsSameOrInside(directory, FullPathOrNull(environmentVariable(name)))) return "your OneDrive folder";
        }
        foreach (string temp in temporaryFolders())
        {
            if (IsSameOrInside(directory, temp)) return "a temporary folder";
        }
        return null;
    }

    // The Known Folder API: the folder Windows itself uses, wherever it was redirected.
    // KF_FLAG_DONT_VERIFY answers for a folder that does not exist yet. Null when Windows has
    // no answer.
    internal static string KnownFolderPath(Guid folder)
    {
        IntPtr found = IntPtr.Zero;
        try
        {
            if (SHGetKnownFolderPath(folder, KF_FLAG_DONT_VERIFY, IntPtr.Zero, out found) != 0) return null;
            return Marshal.PtrToStringUni(found);
        }
        catch { return null; }
        finally
        {
            if (found != IntPtr.Zero) Marshal.FreeCoTaskMem(found);
        }
    }

    const uint KF_FLAG_DONT_VERIFY = 0x00004000;

    [DllImport("shell32.dll")]
    static extern int SHGetKnownFolderPath([MarshalAs(UnmanagedType.LPStruct)] Guid folder, uint flags, IntPtr token, out IntPtr path);

    internal static bool PlaceWasKept(string folder)
    {
        try
        {
            string file = keptPlacesFile();
            if (!File.Exists(file)) return false;
            string mine = (FullPathOrNull(folder) ?? folder).TrimEnd('\\', '/');
            foreach (string line in File.ReadAllLines(file, Encoding.UTF8))
            {
                if (string.Equals(line.Trim().TrimEnd('\\', '/'), mine, StringComparison.OrdinalIgnoreCase)) return true;
            }
            return false;
        }
        catch { return false; /* an unreadable memory asks again, which is the harmless direction */ }
    }

    internal static bool RememberPlaceKept(string folder)
    {
        try
        {
            string file = keptPlacesFile();
            Directory.CreateDirectory(Path.GetDirectoryName(file));
            File.AppendAllText(file, (FullPathOrNull(folder) ?? folder).TrimEnd('\\', '/') + "\r\n", new UTF8Encoding(false));
            return true;
        }
        catch { return false; /* not remembered: the question comes back next launch, nothing worse */ }
    }

    internal static string MoveTarget()
    {
        string programs = userProgramsFolder();
        return string.IsNullOrEmpty(programs) ? null : FullPathOrNull(Path.Combine(programs, InstallFolderName));
    }

    // Everything this launcher does as an installer before it starts anything (see Main). Returns
    // the exit code this launch ends with, or null to carry on launching from here. Only a real
    // build: a folder without the manifest does none of it.
    internal static int? RunInstallerDuties(string here, string node, int port)
    {
        if (!IsKosmosBuild(here)) return null;
        PlaceOutcome installed = CompareWithInstalledCopy(here, node);
        if (installed == PlaceOutcome.StartedInstalledCopy) return 0;
        if (installed == PlaceOutcome.InstalledCopyWouldNotStart) return 1;
        if (installed != PlaceOutcome.NewerThanInstalledCopy
            && OfferToMoveFromTemporaryPlace(here, node, port) == PlaceOutcome.StartedInstalledCopy) return 0;
        refreshWindowsRegistration(here);
        return null;
    }

    internal enum PlaceOutcome { NoInstalledCopy, NotATemporaryPlace, StartedInstalledCopy, InstalledCopyWouldNotStart, NewerThanInstalledCopy, StaysHere }

    // Round 1 finding 4, round 2 finding 4. From ANY folder outside the per-user one (MoveTarget), not
    // only a temporary place: an old copy at D:\Kosmos-0.6.50 re-pointed everything just the same.
    // When that folder holds a Kosmos.exe, engine/win32relocate.js compare decides which copy runs,
    // from its one build verdict (the verdict relocate reads too):
    //   HANDOFF (the same build, an installed build that is newer, or anything unreadable) -> start
    //   the installed Kosmos and end here. This copy re-points nothing: no shortcut, no Apps entry, no
    //   engine pointer. Keep it here does not apply: a stale copy is exactly what re-pointed everything.
    //   NEWER (this copy is newer, or the same version rebuilt from another commit) -> run from here and
    //   re-point, which is how a by-hand zip update works today, until "Update Kosmos in Programs from a
    //   newer downloaded zip" reuses engine/win32apply.js.
    //   NONE (no complete Kosmos there), or a compare that could not run -> carry on as before.
    internal static PlaceOutcome CompareWithInstalledCopy(string here, string node)
    {
        string target = MoveTarget();
        string full = FullPathOrNull(here) ?? here;
        if (target == null || IsSameOrInside(full, target) || IsSameOrInside(target, full)) return PlaceOutcome.NoInstalledCopy;
        // The launcher is the only file this cheap look needs; the engine decides the rest.
        if (!File.Exists(Path.Combine(target, "Kosmos.exe"))) return PlaceOutcome.NoInstalledCopy;
        string compareProblem;
        string[] compared = runEngineHelper(node, here, RelocateHelperScript,
            "--compare --from " + QuoteArgument(full) + " --to " + QuoteArgument(target), out compareProblem);
        string verdict = compared != null && compared.Length > 0 ? compared[0] : null;
        if (verdict != null && verdict.StartsWith("NEWER ", StringComparison.Ordinal)) return PlaceOutcome.NewerThanInstalledCopy;
        if (verdict != null && verdict.StartsWith("HANDOFF ", StringComparison.Ordinal))
        {
            string startProblem = startLauncher(Path.Combine(target, "Kosmos.exe"), target);
            if (startProblem == null) return PlaceOutcome.StartedInstalledCopy;
            tellPerson("Kosmos is installed in " + target + ", but it would not start from there (" + startProblem + "). Double-click Kosmos.exe in that folder.", true);
            return PlaceOutcome.InstalledCopyWouldNotStart;
        }
        return PlaceOutcome.NoInstalledCopy;
    }

    // W-06: a copy running from a folder that gets cleaned up, with a person at the desktop and the
    // folder not kept, is asked Move Kosmos or Keep it here. Whether it may move is the engine's rule
    // (never while a board from this folder serves, never over a different or incomplete Kosmos), and a
    // refusal is shown as it is worded. Only temporary places are asked; the installed-copy verdict above
    // has already run for every folder.
    internal static PlaceOutcome OfferToMoveFromTemporaryPlace(string here, string node, int port)
    {
        string place = TemporaryPlaceOf(here);
        if (place == null) return PlaceOutcome.NotATemporaryPlace;
        string target = MoveTarget();
        string full = FullPathOrNull(here) ?? here;
        if (target == null || IsSameOrInside(full, target) || IsSameOrInside(target, full)) return PlaceOutcome.NotATemporaryPlace;

        if (!showMessageBoxes || PlaceWasKept(here)) return PlaceOutcome.StaysHere;
        MoveAnswer answer = askMoveOrKeep(MoveQuestion(place));
        if (answer == MoveAnswer.Keep) { RememberPlaceKept(here); return PlaceOutcome.StaysHere; }
        if (answer != MoveAnswer.Move) return PlaceOutcome.StaysHere;

        string problem;
        string[] report = runEngineHelper(node, here, RelocateHelperScript,
            "--move --from " + QuoteArgument(full) + " --to " + QuoteArgument(target) + " --port " + port, out problem);
        string outcome = report != null && report.Length > 0 ? report[0] : null;
        if (outcome != null && (outcome.StartsWith("MOVED ", StringComparison.Ordinal) || outcome.StartsWith("SAME ", StringComparison.Ordinal)))
        {
            string startProblem = startLauncher(Path.Combine(target, "Kosmos.exe"), target);
            if (startProblem == null) return PlaceOutcome.StartedInstalledCopy;
            tellPerson("Kosmos is in " + target + " now, but it would not start from there (" + startProblem + "). " + KeepsWorkingHere, true);
            return PlaceOutcome.StaysHere;
        }
        string because = outcome != null && outcome.StartsWith("REFUSED ", StringComparison.Ordinal)
            ? outcome.Substring("REFUSED ".Length)
            : "Kosmos could not be moved (" + (problem ?? "the move did not say what happened") + "). " + KeepsWorkingHere;
        tellPerson(because, false);
        return PlaceOutcome.StaysHere;
    }

    // ---- the console, for --console and non-interactive runs -----------------

    // A GUI-subsystem exe starts with no console. For --console it takes the one
    // it was started from (cmd, PowerShell) or, from a double-click or a
    // shortcut, a window of its own -- which is what the console launcher always
    // had. The server started later shares it, as before.
    // ⚠️ Standard handles a caller redirected (a script capturing the output) are
    // put back after attaching, so the output still goes where the caller asked.
    static void ConnectToAConsole()
    {
        IntPtr stdout = GetStdHandle(STD_OUTPUT_HANDLE);
        IntPtr stderr = GetStdHandle(STD_ERROR_HANDLE);
        IntPtr stdin = GetStdHandle(STD_INPUT_HANDLE);
        bool outRedirected = IsRedirected(stdout), errRedirected = IsRedirected(stderr), inRedirected = IsRedirected(stdin);

        if (!AttachConsole(ATTACH_PARENT_PROCESS))
        {
            // Never give a non-interactive run a console of its own: nobody can
            // see it, and Hold() would wait on it for a key nobody can press.
            if (!Environment.UserInteractive) return;
            // Nor a caller that captured both outputs: every line goes to them,
            // so a new window would stay empty and Hold() would wait on it.
            if (outRedirected && errRedirected) return;
            AllocConsole();
        }
        if (outRedirected) SetStdHandle(STD_OUTPUT_HANDLE, stdout);
        if (errRedirected) SetStdHandle(STD_ERROR_HANDLE, stderr);
        if (inRedirected) SetStdHandle(STD_INPUT_HANDLE, stdin);
    }

    // Redirected means a real handle that is not a console: a file, a pipe, or
    // the NUL device (which a type check would call a character device and miss).
    static bool IsRedirected(IntPtr handle)
    {
        if (handle == IntPtr.Zero || handle == INVALID_HANDLE_VALUE) return false;
        uint mode;
        return !GetConsoleMode(handle, out mode);
    }

    // ⚠️ ONLY when a console would vanish and take the message with it. A user
    // who opened --console from a shortcut got their own window, so an unheld
    // failure prints into a window that closes instantly -- which is how a real
    // error becomes "it just didn't do anything". A user who ran it from an
    // existing shell keeps their scrollback, so holding there is a nuisance
    // instead of a rescue.
    static void Hold()
    {
        if (!Environment.UserInteractive || !ConsoleWasOurs()) return;
        Console.Error.WriteLine("Press any key to close this window.");
        try { Console.ReadKey(true); } catch { /* no keyboard: never block a service or a pipe */ }
    }

    static bool ConsoleWasOurs()
    {
        // A console this process created has exactly one attached process: us.
        // Inherited consoles (cmd, PowerShell, Windows Terminal) have at least two.
        uint[] procs = new uint[4];
        int n = GetConsoleProcessList(procs, procs.Length);
        return n == 1;
    }

    const int STD_INPUT_HANDLE = -10;
    const int STD_OUTPUT_HANDLE = -11;
    const int STD_ERROR_HANDLE = -12;
    const uint ATTACH_PARENT_PROCESS = 0xFFFFFFFF;
    static readonly IntPtr INVALID_HANDLE_VALUE = new IntPtr(-1);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern int GetConsoleProcessList(uint[] processList, int processCount);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool AttachConsole(uint processId);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool AllocConsole();

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr GetStdHandle(int which);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool SetStdHandle(int which, IntPtr handle);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool GetConsoleMode(IntPtr handle, out uint mode);
}
