namespace Auralith.Audio;

public readonly struct AudioSampleBlock
{
    public AudioSampleBlock(float[] samples, int sampleRate, long timestampTicks)
    {
        Samples = samples;
        SampleRate = sampleRate;
        TimestampTicks = timestampTicks;
    }
    public float[] Samples { get; }
    public int SampleRate { get; }
    public long TimestampTicks { get; }
}
