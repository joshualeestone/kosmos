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
// It is a .NET Framework app because every Windows 10/11 machine ships the 4.x
// runtime -- no dependency to install, no bundled runtime to sign.

using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;

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
    // this file does. 1 was the #2086 console launcher; 2 is the GUI one.
    public const string LauncherVersion = "2.0.0.0";
    // Explorer's "Product version". Worded so nobody reads it as the Kosmos
    // version, which lives in manifest.json and on the board.
    public const string LauncherProductVersion = "launcher 2.0";

    // Kept in step with tools/build-kosmos-windows.sh, which reads the board's
    // default out of server.js and refuses the build if this disagrees. If it
    // ever drifts, the launcher opens a port nothing serves.
    const int DefaultPort = 16180;

    // Every message box this program shows carries this title, so the person
    // can tell which program is speaking.
    const string WindowTitle = "Kosmos";

    const string ConsoleFlag = "--console";

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
    static bool showMessageBoxes;

    static string Here()
    {
        // The EXE's own directory, not the working directory: a user can launch
        // this from a shortcut, from Explorer, or from a shell sitting anywhere,
        // and %~dp0's equivalent has to be the binary's location in all three.
        return Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
    }

    static int Main(string[] args)
    {
        bool wantsConsole = Array.Exists(args, a => string.Equals(a, ConsoleFlag, StringComparison.OrdinalIgnoreCase));
        showMessageBoxes = !wantsConsole && Environment.UserInteractive;
        if (!showMessageBoxes) ConnectToAConsole();

        string here = Here();
        string node = Path.Combine(here, "runtime\\node.exe");
        string server = Path.Combine(here, "app\\server.js");
        string opener = Path.Combine(here, "open-board.js");
        string app = Path.Combine(here, "app");

        // 🛑 NOTHING IS STARTED ABOVE THESE TWO CHECKS. The board's hand-off to its
        // logon task happens inside server.js, so a folder without the runtime
        // provably never reaches it -- which is what lets the tests run this exe.
        if (!File.Exists(node))
        {
            if (RunningFromInsideAZip(here)) return FailInsideZip();
            return Fail("the bundled runtime is missing (runtime\\node.exe).");
        }
        if (!File.Exists(server)) return Fail("the application is missing (app\\server.js).");

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

        if (browserProblem != null && showMessageBoxes)
        {
            ShowMessageBox(browserProblem + "\n\nOpen http://127.0.0.1:" + port + " in your browser yourself.", false);
        }

        p.WaitForExit();
        if (p.ExitCode != 0)
        {
            if (showMessageBoxes)
            {
                ShowMessageBox("Kosmos stopped unexpectedly (exit code " + p.ExitCode + ").\n\n"
                    + "Double-click Kosmos.exe to try again. To see why it stopped, open Command Prompt in this folder and run:\n\n"
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

    const uint MB_ICONERROR = 0x10;
    const uint MB_ICONWARNING = 0x30;

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern int MessageBoxW(IntPtr owner, string text, string caption, uint type);

    [DllImport("user32.dll")]
    static extern bool SetProcessDPIAware();

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
            AllocConsole();
        }
        if (outRedirected) SetStdHandle(STD_OUTPUT_HANDLE, stdout);
        if (errRedirected) SetStdHandle(STD_ERROR_HANDLE, stderr);
        if (inRedirected) SetStdHandle(STD_INPUT_HANDLE, stdin);
    }

    static bool IsRedirected(IntPtr handle)
    {
        if (handle == IntPtr.Zero || handle == INVALID_HANDLE_VALUE) return false;
        uint type = GetFileType(handle);
        return type == FILE_TYPE_DISK || type == FILE_TYPE_PIPE;
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
    const uint FILE_TYPE_DISK = 0x0001;
    const uint FILE_TYPE_PIPE = 0x0003;
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

    [DllImport("kernel32.dll")]
    static extern uint GetFileType(IntPtr handle);
}
