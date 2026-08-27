using System.Diagnostics;
using Auralith.Core;
using Auralith.Platform.Windows;
using Vortice.Direct3D;
using Vortice.Direct3D11;
using Vortice.DXGI;

namespace Auralith.Rendering;

public sealed class DiagnosticRenderer : IDisposable
{
    private readonly int _logicalW;
    private readonly int _logicalH;
    private readonly int _targetFps;
    private NativeWindow? _window;
    private ID3D11Device? _device;
    private ID3D11DeviceContext? _context;
    private IDXGISwapChain1? _swap;
    private byte[] _pixels;
    private volatile bool _stop;
    private Thread? _thread;
    private readonly Stopwatch _clock = new();
    private ulong _frame;
    private double _fps;
    private string? _adapter;
    private string? _error;
    private string? _stage = "Idle";
    private GpuTestPhase _phase = GpuTestPhase.Closed;
    private readonly object _gate = new();

    public DiagnosticRenderer(int width, int height, int fps)
    {
        _logicalW = Math.Clamp(width, 16, 3840);
        _logicalH = Math.Clamp(height, 16, 2160);
        _targetFps = fps >= 45 ? 60 : 30;
        _pixels = new byte[_logicalW * _logicalH * 4];
    }

    public GpuTestStatus Status
    {
        get
        {
            lock (_gate)
            {
                return new GpuTestStatus
                {
                    Phase = _phase,
                    Width = _logicalW,
                    Height = _logicalH,
                    TargetFps = _targetFps,
                    ActualFps = _fps,
                    Frame = _frame,
                    Adapter = _adapter,
                    Error = _error,
                    Stage = _stage
                };
            }
        }
    }

    public void Start()
    {
        lock (_gate)
        {
            if (_phase is GpuTestPhase.Starting or GpuTestPhase.Running)
                return;
            _stop = false;
            _error = null;
            _phase = GpuTestPhase.Starting;
            _stage = "Creating native thread";
        }
        NativeLog.Write("[NativeBroadcast] Open requested");
        NativeLog.Write("[NativeBroadcast] State CLOSED -> STARTING");
        NativeLog.Write("[NativeBroadcast] Creating native thread");
        _thread = new Thread(RenderLoop)
        {
            Name = "Auralith.GpuTest",
            IsBackground = true
        };
        _thread.SetApartmentState(ApartmentState.STA);
        _thread.Start();
        NativeLog.Write("[NativeBroadcast] Native thread started");

        _ = Task.Run(async () =>
        {
            await Task.Delay(TimeSpan.FromSeconds(12));
            lock (_gate)
            {
                if (_phase != GpuTestPhase.Starting)
                    return;
                _phase = GpuTestPhase.Error;
                _error = $"Startup timed out at stage '{_stage}'.";
                NativeLog.Error(_stage ?? "Unknown", _error);
            }
            _stop = true;
        });
    }

    public void Stop()
    {
        _stop = true;
        var t = _thread;
        if (t is { IsAlive: true } && t.ManagedThreadId != Environment.CurrentManagedThreadId)
            t.Join(TimeSpan.FromSeconds(2));
        _thread = null;
    }

    private void SetStage(string stage)
    {
        lock (_gate) _stage = stage;
        NativeLog.Write($"[NativeBroadcast] {stage}");
    }

    private void Fail(string stage, string reason)
    {
        lock (_gate)
        {
            _stage = stage;
            _error = reason;
            _phase = GpuTestPhase.Error;
        }
        NativeLog.Error(stage, reason);
    }

    private void RenderLoop()
    {
        try
        {
            SetStage("Registering window class / Creating HWND");
            _window = new NativeWindow();
            _window.Closed += () => _stop = true;
            _window.Create(_logicalW, _logicalH);

            SetStage("Creating D3D11 device");
            var hr = D3D11.D3D11CreateDevice(
                null,
                DriverType.Hardware,
                DeviceCreationFlags.BgraSupport,
                new[] { FeatureLevel.Level_11_0, FeatureLevel.Level_10_1, FeatureLevel.Level_10_0 },
                out _device,
                out var fl,
                out _context);
            if (hr.Failure || _device is null || _context is null)
            {
                Fail("D3D11 Device Creation", $"D3D11CreateDevice HRESULT=0x{hr.Code:X8}");
                return;
            }
            NativeLog.Write($"[NativeBroadcast] D3D11 device created FL={fl}");

            SetStage("Creating DXGI factory");
            using var dxgi = _device.QueryInterface<IDXGIDevice>();
            using var adapter = dxgi.GetAdapter();
            _adapter = adapter.Description.Description;
            using var factory = adapter.GetParent<IDXGIFactory2>();
            NativeLog.Write("[NativeBroadcast] DXGI factory created");

            SetStage("Creating swap chain");
            var desc = new SwapChainDescription1
            {
                Width = (uint)_logicalW,
                Height = (uint)_logicalH,
                Format = Format.B8G8R8A8_UNorm,
                SampleDescription = new SampleDescription(1, 0),
                BufferUsage = Usage.RenderTargetOutput,
                BufferCount = 2,
                Scaling = Scaling.Stretch,
                SwapEffect = SwapEffect.FlipDiscard,
                AlphaMode = AlphaMode.Ignore
            };
            _swap = factory.CreateSwapChainForHwnd(_device, _window.Hwnd, desc);
            NativeLog.Write("[NativeBroadcast] Swap chain created");

            SetStage("Presenting first frame");
            DrawFrame(0);
            using (var back = _swap.GetBuffer<ID3D11Texture2D>(0))
            {
                unsafe
                {
                    fixed (byte* p = _pixels)
                        _context.UpdateSubresource(back, 0, null, (nint)p, (uint)(_logicalW * 4), 0);
                }
            }
            var present = _swap.Present(1, PresentFlags.None);
            if (present.Failure)
            {
                Fail("Presenting first frame", $"Present HRESULT=0x{present.Code:X8}");
                return;
            }
            NativeLog.Write("[NativeBroadcast] First frame presented");

            lock (_gate)
            {
                _phase = GpuTestPhase.Running;
                _stage = "Running";
            }
            NativeLog.Write("[NativeBroadcast] State STARTING -> RUNNING");

            _clock.Restart();
            var fpsWindow = Stopwatch.StartNew();
            var fpsCount = 0;
            var frameTime = TimeSpan.FromSeconds(1.0 / _targetFps);

            while (!_stop)
            {
                var start = Stopwatch.GetTimestamp();
                _window.PumpOnce();
                DrawFrame((float)_clock.Elapsed.TotalSeconds);
                using var bb = _swap.GetBuffer<ID3D11Texture2D>(0);
                unsafe
                {
                    fixed (byte* p = _pixels)
                        _context.UpdateSubresource(bb, 0, null, (nint)p, (uint)(_logicalW * 4), 0);
                }
                var phr = _swap.Present(1, PresentFlags.None);
                if (phr.Failure)
                    throw new InvalidOperationException($"Present HRESULT=0x{phr.Code:X8}");
                _frame++;
                fpsCount++;
                if (fpsWindow.ElapsedMilliseconds >= 1000)
                {
                    _fps = fpsCount / fpsWindow.Elapsed.TotalSeconds;
                    fpsCount = 0;
                    fpsWindow.Restart();
                }
                var spent = Stopwatch.GetElapsedTime(start);
                if (spent < frameTime)
                    Thread.Sleep(frameTime - spent);
            }
            lock (_gate) _phase = GpuTestPhase.Closed;
        }
        catch (Exception ex)
        {
            Fail(_stage ?? "Unknown", ex.Message);
        }
        finally
        {
            try { _swap?.Dispose(); } catch { }
            try { _context?.Dispose(); } catch { }
            try { _device?.Dispose(); } catch { }
            try { _window?.Dispose(); } catch { }
            _swap = null;
            _context = null;
            _device = null;
            _window = null;
        }
    }

    private void DrawFrame(float t)
    {
        var w = _logicalW;
        var h = _logicalH;
        var buf = _pixels;
        for (var i = 0; i < buf.Length; i += 4)
        {
            buf[i] = 12; buf[i + 1] = 10; buf[i + 2] = 8; buf[i + 3] = 255;
        }
        const int border = 8;
        for (var y = 0; y < h; y++)
        for (var x = 0; x < w; x++)
        {
            if (y >= border && y < h - border && x >= border && x < w - border)
                continue;
            var i = (y * w + x) * 4;
            buf[i] = 30; buf[i + 1] = 175; buf[i + 2] = 212; buf[i + 3] = 255;
        }
        var cx = (int)(w * 0.5 + w * 0.32 * MathF.Sin(t * 1.4f));
        var cy = (int)(h * 0.55);
        var r = Math.Max(18, Math.Min(w, h) / 16);
        for (var dy = -r; dy <= r; dy++)
        for (var dx = -r; dx <= r; dx++)
        {
            if (dx * dx + dy * dy > r * r) continue;
            var x = cx + dx; var y = cy + dy;
            if ((uint)x >= (uint)w || (uint)y >= (uint)h) continue;
            var i = (y * w + x) * 4;
            buf[i] = 40; buf[i + 1] = 190; buf[i + 2] = 220; buf[i + 3] = 255;
        }
        var bandY = (int)(h * (0.78 + 0.04 * MathF.Sin(t * 3f)));
        if ((uint)bandY < (uint)h)
        {
            for (var x = border; x < w - border; x++)
            {
                var pulse = (byte)(MathF.Sin(x / (float)w * 12f + t * 4f) * 80 + 80);
                var i = (bandY * w + x) * 4;
                buf[i] = pulse; buf[i + 1] = 80; buf[i + 2] = 180; buf[i + 3] = 255;
            }
        }
    }

    public void Dispose() => Stop();
}
