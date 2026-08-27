using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text.Json;

namespace Auralith.Update;

public sealed class UpdateClient
{
    public const string Channel = "alpha";
    public const string PublicOwner = "dragonking587-ai";
    public const string PublicRepo = "Auralith-Releases";
    public const string ManifestUrl =
        "https://raw.githubusercontent.com/dragonking587-ai/Auralith-Releases/main/latest.json";

    public static readonly string UpdatesDir = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Auralith", "Updates");
    public static readonly string LogsDir = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Auralith", "Logs");

    private static readonly string[] AllowedHosts =
    {
        "raw.githubusercontent.com",
        "github.com",
        "objects.githubusercontent.com",
        "release-assets.githubusercontent.com"
    };

    private readonly HttpClient _http;

    public UpdateClient(HttpClient? http = null)
    {
        _http = http ?? new HttpClient { Timeout = TimeSpan.FromMinutes(10) };
        if (!_http.DefaultRequestHeaders.UserAgent.Any())
            _http.DefaultRequestHeaders.UserAgent.Add(new ProductInfoHeaderValue("Auralith", "2.0"));
    }

    public static void Log(string line)
    {
        try
        {
            Directory.CreateDirectory(LogsDir);
            File.AppendAllText(Path.Combine(LogsDir, "updater.log"),
                $"{DateTime.Now:yyyy-MM-dd HH:mm:ss.fff} {line}{Environment.NewLine}");
        }
        catch { }
    }

    public async Task<UpdateManifest?> FindLatestPreviewAsync(string currentVersion, CancellationToken ct)
    {
        Log($"[Updater] Current version: {currentVersion}");
        Log($"[Updater] Update channel: {Channel}");
        Log($"[Updater] Repository owner: {PublicOwner}");
        Log($"[Updater] Repository: {PublicRepo}");
        Log($"[Updater] API endpoint: {ManifestUrl}");

        HttpResponseMessage resp;
        try
        {
            resp = await _http.GetAsync(ManifestUrl, ct);
        }
        catch (TaskCanceledException)
        {
            throw new InvalidOperationException("Unable to reach update service (timeout).");
        }
        catch (HttpRequestException)
        {
            throw new InvalidOperationException("Unable to reach update service.");
        }

        Log($"[Updater] HTTP status: {(int)resp.StatusCode} {resp.StatusCode}");
        if (resp.StatusCode == System.Net.HttpStatusCode.NotFound)
            throw new InvalidOperationException("No update information available.");
        if ((int)resp.StatusCode == 429)
            throw new InvalidOperationException("Update service temporarily unavailable (rate limited).");
        if (!resp.IsSuccessStatusCode)
            throw new InvalidOperationException($"Update service temporarily unavailable (HTTP {(int)resp.StatusCode}).");

        var json = await resp.Content.ReadAsStringAsync(ct);
        UpdateManifest man;
        try
        {
            man = JsonSerializer.Deserialize<UpdateManifest>(json) ?? throw new InvalidOperationException("empty");
        }
        catch
        {
            throw new InvalidOperationException("No update information available (malformed manifest).");
        }

        if (string.IsNullOrWhiteSpace(man.AssetUrl) && !string.IsNullOrWhiteSpace(man.InstallerUrl))
            man.AssetUrl = man.InstallerUrl;
        if (string.IsNullOrWhiteSpace(man.AssetName) && !string.IsNullOrWhiteSpace(man.AssetUrl))
            man.AssetName = Path.GetFileName(new Uri(man.AssetUrl).AbsolutePath);
        if (string.IsNullOrWhiteSpace(man.Version) || string.IsNullOrWhiteSpace(man.AssetUrl))
            throw new InvalidOperationException("No update information available.");
        if (!IsAllowedUrl(man.AssetUrl) || !man.AssetUrl.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Update service returned an untrusted installer URL.");
        if (!man.AssetName.EndsWith("-x64-Setup.exe", StringComparison.OrdinalIgnoreCase)
            && !man.AssetUrl.EndsWith("-x64-Setup.exe", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Update service did not provide a Setup.exe installer.");

        var current = SemVer.Parse(currentVersion);
        var remote = SemVer.Parse(man.Version);
        Log($"[Updater] Manifest version: {man.Version} newer={remote.IsNewerThan(current)}");
        if (!remote.IsNewerThan(current)) return null;
        if (string.IsNullOrWhiteSpace(man.Channel)) man.Channel = Channel;
        return man;
    }

    public static bool IsAllowedUrl(string url)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri)) return false;
        if (!uri.Scheme.Equals("https", StringComparison.OrdinalIgnoreCase)) return false;
        if (!AllowedHosts.Contains(uri.Host, StringComparer.OrdinalIgnoreCase)) return false;
        if (uri.Host.Equals("github.com", StringComparison.OrdinalIgnoreCase)
            && !uri.AbsolutePath.StartsWith("/dragonking587-ai/Auralith-Releases/", StringComparison.OrdinalIgnoreCase))
            return false;
        if (uri.Host.Equals("raw.githubusercontent.com", StringComparison.OrdinalIgnoreCase)
            && !uri.AbsolutePath.StartsWith("/dragonking587-ai/Auralith-Releases/", StringComparison.OrdinalIgnoreCase))
            return false;
        return true;
    }

    public async Task DownloadAsync(string url, string dest, IProgress<(long done, long total)> progress, CancellationToken ct)
    {
        if (!IsAllowedUrl(url)) throw new InvalidOperationException("Blocked untrusted download URL.");
        Directory.CreateDirectory(Path.GetDirectoryName(dest)!);
        using var resp = await _http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, ct);
        resp.EnsureSuccessStatusCode();
        var total = resp.Content.Headers.ContentLength ?? -1;
        await using var input = await resp.Content.ReadAsStreamAsync(ct);
        await using var output = File.Create(dest);
        var buf = new byte[64 * 1024];
        long done = 0;
        while (true)
        {
            var n = await input.ReadAsync(buf, ct);
            if (n == 0) break;
            await output.WriteAsync(buf.AsMemory(0, n), ct);
            done += n;
            progress.Report((done, total));
        }
        if (done <= 0) throw new InvalidOperationException("Downloaded file was empty.");
        Log($"[Updater] downloaded {done} bytes from {new Uri(url).Host}");
    }

    public static string Sha256File(string path)
    {
        using var fs = File.OpenRead(path);
        return Convert.ToHexString(SHA256.HashData(fs));
    }

    public static void VerifySha256(string path, string expected)
    {
        if (string.IsNullOrWhiteSpace(expected))
            throw new InvalidOperationException("Release metadata did not include a SHA-256 checksum.");
        var actual = Sha256File(path);
        if (!actual.Equals(expected.Trim(), StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Update verification failed.");
        Log("[Updater] SHA-256 verified");
    }
}
