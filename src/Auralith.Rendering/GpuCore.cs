using System.Diagnostics;
using Auralith.Core;
using Vortice.Direct3D;
using Vortice.Direct3D11;
using Vortice.DXGI;

namespace Auralith.Rendering;

/// <summary>Phase 1: one D3D11 device and one final BGRA texture. No output integrations.</summary>
public sealed class GpuCore : IDisposable
{
    public const int Width = 1920;
    public const int Height = 1080;
    public const int TargetFps = 30;

    private ID3D11Device? _device;
    private ID3D11DeviceContext? _context;
    private ID3D11Texture2D? _final;
    private readonly byte[] _pixels = new byte[Width * Height * 4];
    private readonly object _gate = new();
    private Thread? _thread;
    private volatile bool _stop;
    private ulong _frame;
    private double _fps;
    private string _adapter = "";
    private string _stage = "Idle";
    private string? _error;

    public FrameStats Stats
    {
        get
        {
            lock (_gate)
            {
                return new FrameStats
                {
                    Width = Width,
                    Height = Height,
                    TargetFps = TargetFps,
                    ActualFps = _fps,
                    Frame = _frame,
                    Adapter = _adapter,
                    Stage = _stage,
                    Error = _error
                };
            }
        }
    }

    public void CopyPreview(byte[] dest)
    {
        lock (_gate)
            Buffer.BlockCopy(_pixels, 0, dest, 0, Math.Min(dest.Length, _pixels.Length));
    }

    public void Start()
    {
        if (_thread is { IsAlive: true }) return;
        _stop = false;
        _thread = new Thread(Loop) { Name = "Auralith.GpuCore", IsBackground = true };
        _thread.SetApartmentState(ApartmentState.STA);
        _thread.Start();
    }

    public void Stop()
    {
        _stop = true;
        _thread?.Join(TimeSpan.FromSeconds(2));
        _thread = null;
    }

    private void Loop()
    {
        try
        {
            _stage = "Creating D3D11 device";
            var hr = D3D11.D3D11CreateDevice(
                null, DriverType.Hardware, DeviceCreationFlags.BgraSupport,
                new[] { FeatureLevel.Level_11_0, FeatureLevel.Level_10_1 },
                out _device, out var fl, out _context);
            if (hr.Failure || _device is null || _context is null)
                throw new InvalidOperationException($"D3D11CreateDevice 0x{hr.Code:X8}");

            using var dxgi = _device.QueryInterface<IDXGIDevice>();
            using var adapter = dxgi.GetAdapter();
            _adapter = adapter.Description.Description;

            _stage = "Creating final GPU texture";
            _final = _device.CreateTexture2D(new Texture2DDescription
            {
                Width = Width,
                Height = Height,
                MipLevels = 1,
                ArraySize = 1,
                Format = Format.B8G8R8A8_UNorm,
                SampleDescription = new SampleDescription(1, 0),
                Usage = ResourceUsage.Default,
                BindFlags = BindFlags.ShaderResource | BindFlags.RenderTarget,
                CPUAccessFlags = CpuAccessFlags.None
            });

            _stage = "Running";
            var clock = Stopwatch.StartNew();
            var fpsClock = Stopwatch.StartNew();
            var fpsCount = 0;
            var frameTime = TimeSpan.FromSeconds(1.0 / TargetFps);

            while (!_stop)
            {
                var t0 = Stopwatch.GetTimestamp();
                Draw((float)clock.Elapsed.TotalSeconds);
                unsafe
                {
                    fixed (byte* p = _pixels)
                        _context.UpdateSubresource(_final, 0, null, (nint)p, (uint)(Width * 4), 0);
                }
                _frame++;
                fpsCount++;
                if (fpsClock.ElapsedMilliseconds >= 1000)
                {
                    _fps = fpsCount / fpsClock.Elapsed.TotalSeconds;
                    fpsCount = 0;
                    fpsClock.Restart();
                }
                var spent = Stopwatch.GetElapsedTime(t0);
                if (spent < frameTime)
                    Thread.Sleep(frameTime - spent);
            }
            _stage = "Stopped";
        }
        catch (Exception ex)
        {
            _error = ex.Message;
            _stage = "Error";
        }
        finally
        {
            _final?.Dispose();
            _context?.Dispose();
            _device?.Dispose();
            _final = null;
            _context = null;
            _device = null;
        }
    }

    private void Draw(float t)
    {
        var buf = _pixels;
        for (var i = 0; i < buf.Length; i += 4)
        {
            buf[i] = 12; buf[i + 1] = 10; buf[i + 2] = 8; buf[i + 3] = 255;
        }
        const int border = 10;
        for (var y = 0; y < Height; y++)
        for (var x = 0; x < Width; x++)
        {
            if (y >= border && y < Height - border && x >= border && x < Width - border) continue;
            var i = (y * Width + x) * 4;
            buf[i] = 32; buf[i + 1] = 180; buf[i + 2] = 214; buf[i + 3] = 255;
        }
        var cx = (int)(Width * 0.5 + Width * 0.28 * MathF.Sin(t * 1.3f));
        var cy = Height / 2;
        var r = 70;
        for (var dy = -r; dy <= r; dy++)
        for (var dx = -r; dx <= r; dx++)
        {
            if (dx * dx + dy * dy > r * r) continue;
            var x = cx + dx; var y = cy + dy;
            if ((uint)x >= Width || (uint)y >= Height) continue;
            var i = (y * Width + x) * 4;
            buf[i] = 40; buf[i + 1] = 196; buf[i + 2] = 230; buf[i + 3] = 255;
        }
        var bandY = (int)(Height * (0.78 + 0.03 * MathF.Sin(t * 3.2f)));
        for (var x = border; x < Width - border; x++)
        {
            var pulse = (byte)(80 + 80 * MathF.Sin(x / (float)Width * 14f + t * 4f));
            var i = (bandY * Width + x) * 4;
            buf[i] = pulse; buf[i + 1] = 90; buf[i + 2] = 190; buf[i + 3] = 255;
        }
    }

    public void Dispose() => Stop();
}
