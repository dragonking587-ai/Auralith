using Auralith.Audio;
using Xunit;

namespace Auralith.Audio.Tests;

public class PcmConverterTests
{
    [Fact]
    public void Pcm16StereoDownmix()
    {
        var buf = new byte[8];
        BitConverter.GetBytes((short)16384).CopyTo(buf, 0);
        BitConverter.GetBytes((short)-16384).CopyTo(buf, 2);
        BitConverter.GetBytes((short)32767).CopyTo(buf, 4);
        BitConverter.GetBytes((short)0).CopyTo(buf, 6);
        var samples = PcmConverter.ToMonoFloat32(buf, new PcmFormat(PcmEncoding.Pcm, 48000, 2, 16));
        Assert.Equal(2, samples.Length);
        Assert.InRange(samples[0], -0.01f, 0.01f);
        Assert.True(samples[1] > 0.4f);
    }

    [Fact]
    public void Float32PassthroughMono()
    {
        var buf = new byte[8];
        BitConverter.GetBytes(0.5f).CopyTo(buf, 0);
        BitConverter.GetBytes(-0.25f).CopyTo(buf, 4);
        var samples = PcmConverter.ToMonoFloat32(buf, new PcmFormat(PcmEncoding.IeeeFloat, 48000, 1, 32));
        Assert.Equal(2, samples.Length);
        Assert.Equal(0.5f, samples[0], 4);
        Assert.Equal(-0.25f, samples[1], 4);
    }

    [Fact]
    public void Pcm24SignExtend()
    {
        var buf = new byte[] { 0x00, 0x00, 0x80 };
        var samples = PcmConverter.ToMonoFloat32(buf, new PcmFormat(PcmEncoding.Pcm, 48000, 1, 24));
        Assert.Single(samples);
        Assert.True(samples[0] < 0);
    }

    [Fact]
    public void Pcm32Normalize()
    {
        var buf = new byte[4];
        BitConverter.GetBytes(int.MaxValue / 2).CopyTo(buf, 0);
        var samples = PcmConverter.ToMonoFloat32(buf, new PcmFormat(PcmEncoding.Pcm, 48000, 1, 32));
        Assert.Single(samples);
        Assert.InRange(samples[0], 0.4f, 0.6f);
    }

    [Fact]
    public void PeakRms()
    {
        var s = new float[] { 0.5f, -0.5f, 1f, -1f };
        PcmConverter.PeakRms(s, out var peak, out var rms);
        Assert.Equal(1f, peak);
        Assert.True(rms > 0.7f);
    }
}
