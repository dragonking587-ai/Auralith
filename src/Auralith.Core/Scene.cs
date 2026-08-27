namespace Auralith.Core;

public sealed class Region
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public RegionKind Kind { get; set; }
    public string Name { get; set; } = "";
    public bool ShowEditorMarker { get; set; } = true;
    public float X { get; set; }
    public float Y { get; set; }
    public float Width { get; set; } = 120;
    public float Height { get; set; } = 120;
    public float Rotation { get; set; }
    public EffectStack Effects { get; set; } = new();
}

public sealed class Scene
{
    public int SchemaVersion { get; set; } = 1;
    public int CanvasWidth { get; set; } = 1920;
    public int CanvasHeight { get; set; } = 1080;
    public int TargetFps { get; set; } = 30;
    public FitMode Fit { get; set; } = FitMode.Fit;
    public string? BackdropPath { get; set; }
    public bool ShowEditorOverlays { get; set; } = true;
    public ViewMode View { get; set; } = ViewMode.Edit;
    public float MasterIntensity { get; set; } = 1f;
    public float MasterSensitivity { get; set; } = 1f;
    public float MasterBrightness { get; set; } = 1f;
    public float MasterParticleDensity { get; set; } = 1f;
    public float MasterMotionSpeed { get; set; } = 1f;
    public List<Region> Regions { get; set; } = new();

    public bool ShowOverlays => View == ViewMode.Edit && ShowEditorOverlays;
    public bool ShowChrome => View != ViewMode.CleanCapture;
}

public static class FitMath
{
    public static (float x, float y, float w, float h) Dest(
        FitMode mode, int imageW, int imageH, int canvasW, int canvasH)
    {
        if (imageW <= 0 || imageH <= 0) return (0, 0, canvasW, canvasH);
        var ir = imageW / (float)imageH;
        var cr = canvasW / (float)canvasH;
        switch (mode)
        {
            case FitMode.Stretch:
                return (0, 0, canvasW, canvasH);
            case FitMode.Center:
                return ((canvasW - imageW) / 2f, (canvasH - imageH) / 2f, imageW, imageH);
            case FitMode.Fill:
                if (ir > cr)
                {
                    var w = canvasH * ir;
                    return ((canvasW - w) / 2f, 0, w, canvasH);
                }
                else
                {
                    var h = canvasW / ir;
                    return (0, (canvasH - h) / 2f, canvasW, h);
                }
            default: // Fit
                if (ir > cr)
                {
                    var h = canvasW / ir;
                    return (0, (canvasH - h) / 2f, canvasW, h);
                }
                else
                {
                    var w = canvasH * ir;
                    return ((canvasW - w) / 2f, 0, w, canvasH);
                }
        }
    }
}
