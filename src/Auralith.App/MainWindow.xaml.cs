using System.Runtime.InteropServices;
using Auralith.Core;
using Auralith.Rendering;
using Auralith.Update;
using System.Diagnostics;
using System.Reflection;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media.Imaging;
using Windows.Storage;
using Windows.Storage.Pickers;
using Windows.Storage.Streams;
using Windows.Graphics.Imaging;
using WinRT.Interop;
using System.Runtime.InteropServices.WindowsRuntime;

namespace Auralith.App;

public sealed partial class MainWindow : Window
{
    private readonly GpuCore _gpu = new();
    private readonly bool _smoke;
    private readonly Scene _scene = new();
    private readonly DispatcherTimer _timer = new() { Interval = TimeSpan.FromMilliseconds(33) };
    private WriteableBitmap? _bmp;
    private byte[] _copy = new byte[1920 * 1080 * 4];
    private bool _appFullscreen;
    private readonly UpdateClient _updates = new();
    private UpdateManifest? _available;
    private CancellationTokenSource? _dlCts;
    private bool _checkOnStartup = true;
    private bool _holdDecodedPreview;
    private string _imageDiag = "Image Load: idle";

    public MainWindow(bool smoke = false)
    {
        _smoke = smoke;
        InitializeComponent();
        Title = "Auralith";
        VersionText.Text = "v" + AppVersion;
        if (_checkOnStartup && !_smoke) _ = CheckUpdatesAsync(silent: true);
        Root.Loaded += (_, _) =>
        {
            Root.IsTabStop = true;
            Root.KeyDown += OnKeyDown;
            Root.Focus(Microsoft.UI.Xaml.FocusState.Programmatic);
            StartGpuSafely();
        };
        _timer.Tick += (_, _) => Pump();
        _timer.Start();
        Closed += (_, _) => { _timer.Stop(); _gpu.Dispose(); };
    }

    private void StartGpuSafely()
    {
        try
        {
            StartupLog.Write("D3D initialization starting");
            _gpu.Start();
            StartupLog.Write("D3D initialization requested");
        }
        catch (Exception ex)
        {
            StartupLog.Error(ex);
            Hud.Text = "GPU initialization failed.\n" + ex.Message;
        }
    }

    private async void OnLoadImage(object sender, RoutedEventArgs e)
    {
        StartupLog.Write("[ImageLoad] Button clicked");
        try { await LoadImageAsync(); }
        catch (Exception ex)
        {
            StartupLog.Error(ex);
            _imageDiag = $"Image Load: FAILED  {ex.GetType().Name}: {ex.Message}";
            Hud.Text = "Unable to load selected image.\n" + _imageDiag;
        }
    }

    private async Task LoadImageAsync()
    {
        var picker = new FileOpenPicker();
        picker.SuggestedStartLocation = PickerLocationId.PicturesLibrary;
        picker.ViewMode = PickerViewMode.Thumbnail;
        picker.FileTypeFilter.Clear();
        picker.FileTypeFilter.Add(".png");
        picker.FileTypeFilter.Add(".jpg");
        picker.FileTypeFilter.Add(".jpeg");
        picker.FileTypeFilter.Add(".bmp");
        picker.FileTypeFilter.Add(".webp");
        InitializeWithWindow.Initialize(picker, WindowNative.GetWindowHandle(this));
        StartupLog.Write("[ImageLoad] Picker opened");
        var file = await picker.PickSingleFileAsync();
        StartupLog.Write("[ImageLoad] Picker returned");
        if (file is null)
        {
            StartupLog.Write("[ImageLoad] Picker returned null");
            return;
        }
        var props = await file.GetBasicPropertiesAsync();
        StartupLog.Write($"[ImageLoad] Selected file: {file.Name}");
        StartupLog.Write($"[ImageLoad] Extension: {file.FileType} size={props.Size}");
        await LoadBackdropFromFileAsync(file);
    }

    private async Task LoadBackdropFromFileAsync(StorageFile file)
    {
        StartupLog.Write("[ImageLoad] Opening file");
        using var src = await file.OpenReadAsync();
        using var mem = new InMemoryRandomAccessStream();
        await RandomAccessStream.CopyAsync(src, mem);
        mem.Seek(0);
        StartupLog.Write($"[ImageLoad] Stream opened bytes={mem.Size}");
        var decoder = await BitmapDecoder.CreateAsync(mem);
        var w = (int)decoder.PixelWidth;
        var h = (int)decoder.PixelHeight;
        if (w <= 0 || h <= 0) throw new InvalidOperationException("Decoder returned empty dimensions.");
        var pixels = await decoder.GetPixelDataAsync(
            BitmapPixelFormat.Bgra8,
            BitmapAlphaMode.Straight,
            new BitmapTransform(),
            ExifOrientationMode.RespectExifOrientation,
            ColorManagementMode.DoNotColorManage);
        var data = pixels.DetachPixelData();
        var stride = w * 4;
        if (data.Length < stride * h)
            throw new InvalidOperationException($"Pixel buffer too small ({data.Length} < {stride * h}).");
        for (var i = 3; i < data.Length; i += 4) data[i] = 255;
        StartupLog.Write($"[ImageLoad] Decode successful {w}x{h} BGRA8 stride={stride} bytes={data.Length}");
        _scene.BackdropPath = file.Name;
        StartupLog.Write("[ImageLoad] Assigning backdrop to scene");
        _gpu.SetBackdrop(data, w, h);
        StartupLog.Write("[ImageLoad] Scene backdrop updated / requesting redraw");
        var sb = SoftwareBitmap.CreateCopyFromBuffer(
            data.AsBuffer(), BitmapPixelFormat.Bgra8, w, h, BitmapAlphaMode.Ignore);
        var source = new SoftwareBitmapSource();
        await source.SetBitmapAsync(sb);
        _holdDecodedPreview = true;
        Preview.Source = source;
        _imageDiag = $"Image Load Diagnostics  {file.Name}  decode=OK  {w}x{h}  scene=OK  preview=OK";
        Hud.Text = _imageDiag;
    }

    private void OnClearImage(object sender, RoutedEventArgs e)
    {
        _scene.BackdropPath = null;
        _gpu.ClearBackdrop();
        _holdDecodedPreview = false;
        Preview.Source = null;
        _imageDiag = "Image Load: cleared";
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
        if (s.Frame == 0 && !_holdDecodedPreview)
        {
            Hud.Text = s.Error ?? "Starting GPU core…";
            return;
        }
        if (_holdDecodedPreview)
        {
            Hud.Text = _imageDiag + $"  gpu={s.Width}x{s.Height} {s.ActualFps:0.0}fps";
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

    private static string AppVersion =>
        typeof(App).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion
        ?? typeof(App).Assembly.GetName().Version?.ToString() ?? "0.0.0";

    private async void OnCheckUpdates(object sender, RoutedEventArgs e) => await CheckUpdatesAsync(false);

    private async Task CheckUpdatesAsync(bool silent)
    {
        UpdateStatus.Text = "CHECKING…";
        try
        {
            var found = await _updates.FindLatestPreviewAsync(AppVersion, CancellationToken.None);
            if (found is null)
            {
                _available = null;
                InstallUpdateButton.Visibility = Visibility.Collapsed;
                UpdateStatus.Text = silent ? "" : "Auralith is up to date.";
                return;
            }
            _available = found;
            InstallUpdateButton.Visibility = Visibility.Visible;
            UpdateStatus.Text = $"UPDATE AVAILABLE  Installed {AppVersion} → {found.Version}";
        }
        catch (Exception ex)
        {
            UpdateClient.Log(ex.ToString());
            UpdateStatus.Text = "Update check failed: " + ex.Message;
        }
    }

    private async void OnInstallUpdate(object sender, RoutedEventArgs e)
    {
        if (_available is null) return;
        var dlg = new ContentDialog
        {
            Title = "Install update",
            Content = $"Installing {_available.Version} will restart Auralith. Save any work first.",
            PrimaryButtonText = "Download & Install",
            CloseButtonText = "Cancel",
            XamlRoot = Root.XamlRoot
        };
        if (await dlg.ShowAsync() != ContentDialogResult.Primary) return;
        _dlCts = new CancellationTokenSource();
        try
        {
            Directory.CreateDirectory(UpdateClient.UpdatesDir);
            var dest = Path.Combine(UpdateClient.UpdatesDir, _available.AssetName);
            UpdateStatus.Text = "DOWNLOADING…";
            await _updates.DownloadAsync(_available.AssetUrl, dest, new Progress<(long done, long total)>(p =>
            {
                DispatcherQueue.TryEnqueue(() =>
                {
                    if (p.total > 0)
                        UpdateStatus.Text = $"Downloading {_available.Version}  {p.done * 100.0 / p.total:0}%  {p.done / 1e6:0.0} MB / {p.total / 1e6:0.0} MB";
                    else
                        UpdateStatus.Text = $"Downloading {_available.Version}  {p.done / 1e6:0.0} MB";
                });
            }), _dlCts.Token);
            UpdateStatus.Text = "VERIFYING…";
            UpdateClient.VerifySha256(dest, _available.Sha256);
            var helper = Path.Combine(AppContext.BaseDirectory, "Auralith.Updater.exe");
            if (!File.Exists(helper))
                throw new InvalidOperationException("Auralith.Updater.exe is missing from the install folder.");
            UpdateStatus.Text = "INSTALLING… restarting";
            Process.Start(new ProcessStartInfo(helper)
            {
                UseShellExecute = false,
                ArgumentList =
                {
                    "--package", dest,
                    "--target", AppContext.BaseDirectory,
                    "--pid", Environment.ProcessId.ToString(),
                    "--launch", Path.Combine(AppContext.BaseDirectory, "Auralith.exe")
                }
            });
            Application.Current.Exit();
        }
        catch (Exception ex)
        {
            UpdateClient.Log(ex.ToString());
            UpdateStatus.Text = "Automatic update failed. " + ex.Message;
            if (!string.IsNullOrEmpty(_available.ReleaseUrl))
                UpdateStatus.Text += "  Open GitHub Release from the browser if needed: " + _available.ReleaseUrl;
        }
    }


    private void ShowDecodedPreview(byte[] bgra, int w, int h)
    {
        try
        {
            var bmp = new WriteableBitmap(w, h);
            WritePixels(bmp.PixelBuffer, bgra);
            bmp.Invalidate();
            Preview.Source = bmp;
            _bmp = null; // next GPU frame can replace once compositor is ready
        }
        catch (Exception ex) { StartupLog.Error(ex); }
    }

}
