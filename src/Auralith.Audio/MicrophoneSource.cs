using NAudio.Wave;

namespace Auralith.Audio;

public sealed class MicrophoneSource : IAudioCaptureSource
{
    private NAudio.Wave.WasapiCapture? _cap;
    public string Name => "Microphone";
    public WaveFormat? Format => _cap?.WaveFormat;
    public event EventHandler<WaveInEventArgs>? DataAvailable;
    public event EventHandler<string>? Failed;

    public void Start()
    {
        Stop();
        try
        {
            _cap = new NAudio.Wave.WasapiCapture();
            _cap.DataAvailable += (_, e) => DataAvailable?.Invoke(this, e);
            _cap.RecordingStopped += (_, e) =>
            {
                if (e.Exception is not null) Failed?.Invoke(this, e.Exception.Message);
            };
            _cap.StartRecording();
        }
        catch (Exception ex)
        {
            Failed?.Invoke(this, "Microphone capture failed. " + ex.Message);
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
