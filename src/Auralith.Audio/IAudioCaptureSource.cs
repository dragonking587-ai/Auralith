using NAudio.Wave;

namespace Auralith.Audio;

public interface IAudioCaptureSource : IDisposable
{
    string Name { get; }
    WaveFormat? Format { get; }
    event EventHandler<WaveInEventArgs>? DataAvailable;
    event EventHandler<string>? Failed;
    void Start();
    void Stop();
}
