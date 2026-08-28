using System.Text.Json;
using Auralith.Audio;
using Auralith.Core;
using Microsoft.UI.Xaml.Controls;
using Microsoft.Web.WebView2.Core;

namespace Auralith.App;

public sealed class WebAudioHost
{
    public const string Origin = "https://audio.auralith.local/";
    private WebView2? _web;
    private readonly AudioEngine _audio;
    public string Status { get; private set; } = "STOPPED";
    public string Detail { get; private set; } = "WebView not started";
    public event Action? Changed;

    public WebAudioHost(AudioEngine audio) => _audio = audio;

    public async Task AttachAsync(WebView2 web)
    {
        _web = web;
        try
        {
            await web.EnsureCoreWebView2Async();
            var folder = Path.Combine(AppContext.BaseDirectory, "Assets", "WebAudio");
            web.CoreWebView2.SetVirtualHostNameToFolderMapping(
                "audio.auralith.local", folder, CoreWebView2HostResourceAccessKind.Allow);
            web.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
            web.CoreWebView2.Settings.AreDevToolsEnabled = false;
            web.CoreWebView2.PermissionRequested += (_, e) =>
            {
                e.Handled = true;
                e.State = CoreWebView2PermissionState.Allow;
            };
            try
            {
                web.CoreWebView2.ScreenCaptureStarting += (_, e) => { e.Cancel = false; };
            }
            catch { }
            web.CoreWebView2.WebMessageReceived += OnMessage;
            web.CoreWebView2.Navigate(Origin + "index.html");
            Status = "READY";
            Detail = "Origin " + Origin;
            Log("WebView mapped " + folder);
        }
        catch (Exception ex)
        {
            Status = "ERROR";
            Detail = "WebView initialization failed. WebView2 Runtime may be missing. " + ex.Message;
            Log(ex.ToString());
        }
        Changed?.Invoke();
    }

    public async Task ChooseSourceAsync()
    {
        if (_web?.CoreWebView2 is null)
        {
            Status = "ERROR";
            Detail = "getDisplayMedia is unavailable. WebView2 not ready.";
            Changed?.Invoke();
            return;
        }
        _audio.Stop();
        Status = "REQUESTING SOURCE";
        Changed?.Invoke();
        await _web.CoreWebView2.ExecuteScriptAsync("startCapture()");
    }

    public async Task StopAsync()
    {
        if (_web?.CoreWebView2 is not null)
            await _web.CoreWebView2.ExecuteScriptAsync("stopCapture()");
        _audio.ClearExternal();
        Status = "STOPPED";
        Changed?.Invoke();
    }

    private void OnMessage(CoreWebView2 sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        string json = e.WebMessageAsJson;
        try { json = e.TryGetWebMessageAsString() ?? json; } catch { }
        if (json.StartsWith("\"") && json.EndsWith("\""))
        {
            try { json = JsonSerializer.Deserialize<string>(json) ?? json; } catch { }
        }
        JsonDocument parsed;
        try { parsed = JsonDocument.Parse(json); }
        catch { Log("bad message " + json); return; }
        using (parsed)
        {
            var root = parsed.RootElement;
            var type = root.TryGetProperty("type", out var t) ? t.GetString() : "";
            if (type == "error")
            {
                Status = "ERROR";
                Detail = root.GetProperty("message").GetString() ?? "Audio failed.";
                _audio.ClearExternal();
            }
            else if (type == "status")
            {
                Status = root.GetProperty("stage").GetString() ?? Status;
                if (Status == "SOURCE ENDED" || Status == "STOPPED") _audio.ClearExternal();
            }
            else if (type == "started")
            {
                Status = "STARTING";
                Detail = $"AudioContext RUNNING  {root.GetProperty("sampleRate")} Hz  track={root.GetProperty("audioLabel")} {root.GetProperty("audioState")}";
                Log("started " + Detail);
            }
            else if (type == "audioSnapshot")
            {
                var snap = new AudioBands
                {
                    Raw = Get(root, "raw"),
                    Bass = Get(root, "bass"),
                    Low = Get(root, "low"),
                    Mid = Get(root, "mid"),
                    High = Get(root, "high"),
                    Full = Get(root, "fullMix"),
                    Beat = Get(root, "beat"),
                    Transient = Get(root, "transient")
                };
                _audio.ApplyExternal(snap);
                Status = snap.Raw < 1e-4f && snap.Bass < 1e-4f ? "NO SIGNAL" : "CAPTURING";
            }
        }
        Changed?.Invoke();
    }

    private static float Get(JsonElement root, string name)
        => root.TryGetProperty(name, out var v) && v.TryGetDouble(out var d) ? (float)d : 0;

    private static void Log(string s)
    {
        try
        {
            var dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Auralith", "Logs");
            Directory.CreateDirectory(dir);
            File.AppendAllText(Path.Combine(dir, "web-audio.log"), DateTime.Now.ToString("o") + " " + s + Environment.NewLine);
        }
        catch { }
    }
}
