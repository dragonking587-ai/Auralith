using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

internal static class Program
{
    private const string Version = "2.0.0-rc.51";
    private const string ReleaseTag = "Auralith-Native-2.0.0-rc.51";
    private const string ManifestUrl = "https://github.com/dragonking587-ai/Auralith/releases/download/" + ReleaseTag + "/update.json";
    private const string AllowedPrefix = "https://github.com/dragonking587-ai/Auralith/releases/download/" + ReleaseTag + "/";

    [STAThread]
    private static int Main(string[] args)
    {
        try
        {
            ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
            var root = Path.Combine(Path.GetTempPath(), "Auralith-UpdateBridge-" + Version);
            Directory.CreateDirectory(root);
            var installer = Path.Combine(root, "Auralith-" + Version + "-x64-Setup.exe");

            string manifest;
            using (var client = new WebClient())
            {
                client.Headers.Add(HttpRequestHeader.UserAgent, "Auralith-UpdateBridge/" + Version);
                manifest = client.DownloadString(ManifestUrl);
            }

            var assetUrl = MatchJsonString(manifest, "assetUrl");
            var expectedSha = MatchJsonString(manifest, "sha256");
            if (string.IsNullOrWhiteSpace(assetUrl) || string.IsNullOrWhiteSpace(expectedSha))
                throw new InvalidDataException("Release metadata is incomplete.");
            if (!assetUrl.StartsWith(AllowedPrefix, StringComparison.OrdinalIgnoreCase)
                || !assetUrl.EndsWith("-x64-Setup.exe", StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("Release metadata contains an unexpected installer URL.");

            using (var client = new WebClient())
            {
                client.Headers.Add(HttpRequestHeader.UserAgent, "Auralith-UpdateBridge/" + Version);
                client.DownloadFile(assetUrl, installer);
            }

            var actualSha = Sha256File(installer);
            if (!actualSha.Equals(expectedSha.Trim(), StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("Downloaded Auralith installer failed SHA-256 verification.");

            var psi = new ProcessStartInfo(installer)
            {
                UseShellExecute = false,
                Arguments = BuildArguments(args),
                WorkingDirectory = root
            };
            using (var process = Process.Start(psi))
            {
                if (process == null) return 5;
                process.WaitForExit();
                return process.ExitCode;
            }
        }
        catch (Exception ex)
        {
            try
            {
                var logDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Auralith", "Logs");
                Directory.CreateDirectory(logDir);
                File.AppendAllText(Path.Combine(logDir, "updater-bridge.log"), DateTime.Now.ToString("s") + " " + ex + Environment.NewLine);
            }
            catch { }
            return 1;
        }
    }

    private static string MatchJsonString(string json, string key)
    {
        var match = Regex.Match(json, "\\\"" + Regex.Escape(key) + "\\\"\\s*:\\s*\\\"(?<value>[^\\\"]+)\\\"", RegexOptions.IgnoreCase);
        return match.Success ? match.Groups["value"].Value.Replace("\\/", "/") : string.Empty;
    }

    private static string Sha256File(string path)
    {
        using (var stream = File.OpenRead(path))
        using (var sha = SHA256.Create())
        {
            var hash = sha.ComputeHash(stream);
            var builder = new StringBuilder(hash.Length * 2);
            foreach (var b in hash) builder.Append(b.ToString("x2"));
            return builder.ToString();
        }
    }

    private static string BuildArguments(string[] args)
    {
        var builder = new StringBuilder();
        for (var i = 0; i < args.Length; i++)
        {
            if (i > 0) builder.Append(' ');
            builder.Append(Quote(args[i]));
        }
        return builder.ToString();
    }

    private static string Quote(string value)
    {
        if (string.IsNullOrEmpty(value)) return "\"\"";
        if (value.IndexOfAny(new[] { ' ', '\t', '\"' }) < 0) return value;
        return "\"" + value.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";
    }
}
