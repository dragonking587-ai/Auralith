using System.Runtime.InteropServices;
using Auralith.Rendering;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Media.Imaging;
using Windows.Storage.Streams;

namespace Auralith.App;

public sealed partial class MainWindow : Window
{
    private readonly GpuCore _gpu = new();
    private readonly DispatcherTimer _timer = new() { Interval = TimeSpan.FromMilliseconds(33) };
    private WriteableBitmap? _bmp;
    private readonly byte[] _copy = new byte[GpuCore.Width * GpuCore.Height * 4];

    public MainWindow()
    {
        InitializeComponent();
        Title = "Auralith";
        _gpu.Start();
        _timer.Tick += (_, _) => Pump();
        _timer.Start();
        Closed += (_, _) =>
        {
            _timer.Stop();
            _gpu.Dispose();
        };
    }

    private void Pump()
    {
        var s = _gpu.Stats;
        Hud.Text = s.Error is null
            ? $"{s.Width}×{s.Height}   {s.ActualFps:0.0} FPS   frame {s.Frame}   {s.Adapter}   {s.Stage}"
            : $"ERROR  stage={s.Stage}  {s.Error}";
        if (s.Frame == 0) return;
        _bmp ??= new WriteableBitmap(GpuCore.Width, GpuCore.Height);
        _gpu.CopyPreview(_copy);
        WritePixels(_bmp.PixelBuffer, _copy);
        _bmp.Invalidate();
        if (Preview.Source is null)
            Preview.Source = _bmp;
    }

    private static void WritePixels(IBuffer buffer, byte[] src)
    {
        var unk = Marshal.GetIUnknownForObject(buffer);
        try
        {
            var access = (IBufferByteAccess)Marshal.GetTypedObjectForIUnknown(unk, typeof(IBufferByteAccess));
            access.Buffer(out var ptr);
            Marshal.Copy(src, 0, ptr, src.Length);
        }
        finally
        {
            Marshal.Release(unk);
        }
    }

    [ComImport]
    [Guid("905a0fef-bc53-11df-8c49-001e4fc686da")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IBufferByteAccess
    {
        void Buffer(out nint value);
    }
}
