namespace Auralith.Core;

public sealed class FrameStats
{
    public int Width { get; init; }
    public int Height { get; init; }
    public int TargetFps { get; init; }
    public double ActualFps { get; init; }
    public ulong Frame { get; init; }
    public string Adapter { get; init; } = "";
    public string Stage { get; init; } = "Idle";
    public string? Error { get; init; }
}
