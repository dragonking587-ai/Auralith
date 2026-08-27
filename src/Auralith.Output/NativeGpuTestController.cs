using Auralith.Core;
using Auralith.Rendering;

namespace Auralith.Output;

public sealed class NativeGpuTestController : IDisposable
{
    private DiagnosticRenderer? _renderer;

    public GpuTestStatus Status => _renderer?.Status ?? new GpuTestStatus();

    public void Open(int width, int height, int fps)
    {
        _renderer?.Dispose();
        _renderer = new DiagnosticRenderer(width, height, fps);
        _renderer.Start();
    }

    public void Close()
    {
        _renderer?.Stop();
        _renderer?.Dispose();
        _renderer = null;
    }

    public void Dispose() => Close();
}
