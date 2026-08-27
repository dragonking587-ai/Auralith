namespace Auralith.Core;

public enum GpuTestPhase
{
    Closed,
    Starting,
    Running,
    Error
}

public sealed class GpuTestStatus
{
    public GpuTestPhase Phase { get; init; } = GpuTestPhase.Closed;
    public int Width { get; init; }
    public int Height { get; init; }
    public int TargetFps { get; init; }
    public double ActualFps { get; init; }
    public ulong Frame { get; init; }
    public string? Adapter { get; init; }
    public string? Error { get; init; }
    public string? Stage { get; init; }
}
