using System.Runtime.InteropServices;
using Auralith.Core;
using Auralith.Rendering;
using Auralith.Update;
using Auralith.Audio;
using System.Text.Json;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using Microsoft.UI.Input;
using Windows.Foundation;
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
    private readonly AudioEngine _audio = new();
    private string _tool = "select";
    private Region? _selected;
    private Region? _draft;
    private readonly Stack<string> _undo = new();
    private readonly Stack<string> _redo = new();
    private string _imageDiag = "Image Load: idle";

    public MainWindow(bool smoke = false)
    {
        _smoke = smoke;
        InitializeComponent();
        Title = "Auralith";
        ApplyWindowIcon();
        VersionText.Text = "v" + AppVersion;
        if (_checkOnStartup && !_smoke) _ = CheckUpdatesAsync(silent: true);
        Root.Loaded += (_, _) =>
        {
            Root.IsTabStop = true;
            Root.KeyDown += OnKeyDown;
            Root.Focus(Microsoft.UI.Xaml.FocusState.Programmatic);
            StartGpuSafely();
            DeviceBox.Items.Clear();
            foreach (var (id, name) in _audio.ListRenderDevices())
                DeviceBox.Items.Add(new ComboBoxItem { Content = name, Tag = id });
            if (DeviceBox.Items.Count > 0) DeviceBox.SelectedIndex = 0;
        };
        _timer.Tick += (_, _) => Pump();
        _timer.Start();
        Closed += (_, _) => { _timer.Stop(); _gpu.Dispose(); _audio.Dispose(); };
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
        if (LeftTools is not null) LeftTools.Visibility = chrome ? Visibility.Visible : Visibility.Collapsed;
        if (RightPanel is not null) RightPanel.Visibility = chrome ? Visibility.Visible : Visibility.Collapsed;

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
        var bands = _audio.Snapshot();
        _gpu.SetSceneGraph(_scene, _scene.Regions, bands);
        if (Meters is not null)
            Meters.Text = $"BASS {bands.Bass:0.00}  LOW {bands.Low:0.00}  MID {bands.Mid:0.00}  HIGH {bands.High:0.00}\nBEAT {bands.Beat:0.00}  TRN {bands.Transient:0.00}";
        if (AudioStatus is not null) AudioStatus.Text = _audio.Status;
        if (_scene.ShowOverlays) RedrawOverlay();
        else Overlay.Children.Clear();
        if (_holdDecodedPreview)
        {
            Hud.Text = _imageDiag + $"  gpu={s.Width}x{s.Height} {s.ActualFps:0.0}fps";
            // still allow GPU composite under the photo? keep photo pinned
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
            var dest = System.IO.Path.Combine(UpdateClient.UpdatesDir, _available.AssetName);
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
            var helper = System.IO.Path.Combine(AppContext.BaseDirectory, "Auralith.Updater.exe");
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
                    "--launch", System.IO.Path.Combine(AppContext.BaseDirectory, "Auralith.exe")
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


    private void PushUndo()
    {
        _undo.Push(JsonSerializer.Serialize(_scene.Regions));
        _redo.Clear();
    }
    private void OnUndo(object sender, RoutedEventArgs e)
    {
        if (_undo.Count == 0) return;
        _redo.Push(JsonSerializer.Serialize(_scene.Regions));
        _scene.Regions = JsonSerializer.Deserialize<List<Region>>(_undo.Pop()) ?? new();
        _selected = null; RedrawOverlay(); RefreshSel();
    }
    private void OnRedo(object sender, RoutedEventArgs e)
    {
        if (_redo.Count == 0) return;
        _undo.Push(JsonSerializer.Serialize(_scene.Regions));
        _scene.Regions = JsonSerializer.Deserialize<List<Region>>(_redo.Pop()) ?? new();
        _selected = null; RedrawOverlay(); RefreshSel();
    }
    private void OnToolSelect(object s, RoutedEventArgs e) { _tool = "select"; ToolHint.Text = "Click a region to select."; }
    private void OnToolTrace(object s, RoutedEventArgs e) { _tool = "trace"; ToolHint.Text = "Click to add points. Double-click to close."; }
    private void OnToolStamp(object s, RoutedEventArgs e) { _tool = "stamp"; ToolHint.Text = "Drag on the canvas to place a stamp."; }
    private void OnToolEmitter(object s, RoutedEventArgs e) { _tool = "emitter"; ToolHint.Text = "Click to place an emitter."; }
    private void OnOverlayToggle(object s, RoutedEventArgs e)
    {
        _scene.ShowEditorOverlays = OverlayCheck.IsChecked == true;
    }
    private void OnMarkerToggle(object s, RoutedEventArgs e)
    {
        if (_selected is null) return;
        _selected.ShowEditorMarker = MarkerCheck.IsChecked == true;
    }
    private Windows.Foundation.Point ToCanvas(PointerRoutedEventArgs e)
    {
        var pt = e.GetCurrentPoint(Preview).Position;
        var aw = Preview.ActualWidth; var ah = Preview.ActualHeight;
        if (aw < 1 || ah < 1) return new Windows.Foundation.Point(0,0);
        return new Windows.Foundation.Point(pt.X / aw * _scene.CanvasWidth, pt.Y / ah * _scene.CanvasHeight);
    }
    private void OnOverlayPressed(object s, PointerRoutedEventArgs e)
    {
        if (!_scene.ShowOverlays) return;
        var p = ToCanvas(e);
        if (_tool == "select")
        {
            _selected = Hit((float)p.X, (float)p.Y);
            RefreshSel(); return;
        }
        PushUndo();
        if (_tool == "emitter")
        {
            var r = new Region { Kind = RegionKind.Emitter, Name = "Emitter", X = (float)p.X, Y = (float)p.Y, Radius = 70 };
            r.Effects.Add(EffectKind.Glow);
            _scene.Regions.Add(r); _selected = r; RefreshSel(); return;
        }
        if (_tool == "stamp")
        {
            _draft = new Region { Kind = RegionKind.Stamp, Name = "Stamp", X = (float)p.X, Y = (float)p.Y, Width = 8, Height = 8, Shape = StampShape.Ellipse };
            _draft.Effects.Add(EffectKind.Pulse);
            _scene.Regions.Add(_draft); _selected = _draft; Overlay.CapturePointer(e.Pointer); return;
        }
        if (_tool == "trace")
        {
            if (_draft is null || _draft.Kind != RegionKind.Trace)
            {
                _draft = new Region { Kind = RegionKind.Trace, Name = "Trace", X = (float)p.X, Y = (float)p.Y };
                _draft.Effects.Add(EffectKind.Glow);
                _scene.Regions.Add(_draft); _selected = _draft;
            }
            _draft.Points.Add((float)p.X); _draft.Points.Add((float)p.Y);
            if (e.GetCurrentPoint(Overlay).Properties.PointerUpdateKind == Microsoft.UI.Input.PointerUpdateKind.LeftButtonPressed
                && _draft.Points.Count >= 8 && Distance(_draft, p) < 18)
            { _draft = null; }
            RefreshSel();
        }
    }
    private static float Distance(Region r, Windows.Foundation.Point p)
    {
        if (r.Points.Count < 2) return 999;
        var dx = r.Points[0] - (float)p.X; var dy = r.Points[1] - (float)p.Y;
        return MathF.Sqrt(dx*dx+dy*dy);
    }
    private void OnOverlayMoved(object s, PointerRoutedEventArgs e)
    {
        if (_draft is { Kind: RegionKind.Stamp })
        {
            var p = ToCanvas(e);
            _draft.Width = Math.Max(8, (float)p.X - _draft.X);
            _draft.Height = Math.Max(8, (float)p.Y - _draft.Y);
        }
    }
    private void OnOverlayReleased(object s, PointerRoutedEventArgs e)
    {
        Overlay.ReleasePointerCaptures();
        if (_draft is { Kind: RegionKind.Stamp }) _draft = null;
        RefreshSel();
    }
    private Region? Hit(float x, float y)
    {
        foreach (var r in Enumerable.Reverse(_scene.Regions))
        {
            if (r.Kind == RegionKind.Emitter)
            {
                var dx = x - r.X; var dy = y - r.Y;
                if (dx*dx+dy*dy <= r.Radius*r.Radius) return r;
            }
            else if (x >= r.X && y >= r.Y && x <= r.X+r.Width && y <= r.Y+r.Height) return r;
        }
        return null;
    }
    private void OnDeleteSelected(object s, RoutedEventArgs e)
    {
        if (_selected is null) return;
        PushUndo();
        _scene.Regions.Remove(_selected); _selected = null; RefreshSel();
    }
    private void OnDuplicate(object s, RoutedEventArgs e)
    {
        if (_selected is null) return;
        PushUndo();
        var copy = JsonSerializer.Deserialize<Region>(JsonSerializer.Serialize(_selected))!;
        copy.Id = Guid.NewGuid(); copy.X += 30; copy.Y += 30; copy.Name += " copy";
        _scene.Regions.Add(copy); _selected = copy; RefreshSel();
    }
    private void OnAddEffect(object s, RoutedEventArgs e)
    {
        if (_selected is null || AddEffectBox.SelectedItem is not ComboBoxItem item) return;
        if (!Enum.TryParse<EffectKind>(item.Tag?.ToString(), out var kind)) return;
        PushUndo();
        _selected.Effects.Add(kind);
        RefreshSel();
    }
    private void RefreshSel()
    {
        if (_selected is null) { SelInfo.Text = "None selected"; EffectList.Children.Clear(); return; }
        SelInfo.Text = $"{_selected.Kind}  {_selected.Name}\nmarker={_selected.ShowEditorMarker} locked={_selected.Locked}\neffects={_selected.Effects.Items.Count}";
        MarkerCheck.IsChecked = _selected.ShowEditorMarker;
        EffectList.Children.Clear();
        foreach (var fx in _selected.Effects.Items)
        {
            var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4 };
            var cb = new CheckBox { Content = fx.Kind.ToString(), IsChecked = fx.Enabled, Tag = fx };
            cb.Checked += (_, _) => fx.Enabled = true;
            cb.Unchecked += (_, _) => fx.Enabled = false;
            row.Children.Add(cb);
            EffectList.Children.Add(row);
        }
        RedrawOverlay();
    }
    private void RedrawOverlay()
    {
        Overlay.Children.Clear();
        if (!_scene.ShowOverlays) return;
        var sx = Overlay.ActualWidth / _scene.CanvasWidth;
        var sy = Overlay.ActualHeight / _scene.CanvasHeight;
        if (sx <= 0 || sy <= 0) { sx = Preview.ActualWidth / _scene.CanvasWidth; sy = Preview.ActualHeight / _scene.CanvasHeight; }
        if (sx <= 0 || sy <= 0) return;
        foreach (var r in _scene.Regions)
        {
            if (!r.ShowEditorMarker) continue;
            var color = r == _selected ? "#FFD4AF37" : "#88E8E6E3";
            var brush = new SolidColorBrush(Microsoft.UI.Colors.Gold);
            if (r.Kind == RegionKind.Emitter)
            {
                Overlay.Children.Add(new Ellipse
                {
                    Width = r.Radius * 2 * sx, Height = r.Radius * 2 * sy,
                    Stroke = brush, StrokeThickness = 2,
                });
                Canvas.SetLeft(Overlay.Children[^1], (r.X - r.Radius) * sx);
                Canvas.SetTop(Overlay.Children[^1], (r.Y - r.Radius) * sy);
            }
            else if (r.Kind == RegionKind.Trace && r.Points.Count >= 4)
            {
                var poly = new Polygon { Stroke = brush, StrokeThickness = 2, Fill = new SolidColorBrush(Windows.UI.Color.FromArgb(40, 212, 175, 55)) };
                var pts = new PointCollection();
                for (var i = 0; i + 1 < r.Points.Count; i += 2)
                    pts.Add(new Windows.Foundation.Point(r.Points[i] * sx, r.Points[i + 1] * sy));
                poly.Points = pts;
                Overlay.Children.Add(poly);
            }
            else
            {
                Overlay.Children.Add(new Rectangle
                {
                    Width = Math.Max(8, r.Width * sx), Height = Math.Max(8, r.Height * sy),
                    Stroke = brush, StrokeThickness = 2
                });
                Canvas.SetLeft(Overlay.Children[^1], r.X * sx);
                Canvas.SetTop(Overlay.Children[^1], r.Y * sy);
            }
        }
    }
    private void OnStartAudio(object s, RoutedEventArgs e)
    {
        string? id = null;
        if (DeviceBox.SelectedItem is ComboBoxItem item) id = item.Tag as string;
        _audio.StartLoopback(id);
        AudioStatus.Text = _audio.Status;
    }
    private void OnDeviceChanged(object s, SelectionChangedEventArgs e) { }
    private async void OnSaveProject(object s, RoutedEventArgs e)
    {
        var picker = new FileSavePicker();
        picker.FileTypeChoices.Add("Auralith", new List<string> { ".auralith" });
        WinRT.Interop.InitializeWithWindow.Initialize(picker, WinRT.Interop.WindowNative.GetWindowHandle(this));
        var file = await picker.PickSaveFileAsync();
        if (file is null) return;
        await FileIO.WriteTextAsync(file, JsonSerializer.Serialize(_scene, new JsonSerializerOptions { WriteIndented = true }));
    }
    private async void OnOpenProject(object s, RoutedEventArgs e)
    {
        var picker = new FileOpenPicker();
        picker.FileTypeFilter.Add(".auralith");
        WinRT.Interop.InitializeWithWindow.Initialize(picker, WinRT.Interop.WindowNative.GetWindowHandle(this));
        var file = await picker.PickSingleFileAsync();
        if (file is null) return;
        var json = await FileIO.ReadTextAsync(file);
        var loaded = JsonSerializer.Deserialize<Scene>(json);
        if (loaded is null) return;
        if (!string.IsNullOrEmpty(loaded.BackdropPath) && !File.Exists(loaded.BackdropPath))
            Hud.Text = "Backdrop file not found. [Locate Image] — continue without.";
        _scene.Regions = loaded.Regions;
        _scene.Fit = loaded.Fit;
        _scene.ShowEditorOverlays = loaded.ShowEditorOverlays;
        RefreshSel();
    }

    private void ApplyWindowIcon()
    {
        try
        {
            var ico = System.IO.Path.Combine(AppContext.BaseDirectory, "Assets", "auralith.ico");
            if (!File.Exists(ico))
                ico = System.IO.Path.Combine(AppContext.BaseDirectory, "auralith.ico");
            if (!File.Exists(ico)) return;
            var hwnd = WindowNative.GetWindowHandle(this);
            var id = Microsoft.UI.Win32Interop.GetWindowIdFromWindow(hwnd);
            AppWindow.GetFromWindowId(id).SetIcon(ico);
        }
        catch (Exception ex) { StartupLog.Write("icon " + ex.Message); }
    }
}
