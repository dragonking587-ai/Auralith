using Auralith.Core;
using NAudio.CoreAudioApi;

namespace Auralith.Audio;

public sealed class AudioEngine : IDisposable
{
    public const int FftSize = 2048;
    private readonly object _gate = new();
    private readonly AudioBands _bands = new();
    private readonly WebStyleAnalyzer _web = new();
    private readonly float[] _fft = new float[FftSize];
    private IAudioCaptureSource? _source;
    private int _fftFill, _sampleRate = 48000;
    private float _prevBass, _beatEnv, _transEnv;
    private int _fftRuns;
    private DateTime _windowStart = DateTime.UtcNow;
    private double _fftWindow;

    public string Status { get; private set; } = "Audio Capture: STOPPED";
    public string DeviceName { get; private set; } = "";
    public string CaptureModeLabel { get; private set; } = "Desktop Output";
    public string Diagnostics { get; private set; } = "";
    public IAudioCaptureSource? ActiveSource => _source;
    public ProcessLoopbackSource? ProcessSource => _source as ProcessLoopbackSource;
    public bool FirstPacket => _source?.FirstPacket ?? false;
    public long PacketCount => _source?.Packets ?? 0;
    public long FrameCount => _source?.Frames ?? 0;
    public long SilentPackets => 0;
    public double LastPacketAgeSec => -1;
    public float RawPeak { get; private set; }
    public float RawRms { get; private set; }
    public event Action<string>? Logged;

    public AudioBands Snapshot()
    {
        lock (_gate) return new AudioBands
        {
            Raw = _bands.Raw, Bass = _bands.Bass, Low = _bands.Low, Mid = _bands.Mid,
            High = _bands.High, Full = _bands.Full, Beat = _bands.Beat, Transient = _bands.Transient
        };
    }

    public IReadOnlyList<(string id, string name)> ListRenderDevices()
    {
        var list = new List<(string, string)> { ("default", "Default Output Device") };
        try
        {
            foreach (var d in new MMDeviceEnumerator().EnumerateAudioEndPoints(DataFlow.Render, DeviceState.Active))
                list.Add((d.ID, d.FriendlyName));
        }
        catch (Exception ex) { Log("enum render " + ex.Message); }
        return list;
    }

    public IReadOnlyList<(string id, string name)> ListCaptureDevices()
    {
        var list = new List<(string, string)> { ("default", "Default Input Device") };
        try
        {
            foreach (var d in new MMDeviceEnumerator().EnumerateAudioEndPoints(DataFlow.Capture, DeviceState.Active))
                list.Add((d.ID, d.FriendlyName));
        }
        catch (Exception ex) { Log("enum capture " + ex.Message); }
        return list;
    }

    public void StartDesktop(string? deviceId, string name)
    {
        Attach(new DesktopLoopbackSource(deviceId, name), "Desktop Output");
    }

    public void StartApplication(int pid, string name, bool includeTree = true)
    {
        Attach(new ProcessLoopbackSource(pid, name, includeTree), "Application Audio");
    }

    public void StartMicrophone(string? deviceId, string name)
    {
        Attach(new MicrophoneCaptureSource(deviceId, name), "Microphone");
    }

    private void Attach(IAudioCaptureSource src, string mode)
    {
        Stop();
        Status = "Audio Capture: STARTING";
        CaptureModeLabel = mode;
        DeviceName = src.SourceName;
        try
        {
            _source = src;
            src.SamplesAvailable += OnSamples;
            src.Failed += OnFailed;
            src.Start();
            Status = "Audio Capture: WAITING FOR PACKETS  " + src.SourceName;
            Log($"[Audio] Started {mode} {src.SourceName} format={src.FormatDescription}");
        }
        catch (Exception ex)
        {
            Status = "Audio Capture: ERROR " + ex.Message;
            Log("[Audio] " + ex);
            _source = null;
        }
    }

    private void OnFailed(string msg)
    {
        Status = msg.Contains("no longer", StringComparison.OrdinalIgnoreCase) || msg.Contains("lost", StringComparison.OrdinalIgnoreCase)
            ? "Audio Capture: SOURCE LOST  " + DeviceName
            : "Audio Capture: ERROR " + msg;
        Log("[Audio] " + msg);
    }

    private void OnSamples(AudioSampleBlock block)
    {
        if (block.Samples.Length == 0) return;
        _sampleRate = block.SampleRate > 0 ? block.SampleRate : _sampleRate;
        PcmConverter.PeakRms(block.Samples, out var peak, out var rms);
        RawPeak = peak;
        RawRms = rms;
        lock (_gate) _bands.Raw = Math.Clamp(rms * 4f, 0, 1);
        foreach (var s in block.Samples) Push(s);
        if (_source is { } src)
        {
            Status = src.State switch
            {
                AudioCaptureState.Capturing => "Audio Capture: CAPTURING  " + src.SourceName,
                AudioCaptureState.NoSignal => "Audio Capture: NO SIGNAL  " + src.SourceName,
                AudioCaptureState.WaitingForPackets => "Audio Capture: WAITING FOR PACKETS  " + src.SourceName,
                AudioCaptureState.Error => "Audio Capture: ERROR  " + src.SourceName,
                AudioCaptureState.SourceLost => "Audio Capture: SOURCE LOST  " + src.SourceName,
                _ => Status
            };
            UpdateDiag(src);
        }
    }

    private void Push(float s)
    {
        _fft[_fftFill++] = s;
        if (_fftFill < FftSize) return;
        _fftFill = 0;
        _web.Process(_fft, _sampleRate, 1f, out var bass, out var low, out var mid, out var high, out var full);
        var flux = bass + low;
        var beat = flux > _prevBass * 1.25f + 0.12f ? 1f : 0f;
        var trans = Math.Max(0, flux - _prevBass);
        _prevBass = flux;
        _beatEnv = MathF.Max(beat, _beatEnv * 0.82f);
        _transEnv = MathF.Max(trans > 0.18f ? 1f : 0f, _transEnv * 0.75f);
        lock (_gate)
        {
            _bands.Bass = bass; _bands.Low = low; _bands.Mid = mid; _bands.High = high;
            _bands.Full = full; _bands.Beat = _beatEnv; _bands.Transient = _transEnv;
        }
        _fftRuns++;
    }

    private void UpdateDiag(IAudioCaptureSource src)
    {
        var now = DateTime.UtcNow;
        if ((now - _windowStart).TotalSeconds < 1) return;
        var sec = Math.Max(0.001, (now - _windowStart).TotalSeconds);
        Diagnostics =
            $"Mode: {CaptureModeLabel}\nSource: {src.SourceName}\nState: {src.State}\n" +
            $"Format: {src.FormatDescription}\n" +
            $"First Packet: {(src.FirstPacket ? "YES" : "NO")}\n" +
            $"Packets: {src.Packets}  Frames: {src.Frames}\n" +
            $"RAW Peak: {RawPeak:0.000}  RMS: {RawRms:0.000}\n" +
            $"FFT {FftSize}  FFT/s: {_fftRuns / sec:0.0}\n" +
            $"Bands Hz: B20-80 L80-250 M250-2k H2k-12k";
        if (src is ProcessLoopbackSource p)
            Diagnostics += $"\nPID stage: {p.LastStage} HRESULT {p.LastHresult}";
        _fftRuns = 0;
        _windowStart = now;
    }

    public void Stop()
    {
        if (_source is { } src)
        {
            src.SamplesAvailable -= OnSamples;
            src.Failed -= OnFailed;
            try { src.Stop(); } catch { }
            src.Dispose();
        }
        _source = null;
        lock (_gate)
        {
            _bands.Raw = _bands.Bass = _bands.Low = _bands.Mid = _bands.High = _bands.Full = _bands.Beat = _bands.Transient = 0;
        }
        RawPeak = RawRms = 0;
        if (!Status.StartsWith("Audio Capture: ERROR") && !Status.Contains("SOURCE LOST"))
            Status = "Audio Capture: STOPPED";
    }

    private void Log(string s)
    {
        Logged?.Invoke(s);
        try
        {
            var dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Auralith", "Logs");
            Directory.CreateDirectory(dir);
            File.AppendAllText(Path.Combine(dir, "audio.log"), DateTime.Now.ToString("o") + " " + s + Environment.NewLine);
        }
        catch { }
    }
    public void Dispose() => Stop();
}
