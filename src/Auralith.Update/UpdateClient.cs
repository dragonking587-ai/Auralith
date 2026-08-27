using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text.Json;

namespace Auralith.Update;

public sealed class UpdateClient
{
    public const string Owner = "dragonking587-ai";
    public const string Repo = "Auralith";
    public const string ApiReleases = "https://api.github.com/repos/dragonking587-ai/Auralith/releases";
    public static readonly string UpdatesDir = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Auralith", "Updates");
    public static readonly string LogsDir = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Auralith", "Logs");

    private readonly HttpClient _http;

    public UpdateClient(HttpClient? http = null)
    {
        _http = http ?? new HttpClient { Timeout = TimeSpan.FromMinutes(10) };
        if (!_http.DefaultRequestHeaders.UserAgent.Any())
            _http.DefaultRequestHeaders.UserAgent.Add(new ProductInfoHeaderValue("Auralith", "2.0"));
        _http.DefaultRequestHeaders.Accept.ParseAdd("application/vnd.github+json");
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
        Log($"check current={currentVersion} source=api.github.com/{Owner}/{Repo}/releases");
        using var resp = await _http.GetAsync(ApiReleases + "?per_page=20", ct);
        if (!resp.IsSuccessStatusCode)
        {
            Log($"api status {(int)resp.StatusCode}");
            throw new InvalidOperationException($"GitHub Releases API returned {(int)resp.StatusCode}");
        }
        await using var stream = await resp.Content.ReadAsStreamAsync(ct);
        using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: ct);
        var current = SemVer.Parse(currentVersion);
        UpdateManifest? best = null;
        SemVer bestVer = default;
        foreach (var rel in doc.RootElement.EnumerateArray())
        {
            if (rel.TryGetProperty("draft", out var d) && d.GetBoolean()) continue;
            var tag = rel.GetProperty("tag_name").GetString() ?? "";
            var verStr = NormalizeTag(tag);
            SemVer ver;
            try { ver = SemVer.Parse(verStr); } catch { continue; }
            if (!ver.IsNewerThan(current)) continue;
            if (best is not null && ver.CompareTo(bestVer) <= 0) continue;
            string? assetUrl = null, assetName = null;
            foreach (var asset in rel.GetProperty("assets").EnumerateArray())
            {
                var name = asset.GetProperty("name").GetString() ?? "";
                if (!name.EndsWith("-win-x64.zip", StringComparison.OrdinalIgnoreCase)) continue;
                if (name.Contains("Source", StringComparison.OrdinalIgnoreCase)) continue;
                assetName = name;
                assetUrl = asset.GetProperty("browser_download_url").GetString();
                break;
            }
            if (string.IsNullOrEmpty(assetUrl) || string.IsNullOrEmpty(assetName)) continue;
            var sha = "";
            foreach (var asset in rel.GetProperty("assets").EnumerateArray())
            {
                var name = asset.GetProperty("name").GetString() ?? "";
                if (name.Equals(assetName + ".sha256", StringComparison.OrdinalIgnoreCase)
                    || name.Equals("update.json", StringComparison.OrdinalIgnoreCase))
                {
                    var url = asset.GetProperty("browser_download_url").GetString();
                    if (url is null) continue;
                    try
                    {
                        var text = await _http.GetStringAsync(url, ct);
                        if (name.EndsWith(".sha256", StringComparison.OrdinalIgnoreCase))
                            sha = text.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries)[0].Trim();
                        else
                        {
                            var man = JsonSerializer.Deserialize<UpdateManifest>(text);
                            if (man is { Sha256.Length: > 0 }) sha = man.Sha256;
                        }
                    }
                    catch (Exception ex) { Log("metadata read failed " + ex.Message); }
                }
            }
            bestVer = ver;
            best = new UpdateManifest
            {
                Version = verStr,
                Channel = "preview",
                ReleaseUrl = rel.GetProperty("html_url").GetString() ?? "",
                AssetUrl = assetUrl,
                AssetName = assetName,
                Sha256 = sha,
                PublishedAt = rel.TryGetProperty("published_at", out var p) ? p.GetString() ?? "" : "",
                ReleaseNotes = rel.TryGetProperty("body", out var b) ? b.GetString() ?? "" : ""
            };
        }
        return best;
    }

    public static string NormalizeTag(string tag)
    {
        tag = tag.Trim();
        const string prefix = "Auralith-Native-";
        if (tag.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
            tag = tag[prefix.Length..];
        if (tag.StartsWith("Core-Test-", StringComparison.OrdinalIgnoreCase))
            return "0.0.0"; // old test tags are not SemVer app versions
        return tag.TrimStart('v', 'V');
    }

    public async Task DownloadAsync(string url, string dest, IProgress<(long done, long total)> progress, CancellationToken ct)
    {
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
    }

    public static string Sha256File(string path)
    {
        using var fs = File.OpenRead(path);
        var hash = SHA256.HashData(fs);
        return Convert.ToHexString(hash);
    }

    public static void VerifySha256(string path, string expected)
    {
        if (string.IsNullOrWhiteSpace(expected))
            throw new InvalidOperationException("Release metadata did not include a SHA-256 checksum.");
        var actual = Sha256File(path);
        if (!actual.Equals(expected.Trim(), StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException($"Update verification failed. expected={expected} actual={actual}");
    }
}
