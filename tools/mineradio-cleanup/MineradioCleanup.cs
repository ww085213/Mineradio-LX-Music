using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Management;
using System.Runtime.InteropServices;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle("Mineradio Cleanup Tool")]
[assembly: AssemblyDescription("Safely remove Mineradio while optionally preserving user data")]
[assembly: AssemblyCompany("Mineradio")]
[assembly: AssemblyProduct("Mineradio Cleanup Tool")]
[assembly: AssemblyCopyright("Copyright (c) Mineradio contributors")]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("1.0.0.0")]
[assembly: AssemblyInformationalVersion("1.0.0")]

namespace MineradioCleanup
{
    internal enum CleanupKind
    {
        Program,
        UserData,
        Shortcut,
        Registry
    }

    internal sealed class CleanupItem
    {
        public CleanupKind Kind;
        public string Path;
        public string Detail;

        public CleanupItem(CleanupKind kind, string path, string detail)
        {
            Kind = kind;
            Path = path;
            Detail = detail;
        }
    }

    internal sealed class RegistryLocation
    {
        public RegistryHive Hive;
        public RegistryView View;
        public string KeyPath;
        public string DisplayName;

        public string Identity
        {
            get
            {
                return Hive.ToString() + "|" + View.ToString() + "|" + KeyPath;
            }
        }

        public string FriendlyPath
        {
            get
            {
                string root = Hive == RegistryHive.CurrentUser ? "HKCU" : "HKLM";
                return root + "\\" + KeyPath;
            }
        }
    }

    internal sealed class ScanResult
    {
        public readonly List<string> InstallDirectories = new List<string>();
        public readonly List<string> UserDataDirectories = new List<string>();
        public readonly List<string> Shortcuts = new List<string>();
        public readonly List<RegistryLocation> RegistryEntries = new List<RegistryLocation>();

        public List<CleanupItem> ToItems()
        {
            List<CleanupItem> items = new List<CleanupItem>();
            foreach (string path in InstallDirectories)
                items.Add(new CleanupItem(CleanupKind.Program, path, "已验证的 Mineradio 安装目录"));
            foreach (string path in UserDataDirectories)
                items.Add(new CleanupItem(CleanupKind.UserData, path, "音源、歌单、设置或缓存"));
            foreach (string path in Shortcuts)
                items.Add(new CleanupItem(CleanupKind.Shortcut, path, "Mineradio 快捷方式"));
            foreach (RegistryLocation entry in RegistryEntries)
                items.Add(new CleanupItem(CleanupKind.Registry, entry.FriendlyPath, entry.DisplayName));
            return items;
        }
    }

    internal sealed class CleanupSummary
    {
        public readonly List<string> LogLines = new List<string>();
        public int Removed;
        public int Scheduled;
        public int Failed;
        public string LogFile;

        public bool Success
        {
            get { return Failed == 0; }
        }

        public void Add(string line)
        {
            LogLines.Add(DateTime.Now.ToString("HH:mm:ss") + "  " + line);
        }
    }

    internal static class CleanupEngine
    {
        private const int MoveFileDelayUntilReboot = 0x4;
        private const string MarkerName = ".mineradio-install-root";
        private const string MarkerAppId = "appId=com.mineradio.desktop";
        private const string OldInstallerGuid = "9733721a-009e-52bc-b705-49059cd80258";

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool MoveFileEx(string existingFileName, string newFileName, int flags);

        public static string Canonicalize(string path)
        {
            if (String.IsNullOrWhiteSpace(path)) return String.Empty;
            string expanded = Environment.ExpandEnvironmentVariables(path.Trim().Trim('"'));
            string full = Path.GetFullPath(expanded);
            string root = Path.GetPathRoot(full);
            if (!String.Equals(full, root, StringComparison.OrdinalIgnoreCase))
                full = full.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            return full;
        }

        public static bool IsPathInside(string childPath, string parentPath)
        {
            try
            {
                string child = Canonicalize(childPath);
                string parent = Canonicalize(parentPath);
                if (String.IsNullOrEmpty(child) || String.IsNullOrEmpty(parent)) return false;
                string prefix = parent + Path.DirectorySeparatorChar;
                return child.StartsWith(prefix, StringComparison.OrdinalIgnoreCase) ||
                    String.Equals(child, parent, StringComparison.OrdinalIgnoreCase);
            }
            catch
            {
                return false;
            }
        }

        private static bool IsDangerouslyBroad(string path)
        {
            try
            {
                string full = Canonicalize(path);
                if (String.IsNullOrEmpty(full)) return true;
                if (String.Equals(full, Path.GetPathRoot(full), StringComparison.OrdinalIgnoreCase)) return true;
                string user = Canonicalize(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile));
                string desktop = Canonicalize(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory));
                string appData = Canonicalize(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData));
                string local = Canonicalize(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData));
                return String.Equals(full, user, StringComparison.OrdinalIgnoreCase) ||
                    String.Equals(full, desktop, StringComparison.OrdinalIgnoreCase) ||
                    String.Equals(full, appData, StringComparison.OrdinalIgnoreCase) ||
                    String.Equals(full, local, StringComparison.OrdinalIgnoreCase);
            }
            catch
            {
                return true;
            }
        }

        public static bool IsRecognizedInstallDirectory(string path)
        {
            try
            {
                string full = Canonicalize(path);
                if (IsDangerouslyBroad(full) || !Directory.Exists(full)) return false;
                string exe = Path.Combine(full, "Mineradio.exe");
                if (!File.Exists(exe)) return false;

                string marker = Path.Combine(full, MarkerName);
                if (File.Exists(marker))
                {
                    string markerText = File.ReadAllText(marker, Encoding.UTF8);
                    if (markerText.IndexOf(MarkerAppId, StringComparison.OrdinalIgnoreCase) >= 0)
                        return true;
                }

                string package = Path.Combine(full, "resources", "app", "package.json");
                if (File.Exists(package))
                {
                    string packageText = File.ReadAllText(package, Encoding.UTF8);
                    string compact = RemoveJsonWhitespace(packageText);
                    if (compact.IndexOf("\"name\":\"mineradio\"", StringComparison.OrdinalIgnoreCase) >= 0 ||
                        compact.IndexOf("\"productName\":\"Mineradio\"", StringComparison.OrdinalIgnoreCase) >= 0 ||
                        compact.IndexOf("\"appId\":\"com.mineradio.desktop\"", StringComparison.OrdinalIgnoreCase) >= 0)
                        return true;
                }

                FileVersionInfo version = FileVersionInfo.GetVersionInfo(exe);
                return String.Equals(version.ProductName, "Mineradio", StringComparison.OrdinalIgnoreCase) ||
                    (version.FileDescription ?? String.Empty).IndexOf("Mineradio", StringComparison.OrdinalIgnoreCase) >= 0;
            }
            catch
            {
                return false;
            }
        }

        private static string RemoveJsonWhitespace(string text)
        {
            if (String.IsNullOrEmpty(text)) return String.Empty;
            StringBuilder output = new StringBuilder(text.Length);
            bool quoted = false;
            bool escaped = false;
            foreach (char ch in text)
            {
                if (quoted)
                {
                    output.Append(ch);
                    if (escaped) escaped = false;
                    else if (ch == '\\') escaped = true;
                    else if (ch == '"') quoted = false;
                }
                else
                {
                    if (ch == '"')
                    {
                        quoted = true;
                        output.Append(ch);
                    }
                    else if (!Char.IsWhiteSpace(ch)) output.Append(ch);
                }
            }
            return output.ToString();
        }

        public static List<string> KnownUserDataDirectories()
        {
            List<string> paths = new List<string>();
            string roaming = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            AddUnique(paths, Path.Combine(roaming, "Mineradio"));
            AddUnique(paths, Path.Combine(local, "Mineradio"));
            AddUnique(paths, Path.Combine(local, "MineradioPersistentFix"));
            return paths;
        }

        private static bool IsKnownUserDataDirectory(string path)
        {
            string full;
            try { full = Canonicalize(path); }
            catch { return false; }
            foreach (string known in KnownUserDataDirectories())
            {
                if (String.Equals(full, Canonicalize(known), StringComparison.OrdinalIgnoreCase)) return true;
            }
            return false;
        }

        public static ScanResult Scan(IEnumerable<string> manuallyAdded)
        {
            ScanResult result = new ScanResult();
            List<string> candidates = StandardInstallCandidates();
            if (manuallyAdded != null)
            {
                foreach (string path in manuallyAdded) AddUnique(candidates, path);
            }

            List<RegistryLocation> registryEntries = FindMineradioUninstallEntries();
            foreach (RegistryLocation entry in registryEntries)
            {
                string location = ReadRegistryInstallLocation(entry);
                if (!String.IsNullOrEmpty(location)) AddUnique(candidates, location);
            }

            foreach (string candidate in candidates)
            {
                if (IsRecognizedInstallDirectory(candidate)) AddUnique(result.InstallDirectories, Canonicalize(candidate));
            }

            foreach (string path in KnownUserDataDirectories())
            {
                if (Directory.Exists(path)) AddUnique(result.UserDataDirectories, Canonicalize(path));
            }

            foreach (string shortcut in FindMineradioShortcuts()) AddUnique(result.Shortcuts, shortcut);
            foreach (RegistryLocation entry in registryEntries) AddUniqueRegistry(result.RegistryEntries, entry);
            foreach (RegistryLocation entry in FindKnownAppRegistryEntries()) AddUniqueRegistry(result.RegistryEntries, entry);
            return result;
        }

        private static List<string> StandardInstallCandidates()
        {
            List<string> paths = new List<string>();
            AddUnique(paths, @"C:\Mineradio");
            string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            string desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
            string programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
            string programFilesX86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
            AddUnique(paths, Path.Combine(local, "Programs", "Mineradio"));
            AddUnique(paths, Path.Combine(desktop, "Mineradio"));
            if (!String.IsNullOrEmpty(programFiles)) AddUnique(paths, Path.Combine(programFiles, "Mineradio"));
            if (!String.IsNullOrEmpty(programFilesX86)) AddUnique(paths, Path.Combine(programFilesX86, "Mineradio"));
            return paths;
        }

        private static void AddUnique(List<string> values, string path)
        {
            if (String.IsNullOrWhiteSpace(path)) return;
            string full;
            try { full = Canonicalize(path); }
            catch { return; }
            if (!values.Any(value => String.Equals(value, full, StringComparison.OrdinalIgnoreCase))) values.Add(full);
        }

        private static void AddUniqueRegistry(List<RegistryLocation> values, RegistryLocation entry)
        {
            if (entry == null) return;
            if (!values.Any(value => String.Equals(value.Identity, entry.Identity, StringComparison.OrdinalIgnoreCase)))
                values.Add(entry);
        }

        private static IEnumerable<RegistryView> RegistryViews()
        {
            yield return RegistryView.Registry64;
            yield return RegistryView.Registry32;
        }

        private static List<RegistryLocation> FindMineradioUninstallEntries()
        {
            List<RegistryLocation> found = new List<RegistryLocation>();
            RegistryHive[] hives = new RegistryHive[] { RegistryHive.CurrentUser, RegistryHive.LocalMachine };
            foreach (RegistryHive hive in hives)
            {
                foreach (RegistryView view in RegistryViews())
                {
                    try
                    {
                        using (RegistryKey baseKey = RegistryKey.OpenBaseKey(hive, view))
                        using (RegistryKey uninstall = baseKey.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall"))
                        {
                            if (uninstall == null) continue;
                            foreach (string name in uninstall.GetSubKeyNames())
                            {
                                try
                                {
                                    using (RegistryKey app = uninstall.OpenSubKey(name))
                                    {
                                        if (app == null) continue;
                                        string display = Convert.ToString(app.GetValue("DisplayName", String.Empty));
                                        string publisher = Convert.ToString(app.GetValue("Publisher", String.Empty));
                                        bool match = display.StartsWith("Mineradio", StringComparison.OrdinalIgnoreCase) ||
                                            String.Equals(publisher, "Mineradio", StringComparison.OrdinalIgnoreCase) ||
                                            String.Equals(name, "com.mineradio.desktop", StringComparison.OrdinalIgnoreCase) ||
                                            String.Equals(name, OldInstallerGuid, StringComparison.OrdinalIgnoreCase);
                                        if (!match) continue;
                                        RegistryLocation entry = new RegistryLocation();
                                        entry.Hive = hive;
                                        entry.View = view;
                                        entry.KeyPath = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\" + name;
                                        entry.DisplayName = String.IsNullOrEmpty(display) ? name : display;
                                        AddUniqueRegistry(found, entry);
                                    }
                                }
                                catch { }
                            }
                        }
                    }
                    catch { }
                }
            }
            return found;
        }

        private static List<RegistryLocation> FindKnownAppRegistryEntries()
        {
            List<RegistryLocation> found = new List<RegistryLocation>();
            string[] keys = new string[]
            {
                @"Software\" + OldInstallerGuid,
                @"Software\com.mineradio.desktop",
                @"Software\Mineradio",
                @"Software\Classes\com.mineradio.desktop"
            };
            RegistryHive[] hives = new RegistryHive[] { RegistryHive.CurrentUser, RegistryHive.LocalMachine };
            foreach (RegistryHive hive in hives)
            {
                foreach (RegistryView view in RegistryViews())
                {
                    foreach (string path in keys)
                    {
                        try
                        {
                            using (RegistryKey baseKey = RegistryKey.OpenBaseKey(hive, view))
                            using (RegistryKey key = baseKey.OpenSubKey(path))
                            {
                                if (key == null) continue;
                                RegistryLocation entry = new RegistryLocation();
                                entry.Hive = hive;
                                entry.View = view;
                                entry.KeyPath = path;
                                entry.DisplayName = "Mineradio 应用注册信息";
                                AddUniqueRegistry(found, entry);
                            }
                        }
                        catch { }
                    }
                }
            }
            return found;
        }

        private static string ReadRegistryInstallLocation(RegistryLocation entry)
        {
            try
            {
                using (RegistryKey baseKey = RegistryKey.OpenBaseKey(entry.Hive, entry.View))
                using (RegistryKey key = baseKey.OpenSubKey(entry.KeyPath))
                {
                    if (key == null) return String.Empty;
                    string location = Convert.ToString(key.GetValue("InstallLocation", String.Empty));
                    if (!String.IsNullOrWhiteSpace(location)) return Canonicalize(location);
                    string uninstall = Convert.ToString(key.GetValue("UninstallString", String.Empty)).Trim();
                    if (String.IsNullOrEmpty(uninstall)) return String.Empty;
                    string executable = ExtractExecutablePath(uninstall);
                    return String.IsNullOrEmpty(executable) ? String.Empty : Path.GetDirectoryName(executable);
                }
            }
            catch
            {
                return String.Empty;
            }
        }

        private static string ExtractExecutablePath(string commandLine)
        {
            string text = (commandLine ?? String.Empty).Trim();
            if (text.StartsWith("\"", StringComparison.Ordinal))
            {
                int closing = text.IndexOf('"', 1);
                if (closing > 1) return text.Substring(1, closing - 1);
            }
            int exe = text.IndexOf(".exe", StringComparison.OrdinalIgnoreCase);
            if (exe >= 0) return text.Substring(0, exe + 4).Trim();
            return String.Empty;
        }

        private static List<string> FindMineradioShortcuts()
        {
            List<string> shortcuts = new List<string>();
            string appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            List<string> roots = new List<string>();
            AddUnique(roots, Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory));
            AddUnique(roots, Environment.GetFolderPath(Environment.SpecialFolder.CommonDesktopDirectory));
            AddUnique(roots, Environment.GetFolderPath(Environment.SpecialFolder.Programs));
            AddUnique(roots, Environment.GetFolderPath(Environment.SpecialFolder.CommonPrograms));
            AddUnique(roots, Path.Combine(appData, "Microsoft", "Internet Explorer", "Quick Launch", "User Pinned", "TaskBar"));
            foreach (string root in roots)
            {
                foreach (string file in SafeEnumerateFiles(root, "*.lnk"))
                {
                    string name = Path.GetFileNameWithoutExtension(file);
                    if (name.StartsWith("Mineradio", StringComparison.OrdinalIgnoreCase)) AddUnique(shortcuts, file);
                }
            }
            return shortcuts;
        }

        private static IEnumerable<string> SafeEnumerateFiles(string root, string pattern)
        {
            List<string> results = new List<string>();
            if (String.IsNullOrEmpty(root) || !Directory.Exists(root)) return results;
            Stack<string> pending = new Stack<string>();
            pending.Push(root);
            while (pending.Count > 0)
            {
                string current = pending.Pop();
                try { results.AddRange(Directory.GetFiles(current, pattern, SearchOption.TopDirectoryOnly)); }
                catch { }
                try
                {
                    foreach (string directory in Directory.GetDirectories(current))
                    {
                        try
                        {
                            FileAttributes attributes = File.GetAttributes(directory);
                            if ((attributes & FileAttributes.ReparsePoint) == 0) pending.Push(directory);
                        }
                        catch { }
                    }
                }
                catch { }
            }
            return results;
        }

        public static CleanupSummary Clean(ScanResult scan, bool removePrograms, bool removeUserData, bool removeShortcuts)
        {
            CleanupSummary summary = new CleanupSummary();
            summary.Add("Mineradio 清理开始");
            StopMineradioProcesses(scan.InstallDirectories, summary);

            if (removePrograms)
            {
                foreach (string directory in scan.InstallDirectories)
                {
                    if (!IsRecognizedInstallDirectory(directory))
                    {
                        summary.Failed++;
                        summary.Add("拒绝删除未通过身份验证的目录：" + directory);
                        continue;
                    }
                    if (IsPathInside(Application.ExecutablePath, directory))
                    {
                        summary.Failed++;
                        summary.Add("清理工具位于安装目录内，请先把本工具移到桌面或下载目录：" + directory);
                        continue;
                    }
                    if (!PreserveInstallerFiles(directory, ChooseInstallerPreserveDirectory(directory), summary))
                    {
                        summary.Add("为保护安装包，已取消删除程序目录：" + directory);
                        continue;
                    }
                    DeleteDirectorySafely(directory, summary, false);
                }
                DeleteRegistryEntries(scan.RegistryEntries, summary);
                DeleteRunEntries(summary);
            }

            if (removeShortcuts)
            {
                foreach (string shortcut in scan.Shortcuts) DeleteFileSafely(shortcut, summary);
            }

            if (removeUserData)
            {
                foreach (string directory in KnownUserDataDirectories())
                {
                    if (!Directory.Exists(directory)) continue;
                    if (!IsKnownUserDataDirectory(directory))
                    {
                        summary.Failed++;
                        summary.Add("拒绝删除未列入白名单的用户目录：" + directory);
                        continue;
                    }
                    if (IsPathInside(Application.ExecutablePath, directory))
                    {
                        summary.Failed++;
                        summary.Add("清理工具位于用户数据目录内，请先把本工具移到桌面或下载目录：" + directory);
                        continue;
                    }
                    if (!PreserveInstallerFiles(directory, ChooseInstallerPreserveDirectory(directory), summary))
                    {
                        summary.Add("为保护安装包，已取消删除用户数据目录：" + directory);
                        continue;
                    }
                    DeleteDirectorySafely(directory, summary, true);
                }
            }

            summary.Add("清理结束：已删除 " + summary.Removed + " 项，重启后删除 " + summary.Scheduled + " 项，失败 " + summary.Failed + " 项");
            summary.LogFile = WriteLog(summary.LogLines);
            return summary;
        }

        private static void StopMineradioProcesses(IEnumerable<string> installDirectories, CleanupSummary summary)
        {
            HashSet<int> stopped = new HashSet<int>();
            foreach (Process process in Process.GetProcessesByName("Mineradio"))
            {
                if (process.Id == Process.GetCurrentProcess().Id) continue;
                TryStopProcess(process, stopped, summary);
            }

            try
            {
                using (ManagementObjectSearcher searcher = new ManagementObjectSearcher("SELECT ProcessId, Name, ExecutablePath, CommandLine FROM Win32_Process"))
                using (ManagementObjectCollection collection = searcher.Get())
                {
                    foreach (ManagementObject item in collection)
                    {
                        int id = Convert.ToInt32((UInt32)item["ProcessId"]);
                        if (id == Process.GetCurrentProcess().Id || stopped.Contains(id)) continue;
                        string executable = Convert.ToString(item["ExecutablePath"]);
                        string command = Convert.ToString(item["CommandLine"]);
                        bool underInstall = installDirectories.Any(path => IsPathInside(executable, path));
                        bool persistentFix = command.IndexOf("MineradioPersistentFix", StringComparison.OrdinalIgnoreCase) >= 0;
                        if (!underInstall && !persistentFix) continue;
                        try { TryStopProcess(Process.GetProcessById(id), stopped, summary); }
                        catch { }
                    }
                }
            }
            catch (Exception error)
            {
                summary.Add("进程补充扫描跳过：" + error.Message);
            }
        }

        private static void TryStopProcess(Process process, HashSet<int> stopped, CleanupSummary summary)
        {
            try
            {
                int id = process.Id;
                process.Kill();
                process.WaitForExit(4000);
                stopped.Add(id);
                summary.Add("已停止 Mineradio 进程 PID " + id);
            }
            catch (Exception error)
            {
                summary.Add("无法停止进程 PID " + SafeProcessId(process) + "：" + error.Message);
            }
            finally
            {
                process.Dispose();
            }
        }

        private static string SafeProcessId(Process process)
        {
            try { return process.Id.ToString(); }
            catch { return "?"; }
        }

        private static string ChooseInstallerPreserveDirectory(string deletingDirectory)
        {
            string user = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            string downloads = Path.Combine(user, "Downloads");
            string desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
            string[] candidates = new string[]
            {
                Path.Combine(downloads, "Mineradio Installers"),
                Path.Combine(desktop, "Mineradio Installers"),
                Path.Combine(user, "Mineradio Installers"),
                Path.Combine(Path.GetTempPath(), "Mineradio Installers")
            };
            foreach (string candidate in candidates)
            {
                if (!IsPathInside(candidate, deletingDirectory)) return candidate;
            }
            return Path.Combine(Path.GetTempPath(), "Mineradio Installers-" + Guid.NewGuid().ToString("N"));
        }

        private static bool PreserveInstallerFiles(string root, string destination, CleanupSummary summary)
        {
            List<string> files;
            string scanError;
            if (!TryFindInstallerFiles(root, out files, out scanError))
            {
                summary.Failed++;
                summary.Add("无法完整检查安装包，拒绝删除目录 " + root + "：" + scanError);
                return false;
            }
            bool success = true;
            foreach (string source in files.Distinct(StringComparer.OrdinalIgnoreCase))
            {
                try
                {
                    Directory.CreateDirectory(destination);
                    string target = UniqueDestination(destination, Path.GetFileName(source));
                    File.Move(source, target);
                    summary.Add("已保留安装文件：" + target);
                }
                catch (Exception error)
                {
                    success = false;
                    summary.Failed++;
                    summary.Add("无法保留安装文件 " + source + "：" + error.Message);
                }
            }
            return success;
        }

        private static bool TryFindInstallerFiles(string root, out List<string> files, out string error)
        {
            files = new List<string>();
            error = String.Empty;
            if (!Directory.Exists(root)) return true;
            Stack<string> pending = new Stack<string>();
            pending.Push(root);
            while (pending.Count > 0)
            {
                string current = pending.Pop();
                try
                {
                    foreach (string file in Directory.GetFiles(current, "*", SearchOption.TopDirectoryOnly))
                    {
                        string name = Path.GetFileName(file);
                        if (!name.StartsWith("Mineradio.Setup.", StringComparison.OrdinalIgnoreCase)) continue;
                        if (name.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) ||
                            name.EndsWith(".exe.blockmap", StringComparison.OrdinalIgnoreCase) ||
                            name.EndsWith(".SHA256.txt", StringComparison.OrdinalIgnoreCase)) files.Add(file);
                    }
                    foreach (string directory in Directory.GetDirectories(current))
                    {
                        FileAttributes attributes = File.GetAttributes(directory);
                        if ((attributes & FileAttributes.ReparsePoint) == 0) pending.Push(directory);
                    }
                }
                catch (Exception exception)
                {
                    error = exception.Message;
                    return false;
                }
            }
            return true;
        }

        private static string UniqueDestination(string directory, string fileName)
        {
            string target = Path.Combine(directory, fileName);
            if (!File.Exists(target)) return target;
            string stem = Path.GetFileNameWithoutExtension(fileName);
            string extension = Path.GetExtension(fileName);
            for (int index = 1; index < 1000; index++)
            {
                target = Path.Combine(directory, stem + "-" + index + extension);
                if (!File.Exists(target)) return target;
            }
            return Path.Combine(directory, stem + "-" + Guid.NewGuid().ToString("N") + extension);
        }

        private static void NormalizeAttributes(string root)
        {
            foreach (string file in SafeEnumerateFiles(root, "*"))
            {
                try { File.SetAttributes(file, FileAttributes.Normal); }
                catch { }
            }
        }

        private static void DeleteDirectorySafely(string path, CleanupSummary summary, bool userData)
        {
            try
            {
                if (!Directory.Exists(path)) return;
                if (IsDangerouslyBroad(path)) throw new InvalidOperationException("目标目录范围过大");
                NormalizeAttributes(path);
                Directory.Delete(path, true);
                summary.Removed++;
                summary.Add((userData ? "已删除用户数据：" : "已删除程序目录：") + path);
            }
            catch (Exception error)
            {
                if (ScheduleDirectoryForReboot(path))
                {
                    summary.Scheduled++;
                    summary.Add("目录被占用，已安排重启后删除：" + path);
                }
                else
                {
                    summary.Failed++;
                    summary.Add("删除失败 " + path + "：" + error.Message);
                }
            }
        }

        private static void DeleteFileSafely(string path, CleanupSummary summary)
        {
            try
            {
                if (!File.Exists(path)) return;
                File.SetAttributes(path, FileAttributes.Normal);
                File.Delete(path);
                summary.Removed++;
                summary.Add("已删除快捷方式：" + path);
            }
            catch (Exception error)
            {
                if (MoveFileEx(path, null, MoveFileDelayUntilReboot))
                {
                    summary.Scheduled++;
                    summary.Add("快捷方式已安排重启后删除：" + path);
                }
                else
                {
                    summary.Failed++;
                    summary.Add("删除快捷方式失败 " + path + "：" + error.Message);
                }
            }
        }

        private static bool ScheduleDirectoryForReboot(string path)
        {
            try
            {
                if (!Directory.Exists(path)) return true;
                List<string> files = SafeEnumerateFiles(path, "*").ToList();
                foreach (string file in files) MoveFileEx(file, null, MoveFileDelayUntilReboot);
                List<string> directories = SafeEnumerateDirectories(path);
                directories.Sort(delegate(string left, string right) { return right.Length.CompareTo(left.Length); });
                foreach (string directory in directories) MoveFileEx(directory, null, MoveFileDelayUntilReboot);
                return MoveFileEx(path, null, MoveFileDelayUntilReboot);
            }
            catch
            {
                return false;
            }
        }

        private static List<string> SafeEnumerateDirectories(string root)
        {
            List<string> results = new List<string>();
            if (!Directory.Exists(root)) return results;
            Stack<string> pending = new Stack<string>();
            pending.Push(root);
            while (pending.Count > 0)
            {
                string current = pending.Pop();
                try
                {
                    foreach (string directory in Directory.GetDirectories(current))
                    {
                        results.Add(directory);
                        try
                        {
                            FileAttributes attributes = File.GetAttributes(directory);
                            if ((attributes & FileAttributes.ReparsePoint) == 0) pending.Push(directory);
                        }
                        catch { }
                    }
                }
                catch { }
            }
            return results;
        }

        private static void DeleteRegistryEntries(IEnumerable<RegistryLocation> entries, CleanupSummary summary)
        {
            foreach (RegistryLocation entry in entries)
            {
                try
                {
                    using (RegistryKey baseKey = RegistryKey.OpenBaseKey(entry.Hive, entry.View))
                    {
                        baseKey.DeleteSubKeyTree(entry.KeyPath, false);
                    }
                    summary.Removed++;
                    summary.Add("已删除注册信息：" + entry.FriendlyPath);
                }
                catch (Exception error)
                {
                    summary.Failed++;
                    summary.Add("删除注册信息失败 " + entry.FriendlyPath + "：" + error.Message);
                }
            }
        }

        private static void DeleteRunEntries(CleanupSummary summary)
        {
            string[] paths = new string[]
            {
                @"Software\Microsoft\Windows\CurrentVersion\Run",
                @"Software\Microsoft\Windows\CurrentVersion\RunOnce"
            };
            RegistryHive[] hives = new RegistryHive[] { RegistryHive.CurrentUser, RegistryHive.LocalMachine };
            foreach (RegistryHive hive in hives)
            {
                foreach (RegistryView view in RegistryViews())
                {
                    foreach (string path in paths)
                    {
                        try
                        {
                            using (RegistryKey baseKey = RegistryKey.OpenBaseKey(hive, view))
                            using (RegistryKey key = baseKey.OpenSubKey(path, true))
                            {
                                if (key == null) continue;
                                foreach (string name in key.GetValueNames())
                                {
                                    string value = Convert.ToString(key.GetValue(name, String.Empty));
                                    if (name.IndexOf("Mineradio", StringComparison.OrdinalIgnoreCase) < 0 &&
                                        value.IndexOf("Mineradio", StringComparison.OrdinalIgnoreCase) < 0) continue;
                                    key.DeleteValue(name, false);
                                    summary.Removed++;
                                    summary.Add("已删除开机启动项：" + name);
                                }
                            }
                        }
                        catch (Exception error)
                        {
                            summary.Add("开机启动项检查跳过：" + error.Message);
                        }
                    }
                }
            }
        }

        private static string WriteLog(IEnumerable<string> lines)
        {
            try
            {
                string file = Path.Combine(Path.GetTempPath(), "Mineradio-Cleanup-" + DateTime.Now.ToString("yyyyMMdd-HHmmss") + ".log");
                File.WriteAllLines(file, lines, new UTF8Encoding(true));
                return file;
            }
            catch
            {
                return String.Empty;
            }
        }

        public static int RunSelfTest(string resultFile)
        {
            string token = Guid.NewGuid().ToString("N");
            string root = Path.Combine(Path.GetTempPath(), "MineradioCleanupTest-" + token);
            string install = Path.Combine(root, "Mineradio");
            string preserve = Path.Combine(Path.GetTempPath(), "MineradioCleanupTestPreserved-" + token);
            StringBuilder report = new StringBuilder();
            int exitCode = 1;
            try
            {
                Directory.CreateDirectory(Path.Combine(install, "resources", "app"));
                File.WriteAllText(Path.Combine(install, "Mineradio.exe"), "self-test", Encoding.ASCII);
                File.WriteAllText(Path.Combine(install, MarkerName), "Mineradio install root\r\n" + MarkerAppId + "\r\n", Encoding.UTF8);
                File.WriteAllText(Path.Combine(install, "resources", "app", "package.json"), "{\"name\":\"mineradio\"}", Encoding.UTF8);
                File.WriteAllText(Path.Combine(install, "Mineradio.Setup.9.9.9.exe"), "installer", Encoding.ASCII);
                string fakeUserData = Path.Combine(root, "UserData");
                Directory.CreateDirectory(fakeUserData);
                File.WriteAllText(Path.Combine(fakeUserData, "settings.json"), "{}", Encoding.ASCII);
                string fakeShortcut = Path.Combine(root, "Mineradio.lnk");
                File.WriteAllText(fakeShortcut, "shortcut", Encoding.ASCII);
                string invalid = Path.Combine(root, "NotMineradio");
                Directory.CreateDirectory(invalid);
                File.WriteAllText(Path.Combine(invalid, "random.exe"), "keep", Encoding.ASCII);
                string lockedInstall = Path.Combine(root, "LockedMineradio");
                Directory.CreateDirectory(lockedInstall);
                string lockedInstaller = Path.Combine(lockedInstall, "Mineradio.Setup.8.8.8.exe");
                File.WriteAllText(lockedInstaller, "locked installer", Encoding.ASCII);

                RegistryView testView = Environment.Is64BitOperatingSystem ? RegistryView.Registry64 : RegistryView.Registry32;
                string testRegistryPath = @"Software\MineradioCleanupSelfTest\" + token;
                using (RegistryKey currentUser = RegistryKey.OpenBaseKey(RegistryHive.CurrentUser, testView))
                using (RegistryKey testKey = currentUser.CreateSubKey(testRegistryPath))
                {
                    if (testKey != null) testKey.SetValue("SelfTest", 1, RegistryValueKind.DWord);
                }

                bool recognized = IsRecognizedInstallDirectory(install);
                bool invalidRejected = !IsRecognizedInstallDirectory(invalid);
                bool lockedInstallerBlocked;
                CleanupSummary lockedSummary = new CleanupSummary();
                using (FileStream lockedStream = new FileStream(lockedInstaller, FileMode.Open, FileAccess.Read, FileShare.None))
                {
                    lockedInstallerBlocked = !PreserveInstallerFiles(lockedInstall, preserve, lockedSummary);
                }
                lockedInstallerBlocked = lockedInstallerBlocked && Directory.Exists(lockedInstall) && File.Exists(lockedInstaller);
                CleanupSummary summary = new CleanupSummary();
                bool preservationSucceeded = PreserveInstallerFiles(install, preserve, summary);
                DeleteDirectorySafely(install, summary, false);
                DeleteDirectorySafely(fakeUserData, summary, true);
                DeleteFileSafely(fakeShortcut, summary);
                RegistryLocation testRegistry = new RegistryLocation();
                testRegistry.Hive = RegistryHive.CurrentUser;
                testRegistry.View = testView;
                testRegistry.KeyPath = testRegistryPath;
                testRegistry.DisplayName = "Self test";
                DeleteRegistryEntries(new RegistryLocation[] { testRegistry }, summary);
                bool removed = !Directory.Exists(install);
                bool installerPreserved = Directory.Exists(preserve) && Directory.GetFiles(preserve, "Mineradio.Setup.9.9.9*.exe").Length == 1;
                bool invalidKept = Directory.Exists(invalid) && File.Exists(Path.Combine(invalid, "random.exe"));
                bool userDataRemoved = !Directory.Exists(fakeUserData);
                bool shortcutRemoved = !File.Exists(fakeShortcut);
                bool registryRemoved;
                using (RegistryKey currentUser = RegistryKey.OpenBaseKey(RegistryHive.CurrentUser, testView))
                using (RegistryKey testKey = currentUser.OpenSubKey(testRegistryPath))
                {
                    registryRemoved = testKey == null;
                }
                bool passed = recognized && invalidRejected && lockedInstallerBlocked && preservationSucceeded && removed && installerPreserved && invalidKept &&
                    userDataRemoved && shortcutRemoved && registryRemoved && summary.Failed == 0;
                report.AppendLine("recognized=" + recognized);
                report.AppendLine("invalidRejected=" + invalidRejected);
                report.AppendLine("lockedInstallerBlocked=" + lockedInstallerBlocked);
                report.AppendLine("installRemoved=" + removed);
                report.AppendLine("installerPreserved=" + installerPreserved);
                report.AppendLine("preservationSucceeded=" + preservationSucceeded);
                report.AppendLine("invalidKept=" + invalidKept);
                report.AppendLine("userDataRemoved=" + userDataRemoved);
                report.AppendLine("shortcutRemoved=" + shortcutRemoved);
                report.AppendLine("registryRemoved=" + registryRemoved);
                report.AppendLine("failed=" + summary.Failed);
                report.AppendLine("result=" + (passed ? "PASS" : "FAIL"));
                exitCode = passed ? 0 : 2;
            }
            catch (Exception error)
            {
                report.AppendLine("exception=" + error);
                report.AppendLine("result=FAIL");
                exitCode = 3;
            }
            finally
            {
                try { if (Directory.Exists(root)) Directory.Delete(root, true); } catch { }
                try { if (Directory.Exists(preserve)) Directory.Delete(preserve, true); } catch { }
                if (!String.IsNullOrEmpty(resultFile))
                {
                    try { File.WriteAllText(resultFile, report.ToString(), new UTF8Encoding(true)); } catch { }
                }
            }
            return exitCode;
        }

        public static int WriteScanReport(string reportFile)
        {
            try
            {
                ScanResult scan = Scan(null);
                List<string> lines = new List<string>();
                foreach (string path in scan.InstallDirectories) lines.Add("PROGRAM|" + path);
                foreach (string path in scan.UserDataDirectories) lines.Add("USER_DATA|" + path);
                foreach (string path in scan.Shortcuts) lines.Add("SHORTCUT|" + path);
                foreach (RegistryLocation entry in scan.RegistryEntries) lines.Add("REGISTRY|" + entry.FriendlyPath + "|" + entry.DisplayName);
                lines.Add("SUMMARY|programs=" + scan.InstallDirectories.Count + "|userData=" + scan.UserDataDirectories.Count + "|shortcuts=" + scan.Shortcuts.Count + "|registry=" + scan.RegistryEntries.Count);
                File.WriteAllLines(reportFile, lines, new UTF8Encoding(true));
                return 0;
            }
            catch (Exception error)
            {
                try { File.WriteAllText(reportFile, "ERROR|" + error, new UTF8Encoding(true)); } catch { }
                return 4;
            }
        }
    }

    internal sealed class CleanupForm : Form
    {
        private readonly Label introLabel;
        private readonly CheckBox removePrograms;
        private readonly CheckBox removeUserData;
        private readonly CheckBox removeShortcuts;
        private readonly ListView itemList;
        private readonly Button scanButton;
        private readonly Button addDirectoryButton;
        private readonly Button cleanupButton;
        private readonly RichTextBox logBox;
        private readonly Label statusLabel;
        private readonly List<string> manualDirectories = new List<string>();
        private ScanResult currentScan = new ScanResult();

        public CleanupForm()
        {
            Text = "Mineradio 清理工具 1.0.0";
            StartPosition = FormStartPosition.CenterScreen;
            MinimumSize = new Size(860, 650);
            Size = new Size(960, 720);
            AutoScaleMode = AutoScaleMode.Dpi;
            Font = new Font("Microsoft YaHei UI", 9F, FontStyle.Regular, GraphicsUnit.Point);
            BackColor = Color.FromArgb(248, 249, 252);

            introLabel = new Label();
            introLabel.AutoSize = false;
            introLabel.Text = "先扫描，再选择清理范围。程序目录必须通过 Mineradio 身份验证后才能删除；安装包会被保留。";
            introLabel.Location = new Point(24, 20);
            introLabel.Size = new Size(890, 42);
            introLabel.Font = new Font(Font.FontFamily, 10F, FontStyle.Bold);

            removePrograms = new CheckBox();
            removePrograms.Text = "移除 Mineradio 程序和注册信息";
            removePrograms.Checked = true;
            removePrograms.AutoSize = true;
            removePrograms.Location = new Point(26, 68);

            removeShortcuts = new CheckBox();
            removeShortcuts.Text = "移除桌面、开始菜单和任务栏快捷方式";
            removeShortcuts.Checked = true;
            removeShortcuts.AutoSize = true;
            removeShortcuts.Location = new Point(292, 68);

            removeUserData = new CheckBox();
            removeUserData.Text = "彻底清除用户数据（音源、歌单、设置、缓存）";
            removeUserData.Checked = false;
            removeUserData.ForeColor = Color.FromArgb(180, 45, 45);
            removeUserData.AutoSize = true;
            removeUserData.Location = new Point(620, 68);

            itemList = new ListView();
            itemList.Location = new Point(24, 102);
            itemList.Size = new Size(900, 300);
            itemList.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            itemList.View = View.Details;
            itemList.FullRowSelect = true;
            itemList.GridLines = true;
            itemList.HideSelection = false;
            itemList.Columns.Add("类型", 100);
            itemList.Columns.Add("路径", 590);
            itemList.Columns.Add("说明", 195);

            scanButton = MakeButton("重新扫描", new Point(24, 414), 110);
            scanButton.Click += delegate { BeginScan(); };

            addDirectoryButton = MakeButton("添加自定义目录", new Point(146, 414), 145);
            addDirectoryButton.Click += AddDirectoryClicked;

            cleanupButton = MakeButton("开始清理", new Point(774, 414), 150);
            cleanupButton.Anchor = AnchorStyles.Top | AnchorStyles.Right;
            cleanupButton.BackColor = Color.FromArgb(208, 59, 59);
            cleanupButton.ForeColor = Color.White;
            cleanupButton.FlatStyle = FlatStyle.Flat;
            cleanupButton.Click += CleanupClicked;

            statusLabel = new Label();
            statusLabel.AutoSize = false;
            statusLabel.Location = new Point(308, 420);
            statusLabel.Size = new Size(450, 26);
            statusLabel.TextAlign = ContentAlignment.MiddleLeft;

            logBox = new RichTextBox();
            logBox.Location = new Point(24, 464);
            logBox.Size = new Size(900, 180);
            logBox.Anchor = AnchorStyles.Top | AnchorStyles.Bottom | AnchorStyles.Left | AnchorStyles.Right;
            logBox.ReadOnly = true;
            logBox.BackColor = Color.White;
            logBox.Font = new Font("Consolas", 9F);
            logBox.Text = "等待扫描……";

            Controls.Add(introLabel);
            Controls.Add(removePrograms);
            Controls.Add(removeShortcuts);
            Controls.Add(removeUserData);
            Controls.Add(itemList);
            Controls.Add(scanButton);
            Controls.Add(addDirectoryButton);
            Controls.Add(cleanupButton);
            Controls.Add(statusLabel);
            Controls.Add(logBox);

            Shown += delegate { BeginScan(); };
        }

        private Button MakeButton(string text, Point location, int width)
        {
            Button button = new Button();
            button.Text = text;
            button.Location = location;
            button.Size = new Size(width, 36);
            button.UseVisualStyleBackColor = true;
            return button;
        }

        private void SetBusy(bool busy, string status)
        {
            scanButton.Enabled = !busy;
            addDirectoryButton.Enabled = !busy;
            cleanupButton.Enabled = !busy;
            removePrograms.Enabled = !busy;
            removeShortcuts.Enabled = !busy;
            removeUserData.Enabled = !busy;
            statusLabel.Text = status;
            UseWaitCursor = busy;
        }

        private void BeginScan()
        {
            SetBusy(true, "正在扫描……");
            logBox.Text = "正在扫描已安装版本、用户数据、快捷方式和注册信息……";
            Task.Factory.StartNew(delegate { return CleanupEngine.Scan(manualDirectories); })
                .ContinueWith(delegate(Task<ScanResult> task)
                {
                    BeginInvoke((MethodInvoker)delegate
                    {
                        if (task.IsFaulted)
                        {
                            SetBusy(false, "扫描失败");
                            logBox.Text = task.Exception == null ? "未知错误" : task.Exception.ToString();
                            return;
                        }
                        currentScan = task.Result;
                        RenderScan(currentScan);
                        SetBusy(false, "扫描完成");
                    });
                });
        }

        private void RenderScan(ScanResult scan)
        {
            itemList.BeginUpdate();
            itemList.Items.Clear();
            foreach (CleanupItem item in scan.ToItems())
            {
                string kind = item.Kind == CleanupKind.Program ? "程序" :
                    item.Kind == CleanupKind.UserData ? "用户数据" :
                    item.Kind == CleanupKind.Shortcut ? "快捷方式" : "注册信息";
                ListViewItem row = new ListViewItem(kind);
                row.SubItems.Add(item.Path);
                row.SubItems.Add(item.Detail);
                if (item.Kind == CleanupKind.UserData) row.ForeColor = Color.FromArgb(170, 50, 50);
                itemList.Items.Add(row);
            }
            itemList.EndUpdate();
            logBox.Text = "扫描结果：程序目录 " + scan.InstallDirectories.Count + " 个，用户数据目录 " +
                scan.UserDataDirectories.Count + " 个，快捷方式 " + scan.Shortcuts.Count + " 个，注册信息 " +
                scan.RegistryEntries.Count + " 项。\r\n\r\n" +
                "提示：不勾选“彻底清除用户数据”时，音源、歌单和设置会保留。LX Music 自己的数据永远不会被本工具删除。";
        }

        private void AddDirectoryClicked(object sender, EventArgs eventArgs)
        {
            using (FolderBrowserDialog dialog = new FolderBrowserDialog())
            {
                dialog.Description = "选择包含 Mineradio.exe 的安装目录";
                dialog.ShowNewFolderButton = false;
                if (dialog.ShowDialog(this) != DialogResult.OK) return;
                if (!CleanupEngine.IsRecognizedInstallDirectory(dialog.SelectedPath))
                {
                    MessageBox.Show(this, "该目录没有通过 Mineradio 身份验证，因此不会加入清理范围。", "无法识别", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                    return;
                }
                if (!manualDirectories.Any(path => String.Equals(CleanupEngine.Canonicalize(path), CleanupEngine.Canonicalize(dialog.SelectedPath), StringComparison.OrdinalIgnoreCase)))
                    manualDirectories.Add(dialog.SelectedPath);
                BeginScan();
            }
        }

        private void CleanupClicked(object sender, EventArgs eventArgs)
        {
            if (!removePrograms.Checked && !removeUserData.Checked && !removeShortcuts.Checked)
            {
                MessageBox.Show(this, "请至少选择一个清理项目。", "未选择范围", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }
            bool hasSelectedContent =
                (removePrograms.Checked && (currentScan.InstallDirectories.Count > 0 || currentScan.RegistryEntries.Count > 0)) ||
                (removeUserData.Checked && currentScan.UserDataDirectories.Count > 0) ||
                (removeShortcuts.Checked && currentScan.Shortcuts.Count > 0);
            if (!hasSelectedContent)
            {
                MessageBox.Show(this, "没有检测到可清理的 Mineradio。可以用“添加自定义目录”指定旧版位置。", "没有检测到安装", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }

            StringBuilder warning = new StringBuilder();
            warning.AppendLine("即将执行以下操作：");
            if (removePrograms.Checked) warning.AppendLine("• 删除已验证的 Mineradio 程序目录和注册信息");
            if (removeShortcuts.Checked) warning.AppendLine("• 删除 Mineradio 快捷方式");
            if (removeUserData.Checked)
            {
                warning.AppendLine("• 永久删除音源、歌单、设置、壁纸和缓存");
                warning.AppendLine();
                warning.AppendLine("用户数据删除后无法恢复。");
            }
            warning.AppendLine();
            warning.AppendLine("Mineradio.Setup.*.exe 安装包会被保留。是否继续？");
            DialogResult answer = MessageBox.Show(this, warning.ToString(), "确认清理 Mineradio", MessageBoxButtons.YesNo, MessageBoxIcon.Warning, MessageBoxDefaultButton.Button2);
            if (answer != DialogResult.Yes) return;

            SetBusy(true, "正在清理……");
            logBox.Text = "正在停止 Mineradio 并清理所选内容，请勿关闭本工具……";
            bool programs = removePrograms.Checked;
            bool userData = removeUserData.Checked;
            bool shortcuts = removeShortcuts.Checked;
            ScanResult scan = currentScan;
            Task.Factory.StartNew(delegate { return CleanupEngine.Clean(scan, programs, userData, shortcuts); })
                .ContinueWith(delegate(Task<CleanupSummary> task)
                {
                    BeginInvoke((MethodInvoker)delegate
                    {
                        if (task.IsFaulted)
                        {
                            SetBusy(false, "清理异常");
                            logBox.Text = task.Exception == null ? "未知错误" : task.Exception.ToString();
                            return;
                        }
                        CleanupSummary summary = task.Result;
                        logBox.Text = String.Join("\r\n", summary.LogLines.ToArray()) +
                            (String.IsNullOrEmpty(summary.LogFile) ? String.Empty : "\r\n\r\n日志：" + summary.LogFile);
                        SetBusy(false, summary.Success ? "清理完成" : "部分项目未清理");
                        string message = summary.Success ? "Mineradio 清理完成。" : "清理完成，但有项目失败，请查看日志。";
                        if (summary.Scheduled > 0) message += "\r\n部分文件将在重启 Windows 后删除。";
                        if (removeUserData.Checked) message += "\r\n现在重新安装会以首次安装状态启动。";
                        MessageBox.Show(this, message, "清理结果", MessageBoxButtons.OK, summary.Success ? MessageBoxIcon.Information : MessageBoxIcon.Warning);
                        BeginScan();
                    });
                });
        }
    }

    internal static class Program
    {
        [STAThread]
        private static int Main(string[] args)
        {
            string selfTestResult = ArgumentValue(args, "--self-test-result=");
            if (HasArgument(args, "--self-test") || !String.IsNullOrEmpty(selfTestResult))
                return CleanupEngine.RunSelfTest(selfTestResult);

            string scanReport = ArgumentValue(args, "--scan-report=");
            if (!String.IsNullOrEmpty(scanReport)) return CleanupEngine.WriteScanReport(scanReport);

            if (HasArgument(args, "--version"))
            {
                MessageBox.Show("Mineradio Cleanup Tool 1.0.0", "版本", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return 0;
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new CleanupForm());
            return 0;
        }

        private static bool HasArgument(IEnumerable<string> args, string expected)
        {
            return args.Any(value => String.Equals(value, expected, StringComparison.OrdinalIgnoreCase));
        }

        private static string ArgumentValue(IEnumerable<string> args, string prefix)
        {
            foreach (string argument in args)
            {
                if (argument.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) return argument.Substring(prefix.Length).Trim('"');
            }
            return String.Empty;
        }
    }
}
