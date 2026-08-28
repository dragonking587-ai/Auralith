namespace Auralith.Audio;

public interface IAudioCaptureSource : IDisposable
{
    string SourceName { get; }
    AudioCaptureState State { get; }
    int SampleRate { get; }
    int Channels { get; }
    string FormatDescription { get; }
    bool FirstPacket { get; }
    long Packets { get; }
    long Frames { get; }
    float RawPeak { get; }
    float RawRms { get; }
    string? ErrorStage { get; }
    string? ErrorMessage { get; }
    event Action<AudioSampleBlock>? SamplesAvailable;
    event Action<string>? Failed;
    void Start();
    void Stop();
}
