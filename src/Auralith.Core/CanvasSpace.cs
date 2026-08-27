namespace Auralith.Core;

/// <summary>
/// Authoritative editor coordinates. Geometry is stored in SCENE pixels
/// (Scene.CanvasWidth x CanvasHeight, default 1920x1080).
/// WinUI pointer positions are DIPs; do not apply DPI a second time.
/// Image Stretch=Uniform content rectangle is the viewport.
/// </summary>
public static class CanvasSpace
{
    public readonly record struct Rect(float X, float Y, float W, float H);

    /// <summary>Displayed Uniform/Fit rectangle of a source inside a control.</summary>
    public static Rect UniformContent(float controlW, float controlH, float sourceW, float sourceH)
    {
        if (controlW <= 0 || controlH <= 0 || sourceW <= 0 || sourceH <= 0)
            return new Rect(0, 0, Math.Max(0, controlW), Math.Max(0, controlH));
        var cr = controlW / controlH;
        var sr = sourceW / sourceH;
        if (sr > cr)
        {
            var h = controlW / sr;
            return new Rect(0, (controlH - h) / 2f, controlW, h);
        }
        var w = controlH * sr;
        return new Rect((controlW - w) / 2f, 0, w, controlH);
    }

    public static (float x, float y) PointerToScene(
        float pointerX, float pointerY,
        float controlW, float controlH,
        int sceneW, int sceneH,
        float sourceW, float sourceH)
    {
        var v = UniformContent(controlW, controlH, sourceW, sourceH);
        if (v.W < 1 || v.H < 1) return (0, 0);
        var x = (pointerX - v.X) / v.W * sceneW;
        var y = (pointerY - v.Y) / v.H * sceneH;
        return (x, y);
    }

    public static (float x, float y) SceneToPointer(
        float sceneX, float sceneY,
        float controlW, float controlH,
        int sceneW, int sceneH,
        float sourceW, float sourceH)
    {
        var v = UniformContent(controlW, controlH, sourceW, sourceH);
        if (sceneW < 1 || sceneH < 1) return (v.X, v.Y);
        return (v.X + sceneX / sceneW * v.W, v.Y + sceneY / sceneH * v.H);
    }

    public static Rect SceneRectToPointer(
        float sceneX, float sceneY, float sceneW, float sceneH,
        float controlW, float controlH, int canvasW, int canvasH, float sourceW, float sourceH)
    {
        var (x0, y0) = SceneToPointer(sceneX, sceneY, controlW, controlH, canvasW, canvasH, sourceW, sourceH);
        var (x1, y1) = SceneToPointer(sceneX + sceneW, sceneY + sceneH, controlW, controlH, canvasW, canvasH, sourceW, sourceH);
        return new Rect(x0, y0, x1 - x0, y1 - y0);
    }
}

public enum AudioCaptureMode { DesktopOutput, Application, Microphone }
