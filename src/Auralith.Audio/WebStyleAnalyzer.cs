using System.Numerics;

namespace Auralith.Audio;

/// <summary>
/// Port of the original Auralith web analyzer:
/// AnalyserNode getByteFrequencyData (minDecibels -90, maxDecibels -22)
/// + bandRms (20–80 / 80–250 / 250–2000 / 2000–12000)
/// + perceptual sqrt + attack/release envelopes.
/// Capture stays native WASAPI; this is analysis only.
/// </summary>
public sealed class WebStyleAnalyzer
{
    public const int FftSize = 2048;
    public const float MinDb = -90f;
    public const float MaxDb = -22f;

    private readonly Complex[] _spec = new Complex[FftSize];
    private readonly float[] _byteBins = new float[FftSize / 2];
    private float _bass, _low, _mid, _high;
    private DateTime _last = DateTime.UtcNow;

    public void Process(ReadOnlySpan<float> time, int sampleRate, float sensitivity,
        out float bass, out float low, out float mid, out float high, out float full)
    {
        var n = FftSize;
        if (time.Length < n)
        {
            bass = _bass; low = _low; mid = _mid; high = _high;
            full = 0.4f * _bass + 0.25f * _low + 0.2f * _mid + 0.15f * _high;
            return;
        }

        for (var i = 0; i < n; i++)
        {
            var x = 2 * MathF.PI * i / (n - 1);
            var blackman = 0.42f - 0.5f * MathF.Cos(x) + 0.08f * MathF.Cos(2 * x);
            _spec[i] = new Complex(time[i] * blackman, 0);
        }
        Fft(_spec);

        var scale = 1f / n;
        for (var i = 0; i < n / 2; i++)
        {
            var mag = (float)_spec[i].Magnitude * scale;
            var db = 20f * MathF.Log10(MathF.Max(mag, 1e-12f));
            var byteV = (db - MinDb) / (MaxDb - MinDb);
            _byteBins[i] = Math.Clamp(byteV, 0, 1);
        }

        var rawBass = Perceptual(Math.Clamp(BandRms(_byteBins, sampleRate, n, 20, 80) * sensitivity, 0, 1));
        var rawLow = Perceptual(Math.Clamp(BandRms(_byteBins, sampleRate, n, 80, 250) * sensitivity, 0, 1));
        var rawMid = Perceptual(Math.Clamp(BandRms(_byteBins, sampleRate, n, 250, 2000) * sensitivity, 0, 1));
        var rawHigh = Perceptual(Math.Clamp(BandRms(_byteBins, sampleRate, n, 2000, 12000) * sensitivity, 0, 1));

        var now = DateTime.UtcNow;
        var dt = (float)Math.Clamp((now - _last).TotalSeconds, 0.004, 0.05);
        _last = now;
        _bass = Step(_bass, rawBass, dt, 0.006f, 0.16f);
        _low = Step(_low, rawLow, dt, 0.01f, 0.14f);
        _mid = Step(_mid, rawMid, dt, 0.008f, 0.11f);
        _high = Step(_high, rawHigh, dt, 0.004f, 0.08f);

        bass = _bass; low = _low; mid = _mid; high = _high;
        full = Math.Clamp(0.4f * _bass + 0.25f * _low + 0.2f * _mid + 0.15f * _high, 0, 1);
    }

    private static float BandRms(float[] bins, int sampleRate, int fftSize, float loHz, float hiHz)
    {
        var lo = FreqToBin(loHz, sampleRate, fftSize);
        var hi = Math.Max(lo + 1, FreqToBin(hiHz, sampleRate, fftSize));
        double sum = 0; float peak = 0; var n = 0;
        hi = Math.Min(hi, bins.Length);
        for (var i = lo; i < hi; i++)
        {
            var v = bins[i];
            sum += v * v;
            if (v > peak) peak = v;
            n++;
        }
        if (n == 0) return 0;
        var rms = (float)Math.Sqrt(sum / n);
        return Math.Clamp(rms * 0.55f + peak * 0.45f, 0, 1);
    }

    private static int FreqToBin(float freq, int sampleRate, int fftSize)
    {
        var nyquist = sampleRate / 2f;
        var bins = fftSize / 2;
        var b = (int)Math.Round(freq / nyquist * bins);
        return Math.Clamp(b, 0, bins - 1);
    }

    private static float Perceptual(float raw) => raw <= 0 ? 0 : MathF.Sqrt(Math.Clamp(raw, 0, 1));

    private static float Step(float current, float target, float dt, float attack, float release)
    {
        var tau = target > current ? attack : release;
        var coeff = 1 - MathF.Exp(-dt / Math.Max(0.0008f, tau));
        return current + (target - current) * coeff;
    }

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
}
