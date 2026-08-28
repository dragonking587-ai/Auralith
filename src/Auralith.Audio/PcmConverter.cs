namespace Auralith.Audio;

public static class PcmConverter
{
    public static float[] ToMonoFloat32(ReadOnlySpan<byte> buffer, PcmFormat fmt)
    {
        if (buffer.Length == 0) return Array.Empty<float>();
        var ch = fmt.Channels;
        if (fmt.Encoding == PcmEncoding.IeeeFloat || (fmt.BitsPerSample == 32 && fmt.Encoding != PcmEncoding.Pcm))
        {
            var count = buffer.Length / 4;
            var n = count / ch;
            var dst = new float[n];
            for (var i = 0; i < n; i++)
            {
                float acc = 0;
                for (var c = 0; c < ch; c++)
                    acc += BitConverter.ToSingle(buffer.Slice((i * ch + c) * 4, 4));
                dst[i] = acc / ch;
            }
            return dst;
        }
        if (fmt.BitsPerSample == 16)
        {
            var count = buffer.Length / 2;
            var n = count / ch;
            var dst = new float[n];
            for (var i = 0; i < n; i++)
            {
                float acc = 0;
                for (var c = 0; c < ch; c++)
                    acc += BitConverter.ToInt16(buffer.Slice((i * ch + c) * 2, 2)) / 32768f;
                dst[i] = acc / ch;
            }
            return dst;
        }
        if (fmt.BitsPerSample == 24)
        {
            var block = fmt.BlockAlign;
            var n = buffer.Length / block;
            var dst = new float[n];
            for (var i = 0; i < n; i++)
            {
                float acc = 0;
                var off = i * block;
                for (var c = 0; c < ch; c++)
                {
                    var p = off + c * 3;
                    if (p + 2 >= buffer.Length) break;
                    var v = buffer[p] | (buffer[p + 1] << 8) | (buffer[p + 2] << 16);
                    if ((v & 0x800000) != 0) v |= unchecked((int)0xFF000000);
                    acc += v / 8388608f;
                }
                dst[i] = acc / ch;
            }
            return dst;
        }
        if (fmt.BitsPerSample == 32)
        {
            var count = buffer.Length / 4;
            var n = count / ch;
            var dst = new float[n];
            for (var i = 0; i < n; i++)
            {
                float acc = 0;
                for (var c = 0; c < ch; c++)
                    acc += BitConverter.ToInt32(buffer.Slice((i * ch + c) * 4, 4)) / 2147483648f;
                dst[i] = acc / ch;
            }
            return dst;
        }
        return Array.Empty<float>();
    }

    public static void PeakRms(ReadOnlySpan<float> samples, out float peak, out float rms)
    {
        peak = 0;
        if (samples.Length == 0) { rms = 0; return; }
        double sum = 0;
        foreach (var s in samples)
        {
            var a = MathF.Abs(s);
            if (a > peak) peak = a;
            sum += s * s;
        }
        rms = (float)Math.Sqrt(sum / samples.Length);
    }
}
