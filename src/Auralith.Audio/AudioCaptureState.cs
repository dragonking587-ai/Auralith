namespace Auralith.Audio;

public enum AudioCaptureState
{
    Stopped,
    Starting,
    WaitingForPackets,
    NoSignal,
    Capturing,
    SourceLost,
    Error
}
