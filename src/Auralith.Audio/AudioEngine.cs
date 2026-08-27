using System.Numerics;
using Auralith.Core;
using NAudio.CoreAudioApi;
using NAudio.Wave;

namespace Auralith.Audio;

/// <summary>
/// WASAPI render-endpoint loopback. Bands use the real mix sample rate:
/// Bass 20–120, Low 120–400, Mid 400–4000, High 4000–16000 Hz.
/// </summary>
public sealed class AudioEngine : IDisposable
{
    public const int FftSize = 2048;

    private WasapiLoopbackCapture? _loop;
    private ProcessLoopbackSource? _procSrc;
    private NAudio.CoreAudioApi.WasapiCapture? _mic;
    private readonly object _gate = new();
    private readonly float[] _fft = new float[FftSize];
    private readonly WebStyleAnalyzer _web = new();
    private int _fftFill;
    private AudioBands _bands = new();
    private float _prevBass, _beatEnv, _transEnv, _peakHold;
    private long _packets, _silentPackets, _frames, _fftRuns;
    private DateTime _lastPacket = DateTime.MinValue;
    private int _sampleRate = 48000;
    private int _channels = 2;
    private string _format = "";
    private float _rawPeak, _rawRms;
    private string _mode = "Desktop Output";
    private bool _firstPacketLogged;
    private int _packetLogCount;
    private double _pktWindow, _frameWindow, _fftWindow;
    private DateTime _windowStart = DateTime.UtcNow;

    public string Status { get; private set; } = "Audio Capture: STOPPED";
    public string DeviceName { get; private set; } = "Default Output";
    public string DeviceId { get; private set; } = "";
    public string Diagnostics { get; private set; } = "";
    public ProcessLoopbackSource? ProcessSource => _procSrc;
    public string CaptureModeLabel => _mode;
    public bool FirstPacket => _packets > 0;
    public long PacketCount => _packets;
    public long FrameCount => _frames;
    public long SilentPackets => _silentPackets;
    public double LastPacketAgeSec => _lastPacket == DateTime.MinValue ? -1 : (DateTime.UtcNow - _lastPacket).TotalSeconds;
    public float RawPeak => _rawPeak;
    public float RawRms => _rawRms;



    public event Action<string>? Logged;

    public AudioBands Snapshot()
    {
        lock (_gate)
        {
            return new AudioBands
            {
                Raw = _bands.Raw,
                Bass = _bands.Bass,
                Low = _bands.Low,
                Mid = _bands.Mid,
                High = _bands.High,
                Full = _bands.Full,
                Beat = _bands.Beat,
                Transient = _bands.Transient
            };
        }
    }

    public IReadOnlyList<(string id, string name)> ListRenderDevices()
    {
        var list = new List<(string, string)> { ("default", "Default Output Device") };
        try
        {
            var e = new MMDeviceEnumerator();
            foreach (var d in e.EnumerateAudioEndPoints(DataFlow.Render, DeviceState.Active))
                list.Add((d.ID, d.FriendlyName));
        }
        catch (Exception ex) { Log("enum " + ex.Message); }
        return list;
    }

    public void StartLoopback(string? deviceId = null)
    {
        Stop();
        Status = "Audio Capture: STARTING";
        try
        {
            var e = new MMDeviceEnumerator();
            MMDevice dev;
            if (!string.IsNullOrEmpty(deviceId) && deviceId != "default")
                dev = e.GetDevice(deviceId);
            else
                dev = e.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia);

            DeviceId = dev.ID;
            DeviceName = dev.FriendlyName;
            Log($"[Audio] Selected endpoint name: {DeviceName}");
            Log($"[Audio] Endpoint ID: {DeviceId}");
            Log($"[Audio] Device state: {dev.State}");
            Log("[Audio] Data flow: Render");
            Log("[Audio] Role: Multimedia");
            try
            {
                var def = e.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia);
                Log($"[Audio] Default endpoint: {def.FriendlyName}");
            }
            catch { }

            Log("[Audio] Initializing endpoint");
            _loop = new WasapiLoopbackCapture(dev);
            var fmt = _loop.WaveFormat;
            _sampleRate = fmt.SampleRate;
            _channels = Math.Max(1, fmt.Channels);
            _format = $"{fmt.Encoding} {fmt.BitsPerSample}-bit {fmt.Channels}ch {fmt.SampleRate}Hz block={fmt.BlockAlign}";
            Log("[Audio] Audio client created");
            Log("[Audio] Loopback mode enabled");
            Log($"[Audio] Mix format: {_format}");
            Log($"[Audio] Sample rate: {_sampleRate}");
            Log($"[Audio] Channels: {_channels}");
            Log($"[Audio] Bits/sample: {fmt.BitsPerSample}");
            Log($"[Audio] Format/subformat: {fmt.Encoding}");
            if (fmt is WaveFormatExtensible ext)
                Log($"[Audio] SubFormat: {ext.SubFormat}");

            _loop.DataAvailable += OnData;
            _loop.RecordingStopped += (_, args) =>
            {
                if (args.Exception is not null)
                {
                    Status = "Audio Capture: ERROR " + args.Exception.Message;
                    Log("[Audio] RecordingStopped " + args.Exception);
                }
                else Status = "Audio Capture: STOPPED";
            };
            Log("[Audio] Capture client created");
            _loop.StartRecording();
            Log("[Audio] Audio client started");
            Status = "Audio Capture: WAITING FOR PACKETS  " + DeviceName;
            _mode = "Desktop Output";
            _firstPacketLogged = false;
            _packetLogCount = 0;
            _windowStart = DateTime.UtcNow;
            _packets = _frames = _fftRuns = _silentPackets = 0;
        }
        catch (Exception ex)
        {
            Status = "Audio Capture: ERROR " + ex.Message;
            Log("[Audio] " + ex);
        }
    }

    public void StartApplication(int pid, string? endpointId, bool includeTree = true)
    {
        Stop();
        Status = "Audio Capture: STARTING";
        try
        {
            Log($"[AppAudio] Mode: Application Audio PID: {pid} Win: {ProcessLoopbackSource.WindowsVersion()}");
            Log($"[AppAudio] Endpoint: {endpointId}");
            if (!ProcessLoopbackSource.IsSupported())
                throw new InvalidOperationException("Application Audio requires Windows 10 2004+ process loopback. Desktop Output Device remains available.");
            var cap = new ProcessLoopbackSource(pid, "PID " + pid, includeTree);
            cap.DataAvailable += OnDataFromWave;
            cap.Failed += (_, msg) =>
            {
                Status = msg.Contains("no longer") || msg.Contains("lost", StringComparison.OrdinalIgnoreCase)
                    ? "SOURCE LOST"
                    : "Audio Capture: ERROR " + msg;
                Log("[AppAudio] " + msg);
            };
            cap.Start();
            _procSrc = cap;
            if (cap.Format is { } fmt)
            {
                _sampleRate = fmt.SampleRate;
                _channels = Math.Max(1, fmt.Channels);
                _format = $"{fmt.Encoding} {fmt.BitsPerSample}-bit {fmt.Channels}ch {fmt.SampleRate}Hz";
            }
            Status = $"Audio Capture: WAITING FOR PACKETS  Application PID {pid}";
            _mode = "Application Audio";
            Log("[AppAudio] Capture started process-loopback pid=" + pid + " tree=" + includeTree);
            DeviceName = "App PID " + pid;
        }
        catch (Exception ex)
        {
            Status = "Audio Capture: ERROR " + ex.Message;
            Log("[AppAudio] " + ex);
        }
    }

    public void StartMicrophone()
    {
        Stop();
        Status = "Audio Capture: STARTING";
        try
        {
            _mic = new NAudio.CoreAudioApi.WasapiCapture();
            _mic.DataAvailable += OnDataFromWave;
            _mic.RecordingStopped += (_, args) => Status = args.Exception is null ? "Audio Capture: STOPPED" : "Audio Capture: ERROR " + args.Exception.Message;
            var fmt = _mic.WaveFormat;
            _sampleRate = fmt.SampleRate;
            _channels = Math.Max(1, fmt.Channels);
            _format = $"{fmt.Encoding} {fmt.BitsPerSample}-bit {fmt.Channels}ch {fmt.SampleRate}Hz";
            _mic.StartRecording();
            DeviceName = "Microphone";
            Status = "Audio Capture: CAPTURING  Microphone";
        }
        catch (Exception ex)
        {
            Status = "Audio Capture: ERROR " + ex.Message;
            Log("[Audio] mic " + ex);
        }
    }

    private void OnDataFromWave(object? sender, WaveInEventArgs e)
    {
        if (e.BytesRecorded <= 0) return;
        WaveFormat? fmt = _loop?.WaveFormat ?? _procSrc?.Format ?? _mic?.WaveFormat;
        if (fmt is null) return;
        OnPacket(e.Buffer, e.BytesRecorded, fmt);
    }

    public void Stop()
    {
        try { _loop?.StopRecording(); } catch { }
        try { _procSrc?.Stop(); } catch { }
        try { _mic?.StopRecording(); } catch { }
        _loop?.Dispose(); _procSrc?.Dispose(); _mic?.Dispose();
        _loop = null; _procSrc = null; _mic = null;
        if (!Status.StartsWith("Audio Capture: ERROR"))
            Status = "Audio Capture: STOPPED";
    }

    private void OnData(object? sender, WaveInEventArgs e) => OnDataFromWave(sender, e);

    private void OnPacket(byte[] buffer, int bytes, WaveFormat fmt)
    {
        _packets++;
        _lastPacket = DateTime.UtcNow;
        if (!_firstPacketLogged)
        {
            _firstPacketLogged = true;
            Log($"[Audio] First packet YES bytes={bytes} encoding={fmt.Encoding} rate={fmt.SampleRate} ch={fmt.Channels} bits={fmt.BitsPerSample}");
        }

        float peak = 0;
        double sumSq = 0;
        var samples = ConvertToMono(buffer, bytes, fmt);
        if (samples.Count == 0)
        {
            _silentPackets++;
            if (_packetLogCount < 10)
            {
                _packetLogCount++;
                Log($"[Audio] Packet {_packetLogCount} Frames:0 Bytes:{bytes} SilentFlag:true Peak:0 RMS:0");
            }
            UpdateWindow(0);
            if (_packets > 10) Status = "Audio Capture: NO SIGNAL  " + DeviceName;
            else Status = "Audio Capture: WAITING FOR PACKETS  " + DeviceName;
            return;
        }
        _frames += samples.Count;
        foreach (var s in samples)
        {
            var a = MathF.Abs(s);
            if (a > peak) peak = a;
            sumSq += s * s;
            Push(s);
        }
        var rms = (float)Math.Sqrt(sumSq / samples.Count);
        lock (_gate)
        {
            _rawPeak = peak;
            _rawRms = rms;
            _bands.Raw = Math.Clamp(rms * 4f, 0, 1);
        }
        if (_packetLogCount < 10)
        {
            _packetLogCount++;
            Log($"[Audio] Packet {_packetLogCount} Frames:{samples.Count} Bytes:{bytes} SilentFlag:false Peak:{peak:0.000} RMS:{rms:0.000}");
        }
        UpdateWindow(samples.Count);
        if (peak < 1e-5f && rms < 1e-5f)
        {
            if (_packets > 10)
                Status = "Audio Capture: NO SIGNAL  " + DeviceName;
            else
                Status = "Audio Capture: WAITING FOR PACKETS  " + DeviceName;
        }
        else
            Status = "Audio Capture: CAPTURING  " + DeviceName;
    }

    private List<float> ConvertToMono(byte[] buffer, int bytes, WaveFormat fmt)
    {
        var list = new List<float>(bytes / 2);
        var ch = Math.Max(1, fmt.Channels);
        try
        {
            var encoding = fmt.Encoding;
            if (fmt is WaveFormatExtensible ext)
            {
                var sub = ext.SubFormat.ToString();
                if (encoding == WaveFormatEncoding.IeeeFloat
                    || sub.Contains("00000003-0000-0010-8000-00aa00389b71", StringComparison.OrdinalIgnoreCase)
                    || sub.Contains("00000003", StringComparison.OrdinalIgnoreCase))
                    encoding = WaveFormatEncoding.IeeeFloat;
                else if (sub.Contains("00000001-0000-0010-8000-00aa00389b71", StringComparison.OrdinalIgnoreCase))
                    encoding = WaveFormatEncoding.Pcm;
                Log($"[Audio] Extensible SubFormat={sub} treated as {encoding}");
            }

            if (encoding == WaveFormatEncoding.IeeeFloat || fmt.BitsPerSample == 32 && encoding != WaveFormatEncoding.Pcm)
            {
                var floats = bytes / 4;
                for (var i = 0; i + ch <= floats; i += ch)
                {
                    float acc = 0;
                    for (var c = 0; c < ch; c++)
                        acc += BitConverter.ToSingle(buffer, (i + c) * 4);
                    list.Add(acc / ch);
                }
                return list;
            }

            if (fmt.BitsPerSample == 16)
            {
                var count = bytes / 2;
                for (var i = 0; i + ch <= count; i += ch)
                {
                    float acc = 0;
                    for (var c = 0; c < ch; c++)
                        acc += BitConverter.ToInt16(buffer, (i + c) * 2) / 32768f;
                    list.Add(acc / ch);
                }
                return list;
            }

            if (fmt.BitsPerSample == 24)
            {
                var block = fmt.BlockAlign;
                for (var off = 0; off + block <= bytes; off += block)
                {
                    float acc = 0;
                    for (var c = 0; c < ch; c++)
                    {
                        var p = off + c * 3;
                        var v = buffer[p] | (buffer[p + 1] << 8) | (buffer[p + 2] << 16);
                        if ((v & 0x800000) != 0) v |= unchecked((int)0xFF000000);
                        acc += v / 8388608f;
                    }
                    list.Add(acc / ch);
                }
                return list;
            }

            if (fmt.BitsPerSample == 32)
            {
                var count = bytes / 4;
                for (var i = 0; i + ch <= count; i += ch)
                {
                    float acc = 0;
                    for (var c = 0; c < ch; c++)
                        acc += BitConverter.ToInt32(buffer, (i + c) * 4) / 2147483648f;
                    list.Add(acc / ch);
                }
                return list;
            }

            // Last-resort: NAudio sample provider over a copy of this packet.
            using var ms = new MemoryStream(buffer, 0, bytes, writable: false);
            using var raw = new RawSourceWaveStream(ms, fmt);
            var sp = raw.ToSampleProvider();
            var tmp = new float[Math.Max(ch * 256, bytes)];
            int n;
            while ((n = sp.Read(tmp, 0, tmp.Length)) > 0)
            {
                for (var i = 0; i + ch <= n; i += ch)
                {
                    float acc = 0;
                    for (var c = 0; c < ch; c++) acc += tmp[i + c];
                    list.Add(acc / ch);
                }
            }
        }
        catch (Exception ex) { Log("[Audio] convert " + ex.Message); }
        return list;
    }

    private void Push(float s)
    {
        _fft[_fftFill++] = s;
        if (_fftFill < FftSize) return;
        _fftFill = 0;
        Analyze(_fft, _sampleRate);
        _fftRuns++;
    }

    private void Analyze(float[] time, int sampleRate)
    {
        _web.Process(time, sampleRate, 1f, out var bass, out var low, out var mid, out var high, out var full);
        var flux = bass + low;
        var beat = flux > _prevBass * 1.25f + 0.12f ? 1f : 0f;
        var trans = Math.Max(0, flux - _prevBass);
        _prevBass = flux;
        _beatEnv = MathF.Max(beat, _beatEnv * 0.82f);
        _transEnv = MathF.Max(trans > 0.18f ? 1f : 0f, _transEnv * 0.75f);
        lock (_gate)
        {
            _bands.Bass = bass;
            _bands.Low = low;
            _bands.Mid = mid;
            _bands.High = high;
            _bands.Full = full;
            _bands.Beat = _beatEnv;
            _bands.Transient = _transEnv;
        }
    }

    private void UpdateWindow(int frames)
    {
        _pktWindow++;
        _frameWindow += frames;
        var now = DateTime.UtcNow;
        if ((now - _windowStart).TotalSeconds < 1) return;
        var sec = Math.Max(0.001, (now - _windowStart).TotalSeconds);
        Diagnostics =
            $"Device: {DeviceName}\n" +
            $"State: {Status}\n" +
            $"Format: {_format}\n" +
            $"Packets/s: {_pktWindow / sec:0.0}  Silent: {_silentPackets}\n" +
            $"Frames/s: {_frameWindow / sec:0}\n" +
            $"Raw Peak: {_rawPeak:0.000}  RMS: {_rawRms:0.000}\n" +
            $"FFT {FftSize}  FFT/s: {_fftRuns / sec:0.0}\n" +
            $"Bands Hz: B20-80 L80-250 M250-2k H2k-12k (web AnalyserNode mapping)";
        _pktWindow = _frameWindow = 0;
        _fftRuns = 0;
        _windowStart = now;
        Log($"[AudioCapture] Peak={_rawPeak:0.000} RMS={_rawRms:0.000} {_format}");
    }

    private static float Smooth(float cur, float target, float attack, float release)
        => target > cur ? cur + (target - cur) * attack : cur + (target - cur) * release;

    private static void Fft(Complex[] a)
    {
        var n = a.Length;
        for (int i = 1, j = 0; i < n; i++)
        {
            var bit = n >> 1;
            for (; j >= bit; bit >>= 1) j -= bit;
            j += bit;
            if (i < j) (a[i], a[j]) = (a[j], a[i]);
        }
        for (var len = 2; len <= n; len <<= 1)
        {
            var ang = -2 * Math.PI / len;
            var wlen = new Complex(Math.Cos(ang), Math.Sin(ang));
            for (var i = 0; i < n; i += len)
            {
                var w = Complex.One;
                for (var j = 0; j < len / 2; j++)
                {
                    var u = a[i + j];
                    var v = a[i + j + len / 2] * w;
                    a[i + j] = u + v;
                    a[i + j + len / 2] = u - v;
                    w *= wlen;
                }
            }
        }
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
