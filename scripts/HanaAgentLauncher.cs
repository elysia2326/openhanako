using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;
using Microsoft.Win32;

internal static class HanaAgentLauncher
{
    private const string ProjectDir = @"D:\hana agent\openhanako";
    private const string DevPackagedExe = @"D:\hana agent\openhanako\dist\win-unpacked\HanaAgent.exe";
    private const string LauncherBuildMarker = "HANA_AGENT_LAUNCHER_PREFERS_INSTALLED_2026_06_26";

    [STAThread]
    private static int Main()
    {
        try
        {
            GC.KeepAlive(LauncherBuildMarker);

            foreach (var exePath in CandidateExecutables())
            {
                if (StartIfExists(exePath))
                {
                    return 0;
                }
            }

            var npmCmd = Path.Combine(Environment.GetEnvironmentVariable("SystemRoot") ?? @"C:\Windows", "System32", "cmd.exe");
            var startInfo = new ProcessStartInfo
            {
                FileName = npmCmd,
                Arguments = "/d /c npm start",
                WorkingDirectory = ProjectDir,
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden
            };

            Process.Start(startInfo);
            return 0;
        }
        catch (Exception ex)
        {
            MessageBox.Show(
                "HanaAgent failed to start.\n\n" + ex.Message,
                "HanaAgent Launcher",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
            return 1;
        }
    }

    private static IEnumerable<string> CandidateExecutables()
    {
        var overridePath = Environment.GetEnvironmentVariable("HANA_AGENT_EXE");
        if (!string.IsNullOrWhiteSpace(overridePath))
        {
            yield return overridePath;
        }

        foreach (var installLocation in ReadInstalledHanaAgentLocations())
        {
            yield return Path.Combine(installLocation, "HanaAgent.exe");
        }

        yield return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "HanaAgent", "HanaAgent.exe");
        yield return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "HanaAgent", "HanaAgent.exe");
        yield return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "HanaAgent", "HanaAgent.exe");
        yield return DevPackagedExe;
    }

    private static IEnumerable<string> ReadInstalledHanaAgentLocations()
    {
        var registryRoots = new[]
        {
            Tuple.Create(RegistryHive.CurrentUser, RegistryView.Default),
            Tuple.Create(RegistryHive.LocalMachine, RegistryView.Registry64),
            Tuple.Create(RegistryHive.LocalMachine, RegistryView.Registry32)
        };

        foreach (var root in registryRoots)
        {
            using (var baseKey = RegistryKey.OpenBaseKey(root.Item1, root.Item2))
            using (var uninstallKey = baseKey.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall"))
            {
                if (uninstallKey == null)
                {
                    continue;
                }

                foreach (var subKeyName in uninstallKey.GetSubKeyNames())
                {
                    using (var appKey = uninstallKey.OpenSubKey(subKeyName))
                    {
                        if (appKey == null)
                        {
                            continue;
                        }

                        var displayName = Convert.ToString(appKey.GetValue("DisplayName"));
                        if (string.IsNullOrWhiteSpace(displayName) ||
                            displayName.IndexOf("HanaAgent", StringComparison.OrdinalIgnoreCase) < 0)
                        {
                            continue;
                        }

                        var installLocation = Convert.ToString(appKey.GetValue("InstallLocation"));
                        if (!string.IsNullOrWhiteSpace(installLocation))
                        {
                            yield return installLocation;
                        }
                    }
                }
            }
        }
    }

    private static bool StartIfExists(string exePath)
    {
        if (string.IsNullOrWhiteSpace(exePath) || !File.Exists(exePath))
        {
            return false;
        }

        Process.Start(new ProcessStartInfo
        {
            FileName = exePath,
            WorkingDirectory = Path.GetDirectoryName(exePath),
            UseShellExecute = true
        });
        return true;
    }
}
