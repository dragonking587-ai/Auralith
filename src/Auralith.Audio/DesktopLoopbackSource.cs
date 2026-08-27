using NAudio.CoreAudioApi;
using NAudio.Wave;

namespace Auralith.Audio;

public sealed class DesktopLoopbackSource : IAudioCaptureSource
{
    private readonly string? _deviceId;
    private WasapiLoopbackCapture? _cap;
    public string Name { get; }
    public WaveFormat? Format => _cap?.WaveFormat;
    public event EventHandler<WaveInEventArgs>? DataAvailable;
    public event EventHandler<string>? Failed;

    public DesktopLoopbackSource(string? deviceId, string name)
    {
        _deviceId = deviceId;
        Name = name;
    }

    public void Start()
    {
        Stop();
        try
        {
            var en = new MMDeviceEnumerator();
            MMDevice dev = string.IsNullOrEmpty(_deviceId) || _deviceId == "default"
                ? en.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia)
                : en.GetDevice(_deviceId);
            _cap = new WasapiLoopbackCapture(dev);
            _cap.DataAvailable += (_, e) => DataAvailable?.Invoke(this, e);
            _cap.RecordingStopped += (_, e) =>
            {
                if (e.Exception is not null) Failed?.Invoke(this, e.Exception.Message);
            };
            _cap.StartRecording();
        }
        catch (Exception ex)
        {
            Failed?.Invoke(this, "Unable to initialize desktop loopback. " + ex.Message);
            throw;
        }
    }

    public void Stop()
    {
        try { _cap?.StopRecording(); } catch { }
        _cap?.Dispose();
        _cap = null;
    }

    public void Dispose() => Stop();
}
