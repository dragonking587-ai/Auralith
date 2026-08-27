using System.Text.Json.Serialization;

namespace Auralith.Update;

public sealed class UpdateManifest
{
    [JsonPropertyName("version")] public string Version { get; set; } = "";
    [JsonPropertyName("channel")] public string Channel { get; set; } = "preview";
    [JsonPropertyName("releaseUrl")] public string ReleaseUrl { get; set; } = "";
    [JsonPropertyName("assetUrl")] public string AssetUrl { get; set; } = "";
    [JsonPropertyName("assetName")] public string AssetName { get; set; } = "";
    [JsonPropertyName("sha256")] public string Sha256 { get; set; } = "";
    [JsonPropertyName("publishedAt")] public string PublishedAt { get; set; } = "";
    [JsonPropertyName("releaseNotes")] public string ReleaseNotes { get; set; } = "";
}

public enum UpdateState
{
    Idle, Checking, UpdateAvailable, Downloading, Verifying, ReadyToInstall,
    Installing, Restarting, UpToDate, Error
}
