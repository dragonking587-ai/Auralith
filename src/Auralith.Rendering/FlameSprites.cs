using Auralith.Core;
using SkiaSharp;

namespace Auralith.Rendering;

/// <summary>Composites two matching Blender renders, with black keyed out by Screen blending.</summary>
internal static class FlameSprites
{
    private const int Columns = 6;
    private const int FrameWidth = 320;
    private const int FrameHeight = 448;
    private const int OverlapFrames = 6;
    private const int LoopFrames = 30;
    private static readonly Lazy<SKImage> Calm = new(() => Load("calm"));
    private static readonly Lazy<SKImage> Flare = new(() => Load("flare"));

    public static void Draw(SKCanvas canvas, SKRect bounds, EffectInstance effect, float flare,
        float treble, float strength, float particleDensity, float time)
    {
        if (strength <= 0.001f || bounds.Width < 2f || bounds.Height < 2f) return;

        var width = bounds.Width * Math.Clamp(0.65f + effect.WidthAmt * 0.9f, 0.35f, 1.6f);
        var height = bounds.Height * Math.Clamp(0.62f + effect.HeightAmt * 0.8f, 0.35f, 1.65f);
        var baseY = bounds.Bottom;
        var dest = new SKRect(bounds.MidX - width / 2, baseY - height * 0.9f,
            bounds.MidX + width / 2, baseY + height * 0.1f);
        var clock = time + (uint)effect.Id.GetHashCode() % 1000 / 1000f;
        var frame = (int)(clock * 30f % LoopFrames) + OverlapFrames;

        DrawSpill(canvas, bounds.MidX, baseY, width, effect.PrimaryColor, strength, flare, clock);
        using var paint = new SKPaint { BlendMode = SKBlendMode.Screen };
        DrawLoop(canvas, Calm, frame, dest, paint, strength * (1f - flare));
        DrawLoop(canvas, Flare, frame, dest, paint, strength * flare);
        DrawSparks(canvas, paint, effect, bounds.MidX, baseY, width, height, treble, strength, particleDensity, clock);
    }

    private static SKImage Load(string name)
    {
        using var stream = typeof(FlameSprites).Assembly.GetManifestResourceStream($"Auralith.Flame.{name}.webp")
            ?? throw new InvalidOperationException($"Missing embedded {name} flame frames.");
        using var bitmap = SKBitmap.Decode(stream)
            ?? throw new InvalidOperationException($"Invalid embedded {name} flame frames.");
        return SKImage.FromBitmap(bitmap);
    }

    private static void DrawLoop(SKCanvas canvas, Lazy<SKImage> atlas, int frame, SKRect dest, SKPaint paint, float opacity)
    {
        if (opacity <= 0.001f) return;
        var blend = Math.Clamp((frame - LoopFrames + 1) / (float)OverlapFrames, 0f, 1f);
        DrawFrame(canvas, atlas.Value, frame, dest, paint, opacity * (1f - blend));
        if (blend > 0f)
            DrawFrame(canvas, atlas.Value, frame - LoopFrames, dest, paint, opacity * blend);
    }

    private static void DrawFrame(SKCanvas canvas, SKImage atlas, int frame, SKRect dest, SKPaint paint, float opacity)
    {
        if (opacity <= 0.001f) return;
        var x = frame % Columns * FrameWidth;
        var y = frame / Columns * FrameHeight;
        // Keep bilinear sampling inside the selected cell.
        var source = new SKRect(x + 0.5f, y + 0.5f, x + FrameWidth - 0.5f, y + FrameHeight - 0.5f);
        paint.Color = SKColors.White.WithAlpha((byte)(Math.Clamp(opacity, 0f, 1f) * 255));
        canvas.DrawImage(atlas, source, dest, new SKSamplingOptions(SKFilterMode.Linear), paint);
    }

    private static void DrawSpill(SKCanvas canvas, float x, float y, float width, uint color, float strength, float flare, float time)
    {
        var center = new SKPoint(x, y);
        var radius = width * (0.56f + flare * 0.23f);
        var flicker = 0.86f + 0.14f * MathF.Sin(time * 17f);
        var alpha = (byte)(Math.Clamp(strength * flicker * (0.16f + flare * 0.25f), 0f, 1f) * 255);
        var warm = new SKColor(255, (byte)(55 + ((color >> 8) & 255) * 0.35f), (byte)(10 + (color & 255) * 0.13f), alpha);
        using var shader = SKShader.CreateRadialGradient(center, radius,
            [warm, warm.WithAlpha((byte)(alpha * 0.36f)), warm.WithAlpha(0)], [0f, 0.42f, 1f], SKShaderTileMode.Clamp);
        using var paint = new SKPaint { Shader = shader, BlendMode = SKBlendMode.Screen };
        canvas.Save();
        canvas.Scale(1f, 0.48f, x, y);
        canvas.DrawCircle(center, radius, paint);
        canvas.Restore();
    }

    private static void DrawSparks(SKCanvas canvas, SKPaint paint, EffectInstance effect,
        float x, float y, float width, float height, float treble, float strength, float density, float time)
    {
        var max = effect.Quality switch { QualityLevel.Low => 8, QualityLevel.High => 24, _ => 15 };
        var count = Math.Clamp((int)MathF.Round(max * treble * density), 0, max);
        paint.IsAntialias = true;
        for (var i = 0; i < count; i++)
        {
            var phase = time * (0.75f + i * 0.073f) + i * 0.618f + effect.Seed * 0.031f;
            var age = phase - MathF.Floor(phase);
            var drift = MathF.Sin(i * 31.7f) * (0.09f + Math.Clamp(effect.Turbulence, 0f, 1f) * 0.22f);
            var sx = x + width * (0.09f * MathF.Sin(i * 4.7f) + drift * age);
            var sy = y - height * age * (0.64f + treble * 0.28f);
            var alpha = Math.Clamp(strength * MathF.Sin(MathF.PI * age) * (0.45f + treble * 0.5f), 0f, 1f);
            paint.Color = new SKColor(255, (byte)(170 - age * 106), 36, (byte)(alpha * 255));
            canvas.DrawOval(sx, sy, Math.Clamp(width * 0.006f, 0.7f, 3f), Math.Clamp(height * 0.009f, 0.9f, 5f), paint);
        }
    }
}
