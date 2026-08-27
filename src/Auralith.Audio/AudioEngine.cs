using System.Numerics;
using Auralith.Core;
using NAudio.CoreAudioApi;
using NAudio.Wave;

namespace Auralith.Audio;

/// <summary>
/// WASAPI loopback + capture. Bands: Bass 20–80 Hz, Low 80–250, Mid 250–4000, High 4000–16000.
/// </summary>
public sealed class AudioEngine : IDisposable
{
    private WasapiLoopbackCapture? _loop;
    private WasapiCapture? _mic;
    private readonly object _gate = new();
    private readonly float[] _fft = new float[2048];
    private int _fftFill;
    private AudioBands _bands = new();
    private float _prevFlux, _beatEnv, _transEnv;
    public string Status { get; private set; } = "Idle";
    public string DeviceName { get; private set; } = "Default Output";

    public AudioBands Snapshot()
    {
        lock (_gate) return new AudioBands
        {
            Bass = _bands.Bass, Low = _bands.Low, Mid = _bands.Mid, High = _bands.High,
            Full = _bands.Full, Beat = _bands.Beat, Transient = _bands.Transient
        };
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
        catch { }
        return list;
    }

    public void StartLoopback(string? deviceId = null)
    {
        Stop();
        try
        {
            MMDevice? dev = null;
            var e = new MMDeviceEnumerator();
            if (!string.IsNullOrEmpty(deviceId) && deviceId != "default")
                dev = e.GetDevice(deviceId);
            _loop = dev is null ? new WasapiLoopbackCapture() : new WasapiLoopbackCapture(dev);
            DeviceName = (_loop.CaptureState.ToString() == "") ? "Default Output" : (_loop as WasapiCapture)?.WaveFormat.ToString() ?? "Default Output";
            try { DeviceName = (dev ?? e.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia)).FriendlyName; } catch { DeviceName = "Default Output"; }
            _loop.DataAvailable += OnData;
            _loop.RecordingStopped += (_, args) => Status = args.Exception is null ? "Stopped" : args.Exception.Message;
            _loop.StartRecording();
            Status = "Desktop audio: " + DeviceName;
        }
        catch (Exception ex)
        {
            Status = "Audio failed: " + ex.Message;
        }
    }

    public void Stop()
    {
        try { _loop?.StopRecording(); } catch { }
        try { _mic?.StopRecording(); } catch { }
        _loop?.Dispose(); _mic?.Dispose();
        _loop = null; _mic = null;
    }

    private void OnData(object? sender, WaveInEventArgs e)
    {
        if (e.BytesRecorded < 8) return;
        var fmt = (_loop ?? (WaveInEventArgs?)null) is null ? WaveFormat.CreateIeeeFloatWaveFormat(48000, 2) : _loop!.WaveFormat;
        var bytes = e.Buffer;
        var count = e.BytesRecorded;
        if (fmt.Encoding == WaveFormatEncoding.IeeeFloat)
        {
            for (var i = 0; i + 3 < count; i += fmt.BlockAlign)
            {
                var sample = BitConverter.ToSingle(bytes, i);
                Push(sample);
            }
        }
        else if (fmt.BitsPerSample == 16)
        {
            for (var i = 0; i + 1 < count; i += fmt.BlockAlign)
                Push(BitConverter.ToInt16(bytes, i) / 32768f);
        }
    }

    private void Push(float s)
    {
        _fft[_fftFill++] = s;
        if (_fftFill < _fft.Length) return;
        _fftFill = 0;
        Analyze(_fft);
    }

    private void Analyze(float[] time)
    {
        var n = time.Length;
        var spec = new Complex[n];
        var windowed = new float[n];
        for (var i = 0; i < n; i++)
        {
            var w = 0.5f * (1 - MathF.Cos(2 * MathF.PI * i / (n - 1)));
            windowed[i] = time[i] * w;
            spec[i] = new Complex(windowed[i], 0);
        }
        Fft(spec);
        var mag = new float[n / 2];
        double rms = 0;
        for (var i = 0; i < mag.Length; i++)
        {
            mag[i] = (float)spec[i].Magnitude;
            rms += windowed[i] * windowed[i];
        }
        rms = Math.Sqrt(rms / n);
        float Band(int a, int b)
        {
            double s = 0; var c = 0;
            for (var i = a; i <= b && i < mag.Length; i++, c++) s += mag[i];
            return c == 0 ? 0 : (float)(s / c);
        }
        // bin Hz ~= sampleRate/n; assume 48k => bin ~ 23.4 Hz
        var bass = Norm(Band(1, 3));
        var low = Norm(Band(4, 10));
        var mid = Norm(Band(11, 170));
        var high = Norm(Band(171, 680));
        var flux = 0f;
        for (var i = 1; i < 80 && i < mag.Length; i++) flux += mag[i];
        var beat = flux > _prevFlux * 1.35f + 0.8f ? 1f : 0f;
        _prevFlux = flux * 0.85f + _prevFlux * 0.15f;
        _beatEnv = MathF.Max(beat, _beatEnv * 0.82f);
        var trans = MathF.Max(0, flux - _prevFlux);
        _transEnv = MathF.Max(trans > 2f ? 1f : 0f, _transEnv * 0.75f);
        lock (_gate)
        {
            _bands.Bass = Smooth(_bands.Bass, bass, 0.35f, 0.12f);
            _bands.Low = Smooth(_bands.Low, low, 0.35f, 0.12f);
            _bands.Mid = Smooth(_bands.Mid, mid, 0.28f, 0.1f);
            _bands.High = Smooth(_bands.High, high, 0.22f, 0.08f);
            _bands.Full = Smooth(_bands.Full, Math.Clamp((float)rms * 4f, 0, 1), 0.3f, 0.12f);
            _bands.Beat = _beatEnv;
            _bands.Transient = _transEnv;
        }
    }

    private static float Norm(float v) => Math.Clamp(v / 40f, 0, 1);
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

    public void Dispose() => Stop();
}
