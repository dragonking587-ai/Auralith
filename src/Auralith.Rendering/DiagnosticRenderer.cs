using System.Diagnostics;
using Auralith.Core;
using Auralith.Platform.Windows;
using Vortice.Direct3D;
using Vortice.Direct3D11;
using Vortice.DXGI;

namespace Auralith.Rendering;

/// <summary>Phase 1 standalone D3D11 diagnostic. No scene, no effects.</summary>
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
    private bool _stop;
    private Thread? _thread;
    private readonly Stopwatch _clock = new();
    private ulong _frame;
    private double _fps;
    private string? _adapter;
    private string? _error;
    private string? _stage;
    private GpuTestPhase _phase = GpuTestPhase.Closed;

    public DiagnosticRenderer(int width, int height, int fps)
    {
        _logicalW = Math.Clamp(width, 16, 3840);
        _logicalH = Math.Clamp(height, 16, 2160);
        _targetFps = fps >= 45 ? 60 : 30;
        _pixels = new byte[_logicalW * _logicalH * 4];
    }

    public GpuTestStatus Status => new()
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

    public void Start()
    {
        if (_phase is GpuTestPhase.Starting or GpuTestPhase.Running)
            return;
        _stop = false;
        _phase = GpuTestPhase.Starting;
        _stage = "Thread";
        _thread = new Thread(RenderLoop) { Name = "Auralith.GpuTest", IsBackground = true };
        _thread.Start();
    }

    public void Stop()
    {
        _stop = true;
        _thread?.Join(2000);
        _thread = null;
    }

    private void RenderLoop()
    {
        try
        {
            _stage = "HWND Creation";
            _window = new NativeWindow();
            _window.Closed += () => _stop = true;
            _window.Create(_logicalW, _logicalH);

            _stage = "D3D11 Device Creation";
            D3D11.D3D11CreateDevice(null, DriverType.Hardware, DeviceCreationFlags.BgraSupport,
                new[] { FeatureLevel.Level_11_1, FeatureLevel.Level_11_0, FeatureLevel.Level_10_1 },
                out _device, out var fl, out _context).CheckError();
            if (_device is null || _context is null)
                throw new InvalidOperationException("D3D11 device was null");

            using var dxgi = _device.QueryInterface<IDXGIDevice>();
            using var adapter = dxgi.GetAdapter();
            _adapter = adapter.Description.Description;
            _stage = "Swap Chain Creation";
            using var factory = adapter.GetParent<IDXGIFactory2>();
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

            _phase = GpuTestPhase.Running;
            _stage = "Running";
            _clock.Restart();
            var fpsWindow = Stopwatch.StartNew();
            var fpsCount = 0;
            var frameTime = TimeSpan.FromSeconds(1.0 / _targetFps);

            while (!_stop)
            {
                var start = Stopwatch.GetTimestamp();
                _window.PumpOnce();
                DrawFrame((float)_clock.Elapsed.TotalSeconds);
                using var back = _swap.GetBuffer<ID3D11Texture2D>(0);
                unsafe
                {
                    fixed (byte* p = _pixels)
                    {
                        _context.UpdateSubresource(back, 0, null, (nint)p, (uint)(_logicalW * 4), 0);
                    }
                }
                var hr = _swap.Present(1, PresentFlags.None);
                if (hr.Failure)
                    throw new InvalidOperationException($"Present failed HRESULT=0x{hr.Code:X8}");
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
            _phase = GpuTestPhase.Closed;
        }
        catch (Exception ex)
        {
            _error = ex.Message;
            _phase = GpuTestPhase.Error;
        }
        finally
        {
            _swap?.Dispose();
            _context?.Dispose();
            _device?.Dispose();
            _window?.Dispose();
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
            if (y < border || y >= h - border || x < border || x >= w - border)
            {
                var i = (y * w + x) * 4;
                buf[i] = 30; buf[i + 1] = 175; buf[i + 2] = 212; buf[i + 3] = 255;
            }
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
