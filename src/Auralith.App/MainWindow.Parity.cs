using Auralith.Core;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media.Imaging;
using Windows.Graphics.Imaging;
using Windows.Storage;
using Windows.Storage.Pickers;
using Windows.Storage.Streams;
using WinRT.Interop;
using System.Runtime.InteropServices.WindowsRuntime;

namespace Auralith.App;

public sealed partial class MainWindow
{
    private bool _parityDragging;
    private Region? _parityDragRegion;
    private Windows.Foundation.Point _parityDragStart;
    private float _parityDragX;
    private float _parityDragY;
    private List<float>? _parityDragPoints;

    private async void OnLoadImagePortable(object sender, RoutedEventArgs e)
    {
        try
        {
            var picker = new FileOpenPicker
            {
                SuggestedStartLocation = PickerLocationId.PicturesLibrary,
                ViewMode = PickerViewMode.Thumbnail
            };
            foreach (var ext in new[] { ".png", ".jpg", ".jpeg", ".bmp", ".webp" })
                picker.FileTypeFilter.Add(ext);
            InitializeWithWindow.Initialize(picker, WindowNative.GetWindowHandle(this));
            var file = await picker.PickSingleFileAsync();
            if (file is null) return;

            await LoadBackdropFromFileAsync(file);
            _scene.BackdropPath = file.Path;
            _scene.BackdropDataUrl = await ReadImageAsDataUrlAsync(file);
            Hud.Text = _scene.BackdropDataUrl is null
                ? $"Loaded {file.Name}. Image is too large to embed; keep the original file available."
                : $"Loaded {file.Name}. Backdrop is embedded in the project when saved.";
        }
        catch (Exception ex)
        {
            StartupLog.Error(ex);
            Hud.Text = "Unable to load selected image. " + ex.Message;
        }
    }

    private void OnClearImagePortable(object sender, RoutedEventArgs e)
    {
        OnClearImage(sender, e);
        _scene.BackdropDataUrl = null;
    }

    private async void OnSaveProjectPortable(object sender, RoutedEventArgs e)
    {
        try
        {
            var picker = new FileSavePicker { SuggestedFileName = "Auralith Project" };
            picker.FileTypeChoices.Add("Auralith Project", new List<string> { ".auralith" });
            InitializeWithWindow.Initialize(picker, WindowNative.GetWindowHandle(this));
            var file = await picker.PickSaveFileAsync();
            if (file is null) return;
            await FileIO.WriteTextAsync(file, SceneProjectCodec.Serialize(_scene));
            Hud.Text = $"Project saved: {file.Name}";
        }
        catch (Exception ex)
        {
            StartupLog.Error(ex);
            Hud.Text = "Project save failed. " + ex.Message;
        }
    }

    private async void OnOpenProjectPortable(object sender, RoutedEventArgs e)
    {
        try
        {
            var picker = new FileOpenPicker();
            picker.FileTypeFilter.Add(".auralith");
            InitializeWithWindow.Initialize(picker, WindowNative.GetWindowHandle(this));
            var file = await picker.PickSingleFileAsync();
            if (file is null) return;

            var result = SceneProjectCodec.Deserialize(await FileIO.ReadTextAsync(file));
            ApplyLoadedScene(result.Scene);
            await RestoreBackdropAsync();
            SyncUiFromScene();

            _selected = null;
            _draft = null;
            _editFx = null;
            _undo.Clear();
            _redo.Clear();
            SetView(ViewMode.Edit);
            RefreshSel();

            Hud.Text = result.Warnings.Count == 0
                ? $"Project opened: {file.Name}"
                : $"Project opened with migration notes: {string.Join(" | ", result.Warnings.Distinct())}";
        }
        catch (Exception ex)
        {
            StartupLog.Error(ex);
            Hud.Text = "Project open failed. " + ex.Message;
        }
    }

    private void ApplyLoadedScene(Scene loaded)
    {
        _scene.SchemaVersion = loaded.SchemaVersion;
        _scene.CanvasWidth = loaded.CanvasWidth;
        _scene.CanvasHeight = loaded.CanvasHeight;
        _scene.TargetFps = loaded.TargetFps;
        _scene.Fit = loaded.Fit;
        _scene.BackdropPath = loaded.BackdropPath;
        _scene.BackdropDataUrl = loaded.BackdropDataUrl;
        _scene.ShowEditorOverlays = loaded.ShowEditorOverlays;
        _scene.MasterIntensity = loaded.MasterIntensity;
        _scene.MasterBrightness = loaded.MasterBrightness;
        _scene.MasterSensitivity = loaded.MasterSensitivity;
        _scene.MasterParticleDensity = loaded.MasterParticleDensity;
        _scene.MasterMotionSpeed = loaded.MasterMotionSpeed;
        _scene.Regions = loaded.Regions;
        _scene.View = ViewMode.Edit;
        _gpu.SetFit(_scene.Fit);
    }

    private async Task RestoreBackdropAsync()
    {
        var embedded = SceneProjectCodec.DecodeBackdropDataUrl(_scene.BackdropDataUrl);
        if (embedded is { Length: > 0 })
        {
            await LoadBackdropBytesAsync(embedded);
            return;
        }

        if (!string.IsNullOrWhiteSpace(_scene.BackdropPath) && File.Exists(_scene.BackdropPath))
        {
            var path = _scene.BackdropPath;
            var file = await StorageFile.GetFileFromPathAsync(path);
            await LoadBackdropFromFileAsync(file);
            _scene.BackdropPath = path;
            _scene.BackdropDataUrl = await ReadImageAsDataUrlAsync(file);
            return;
        }

        _gpu.ClearBackdrop();
        Preview.Source = null;
        _holdDecodedPreview = false;
    }

    private async Task LoadBackdropBytesAsync(byte[] compressed)
    {
        using var mem = new InMemoryRandomAccessStream();
        await mem.WriteAsync(compressed.AsBuffer());
        mem.Seek(0);
        var decoder = await BitmapDecoder.CreateAsync(mem);
        var w = checked((int)decoder.PixelWidth);
        var h = checked((int)decoder.PixelHeight);
        if (w <= 0 || h <= 0 || w > 16384 || h > 16384)
            throw new InvalidDataException("Embedded backdrop dimensions are invalid.");

        var pixels = await decoder.GetPixelDataAsync(
            BitmapPixelFormat.Bgra8,
            BitmapAlphaMode.Straight,
            new BitmapTransform(),
            ExifOrientationMode.RespectExifOrientation,
            ColorManagementMode.DoNotColorManage);
        var data = pixels.DetachPixelData();
        if (data.Length < w * h * 4)
            throw new InvalidDataException("Embedded backdrop pixel data is incomplete.");
        for (var i = 3; i < data.Length; i += 4) data[i] = 255;

        _gpu.SetBackdrop(data, w, h);
        var bitmap = SoftwareBitmap.CreateCopyFromBuffer(
            data.AsBuffer(), BitmapPixelFormat.Bgra8, w, h, BitmapAlphaMode.Ignore);
        var source = new SoftwareBitmapSource();
        await source.SetBitmapAsync(bitmap);
        Preview.Source = source;
        _holdDecodedPreview = false;
        _imageDiag = $"Embedded backdrop restored {w}x{h}";
    }

    private static async Task<string?> ReadImageAsDataUrlAsync(StorageFile file)
    {
        var props = await file.GetBasicPropertiesAsync();
        if (props.Size == 0 || props.Size > 64UL * 1024 * 1024) return null;
        var buffer = await FileIO.ReadBufferAsync(file);
        var bytes = buffer.ToArray();
        var mime = file.FileType.ToLowerInvariant() switch
        {
            ".jpg" or ".jpeg" => "image/jpeg",
            ".bmp" => "image/bmp",
            ".webp" => "image/webp",
            _ => "image/png"
        };
        return $"data:{mime};base64,{Convert.ToBase64String(bytes)}";
    }

    private void SyncUiFromScene()
    {
        FitBox.SelectedIndex = _scene.Fit switch
        {
            FitMode.Fill => 1,
            FitMode.Stretch => 2,
            FitMode.Center => 3,
            _ => 0
        };
        OverlayCheck.IsChecked = _scene.ShowEditorOverlays;
        MasterInt.Value = Math.Clamp(_scene.MasterIntensity * 100f, 0f, 200f);
        MasterBri.Value = Math.Clamp(_scene.MasterBrightness * 100f, 0f, 200f);
        MasterSens.Value = Math.Clamp(_scene.MasterSensitivity * 100f, 0f, 200f);
    }

    private async void OnAdvancedEffectControls(object sender, RoutedEventArgs e)
    {
        if (_editFx is null)
        {
            Hud.Text = "Select an effect and choose Edit first.";
            return;
        }

        var fx = _editFx;
        var intensity = new Slider { Minimum = 0, Maximum = 400, Value = fx.Intensity * 100, Width = 360 };
        var brightness = new Slider { Minimum = 0, Maximum = 400, Value = fx.Brightness * 100, Width = 360 };
        var primary = new ColorPicker { Color = ToUiColor(fx.PrimaryColor) };
        var secondary = new ColorPicker { Color = ToUiColor(fx.SecondaryColor) };
        var quality = new ComboBox { Width = 180 };
        foreach (var qualityLevel in Enum.GetValues<QualityLevel>())
            quality.Items.Add(new ComboBoxItem { Content = qualityLevel.ToString(), Tag = qualityLevel, IsSelected = qualityLevel == fx.Quality });

        var panel = new StackPanel { Spacing = 6 };
        panel.Children.Add(new TextBlock { Text = "Intensity %" });
        panel.Children.Add(intensity);
        panel.Children.Add(new TextBlock { Text = "Brightness %" });
        panel.Children.Add(brightness);
        panel.Children.Add(new TextBlock { Text = "Primary color" });
        panel.Children.Add(primary);
        panel.Children.Add(new TextBlock { Text = "Secondary color" });
        panel.Children.Add(secondary);
        panel.Children.Add(new TextBlock { Text = "Render quality" });
        panel.Children.Add(quality);

        var dlg = new ContentDialog
        {
            Title = fx.Kind + " — effect controls",
            Content = new ScrollViewer { Content = panel, MaxHeight = 560 },
            PrimaryButtonText = "Apply",
            CloseButtonText = "Cancel",
            XamlRoot = Root.XamlRoot
        };
        if (await dlg.ShowAsync() != ContentDialogResult.Primary) return;

        PushUndo();
        fx.Intensity = (float)intensity.Value / 100f;
        fx.Brightness = (float)brightness.Value / 100f;
        fx.PrimaryColor = FromUiColor(primary.Color);
        fx.SecondaryColor = FromUiColor(secondary.Color);
        if (quality.SelectedItem is ComboBoxItem item && item.Tag is QualityLevel selectedQuality) fx.Quality = selectedQuality;
        BuildInspector();
    }

    private static Windows.UI.Color ToUiColor(uint argb)
        => Windows.UI.Color.FromArgb(
            (byte)(argb >> 24),
            (byte)(argb >> 16),
            (byte)(argb >> 8),
            (byte)argb);

    private static uint FromUiColor(Windows.UI.Color c)
        => ((uint)c.A << 24) | ((uint)c.R << 16) | ((uint)c.G << 8) | c.B;

    private void OnOverlayPressedParity(object sender, PointerRoutedEventArgs e)
    {
        if (_tool != "select")
        {
            OnOverlayPressed(sender, e);
            return;
        }
        if (!_scene.ShowOverlays) return;

        var p = ToCanvas(e);
        _selected = HitRegionParity((float)p.X, (float)p.Y);
        RefreshSel();
        if (_selected is null || _selected.Locked) return;

        PushUndo();
        _parityDragging = true;
        _parityDragRegion = _selected;
        _parityDragStart = p;
        _parityDragX = _selected.X;
        _parityDragY = _selected.Y;
        _parityDragPoints = _selected.Points.ToList();
        Overlay.CapturePointer(e.Pointer);
        e.Handled = true;
    }

    private void OnOverlayMovedParity(object sender, PointerRoutedEventArgs e)
    {
        if (_tool != "select")
        {
            OnOverlayMoved(sender, e);
            return;
        }
        if (!_parityDragging || _parityDragRegion is null) return;

        var p = ToCanvas(e);
        var dx = (float)(p.X - _parityDragStart.X);
        var dy = (float)(p.Y - _parityDragStart.Y);
        _parityDragRegion.X = _parityDragX + dx;
        _parityDragRegion.Y = _parityDragY + dy;
        if (_parityDragRegion.Kind == RegionKind.Trace && _parityDragPoints is not null)
        {
            _parityDragRegion.Points.Clear();
            for (var i = 0; i + 1 < _parityDragPoints.Count; i += 2)
            {
                _parityDragRegion.Points.Add(_parityDragPoints[i] + dx);
                _parityDragRegion.Points.Add(_parityDragPoints[i + 1] + dy);
            }
        }
        RedrawOverlay();
        e.Handled = true;
    }

    private void OnOverlayReleasedParity(object sender, PointerRoutedEventArgs e)
    {
        if (_tool != "select")
        {
            OnOverlayReleased(sender, e);
            return;
        }
        if (!_parityDragging) return;
        Overlay.ReleasePointerCaptures();
        _parityDragging = false;
        _parityDragRegion = null;
        _parityDragPoints = null;
        RefreshSel();
        e.Handled = true;
    }

    private Region? HitRegionParity(float x, float y)
    {
        foreach (var r in Enumerable.Reverse(_scene.Regions))
        {
            if (r.Kind == RegionKind.Emitter)
            {
                var dx = x - r.X;
                var dy = y - r.Y;
                if (dx * dx + dy * dy <= r.Radius * r.Radius) return r;
                continue;
            }

            if (r.Kind == RegionKind.Trace && r.Points.Count >= 4)
            {
                var minX = float.PositiveInfinity;
                var minY = float.PositiveInfinity;
                var maxX = float.NegativeInfinity;
                var maxY = float.NegativeInfinity;
                for (var i = 0; i + 1 < r.Points.Count; i += 2)
                {
                    minX = Math.Min(minX, r.Points[i]);
                    minY = Math.Min(minY, r.Points[i + 1]);
                    maxX = Math.Max(maxX, r.Points[i]);
                    maxY = Math.Max(maxY, r.Points[i + 1]);
                }
                const float pad = 14f;
                if (x >= minX - pad && x <= maxX + pad && y >= minY - pad && y <= maxY + pad) return r;
                continue;
            }

            if (x >= r.X && y >= r.Y && x <= r.X + r.Width && y <= r.Y + r.Height) return r;
        }
        return null;
    }
}
