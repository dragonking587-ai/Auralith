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
    private WebAudioHost? _webAudio;
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
            AddEffectBox.Items.Clear();
            foreach (var kind in EffectCatalog.All)
                AddEffectBox.Items.Add(new ComboBoxItem { Content = kind.ToString(), Tag = kind.ToString() });
            if (AddEffectBox.Items.Count > 0) AddEffectBox.SelectedIndex = 0;
            _ = InitWebAudioAsync();


        };
        _timer.Tick += (_, _) => Pump();
        _timer.Start();
        Closed += (_, _) => { _timer.Stop(); _gpu.Dispose(); _audio.Dispose(); _ = _webAudio?.StopAsync(); };
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
        // keep decoded preview only until GPU presents the same 1920x1080 scene
        _holdDecodedPreview = false;
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
            Meters.Text =
                $"RAW  {Bar(bands.Raw)}  {bands.Raw:0.00}\n" +
                $"BASS {Bar(bands.Bass)}  {bands.Bass:0.00}\n" +
                $"LOW  {Bar(bands.Low)}  {bands.Low:0.00}\n" +
                $"MID  {Bar(bands.Mid)}  {bands.Mid:0.00}\n" +
                $"HIGH {Bar(bands.High)}  {bands.High:0.00}\n" +
                $"BEAT {Bar(bands.Beat)}  {bands.Beat:0.00}  TRN {Bar(bands.Transient)}  {bands.Transient:0.00}";
        var webSel = (EngineBox?.SelectedItem as ComboBoxItem)?.Tag?.ToString() == "Web";
        if (AudioStatus is not null)
            AudioStatus.Text = webSel && _webAudio is not null
                ? ("WEB AUDIO: " + _webAudio.Status + "  " + _webAudio.Detail)
                : _audio.Status;

        if (AudioDiag is not null) AudioDiag.Text = _audio.Diagnostics;
        if (LoopbackDiag is not null)
        {
            var b = _audio.Snapshot();
            var src = _audio.ProcessSource;
            var age = _audio.LastPacketAgeSec;
            LoopbackDiag.Text =
                $"Mode: {_audio.CaptureModeLabel}\nSource: {_audio.DeviceName}\n" +
                $"State: {_audio.Status}\n" +
                $"First Packet: {(_audio.FirstPacket ? "YES" : "NO")}\n" +
                $"Total Packets: {_audio.PacketCount}  Silent: {_audio.SilentPackets}\n" +
                $"Last Packet Age: {(age < 0 ? "n/a" : age.ToString("0.00") + "s")}\n" +
                $"RAW Peak: {_audio.RawPeak:0.000}  RAW RMS: {_audio.RawRms:0.000}\n" +
                $"BASS {b.Bass:0.00} LOW {b.Low:0.00} MID {b.Mid:0.00} HIGH {b.High:0.00}\n" +
                (src is null
                    ? "PROCESS LOOPBACK: IDLE"
                    : $"PROCESS LOOPBACK: {src.LastStage} HRESULT {src.LastHresult} FirstPacket {(src.FirstPacket ? "YES" : "NO")} Packets {src.Packets}");
        }

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
    private (float sw, float sh) PreviewSourceSize()
        => (_scene.CanvasWidth, _scene.CanvasHeight);

    private Windows.Foundation.Point ToCanvas(PointerRoutedEventArgs e)
    {
        var pt = e.GetCurrentPoint(Preview).Position;
        var aw = (float)Preview.ActualWidth; var ah = (float)Preview.ActualHeight;
        if (aw < 1 || ah < 1) return new Windows.Foundation.Point(0,0);
        var (sw, sh) = PreviewSourceSize();
        var (x, y) = CanvasSpace.PointerToScene((float)pt.X, (float)pt.Y, aw, ah, _scene.CanvasWidth, _scene.CanvasHeight, sw, sh);
        if (CoordHud is not null)
        {
            var v = CanvasSpace.UniformContent(aw, ah, sw, sh);
            CoordHud.Text = $"Canvas: {pt.X:0},{pt.Y:0}  Scene: {x:0},{y:0}\nViewport: {v.X:0},{v.Y:0} {v.W:0}x{v.H:0}  Scene {_scene.CanvasWidth}x{_scene.CanvasHeight}  Fit {_scene.Fit}";
        }
        return new Windows.Foundation.Point(x, y);
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
    private EffectInstance? _editFx;

    private void RefreshSel()
    {
        if (_selected is null)
        {
            SelInfo.Text = "None selected";
            EffectList.Children.Clear();
            EffectInspector.Children.Clear();
            return;
        }
        SelInfo.Text = $"{_selected.Kind}  {_selected.Name}\nmarker={_selected.ShowEditorMarker} locked={_selected.Locked}\neffects={_selected.Effects.Items.Count}";
        MarkerCheck.IsChecked = _selected.ShowEditorMarker;
        EffectList.Children.Clear();
        foreach (var fx in _selected.Effects.Items)
        {
            var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4 };
            var cb = new CheckBox { Content = fx.Kind.ToString(), IsChecked = fx.Enabled, Tag = fx };
            cb.Checked += (_, _) => fx.Enabled = true;
            cb.Unchecked += (_, _) => fx.Enabled = false;
            var pick = new Button { Content = "Edit", Tag = fx };
            pick.Click += (_, _) => { _editFx = fx; BuildInspector(); };
            var up = new Button { Content = "Up", Tag = fx };
            up.Click += (_, _) => MoveFx(fx, -1);
            var dn = new Button { Content = "Dn", Tag = fx };
            dn.Click += (_, _) => MoveFx(fx, 1);
            var del = new Button { Content = "X", Tag = fx };
            del.Click += (_, _) => { PushUndo(); _selected.Effects.Remove(fx.Id); if (_editFx==fx) _editFx=null; RefreshSel(); };
            row.Children.Add(cb); row.Children.Add(pick); row.Children.Add(up); row.Children.Add(dn); row.Children.Add(del);
            EffectList.Children.Add(row);
        }
        _editFx ??= _selected.Effects.Items.LastOrDefault();
        BuildInspector();
        RedrawOverlay();
    }

    private void MoveFx(EffectInstance fx, int dir)
    {
        var i = _selected!.Effects.Items.IndexOf(fx);
        PushUndo();
        _selected.Effects.Move(i, i + dir);
        RefreshSel();
    }

    private void BuildInspector()
    {
        EffectInspector.Children.Clear();
        if (_editFx is null) return;
        var fx = _editFx;
        var title = new TextBlock { Text = fx.Kind.ToString(), Foreground = new SolidColorBrush(Microsoft.UI.Colors.Gold) };
        EffectInspector.Children.Add(title);
        var controls = EffectCatalog.Controls(fx.Kind);
        if (controls.Contains("Audio"))
        {
            var box = new ComboBox { Width = 220 };
            foreach (var a in Enum.GetValues<AudioSource>())
                box.Items.Add(new ComboBoxItem { Content = a.ToString(), Tag = a, IsSelected = fx.Audio == a });
            box.SelectionChanged += (_, _) =>
            {
                if (box.SelectedItem is ComboBoxItem it && it.Tag is AudioSource src) fx.Audio = src;
            };
            EffectInspector.Children.Add(box);
        }
        void SliderRow(string label, float min, float max, float cur, Action<float> set, string tip)
        {
            var lab = new TextBlock { Text = $"{label}  {cur:0.##}", Foreground = new SolidColorBrush(Microsoft.UI.Colors.White), FontSize = 11 };
            ToolTipService.SetToolTip(lab, tip);
            var sl = new Slider { Minimum = min, Maximum = max, Value = cur, Width = 220, StepFrequency = (max-min)/100 };
            sl.ValueChanged += (_, e) => { set((float)e.NewValue); lab.Text = $"{label}  {e.NewValue:0.##}"; };
            EffectInspector.Children.Add(lab);
            EffectInspector.Children.Add(sl);
        }
        if (controls.Contains("Intensity")) SliderRow("Intensity %", 0, 200, fx.Intensity*100, v => fx.Intensity=v/100f, "Overall effect strength");
        if (controls.Contains("Brightness")) SliderRow("Brightness %", 0, 200, fx.Brightness*100, v => fx.Brightness=v/100f, "Light output multiplier");
        if (controls.Contains("Opacity")) SliderRow("Opacity %", 0, 100, fx.Opacity*100, v => fx.Opacity=v/100f, "Layer opacity");
        if (controls.Contains("Sensitivity")) SliderRow("Sensitivity", 0, 2, fx.Sensitivity, v => fx.Sensitivity=v, "Audio gain into the effect");
        if (controls.Contains("Threshold")) SliderRow("Threshold", 0, 1, fx.Threshold, v => fx.Threshold=v, "Audio must exceed this before the effect rises");
        if (controls.Contains("Attack")) SliderRow("Attack s", 0, 1, fx.Attack, v => fx.Attack=v, "Rise time");
        if (controls.Contains("Release")) SliderRow("Release s", 0, 2, fx.Release, v => fx.Release=v, "Fall time");
        if (controls.Contains("Speed")) SliderRow("Speed x", 0.1f, 4, fx.Speed, v => fx.Speed=v, "Animation speed");
        if (controls.Contains("ScaleAmount")) SliderRow("Scale", 0, 2, fx.ScaleAmount, v => fx.ScaleAmount=v, "Size / expansion amount");
        if (controls.Contains("Spread")) SliderRow("Spread", 0, 2, fx.Spread, v => fx.Spread=v, "How far the effect reaches");
        if (controls.Contains("Falloff")) SliderRow("Falloff", 0, 2, fx.Falloff, v => fx.Falloff=v, "Edge fade");
        if (controls.Contains("Softness")) SliderRow("Softness", 0, 2, fx.Softness, v => fx.Softness=v, "Edge softness");
        if (controls.Contains("AudioInfluence")) SliderRow("Audio Influence %", 0, 100, fx.AudioInfluence*100, v => fx.AudioInfluence=v/100f, "0% manual, 100% fully audio-driven");
        if (controls.Contains("Radius")) SliderRow("Radius px", 4, 400, fx.Radius, v => fx.Radius=v, "Effect radius");
        if (controls.Contains("Thickness")) SliderRow("Thickness", 1, 40, fx.Thickness, v => fx.Thickness=v, "Ring or stroke thickness");
        if (controls.Contains("Frequency")) SliderRow("Frequency Hz", 0.5f, 8, fx.Frequency, v => fx.Frequency=v, "Safety-capped strobe/flash rate");
        if (controls.Contains("DutyCycle")) SliderRow("Duty Cycle", 0.05f, 0.9f, fx.DutyCycle, v => fx.DutyCycle=v, "On-time fraction");
        if (controls.Contains("Count")) SliderRow("Count", 1, 40, fx.Count, v => fx.Count=v, "Rays, echoes, or particles");
        if (controls.Contains("Lifetime")) SliderRow("Lifetime s", 0.1f, 3, fx.Lifetime, v => fx.Lifetime=v, "Particle lifetime");
        if (controls.Contains("Angle")) SliderRow("Angle deg", 0, 360, fx.Angle, v => fx.Angle=v, "Direction");
        if (controls.Contains("Distortion")) SliderRow("Distortion", 0, 2, fx.Distortion, v => fx.Distortion=v, "Warp amount");
        if (controls.Contains("Turbulence")) SliderRow("Turbulence", 0, 2, fx.Turbulence, v => fx.Turbulence=v, "Noise / chaos");
        if (controls.Contains("MinOut")) SliderRow("Min Output", 0, 1, fx.MinOut, v => fx.MinOut=v, "Lower brightness clamp");
        if (controls.Contains("MaxOut")) SliderRow("Max Output", 0, 2, fx.MaxOut, v => fx.MaxOut=v, "Upper brightness clamp");
        if (controls.Contains("HoldTime")) SliderRow("Hold s", 0, 2, fx.HoldTime, v => fx.HoldTime=v, "Hold duration");
        if (controls.Contains("FadeTime")) SliderRow("Fade s", 0, 3, fx.FadeTime, v => fx.FadeTime=v, "Fade duration");
        if (controls.Contains("Density")) SliderRow("Density", 0, 2, fx.Density, v => fx.Density=v, "Particle or drop density");
        if (controls.Contains("WidthAmt")) SliderRow("Width", 0.05f, 2, fx.WidthAmt, v => fx.WidthAmt=v, "Width / thickness scale");
        if (controls.Contains("HeightAmt")) SliderRow("Height", 0.05f, 2, fx.HeightAmt, v => fx.HeightAmt=v, "Height / length scale");
        if (controls.Contains("Randomness")) SliderRow("Randomness", 0, 1, fx.Randomness, v => fx.Randomness=v, "Organic variation");
        var reset = new Button { Content = "Reset Effect" };
        reset.Click += (_, _) =>
        {
            var kind = fx.Kind; var id = fx.Id;
            var fresh = new EffectInstance { Kind = kind, Id = id };
            var i = _selected!.Effects.Items.FindIndex(e => e.Id == id);
            if (i >= 0) _selected.Effects.Items[i] = fresh;
            _editFx = fresh; BuildInspector();
        };
        var rnd = new Button { Content = "Randomize" };
        rnd.Click += (_, _) =>
        {
            fx.Speed = 0.4f + HashF(fx.Seed+1)*2f;
            fx.Spread = HashF(fx.Seed+2);
            fx.Randomness = HashF(fx.Seed+3);
            fx.PrimaryColor = 0xFF000000 | (uint)(HashF(fx.Seed+4)*0xFFFFFF);
            BuildInspector();
        };
        EffectInspector.Children.Add(reset);
        EffectInspector.Children.Add(rnd);
    }

    private static float HashF(int s) { unchecked { var x = (uint)(s * 747796405); return (x & 0xFFFF) / 65535f; } }

    private void OnMasterChanged(object sender, Microsoft.UI.Xaml.Controls.Primitives.RangeBaseValueChangedEventArgs e)
    {
        _scene.MasterIntensity = (float)(MasterInt?.Value ?? 100) / 100f;
        _scene.MasterBrightness = (float)(MasterBri?.Value ?? 100) / 100f;
        _scene.MasterSensitivity = (float)(MasterSens?.Value ?? 100) / 100f;
        if (MasterLabels is not null)
            MasterLabels.Text = $"Intensity {_scene.MasterIntensity:0.00}  Bright {_scene.MasterBrightness:0.00}  Sens {_scene.MasterSensitivity:0.00}";
    }

    private async void OnEffectStatus(object sender, RoutedEventArgs e)
    {
        var lines = string.Join("\n", EffectValidator.Report().Select(r => $"{r.Kind}: {r.Status}"));
        var dlg = new ContentDialog
        {
            Title = "Effect Library Status",
            Content = new ScrollViewer { Content = new TextBlock { Text = lines, FontFamily = new FontFamily("Consolas"), FontSize = 12 }, Height = 420 },
            CloseButtonText = "Close",
            XamlRoot = Root.XamlRoot
        };
        await dlg.ShowAsync();
    }

    private void RedrawOverlay()
    {
        Overlay.Children.Clear();
        if (!_scene.ShowOverlays) return;
        var aw = (float)Preview.ActualWidth; var ah = (float)Preview.ActualHeight;
        if (aw < 1 || ah < 1) return;
        var (sw, sh) = PreviewSourceSize();
        (float x, float y) Map(float sx, float sy) =>
            CanvasSpace.SceneToPointer(sx, sy, aw, ah, _scene.CanvasWidth, _scene.CanvasHeight, sw, sh);
        foreach (var r in _scene.Regions)
        {
            if (!r.ShowEditorMarker) continue;
            var brush = new SolidColorBrush(Microsoft.UI.Colors.Gold);
            if (r.Kind == RegionKind.Emitter)
            {
                var (cx, cy) = Map(r.X, r.Y);
                var (rx, _) = Map(r.X + r.Radius, r.Y);
                var rad = Math.Max(4, Math.Abs(rx - cx));
                Overlay.Children.Add(new Ellipse { Width = rad * 2, Height = rad * 2, Stroke = brush, StrokeThickness = 2 });
                Canvas.SetLeft(Overlay.Children[^1], cx - rad);
                Canvas.SetTop(Overlay.Children[^1], cy - rad);
            }
            else if (r.Kind == RegionKind.Trace && r.Points.Count >= 4)
            {
                var poly = new Polygon { Stroke = brush, StrokeThickness = 2, Fill = new SolidColorBrush(Windows.UI.Color.FromArgb(40, 212, 175, 55)) };
                var pts = new PointCollection();
                for (var i = 0; i + 1 < r.Points.Count; i += 2)
                {
                    var (px, py) = Map(r.Points[i], r.Points[i + 1]);
                    pts.Add(new Windows.Foundation.Point(px, py));
                }
                poly.Points = pts;
                Overlay.Children.Add(poly);
            }
            else
            {
                var box = CanvasSpace.SceneRectToPointer(r.X, r.Y, r.Width, r.Height, aw, ah, _scene.CanvasWidth, _scene.CanvasHeight, sw, sh);
                Overlay.Children.Add(new Rectangle { Width = Math.Max(4, box.W), Height = Math.Max(4, box.H), Stroke = brush, StrokeThickness = 2 });
                Canvas.SetLeft(Overlay.Children[^1], box.X);
                Canvas.SetTop(Overlay.Children[^1], box.Y);
            }
        }
    }
    private async Task InitWebAudioAsync()
    {
        try
        {
            _webAudio = new WebAudioHost(_audio);
            _webAudio.Changed += () =>
            {
                DispatcherQueue.TryEnqueue(() =>
                {
                    if (WebAudioStatus is not null)
                        WebAudioStatus.Text = "WEB AUDIO  " + _webAudio.Status + "  " + _webAudio.Detail;
                });
            };
            if (WebAudioView is not null)
                await _webAudio.AttachAsync(WebAudioView);
        }
        catch (Exception ex)
        {
            if (WebAudioStatus is not null)
                WebAudioStatus.Text = "WEB AUDIO ERROR  " + ex.Message;
        }
    }
    private void LogWebViewLayout()
    {
        if (WebAudioView is null) return;
        var msg = $"[WebView] {WebAudioView.ActualWidth:0}x{WebAudioView.ActualHeight:0} vis={WebAudioView.Visibility} opacity={WebAudioView.Opacity} hit={WebAudioView.IsHitTestVisible}";
        try
        {
            var dir = System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Auralith", "Logs");
            Directory.CreateDirectory(dir);
            File.AppendAllText(System.IO.Path.Combine(dir, "web-audio.log"), DateTime.Now.ToString("o") + " " + msg + Environment.NewLine);
        }
        catch { }
        if (WebAudioStatus is not null && _webAudio is not null)
            WebAudioStatus.Text = "WEB AUDIO  " + _webAudio.Status + "  " + msg;
    }
    private async void OnWebChoose(object s, RoutedEventArgs e)
    {
        if (_webAudio is null) { if (WebAudioStatus is not null) WebAudioStatus.Text = "WEB AUDIO ERROR  host not ready"; return; }
        if (WebAudioPanel is not null) WebAudioPanel.Visibility = Visibility.Visible;
        if (WebAudioView is not null)
        {
            WebAudioView.Visibility = Visibility.Visible;
            WebAudioView.Opacity = 1;
            WebAudioView.IsHitTestVisible = true;
            WebAudioView.Width = 420;
            WebAudioView.Height = 180;
            LogWebViewLayout();
            WebAudioView.Focus(FocusState.Programmatic);
        }
        await _webAudio.RevealPanelAsync();

    }
    private async void OnWebStop(object s, RoutedEventArgs e)
    {
        if (_webAudio is not null) await _webAudio.StopAsync();
    }
    private void OnEngineChanged(object s, SelectionChangedEventArgs e)
    {
        var web = (EngineBox.SelectedItem as ComboBoxItem)?.Tag?.ToString() == "Web";
        void Set(FrameworkElement? el, bool show) { if (el is not null) el.Visibility = show ? Visibility.Visible : Visibility.Collapsed; }
        Set(WebSourceButton, web);
        Set(WebStopButton, web);
        Set(WebAudioPanel, web);
        Set(WebAudioView, web);
        Set(WebAudioStatus, web);
        Set(CaptureModeBox, !web);
        Set(DeviceBox, !web);
        Set(AppBox, !web);
        Set(IncludeTreeCheck, !web);
        Set(RefreshAppsButton, !web);
        Set(StartAudioButton, !web);
        if (!web) _ = _webAudio?.StopAsync();
        else LogWebViewLayout();
    }
    private void OnStartAudio(object s, RoutedEventArgs e)
    {
        if ((EngineBox.SelectedItem as ComboBoxItem)?.Tag?.ToString() == "Web")
        {
            OnWebChoose(s, e);
            return;
        }
        _audio.Logged += line => StartupLog.Write(line);
        var mode = (CaptureModeBox.SelectedItem as ComboBoxItem)?.Tag?.ToString();
        if (mode == "Microphone") _audio.StartMicrophone();
        else if (mode == "Application")
        {
            if (AppBox.SelectedItem is ComboBoxItem app && app.Tag is AudioAppSession sess)
                _audio.StartApplication(sess.Pid, sess.EndpointId, IncludeTreeCheck.IsChecked == true);
            else
            {
                AudioStatus.Text = "Choose an application first.";
                return;
            }
        }
        else
        {
            string? id = (DeviceBox.SelectedItem as ComboBoxItem)?.Tag as string;
            _audio.StartLoopback(id);
        }
        AudioStatus.Text = _audio.Status;
    }
    private void OnDeviceChanged(object s, SelectionChangedEventArgs e) { }
    private void OnCaptureModeChanged(object s, SelectionChangedEventArgs e)
    {
        if (AppBox is null || DeviceBox is null) return;
        var mode = (CaptureModeBox.SelectedItem as ComboBoxItem)?.Tag?.ToString();
        AppBox.Visibility = mode == "Application" ? Visibility.Visible : Visibility.Collapsed;
        DeviceBox.Visibility = mode == "DesktopOutput" ? Visibility.Visible : Visibility.Collapsed;
        if (mode == "Application") OnRefreshApps(s, e);
    }
    private void OnRefreshApps(object s, RoutedEventArgs e)
    {
        AppBox.Items.Clear();
        foreach (var sess in AudioSessions.List())
            AppBox.Items.Add(new ComboBoxItem { Content = sess.Display + (sess.Active ? " (active)" : ""), Tag = sess });
        if (AppBox.Items.Count > 0) AppBox.SelectedIndex = 0;
        else AppBox.Items.Add(new ComboBoxItem { Content = "No audio sessions found" });
    }
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
            Microsoft.UI.Windowing.AppWindow.GetFromWindowId(
                Microsoft.UI.Win32Interop.GetWindowIdFromWindow(WindowNative.GetWindowHandle(this))
            ).SetIcon(ico);
        }
        catch (Exception ex) { StartupLog.Write("icon " + ex.Message); }
    }

    private static string Bar(float v)
    {
        var n = (int)Math.Clamp(v * 14, 0, 14);
        return new string('█', n) + new string('░', 14 - n);
    }
}
