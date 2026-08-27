using Auralith.Audio;
using Xunit;

namespace Auralith.Core.Tests;

public class WebStyleAnalyzerTests
{
    [Fact]
    public void Silence_stays_near_zero()
    {
        var a = new WebStyleAnalyzer();
        var buf = new float[WebStyleAnalyzer.FftSize];
        a.Process(buf, 48000, 1, out var b, out var l, out var m, out var h, out var f);
        Assert.InRange(b + l + m + h + f, 0, 0.05);
    }

    [Fact]
    public void Low_sine_raises_bass_more_than_high()
    {
        var a = new WebStyleAnalyzer();
        var buf = new float[WebStyleAnalyzer.FftSize];
        const int sr = 48000;
        for (var i = 0; i < buf.Length; i++)
            buf[i] = MathF.Sin(2 * MathF.PI * 60f * i / sr);
        float b=0,h=0;
        for (var n = 0; n < 8; n++)
            a.Process(buf, sr, 1, out b, out _, out _, out h, out _);
        Assert.True(b > h);
        Assert.True(b > 0.02);
    }
}
