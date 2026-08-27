using System.Diagnostics;
using Auralith.Core;
using Vortice.Direct3D;
using Vortice.Direct3D11;
using Vortice.DXGI;

namespace Auralith.Rendering;

public sealed class GpuCore : IDisposable
{
    public int Width { get; private set; } = 1920;
    public int Height { get; private set; } = 1080;
    public int TargetFps { get; set; } = 30;

    private ID3D11Device? _device;
    private ID3D11DeviceContext? _context;
    private ID3D11Texture2D? _final;
    private byte[] _pixels = new byte[1920 * 1080 * 4];
    private byte[]? _backdrop;
    private int _bdW, _bdH;
    private FitMode _fit = FitMode.Fit;
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
                    Width = Width, Height = Height, TargetFps = TargetFps,
                    ActualFps = _fps, Frame = _frame, Adapter = _adapter,
                    Stage = _stage, Error = _error
                };
            }
        }
    }

    public void SetCanvas(int w, int h)
    {
        lock (_gate)
        {
            Width = Math.Clamp(w, 64, 3840);
            Height = Math.Clamp(h, 64, 2160);
            _pixels = new byte[Width * Height * 4];
        }
    }

    public void SetFit(FitMode fit) { lock (_gate) _fit = fit; }

    public void SetBackdrop(byte[] bgra, int w, int h)
    {
        lock (_gate)
        {
            _backdrop = (byte[])bgra.Clone();
            _bdW = w;
            _bdH = h;
        }
    }

    public void ClearBackdrop()
    {
        lock (_gate) { _backdrop = null; _bdW = _bdH = 0; }
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
                out _device, out _, out _context);
            if (hr.Failure || _device is null || _context is null)
            {
                hr = D3D11.D3D11CreateDevice(
                    null, DriverType.Warp, DeviceCreationFlags.BgraSupport,
                    new[] { FeatureLevel.Level_11_0, FeatureLevel.Level_10_1 },
                    out _device, out _, out _context);
            }
            if (hr.Failure || _device is null || _context is null)
                throw new InvalidOperationException($"D3D11CreateDevice 0x{hr.Code:X8}");
            using (var dxgi = _device.QueryInterface<IDXGIDevice>())
            using (var adapter = dxgi.GetAdapter())
                _adapter = adapter.Description.Description;

            RecreateTexture();
            _stage = "Running";
            var clock = Stopwatch.StartNew();
            var fpsClock = Stopwatch.StartNew();
            var fpsCount = 0;

            while (!_stop)
            {
                var t0 = Stopwatch.GetTimestamp();
                int w, h, fps;
                lock (_gate) { w = Width; h = Height; fps = TargetFps; }
                if (_final is null || _final.Description.Width != w || _final.Description.Height != h)
                    RecreateTexture();
                Draw((float)clock.Elapsed.TotalSeconds);
                unsafe
                {
                    fixed (byte* p = _pixels)
                        _context!.UpdateSubresource(_final, 0, null, (nint)p, (uint)(w * 4), 0);
                }
                _frame++;
                fpsCount++;
                if (fpsClock.ElapsedMilliseconds >= 1000)
                {
                    _fps = fpsCount / fpsClock.Elapsed.TotalSeconds;
                    fpsCount = 0;
                    fpsClock.Restart();
                }
                var frameTime = TimeSpan.FromSeconds(1.0 / Math.Max(1, fps));
                var spent = Stopwatch.GetElapsedTime(t0);
                if (spent < frameTime) Thread.Sleep(frameTime - spent);
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
            _final?.Dispose(); _context?.Dispose(); _device?.Dispose();
            _final = null; _context = null; _device = null;
        }
    }

    private void RecreateTexture()
    {
        _final?.Dispose();
        _final = _device!.CreateTexture2D(new Texture2DDescription
        {
            Width = (uint)Width, Height = (uint)Height, MipLevels = 1, ArraySize = 1,
            Format = Format.B8G8R8A8_UNorm, SampleDescription = new SampleDescription(1, 0),
            Usage = ResourceUsage.Default,
            BindFlags = BindFlags.ShaderResource | BindFlags.RenderTarget
        });
        lock (_gate) _pixels = new byte[Width * Height * 4];
    }

    private void Draw(float t)
    {
        int w, h;
        byte[]? bd; int bw, bh; FitMode fit;
        lock (_gate)
        {
            w = Width; h = Height; bd = _backdrop; bw = _bdW; bh = _bdH; fit = _fit;
        }
        var buf = _pixels;
        for (var i = 0; i < buf.Length; i += 4)
        { buf[i] = 12; buf[i + 1] = 10; buf[i + 2] = 8; buf[i + 3] = 255; }

        if (bd is not null && bw > 0 && bh > 0)
            BlitBackdrop(buf, w, h, bd, bw, bh, fit);
        else
            DrawDiagnostic(buf, w, h, t);
    }

    private static void BlitBackdrop(byte[] dest, int dw, int dh, byte[] src, int sw, int sh, FitMode fit)
    {
        var (dx, dy, dtw, dth) = FitMath.Dest(fit, sw, sh, dw, dh);
        var x0 = (int)Math.Floor(dx); var y0 = (int)Math.Floor(dy);
        var x1 = (int)Math.Ceiling(dx + dtw); var y1 = (int)Math.Ceiling(dy + dth);
        for (var y = Math.Max(0, y0); y < Math.Min(dh, y1); y++)
        {
            var v = (y - dy) / dth;
            var sy = Math.Clamp((int)(v * sh), 0, sh - 1);
            for (var x = Math.Max(0, x0); x < Math.Min(dw, x1); x++)
            {
                var u = (x - dx) / dtw;
                var sx = Math.Clamp((int)(u * sw), 0, sw - 1);
                var si = (sy * sw + sx) * 4;
                var di = (y * dw + x) * 4;
                dest[di] = src[si]; dest[di + 1] = src[si + 1];
                dest[di + 2] = src[si + 2]; dest[di + 3] = 255;
            }
        }
    }

    private static void DrawDiagnostic(byte[] buf, int w, int h, float t)
    {
        const int border = 10;
        for (var y = 0; y < h; y++)
        for (var x = 0; x < w; x++)
        {
            if (y >= border && y < h - border && x >= border && x < w - border) continue;
            var i = (y * w + x) * 4;
            buf[i] = 32; buf[i + 1] = 180; buf[i + 2] = 214; buf[i + 3] = 255;
        }
        var cx = (int)(w * 0.5 + w * 0.28 * MathF.Sin(t * 1.3f));
        var cy = h / 2; var r = Math.Max(24, Math.Min(w, h) / 18);
        for (var dy = -r; dy <= r; dy++)
        for (var dx = -r; dx <= r; dx++)
        {
            if (dx * dx + dy * dy > r * r) continue;
            var x = cx + dx; var y = cy + dy;
            if ((uint)x >= (uint)w || (uint)y >= (uint)h) continue;
            var i = (y * w + x) * 4;
            buf[i] = 40; buf[i + 1] = 196; buf[i + 2] = 230; buf[i + 3] = 255;
        }
    }

    public void Dispose() => Stop();
}
