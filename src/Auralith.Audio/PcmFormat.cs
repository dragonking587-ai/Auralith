namespace Auralith.Audio;

public enum PcmEncoding { IeeeFloat, Pcm }

public readonly struct PcmFormat
{
    public PcmFormat(PcmEncoding encoding, int sampleRate, int channels, int bitsPerSample)
    {
        Encoding = encoding;
        SampleRate = sampleRate;
        Channels = Math.Max(1, channels);
        BitsPerSample = bitsPerSample;
    }
    public PcmEncoding Encoding { get; }
    public int SampleRate { get; }
    public int Channels { get; }
    public int BitsPerSample { get; }
    public int BlockAlign => Math.Max(1, Channels * ((BitsPerSample + 7) / 8));
    public override string ToString() => $"{Encoding} {BitsPerSample}-bit {Channels}ch {SampleRate}Hz";
}
