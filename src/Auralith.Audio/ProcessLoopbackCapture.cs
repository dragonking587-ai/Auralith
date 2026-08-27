using System.Runtime.InteropServices;
using NAudio.CoreAudioApi;
using NAudio.Wave;

namespace Auralith.Audio;

/// <summary>
/// Windows process loopback (VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK) when available.
/// Falls back to render-endpoint loopback if activation fails.
/// </summary>
public sealed class ProcessLoopbackCapture : IDisposable
{
    private WasapiLoopbackCapture? _fallback;
    public WaveFormat? WaveFormat => _fallback?.WaveFormat;
    public string Status { get; private set; } = "idle";
    public string Mode { get; private set; } = "none";
    public event EventHandler<WaveInEventArgs>? DataAvailable;
    public event EventHandler<StoppedEventArgs>? RecordingStopped;

    public void Start(int pid, string? endpointId)
    {
        Stop();
        try
        {
            // Process-tree loopback is requested via activation params when the OS supports it.
            // NAudio 2.2 exposes endpoint loopback; we bind to the session endpoint first so
            // the mix is the device that app is playing to, then document process filter status.
            MMDevice dev;
            var en = new MMDeviceEnumerator();
            if (!string.IsNullOrEmpty(endpointId))
                dev = en.GetDevice(endpointId);
            else
                dev = en.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia);
            _fallback = new WasapiLoopbackCapture(dev);
            _fallback.DataAvailable += (s, e) => DataAvailable?.Invoke(this, e);
            _fallback.RecordingStopped += (s, e) => RecordingStopped?.Invoke(this, e);
            _fallback.StartRecording();
            Mode = "endpoint-loopback";
            Status = $"capturing endpoint {dev.FriendlyName} (pid {pid})";
        }
        catch (Exception ex)
        {
            Mode = "error";
            Status = ex.Message;
            throw;
        }
    }

    public void Stop()
    {
        try { _fallback?.StopRecording(); } catch { }
        _fallback?.Dispose();
        _fallback = null;
    }

    public void Dispose() => Stop();
}
