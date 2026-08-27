using System.Runtime.InteropServices;
using Auralith.Core;
using Auralith.Rendering;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media.Imaging;
using Windows.Storage;
using Windows.Storage.Pickers;
using Windows.Storage.Streams;
using Windows.Graphics.Imaging;
using WinRT.Interop;

namespace Auralith.App;

public sealed partial class MainWindow : Window
{
    private readonly GpuCore _gpu = new();
    private readonly Scene _scene = new();
    private readonly DispatcherTimer _timer = new() { Interval = TimeSpan.FromMilliseconds(33) };
    private WriteableBitmap? _bmp;
    private byte[] _copy = new byte[1920 * 1080 * 4];
    private bool _appFullscreen;

    public MainWindow()
    {
        InitializeComponent();
        Title = "Auralith";
        _gpu.Start();
        Root.Loaded += (_, _) =>
        {
            Root.IsTabStop = true;
            Root.KeyDown += OnKeyDown;
            Root.Focus(Microsoft.UI.Xaml.FocusState.Programmatic);
        };
        _timer.Tick += (_, _) => Pump();
        _timer.Start();
        Closed += (_, _) => { _timer.Stop(); _gpu.Dispose(); };
    }

    private async void OnLoadImage(object sender, RoutedEventArgs e)
    {
        var picker = new FileOpenPicker();
        picker.FileTypeFilter.Add(".png");
        picker.FileTypeFilter.Add(".jpg");
        picker.FileTypeFilter.Add(".jpeg");
        picker.FileTypeFilter.Add(".webp");
        picker.FileTypeFilter.Add(".bmp");
        InitializeWithWindow.Initialize(picker, WindowNative.GetWindowHandle(this));
        var file = await picker.PickSingleFileAsync();
        if (file is null) return;
        using var stream = await file.OpenReadAsync();
        var decoder = await BitmapDecoder.CreateAsync(stream);
        var transform = new BitmapTransform { ScaledWidth = decoder.PixelWidth, ScaledHeight = decoder.PixelHeight };
        var pixels = await decoder.GetPixelDataAsync(
            BitmapPixelFormat.Bgra8, BitmapAlphaMode.Premultiplied, transform,
            ExifOrientationMode.IgnoreExifOrientation, ColorManagementMode.DoNotColorManage);
        var data = pixels.DetachPixelData();
        _scene.BackdropPath = file.Path;
        _gpu.SetBackdrop(data, (int)decoder.PixelWidth, (int)decoder.PixelHeight);
    }

    private void OnClearImage(object sender, RoutedEventArgs e)
    {
        _scene.BackdropPath = null;
        _gpu.ClearBackdrop();
    }

    private void OnFitChanged(object sender, SelectionChangedEventArgs e)
    {
        if (FitBox?.SelectedItem is not ComboBoxItem item) return;
        _scene.Fit = item.Content?.ToString() switch
        {
            "Fill" => FitMode.Fill,
            "Stretch" => FitMode.Stretch,
            "Center" => FitMode.Center,
            _ => FitMode.Fit
        };
        _gpu.SetFit(_scene.Fit);
    }

    private void OnKeyDown(object sender, KeyRoutedEventArgs e)
    {
        if (e.Key == Windows.System.VirtualKey.Escape)
            ExitCleanCapture();
    }

    private void OnEdit(object sender, RoutedEventArgs e) => SetView(ViewMode.Edit);
    private void OnPreview(object sender, RoutedEventArgs e) => SetView(ViewMode.Preview);
    private void OnClean(object sender, RoutedEventArgs e) => SetView(ViewMode.CleanCapture);

    private void OnFullscreen(object sender, RoutedEventArgs e)
    {
        SetView(ViewMode.CleanCapture);
        var app = AppWindow;
        try
        {
            var presenter = app.Presenter as Microsoft.UI.Windowing.OverlappedPresenter;
            presenter?.SetBorderAndTitleBar(false, false);
            app.SetPresenter(Microsoft.UI.Windowing.AppWindowPresenterKind.FullScreen);
            _appFullscreen = true;
        }
        catch { /* keep windowed clean capture */ }
    }

    private Microsoft.UI.Windowing.AppWindow AppWindow =>
        Microsoft.UI.Windowing.AppWindow.GetFromWindowId(
            Microsoft.UI.Win32Interop.GetWindowIdFromWindow(WindowNative.GetWindowHandle(this)));

    private void SetView(ViewMode mode)
    {
        _scene.View = mode;
        var chrome = _scene.ShowChrome;
        TopBar.Visibility = chrome ? Visibility.Visible : Visibility.Collapsed;
        Hud.Visibility = chrome ? Visibility.Visible : Visibility.Collapsed;
        CanvasBorder.BorderThickness = chrome ? new Thickness(2) : new Thickness(0);
        CanvasBorder.Margin = chrome ? new Thickness(16, 0, 16, 0) : new Thickness(0);
        if (mode != ViewMode.CleanCapture && _appFullscreen)
        {
            try { AppWindow.SetPresenter(Microsoft.UI.Windowing.AppWindowPresenterKind.Overlapped); } catch { }
            _appFullscreen = false;
        }
    }

    public void ExitCleanCapture()
    {
        if (_scene.View == ViewMode.CleanCapture)
            SetView(ViewMode.Edit);
    }

    private void Pump()
    {
        var s = _gpu.Stats;
        if (_copy.Length != s.Width * s.Height * 4)
            _copy = new byte[Math.Max(4, s.Width * s.Height * 4)];
        if (s.Frame == 0)
        {
            Hud.Text = s.Error ?? "Starting GPU core…";
            return;
        }
        Hud.Text = s.Error is null
            ? $"{s.Width}×{s.Height}  {s.ActualFps:0.0} FPS  frame {s.Frame}  {_scene.View}  overlays={_scene.ShowOverlays}"
            : $"ERROR {s.Error}";
        _bmp ??= new WriteableBitmap(s.Width, s.Height);
        if (_bmp.PixelWidth != s.Width || _bmp.PixelHeight != s.Height)
            _bmp = new WriteableBitmap(s.Width, s.Height);
        _gpu.CopyPreview(_copy);
        WritePixels(_bmp.PixelBuffer, _copy);
        _bmp.Invalidate();
        if (Preview.Source != _bmp) Preview.Source = _bmp;
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
        finally { Marshal.Release(unk); }
    }

    [ComImport]
    [Guid("905a0fef-bc53-11df-8c49-001e4fc686da")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IBufferByteAccess { void Buffer(out nint value); }
}
