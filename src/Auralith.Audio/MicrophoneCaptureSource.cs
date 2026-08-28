using NAudio.CoreAudioApi;
using NAudio.Wave;

namespace Auralith.Audio;

public sealed class MicrophoneCaptureSource : IAudioCaptureSource
{
    private readonly string? _deviceId;
    private WasapiCapture? _cap;
    private PcmFormat _pcm;
    public string SourceName { get; }
    public AudioCaptureState State { get; private set; } = AudioCaptureState.Stopped;
    public int SampleRate => _pcm.SampleRate;
    public int Channels => _pcm.Channels;
    public string FormatDescription => _pcm.ToString();
    public bool FirstPacket { get; private set; }
    public long Packets { get; private set; }
    public long Frames { get; private set; }
    public float RawPeak { get; private set; }
    public float RawRms { get; private set; }
    public string? ErrorStage { get; private set; }
    public string? ErrorMessage { get; private set; }
    public event Action<AudioSampleBlock>? SamplesAvailable;
    public event Action<string>? Failed;

    public MicrophoneCaptureSource(string? deviceId, string name)
    {
        _deviceId = deviceId;
        SourceName = name;
    }

    public void Start()
    {
        Stop();
        State = AudioCaptureState.Starting;
        FirstPacket = false; Packets = Frames = 0;
        try
        {
            var en = new MMDeviceEnumerator();
            MMDevice dev = string.IsNullOrEmpty(_deviceId) || _deviceId == "default"
                ? en.GetDefaultAudioEndpoint(DataFlow.Capture, Role.Multimedia)
                : en.GetDevice(_deviceId);
            _cap = new WasapiCapture(dev);
            var wf = _cap.WaveFormat;
            var enc = wf.Encoding == WaveFormatEncoding.IeeeFloat ? PcmEncoding.IeeeFloat : PcmEncoding.Pcm;
            if (wf is WaveFormatExtensible ext)
            {
                var sub = ext.SubFormat.ToString();
                if (sub.Contains("00000003", StringComparison.OrdinalIgnoreCase)) enc = PcmEncoding.IeeeFloat;
                else if (sub.Contains("00000001", StringComparison.OrdinalIgnoreCase)) enc = PcmEncoding.Pcm;
            }
            _pcm = new PcmFormat(enc, wf.SampleRate, wf.Channels, wf.BitsPerSample);
            _cap.DataAvailable += OnData;
            _cap.RecordingStopped += (_, e) =>
            {
                if (e.Exception is not null)
                {
                    State = AudioCaptureState.Error;
                    ErrorMessage = e.Exception.Message;
                    Failed?.Invoke(e.Exception.Message);
                }
                else if (State != AudioCaptureState.Error) State = AudioCaptureState.Stopped;
            };
            _cap.StartRecording();
            State = AudioCaptureState.WaitingForPackets;
        }
        catch (Exception ex)
        {
            State = AudioCaptureState.Error;
            ErrorStage = "Start";
            ErrorMessage = ex.Message;
            Failed?.Invoke(ex.Message);
            throw;
        }
    }

    private void OnData(object? sender, WaveInEventArgs e)
    {
        if (e.BytesRecorded <= 0) return;
        Packets++;
        var samples = PcmConverter.ToMonoFloat32(e.Buffer.AsSpan(0, e.BytesRecorded), _pcm);
        if (samples.Length == 0) return;
        FirstPacket = true;
        Frames += samples.Length;
        PcmConverter.PeakRms(samples, out var peak, out var rms);
        RawPeak = peak; RawRms = rms;
        State = peak < 1e-5f && rms < 1e-5f ? AudioCaptureState.NoSignal : AudioCaptureState.Capturing;
        SamplesAvailable?.Invoke(new AudioSampleBlock(samples, _pcm.SampleRate, DateTime.UtcNow.Ticks));
    }

    public void Stop()
    {
        try { _cap?.StopRecording(); } catch { }
        _cap?.Dispose();
        _cap = null;
        if (State != AudioCaptureState.Error) State = AudioCaptureState.Stopped;
    }
    public void Dispose() => Stop();
}
