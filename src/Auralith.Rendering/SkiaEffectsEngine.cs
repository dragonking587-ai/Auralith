using System.Buffers;
using System.Numerics;
using Auralith.Core;
using SkiaSharp;

namespace Auralith.Rendering;

/// <summary>
/// Auralith Effects Engine 2. CPU-side simulation and SkiaSharp raster compositing.
/// Direct3D remains the presentation/output transport only.
/// </summary>
public sealed class SkiaEffectsEngine : IDisposable
{
    private readonly Dictionary<Guid, float> _envelopes = new();
    private readonly Dictionary<Guid, ParticleSystemState> _particles = new();
    private readonly Dictionary<Guid, LightningState> _lightning = new();
    private float _lastTime = -1f;
    private int _frame;

    public static bool HasHandler(EffectKind kind) => Enum.IsDefined(kind);

    public unsafe void Apply(
        byte[] pixels,
        int width,
        int height,
        IReadOnlyList<Region> regions,
        AudioBands audio,
        Scene scene,
        float time)
    {
        if (pixels.Length < width * height * 4 || width <= 0 || height <= 0) return;

        var dt = _lastTime < 0 ? 1f / Math.Max(1, scene.TargetFps) : Math.Clamp(time - _lastTime, 1f / 240f, 0.1f);
        _lastTime = time;
        _frame++;

        var liveIds = new HashSet<Guid>();
        var info = new SKImageInfo(width, height, SKColorType.Bgra8888, SKAlphaType.Premul);

        fixed (byte* ptr = pixels)
        {
            using var surface = SKSurface.Create(info, (IntPtr)ptr, width * 4);
            if (surface is null) return;
            var canvas = surface.Canvas;

            foreach (var region in regions)
            {
                using var regionPath = BuildRegionPath(region);
                foreach (var fx in region.Effects.Items)
                {
                    if (!fx.Enabled) continue;
                    liveIds.Add(fx.Id);

                    var drive = Drive(fx, audio, scene.MasterSensitivity, dt);
                    var amount = Math.Clamp(
                        fx.Intensity * fx.Brightness * fx.Opacity * drive *
                        scene.MasterIntensity * scene.MasterBrightness,
                        0f, 4f);

                    if (ApplyPixelEffect(pixels, width, height, region, fx, drive, amount, time))
                    {
                        canvas.Flush();
                        continue;
                    }

                    canvas.Save();
                    canvas.ClipPath(regionPath, SKClipOperation.Intersect, true);
                    DrawEffect(canvas, regionPath, region, fx, drive, amount,
                        scene.MasterParticleDensity, scene.MasterMotionSpeed, time, dt);
                    canvas.Restore();
                }
            }

            canvas.Flush();
        }

        if ((_frame & 127) == 0)
            PruneState(liveIds);
    }

    private float Drive(EffectInstance fx, AudioBands a, float masterSensitivity, float dt)
    {
        var raw = fx.Audio switch
        {
            AudioSource.Bass => a.Bass,
            AudioSource.Low => a.Low,
            AudioSource.Mid => a.Mid,
            AudioSource.High => a.High,
            AudioSource.Beat => a.Beat,
            AudioSource.Transient => a.Transient,
            AudioSource.Manual => 1f,
            _ => a.Full
        };

        if (fx.InvertResponse) raw = 1f - raw;
        raw = Math.Clamp((raw - fx.Threshold) / Math.Max(0.001f, 1f - fx.Threshold), 0f, 1f);
        var target = fx.Audio == AudioSource.Manual
            ? 1f
            : Math.Clamp(raw * fx.Sensitivity * masterSensitivity, 0f, 1f);

        _envelopes.TryGetValue(fx.Id, out var current);
        var tau = target > current ? Math.Max(0.002f, fx.Attack) : Math.Max(0.002f, fx.Release);
        var alpha = 1f - MathF.Exp(-dt / tau);
        current += (target - current) * alpha;
        _envelopes[fx.Id] = current;

        return fx.Audio == AudioSource.Manual
            ? 1f
            : (1f - fx.AudioInfluence) + fx.AudioInfluence * current;
    }

    private bool ApplyPixelEffect(
        byte[] px, int w, int h, Region r, EffectInstance fx,
        float drive, float amount, float time)
    {
        switch (fx.Kind)
        {
            case EffectKind.Pulse:
                ScaleRegion(px, w, h, r, 1f + amount * (0.25f + fx.ScaleAmount * drive));
                return true;
            case EffectKind.Flicker:
            {
                var n = Hash(fx.Seed, (int)(time * (3f + fx.Speed * 14f)));
                var natural = 0.72f + 0.28f * n;
                ScaleRegion(px, w, h, r, 0.65f + amount * natural);
                return true;
            }
            case EffectKind.LightSurge:
                ScaleRegion(px, w, h, r, 1f + amount * MathF.Pow(drive, 0.55f));
                return true;
            case EffectKind.Strobe:
            {
                var hz = Math.Clamp(fx.Frequency, 0.5f, 12f);
                var on = (time * hz) % 1f < fx.DutyCycle;
                ScaleRegion(px, w, h, r, on ? 0.9f + amount : 0.25f);
                return true;
            }
            case EffectKind.ShadowPulse:
            case EffectKind.RoomDim:
            case EffectKind.LocalDim:
                DimOutside(px, w, h, r, Math.Clamp(fx.Intensity * drive, 0f, 0.88f));
                return true;
            case EffectKind.ContrastSurge:
                Contrast(px, w, h, r, amount * 0.65f);
                return true;
            case EffectKind.HueShift:
                HueRotate(px, w, h, r, fx.Angle + time * fx.Speed * 18f * drive);
                return true;
            case EffectKind.BassExpansion:
                ScaleRegion(px, w, h, r, 1f + amount * drive * 0.35f);
                return true;
            case EffectKind.ThunderFlash:
            case EffectKind.BeatFlash:
            case EffectKind.TransientBurst:
                ScaleRegion(px, w, h, r, 1f + amount * MathF.Pow(drive, 0.65f) * 1.6f);
                return true;
            case EffectKind.HeatDistortion:
            case EffectKind.Refraction:
            case EffectKind.HolographicDistortion:
            case EffectKind.GlitchLight:
                DistortPixels(px, w, h, r, fx, amount, time);
                return false;
            default:
                return false;
        }
    }

    private void DrawEffect(
        SKCanvas canvas, SKPath path, Region r, EffectInstance fx,
        float drive, float amount, float particleDensity, float motionSpeed,
        float time, float dt)
    {
        switch (fx.Kind)
        {
            case EffectKind.Glow:
            case EffectKind.NeonGlow:
            case EffectKind.PeakHoldGlow:
                DrawGlow(canvas, path, fx, amount);
                break;
            case EffectKind.BreathingGlow:
                DrawGlow(canvas, path, fx, amount * (0.45f + 0.55f * (0.5f + 0.5f * MathF.Sin(time * fx.Speed * 2f))));
                break;
            case EffectKind.Afterglow:
                DrawGlow(canvas, path, fx, amount * (0.35f + 0.65f * drive));
                break;
            case EffectKind.EchoPulse:
            case EffectKind.EnergyRipple:
            case EffectKind.Shockwave:
            case EffectKind.AudioRipple:
            case EffectKind.WaterRipple:
                DrawRipples(canvas, path.Bounds, fx, amount, time);
                break;
            case EffectKind.WaveSweep:
            case EffectKind.FrequencyGradient:
            case EffectKind.SpectrumSweep:
                DrawSweep(canvas, path.Bounds, fx, amount, time);
                break;
            case EffectKind.Spotlight:
                DrawSpotlight(canvas, path.Bounds, fx, amount);
                break;
            case EffectKind.Halo:
                DrawHalo(canvas, path.Bounds, fx, amount, time);
                break;
            case EffectKind.LightRays:
            case EffectKind.GodRays:
            case EffectKind.Starburst:
                DrawRays(canvas, path.Bounds, fx, amount, time);
                break;
            case EffectKind.LensFlare:
                DrawLensFlare(canvas, path.Bounds, fx, amount, time);
                break;
            case EffectKind.EnergyFlow:
            case EffectKind.Plasma:
            case EffectKind.MagicEnergy:
            case EffectKind.SpectralAura:
                DrawEnergy(canvas, path.Bounds, fx, amount, time);
                break;
            case EffectKind.VoidEnergy:
                DrawVoid(canvas, path.Bounds, fx, amount, time);
                break;
            case EffectKind.Portal:
            case EffectKind.Vortex:
                DrawVortex(canvas, path.Bounds, fx, amount, time);
                break;
            case EffectKind.EnergyBeam:
            case EffectKind.Laser:
                DrawBeam(canvas, path.Bounds, fx, amount, time);
                break;
            case EffectKind.EnergySparks:
            case EffectKind.Sparks:
            case EffectKind.Embers:
            case EffectKind.Glitter:
            case EffectKind.ParticleBurst:
            case EffectKind.ParticleFountain:
            case EffectKind.OrbitingParticles:
            case EffectKind.GravityParticles:
            case EffectKind.ReverseGravity:
            case EffectKind.Swarm:
            case EffectKind.Trail:
            case EffectKind.DustMotes:
            case EffectKind.Ash:
            case EffectKind.Snow:
                DrawParticles(canvas, path, r, fx, drive, amount, particleDensity, motionSpeed, time, dt);
                break;
            case EffectKind.LightningArc:
            case EffectKind.ElectricCrawl:
                DrawLightning(canvas, path, r, fx, drive, amount, time, dt);
                break;
            case EffectKind.RealisticFlame:
                DrawFlame(canvas, path, r, fx, drive, amount, particleDensity, motionSpeed, time, dt);
                break;
            case EffectKind.SmokeFog:
            case EffectKind.Mist:
            case EffectKind.AtmosphericHaze:
                DrawFog(canvas, path.Bounds, fx, amount, time);
                break;
            case EffectKind.ChromaticPulse:
            case EffectKind.PrismaticLight:
                DrawPrismatic(canvas, path, fx, amount, time);
                break;
            case EffectKind.NeonChase:
            case EffectKind.TraceChase:
            case EffectKind.RhythmChase:
            case EffectKind.RuneSequence:
            case EffectKind.RuneGlow:
            case EffectKind.TracePulse:
            case EffectKind.OutlineEnergy:
                DrawOutline(canvas, path, fx, amount, time);
                break;
            case EffectKind.Shimmer:
                DrawShimmer(canvas, path.Bounds, fx, amount, time);
                break;
            case EffectKind.Rain:
                DrawRain(canvas, path.Bounds, fx, amount, time);
                break;
            case EffectKind.WetReflection:
            case EffectKind.WaterReflection:
            case EffectKind.Caustics:
                DrawWater(canvas, path.Bounds, fx, amount, time);
                break;
            case EffectKind.Aurora:
                DrawAurora(canvas, path.Bounds, fx, amount, time);
                break;
            case EffectKind.HeatDistortion:
            case EffectKind.Refraction:
            case EffectKind.HolographicDistortion:
            case EffectKind.GlitchLight:
                DrawDistortionFinish(canvas, path.Bounds, fx, amount, time);
                break;
            default:
                DrawGlow(canvas, path, fx, amount * 0.55f);
                break;
        }
    }

    private static SKPath BuildRegionPath(Region r)
    {
        var p = new SKPath();
        if (r.Kind == RegionKind.Trace && r.Points.Count >= 6)
        {
            p.MoveTo(r.Points[0], r.Points[1]);
            for (var i = 2; i + 1 < r.Points.Count; i += 2)
                p.LineTo(r.Points[i], r.Points[i + 1]);
            p.Close();
            return p;
        }

        if (r.Kind == RegionKind.Emitter)
        {
            p.AddCircle(r.X, r.Y, Math.Max(1f, r.Radius));
            return p;
        }

        var rect = new SKRect(r.X, r.Y, r.X + Math.Max(1f, r.Width), r.Y + Math.Max(1f, r.Height));
        if (r.Shape is StampShape.Circle or StampShape.Ellipse)
            p.AddOval(rect);
        else if (r.Shape == StampShape.Line)
        {
            p.MoveTo(rect.Left, rect.Top);
            p.LineTo(rect.Right, rect.Bottom);
        }
        else
            p.AddRect(rect);
        return p;
    }

    private static void DrawGlow(SKCanvas c, SKPath path, EffectInstance fx, float amount)
    {
        if (amount <= 0.001f) return;
        var color = Color(fx.PrimaryColor);
        var sigma = 3f + fx.Softness * 22f + fx.Radius * 0.025f;
        using var glow = NewPaint(fx, Alpha(color, Math.Clamp(amount * 0.28f, 0f, 0.8f)), SKPaintStyle.Fill);
        glow.ImageFilter = SKImageFilter.CreateBlur(sigma, sigma);
        c.DrawPath(path, glow);

        using var edge = NewPaint(fx, Alpha(color, Math.Clamp(amount * 0.48f, 0f, 0.95f)), SKPaintStyle.Stroke);
        edge.StrokeWidth = Math.Max(1.5f, fx.Thickness * 0.35f + fx.WidthAmt * 4f);
        edge.StrokeJoin = SKStrokeJoin.Round;
        edge.StrokeCap = SKStrokeCap.Round;
        c.DrawPath(path, edge);
    }

    private static void DrawRipples(SKCanvas c, SKRect b, EffectInstance fx, float amount, float time)
    {
        var count = Math.Clamp((int)MathF.Round(Math.Max(2f, fx.Count)), 2, 14);
        var center = new SKPoint(b.MidX, b.MidY);
        var maxR = Math.Max(8f, Math.Min(b.Width, b.Height) * 0.58f);
        var color = Color(fx.PrimaryColor);
        for (var i = 0; i < count; i++)
        {
            var phase = Frac(time * (0.22f + fx.Speed * 0.35f) + i / (float)count);
            var radius = 4f + maxR * phase;
            var fade = (1f - phase) * amount;
            using var p = NewPaint(fx, Alpha(color, Math.Clamp(fade * 0.75f, 0f, 0.9f)), SKPaintStyle.Stroke);
            p.StrokeWidth = 1.5f + fx.WidthAmt * 8f * (1f - phase * 0.65f);
            p.ImageFilter = SKImageFilter.CreateBlur(1.5f + fx.Softness * 4f, 1.5f + fx.Softness * 4f);
            c.DrawCircle(center.X, center.Y, radius, p);
        }
    }

    private static void DrawSweep(SKCanvas c, SKRect b, EffectInstance fx, float amount, float time)
    {
        var t = Frac(time * (0.15f + fx.Speed * 0.3f));
        var x = b.Left + b.Width * t;
        var half = Math.Max(8f, b.Width * Math.Clamp(fx.WidthAmt, 0.04f, 0.8f) * 0.35f);
        var color = Color(fx.PrimaryColor);
        using var p = NewPaint(fx, SKColors.White, SKPaintStyle.Fill);
        p.Shader = SKShader.CreateLinearGradient(
            new SKPoint(x - half, b.MidY), new SKPoint(x + half, b.MidY),
            new[] { Alpha(color, 0), Alpha(color, Math.Clamp(amount * 0.8f, 0f, 0.9f)), Alpha(color, 0) },
            new[] { 0f, 0.5f, 1f }, SKShaderTileMode.Clamp);
        c.DrawRect(b, p);
    }

    private static void DrawSpotlight(SKCanvas c, SKRect b, EffectInstance fx, float amount)
    {
        var color = Color(fx.PrimaryColor);
        var radius = Math.Max(12f, Math.Max(b.Width, b.Height) * 0.62f);
        using var p = NewPaint(fx, SKColors.White, SKPaintStyle.Fill);
        p.Shader = SKShader.CreateRadialGradient(
            new SKPoint(b.MidX, b.MidY), radius,
            new[] { Alpha(color, Math.Clamp(amount * 0.7f, 0f, 0.95f)), Alpha(color, Math.Clamp(amount * 0.18f, 0f, 0.35f)), Alpha(color, 0) },
            new[] { 0f, 0.48f, 1f }, SKShaderTileMode.Clamp);
        c.DrawCircle(b.MidX, b.MidY, radius, p);
    }

    private static void DrawHalo(SKCanvas c, SKRect b, EffectInstance fx, float amount, float time)
    {
        var pulse = 0.88f + 0.12f * MathF.Sin(time * (1f + fx.Speed * 2f));
        var radius = Math.Max(6f, Math.Min(b.Width, b.Height) * 0.42f * pulse);
        var color = Color(fx.PrimaryColor);
        using var glow = NewPaint(fx, Alpha(color, Math.Clamp(amount * 0.55f, 0f, 0.9f)), SKPaintStyle.Stroke);
        glow.StrokeWidth = Math.Max(2f, fx.Thickness + fx.WidthAmt * 8f);
        glow.ImageFilter = SKImageFilter.CreateBlur(5f + fx.Softness * 10f, 5f + fx.Softness * 10f);
        c.DrawCircle(b.MidX, b.MidY, radius, glow);
        using var core = NewPaint(fx, Alpha(SKColors.White, Math.Clamp(amount * 0.75f, 0f, 0.92f)), SKPaintStyle.Stroke);
        core.StrokeWidth = Math.Max(1f, glow.StrokeWidth * 0.22f);
        c.DrawCircle(b.MidX, b.MidY, radius, core);
    }

    private static void DrawRays(SKCanvas c, SKRect b, EffectInstance fx, float amount, float time)
    {
        var count = Math.Clamp((int)MathF.Round(fx.Count), 6, 48);
        var radius = MathF.Sqrt(b.Width * b.Width + b.Height * b.Height) * 0.7f;
        var center = new Vector2(b.MidX, b.MidY);
        var color = Color(fx.PrimaryColor);
        for (var i = 0; i < count; i++)
        {
            var a = (i / (float)count) * MathF.Tau + fx.Angle * MathF.PI / 180f + time * fx.Speed * 0.04f;
            var flick = 0.45f + 0.55f * Hash(fx.Seed + i, (int)(time * 5f));
            var end = center + new Vector2(MathF.Cos(a), MathF.Sin(a)) * radius;
            using var p = NewPaint(fx, Alpha(color, Math.Clamp(amount * 0.22f * flick, 0f, 0.5f)), SKPaintStyle.Stroke);
            p.StrokeWidth = 1f + fx.WidthAmt * 5f;
            p.ImageFilter = SKImageFilter.CreateBlur(2f + fx.Softness * 6f, 2f + fx.Softness * 6f);
            c.DrawLine(center.X, center.Y, end.X, end.Y, p);
        }
    }

    private static void DrawLensFlare(SKCanvas c, SKRect b, EffectInstance fx, float amount, float time)
    {
        var color = Color(fx.PrimaryColor);
        var center = new Vector2(b.MidX, b.MidY);
        var dir = Vector2.Normalize(new Vector2(MathF.Cos(time * 0.09f + fx.Angle), MathF.Sin(time * 0.07f + fx.Angle * 0.5f)));
        var count = Math.Clamp((int)MathF.Round(fx.Count), 3, 12);
        for (var i = -count / 2; i <= count / 2; i++)
        {
            var pos = center + dir * (i * Math.Min(b.Width, b.Height) * 0.12f);
            var radius = Math.Max(2f, fx.Radius * (0.08f + 0.025f * Math.Abs(i)));
            using var p = NewPaint(fx, Alpha(color, Math.Clamp(amount * 0.22f / (1f + Math.Abs(i) * 0.2f), 0f, 0.5f)), SKPaintStyle.Fill);
            p.ImageFilter = SKImageFilter.CreateBlur(radius * 0.45f, radius * 0.45f);
            c.DrawCircle(pos.X, pos.Y, radius, p);
        }
    }

    private static void DrawEnergy(SKCanvas c, SKRect b, EffectInstance fx, float amount, float time)
    {
        var primary = Color(fx.PrimaryColor);
        var secondary = Color(fx.SecondaryColor);
        var strands = fx.Quality switch { QualityLevel.Low => 5, QualityLevel.High => 14, _ => 9 };
        for (var s = 0; s < strands; s++)
        {
            using var path = new SKPath();
            var y0 = b.Top + b.Height * ((s + 0.5f) / strands);
            path.MoveTo(b.Left, y0);
            var segments = 8;
            for (var j = 1; j <= segments; j++)
            {
                var x = b.Left + b.Width * j / segments;
                var wobble = MathF.Sin(j * 1.7f + s * 2.1f + time * (1.2f + fx.Speed * 2.5f)) *
                             b.Height * (0.025f + fx.Turbulence * 0.08f);
                var n = (Hash(fx.Seed + s * 17, j + (int)(time * 8f)) - 0.5f) * b.Height * fx.Turbulence * 0.08f;
                path.LineTo(x, y0 + wobble + n);
            }

            var col = (s & 1) == 0 ? primary : secondary;
            using var glow = NewPaint(fx, Alpha(col, Math.Clamp(amount * 0.35f, 0f, 0.72f)), SKPaintStyle.Stroke);
            glow.StrokeWidth = 2f + fx.WidthAmt * 8f;
            glow.StrokeCap = SKStrokeCap.Round;
            glow.ImageFilter = SKImageFilter.CreateBlur(4f + fx.Turbulence * 8f, 4f + fx.Turbulence * 8f);
            c.DrawPath(path, glow);
            using var core = NewPaint(fx, Alpha(Mix(col, SKColors.White, 0.55f), Math.Clamp(amount * 0.68f, 0f, 0.95f)), SKPaintStyle.Stroke);
            core.StrokeWidth = Math.Max(0.8f, glow.StrokeWidth * 0.2f);
            core.StrokeCap = SKStrokeCap.Round;
            c.DrawPath(path, core);
        }
    }

    private static void DrawVoid(SKCanvas c, SKRect b, EffectInstance fx, float amount, float time)
    {
        var color = Color(fx.PrimaryColor);
        using var dark = new SKPaint { IsAntialias = true, Color = new SKColor(0, 0, 0, (byte)Math.Clamp(amount * 95f, 0f, 180f)), BlendMode = SKBlendMode.SrcOver };
        c.DrawOval(b, dark);
        for (var i = 0; i < 5; i++)
        {
            var rr = Math.Min(b.Width, b.Height) * (0.18f + i * 0.065f + 0.015f * MathF.Sin(time * fx.Speed + i));
            using var p = NewPaint(fx, Alpha(color, Math.Clamp(amount * 0.17f, 0f, 0.4f)), SKPaintStyle.Stroke);
            p.StrokeWidth = 1.5f + fx.WidthAmt * 3f;
            p.ImageFilter = SKImageFilter.CreateBlur(3f, 3f);
            c.DrawCircle(b.MidX, b.MidY, rr, p);
        }
    }

    private static void DrawVortex(SKCanvas c, SKRect b, EffectInstance fx, float amount, float time)
    {
        var primary = Color(fx.PrimaryColor);
        var secondary = Color(fx.SecondaryColor);
        var turns = fx.Quality == QualityLevel.Low ? 18 : fx.Quality == QualityLevel.High ? 44 : 30;
        using var path = new SKPath();
        for (var i = 0; i < turns; i++)
        {
            var q = i / (float)(turns - 1);
            var a = q * MathF.Tau * (2.8f + fx.Density * 2f) + time * fx.Speed * 1.6f;
            var rad = q * Math.Min(b.Width, b.Height) * 0.48f;
            var x = b.MidX + MathF.Cos(a) * rad;
            var y = b.MidY + MathF.Sin(a) * rad * 0.72f;
            if (i == 0) path.MoveTo(x, y); else path.LineTo(x, y);
        }
        using var glow = NewPaint(fx, Alpha(secondary, Math.Clamp(amount * 0.42f, 0f, 0.8f)), SKPaintStyle.Stroke);
        glow.StrokeWidth = 4f + fx.Thickness * 0.55f;
        glow.StrokeCap = SKStrokeCap.Round;
        glow.ImageFilter = SKImageFilter.CreateBlur(5f, 5f);
        c.DrawPath(path, glow);
        using var core = NewPaint(fx, Alpha(primary, Math.Clamp(amount * 0.85f, 0f, 1f)), SKPaintStyle.Stroke);
        core.StrokeWidth = Math.Max(1f, glow.StrokeWidth * 0.25f);
        core.StrokeCap = SKStrokeCap.Round;
        c.DrawPath(path, core);
    }

    private static void DrawBeam(SKCanvas c, SKRect b, EffectInstance fx, float amount, float time)
    {
        var a = fx.Angle * MathF.PI / 180f;
        var dir = new Vector2(MathF.Cos(a), MathF.Sin(a));
        if (dir.LengthSquared() < 0.1f) dir = Vector2.UnitX;
        var len = MathF.Sqrt(b.Width * b.Width + b.Height * b.Height);
        var center = new Vector2(b.MidX, b.MidY);
        var p0 = center - dir * len;
        var p1 = center + dir * len;
        var color = Color(fx.PrimaryColor);
        using var glow = NewPaint(fx, Alpha(color, Math.Clamp(amount * 0.55f, 0f, 0.9f)), SKPaintStyle.Stroke);
        glow.StrokeWidth = Math.Max(3f, fx.WidthAmt * 28f);
        glow.StrokeCap = SKStrokeCap.Round;
        glow.ImageFilter = SKImageFilter.CreateBlur(6f + fx.Softness * 8f, 6f + fx.Softness * 8f);
        c.DrawLine(p0.X, p0.Y, p1.X, p1.Y, glow);
        using var core = NewPaint(fx, Alpha(Mix(color, SKColors.White, 0.8f), Math.Clamp(amount, 0f, 1f)), SKPaintStyle.Stroke);
        core.StrokeWidth = Math.Max(1f, glow.StrokeWidth * 0.14f);
        core.StrokeCap = SKStrokeCap.Round;
        c.DrawLine(p0.X, p0.Y, p1.X, p1.Y, core);
    }

    private void DrawParticles(
        SKCanvas c, SKPath clip, Region r, EffectInstance fx,
        float drive, float amount, float masterDensity, float motionSpeed,
        float time, float dt)
    {
        var state = GetParticleState(fx);
        var densityScale = fx.Quality switch { QualityLevel.Low => 0.45f, QualityLevel.High => 1.35f, _ => 0.85f };
        var rate = (8f + fx.Density * 115f) * Math.Max(0.15f, masterDensity) * densityScale * (0.18f + drive * 0.82f);
        if (fx.Kind == EffectKind.ParticleBurst) rate *= 1.8f;
        if (fx.Kind is EffectKind.Glitter or EffectKind.DustMotes) rate *= 0.55f;
        state.Carry += dt * rate;
        var spawn = Math.Min(96, (int)state.Carry);
        state.Carry -= spawn;
        var max = fx.Quality switch { QualityLevel.Low => 180, QualityLevel.High => 900, _ => 480 };
        while (spawn-- > 0 && state.Items.Count < max)
            state.Items.Add(SpawnParticle(state.Rng, r, fx));

        var accel = 90f * Math.Max(0.2f, motionSpeed);
        for (var i = state.Items.Count - 1; i >= 0; i--)
        {
            var p = state.Items[i];
            p.Prev = p.Pos;
            p.Age += dt;
            if (p.Age >= p.Life)
            {
                state.Items.RemoveAt(i);
                continue;
            }

            switch (fx.Kind)
            {
                case EffectKind.Sparks:
                case EffectKind.EnergySparks:
                case EffectKind.ParticleBurst:
                    p.Vel.Y += accel * dt;
                    p.Vel *= MathF.Pow(0.985f, dt * 60f);
                    break;
                case EffectKind.Embers:
                    p.Vel.Y -= accel * 0.18f * dt;
                    p.Vel.X += MathF.Sin(time * 2.1f + p.Phase) * fx.Turbulence * 18f * dt;
                    break;
                case EffectKind.ParticleFountain:
                case EffectKind.GravityParticles:
                    p.Vel.Y += accel * dt;
                    break;
                case EffectKind.ReverseGravity:
                    p.Vel.Y -= accel * 0.6f * dt;
                    break;
                case EffectKind.Snow:
                    p.Vel.X += MathF.Sin(time * 0.8f + p.Phase) * 7f * dt;
                    p.Vel.Y += 5f * dt;
                    break;
                case EffectKind.Ash:
                case EffectKind.DustMotes:
                    p.Vel.X += MathF.Sin(time * 0.7f + p.Phase) * 4f * dt;
                    p.Vel.Y += MathF.Cos(time * 0.45f + p.Phase) * 2f * dt;
                    break;
                case EffectKind.Swarm:
                {
                    // Swarm is rendered as organic firefly-like agents rather than generic dots.
                    var wander = new Vector2(
                        MathF.Sin(time * 1.7f + p.Phase * 2.3f),
                        MathF.Cos(time * 1.3f + p.Phase * 1.9f));
                    p.Vel += wander * (10f + 26f * fx.Randomness) * dt;
                    p.Vel *= MathF.Pow(0.94f, dt * 60f);
                    break;
                }
                case EffectKind.OrbitingParticles:
                {
                    var center = RegionCenter(r);
                    var rad = 14f + p.Size * 8f + fx.Radius * (0.25f + 0.6f * p.Phase);
                    var a = time * fx.Speed * (0.7f + p.Phase) + p.Phase * MathF.Tau * 3f;
                    p.Pos = center + new Vector2(MathF.Cos(a) * rad, MathF.Sin(a) * rad * 0.7f);
                    p.Vel = Vector2.Zero;
                    break;
                }
            }

            if (fx.Kind != EffectKind.OrbitingParticles)
                p.Pos += p.Vel * dt * Math.Max(0.1f, motionSpeed);

            state.Items[i] = p;
            DrawParticle(c, fx, p, amount);
        }
    }

    private void DrawFlame(
        SKCanvas c, SKPath clip, Region r, EffectInstance fx,
        float drive, float amount, float masterDensity, float motionSpeed,
        float time, float dt)
    {
        var state = GetParticleState(fx);
        var rate = (28f + fx.Density * 95f) * Math.Max(0.3f, masterDensity) * (0.45f + drive * 0.8f);
        state.Carry += dt * rate;
        var spawn = Math.Min(80, (int)state.Carry);
        state.Carry -= spawn;
        var max = fx.Quality switch { QualityLevel.Low => 120, QualityLevel.High => 650, _ => 340 };
        while (spawn-- > 0 && state.Items.Count < max)
            state.Items.Add(SpawnFlame(state.Rng, r, fx));

        var baseColor = Color(fx.PrimaryColor);
        for (var i = state.Items.Count - 1; i >= 0; i--)
        {
            var p = state.Items[i];
            p.Prev = p.Pos;
            p.Age += dt;
            if (p.Age >= p.Life)
            {
                state.Items.RemoveAt(i);
                continue;
            }
            var life = 1f - p.Age / p.Life;
            p.Vel.X += MathF.Sin(time * 4.1f + p.Phase * 4f) * (5f + fx.Turbulence * 38f) * dt;
            p.Vel.Y -= (8f + drive * 16f) * dt;
            p.Pos += p.Vel * dt * Math.Max(0.15f, motionSpeed);
            state.Items[i] = p;

            var warm = Mix(new SKColor(255, 58, 8), baseColor, 0.35f);
            var hot = Mix(new SKColor(255, 188, 35), SKColors.White, Math.Clamp(life * 0.55f, 0f, 0.7f));
            var col = Mix(warm, hot, life);
            var alpha = Math.Clamp(amount * life * 0.42f, 0f, 0.82f);
            using var glow = NewPaint(fx, Alpha(col, alpha), SKPaintStyle.Fill);
            var blur = 4f + p.Size * 0.75f;
            glow.ImageFilter = SKImageFilter.CreateBlur(blur, blur);
            c.DrawOval(new SKRect(p.Pos.X - p.Size, p.Pos.Y - p.Size * 1.6f,
                p.Pos.X + p.Size, p.Pos.Y + p.Size * 1.6f), glow);
            using var core = NewPaint(fx, Alpha(hot, Math.Clamp(alpha * 1.5f, 0f, 0.9f)), SKPaintStyle.Fill);
            c.DrawOval(new SKRect(p.Pos.X - p.Size * 0.28f, p.Pos.Y - p.Size,
                p.Pos.X + p.Size * 0.28f, p.Pos.Y + p.Size), core);
        }
    }

    private void DrawLightning(
        SKCanvas c, SKPath clip, Region r, EffectInstance fx,
        float drive, float amount, float time, float dt)
    {
        var state = GetLightningState(fx);
        state.Age += dt;
        state.Cooldown -= dt;
        var probability = Math.Clamp(dt * fx.Frequency * (0.07f + drive * 0.35f), 0f, 0.75f);
        if ((state.Age >= state.Life && state.Cooldown <= 0f && state.Rng.NextSingle() < probability) || state.Main.Count == 0)
            GenerateLightning(state, r, fx, drive);

        if (state.Age > state.Life || state.Main.Count < 2) return;
        var pulse = MathF.Exp(-state.Age * 28f) + 0.42f * MathF.Exp(-MathF.Abs(state.Age - 0.055f) * 70f);
        var strength = Math.Clamp(amount * pulse, 0f, 2.5f);
        var color = Color(fx.PrimaryColor);

        DrawBolt(c, state.Main, fx, color, strength, 1f);
        foreach (var branch in state.Branches)
            DrawBolt(c, branch, fx, color, strength * 0.58f, 0.65f);

        using var flash = new SKPaint
        {
            IsAntialias = true,
            Color = new SKColor(220, 235, 255, (byte)Math.Clamp(strength * 24f, 0f, 55f)),
            BlendMode = SKBlendMode.Screen
        };
        c.DrawRect(clip.Bounds, flash);
    }

    private static void DrawBolt(SKCanvas c, List<Vector2> pts, EffectInstance fx, SKColor color, float strength, float scale)
    {
        using var path = new SKPath();
        path.MoveTo(pts[0].X, pts[0].Y);
        for (var i = 1; i < pts.Count; i++) path.LineTo(pts[i].X, pts[i].Y);
        using var halo = NewPaint(fx, Alpha(color, Math.Clamp(strength * 0.42f, 0f, 0.8f)), SKPaintStyle.Stroke);
        halo.StrokeWidth = (5f + fx.WidthAmt * 13f) * scale;
        halo.StrokeCap = SKStrokeCap.Round;
        halo.StrokeJoin = SKStrokeJoin.Round;
        halo.ImageFilter = SKImageFilter.CreateBlur(5f, 5f);
        c.DrawPath(path, halo);
        using var main = NewPaint(fx, Alpha(Mix(color, new SKColor(185, 220, 255), 0.45f), Math.Clamp(strength * 0.8f, 0f, 1f)), SKPaintStyle.Stroke);
        main.StrokeWidth = (1.8f + fx.WidthAmt * 4.2f) * scale;
        main.StrokeCap = SKStrokeCap.Round;
        main.StrokeJoin = SKStrokeJoin.Round;
        c.DrawPath(path, main);
        using var core = NewPaint(fx, Alpha(SKColors.White, Math.Clamp(strength, 0f, 1f)), SKPaintStyle.Stroke);
        core.StrokeWidth = Math.Max(0.75f, main.StrokeWidth * 0.34f);
        core.StrokeCap = SKStrokeCap.Round;
        c.DrawPath(path, core);
    }

    private static void DrawFog(SKCanvas c, SKRect b, EffectInstance fx, float amount, float time)
    {
        var count = fx.Quality switch { QualityLevel.Low => 8, QualityLevel.High => 26, _ => 16 };
        var color = Color(fx.PrimaryColor);
        for (var i = 0; i < count; i++)
        {
            var hx = Hash(fx.Seed + 17, i);
            var hy = Hash(fx.Seed + 31, i);
            var drift = time * (0.01f + fx.Speed * 0.025f);
            var x = b.Left + b.Width * Frac(hx + drift + 0.025f * MathF.Sin(time * 0.4f + i));
            var y = b.Top + b.Height * Frac(hy + 0.03f * MathF.Sin(time * 0.25f + i * 1.7f));
            var rx = Math.Max(20f, b.Width * (0.12f + 0.12f * Hash(fx.Seed, i + 100)));
            var ry = rx * (0.35f + 0.35f * Hash(fx.Seed, i + 200));
            using var p = NewPaint(fx, Alpha(color, Math.Clamp(amount * fx.Density * 0.055f, 0f, 0.18f)), SKPaintStyle.Fill);
            p.ImageFilter = SKImageFilter.CreateBlur(12f + fx.Softness * 22f, 12f + fx.Softness * 22f);
            c.DrawOval(new SKRect(x - rx, y - ry, x + rx, y + ry), p);
        }
    }

    private static void DrawPrismatic(SKCanvas c, SKPath path, EffectInstance fx, float amount, float time)
    {
        var offset = 1.5f + 4f * fx.Spread;
        var colors = new[] { new SKColor(255, 60, 80), new SKColor(80, 255, 180), new SKColor(70, 130, 255) };
        for (var i = 0; i < 3; i++)
        {
            c.Save();
            c.Translate((i - 1) * offset, (1 - i) * offset * 0.35f);
            using var p = NewPaint(fx, Alpha(colors[i], Math.Clamp(amount * 0.35f, 0f, 0.65f)), SKPaintStyle.Stroke);
            p.StrokeWidth = 2f + fx.WidthAmt * 5f;
            p.ImageFilter = SKImageFilter.CreateBlur(1.5f, 1.5f);
            c.DrawPath(path, p);
            c.Restore();
        }
    }

    private static void DrawOutline(SKCanvas c, SKPath path, EffectInstance fx, float amount, float time)
    {
        var color = Color(fx.PrimaryColor);
        var width = Math.Max(1.5f, 2f + fx.WidthAmt * 10f);
        using var glow = NewPaint(fx, Alpha(color, Math.Clamp(amount * 0.5f, 0f, 0.9f)), SKPaintStyle.Stroke);
        glow.StrokeWidth = width * 2.3f;
        glow.StrokeCap = SKStrokeCap.Round;
        glow.StrokeJoin = SKStrokeJoin.Round;
        glow.ImageFilter = SKImageFilter.CreateBlur(4f, 4f);
        c.DrawPath(path, glow);

        using var core = NewPaint(fx, Alpha(Mix(color, SKColors.White, 0.35f), Math.Clamp(amount * 0.9f, 0f, 1f)), SKPaintStyle.Stroke);
        core.StrokeWidth = width * 0.45f;
        core.StrokeCap = SKStrokeCap.Round;
        core.StrokeJoin = SKStrokeJoin.Round;
        if (fx.Kind is EffectKind.NeonChase or EffectKind.TraceChase or EffectKind.RhythmChase or EffectKind.RuneSequence)
            core.PathEffect = SKPathEffect.CreateDash(new[] { 18f, 12f }, -time * (30f + fx.Speed * 120f));
        c.DrawPath(path, core);
    }

    private static void DrawShimmer(SKCanvas c, SKRect b, EffectInstance fx, float amount, float time)
    {
        var color = Color(fx.PrimaryColor);
        var count = 8 + (int)(fx.Density * 22f);
        for (var i = 0; i < count; i++)
        {
            var x = b.Left + b.Width * Hash(fx.Seed, i * 2 + 1);
            var y = b.Top + b.Height * Hash(fx.Seed, i * 2 + 2);
            var tw = MathF.Pow(Math.Max(0f, MathF.Sin(time * (2f + fx.Speed * 4f) + i * 2.13f)), 8f);
            if (tw < 0.03f) continue;
            var rr = 2f + fx.ScaleAmount * 6f;
            using var p = NewPaint(fx, Alpha(color, Math.Clamp(amount * tw, 0f, 0.95f)), SKPaintStyle.Stroke);
            p.StrokeWidth = 1.1f;
            c.DrawLine(x - rr, y, x + rr, y, p);
            c.DrawLine(x, y - rr, x, y + rr, p);
        }
    }

    private static void DrawRain(SKCanvas c, SKRect b, EffectInstance fx, float amount, float time)
    {
        var count = fx.Quality switch { QualityLevel.Low => 28, QualityLevel.High => 120, _ => 70 };
        var color = Mix(Color(fx.PrimaryColor), new SKColor(170, 205, 235), 0.55f);
        var slant = MathF.Tan(fx.Angle * MathF.PI / 180f) * 14f;
        using var p = NewPaint(fx, Alpha(color, Math.Clamp(amount * 0.45f, 0f, 0.75f)), SKPaintStyle.Stroke);
        p.StrokeWidth = 1f + fx.WidthAmt * 1.5f;
        p.StrokeCap = SKStrokeCap.Round;
        for (var i = 0; i < count; i++)
        {
            var x = b.Left + b.Width * Hash(fx.Seed, i * 3 + 1);
            var phase = Hash(fx.Seed, i * 3 + 2);
            var y = b.Top + b.Height * Frac(phase + time * (0.2f + fx.Speed * 0.65f));
            var len = 8f + 26f * fx.HeightAmt * (0.55f + Hash(fx.Seed, i * 3 + 3));
            c.DrawLine(x, y, x + slant, y + len, p);
        }
    }

    private static void DrawWater(SKCanvas c, SKRect b, EffectInstance fx, float amount, float time)
    {
        var color = Mix(Color(fx.PrimaryColor), new SKColor(90, 190, 235), 0.55f);
        var lines = 7 + (int)(fx.Density * 10f);
        for (var i = 0; i < lines; i++)
        {
            using var path = new SKPath();
            var y = b.Top + b.Height * (i + 0.5f) / lines;
            path.MoveTo(b.Left, y);
            var seg = 12;
            for (var j = 1; j <= seg; j++)
            {
                var x = b.Left + b.Width * j / seg;
                var yy = y + MathF.Sin(j * 1.4f + time * fx.Speed * 2.2f + i) * (2f + fx.Distortion * 8f);
                path.LineTo(x, yy);
            }
            using var p = NewPaint(fx, Alpha(color, Math.Clamp(amount * 0.22f, 0f, 0.45f)), SKPaintStyle.Stroke);
            p.StrokeWidth = 1.1f + fx.WidthAmt * 2f;
            p.ImageFilter = SKImageFilter.CreateBlur(0.8f, 0.8f);
            c.DrawPath(path, p);
        }
    }

    private static void DrawAurora(SKCanvas c, SKRect b, EffectInstance fx, float amount, float time)
    {
        var primary = Color(fx.PrimaryColor);
        var secondary = Color(fx.SecondaryColor);
        var ribbons = fx.Quality switch { QualityLevel.Low => 3, QualityLevel.High => 8, _ => 5 };
        for (var r = 0; r < ribbons; r++)
        {
            using var path = new SKPath();
            var baseY = b.Top + b.Height * (0.18f + r * 0.11f);
            path.MoveTo(b.Left, baseY);
            for (var s = 1; s <= 14; s++)
            {
                var x = b.Left + b.Width * s / 14f;
                var y = baseY + MathF.Sin(s * 0.82f + r * 1.4f + time * fx.Speed * 0.7f) *
                    b.Height * (0.04f + fx.Turbulence * 0.05f);
                path.LineTo(x, y);
            }
            using var p = NewPaint(fx, Alpha(Mix(primary, secondary, r / Math.Max(1f, ribbons - 1f)), Math.Clamp(amount * 0.28f, 0f, 0.55f)), SKPaintStyle.Stroke);
            p.StrokeWidth = Math.Max(5f, b.Height * 0.03f * fx.HeightAmt);
            p.StrokeCap = SKStrokeCap.Round;
            p.ImageFilter = SKImageFilter.CreateBlur(8f + fx.Softness * 10f, 8f + fx.Softness * 10f);
            c.DrawPath(path, p);
        }
    }

    private static void DrawDistortionFinish(SKCanvas c, SKRect b, EffectInstance fx, float amount, float time)
    {
        if (fx.Kind is not (EffectKind.HolographicDistortion or EffectKind.GlitchLight)) return;
        using var p = new SKPaint
        {
            IsAntialias = false,
            Color = new SKColor(120, 220, 255, (byte)Math.Clamp(amount * 22f, 0f, 55f)),
            BlendMode = SKBlendMode.Screen,
            StrokeWidth = 1f
        };
        var spacing = 5f + 8f * (1f - fx.Density * 0.5f);
        for (var y = b.Top + Frac(time * 18f) * spacing; y < b.Bottom; y += spacing)
            c.DrawLine(b.Left, y, b.Right, y, p);
    }

    private ParticleSystemState GetParticleState(EffectInstance fx)
    {
        if (_particles.TryGetValue(fx.Id, out var state)) return state;
        state = new ParticleSystemState(new Random(unchecked(fx.Seed * 397 ^ fx.Id.GetHashCode())));
        _particles[fx.Id] = state;
        return state;
    }

    private LightningState GetLightningState(EffectInstance fx)
    {
        if (_lightning.TryGetValue(fx.Id, out var state)) return state;
        state = new LightningState(new Random(unchecked(fx.Seed * 911 ^ fx.Id.GetHashCode())));
        _lightning[fx.Id] = state;
        return state;
    }

    private static Particle SpawnParticle(Random rng, Region r, EffectInstance fx)
    {
        var center = RegionCenter(r);
        var pos = RandomPoint(rng, r);
        var spread = Math.Clamp(fx.Spread, 0f, 1.5f);
        var angle = (float)(rng.NextDouble() * MathF.Tau);
        var speed = (20f + rng.NextSingle() * 150f) * (0.35f + fx.Speed * 0.65f);
        var vel = new Vector2(MathF.Cos(angle), MathF.Sin(angle)) * speed * (0.35f + spread);

        switch (fx.Kind)
        {
            case EffectKind.Sparks:
            case EffectKind.EnergySparks:
            case EffectKind.ParticleBurst:
                pos = center;
                vel.Y -= MathF.Abs(vel.Y) * 0.45f;
                break;
            case EffectKind.ParticleFountain:
                pos = new Vector2(center.X + (rng.NextSingle() - 0.5f) * Math.Max(8f, r.Width * 0.15f), RegionBounds(r).Bottom - 2f);
                vel = new Vector2((rng.NextSingle() - 0.5f) * 80f * spread, -(90f + rng.NextSingle() * 180f) * fx.Speed);
                break;
            case EffectKind.Embers:
                vel = new Vector2((rng.NextSingle() - 0.5f) * 35f, -(18f + rng.NextSingle() * 65f));
                break;
            case EffectKind.Snow:
                pos.Y = RegionBounds(r).Top - 2f;
                vel = new Vector2((rng.NextSingle() - 0.5f) * 14f, 16f + rng.NextSingle() * 34f);
                break;
            case EffectKind.Ash:
            case EffectKind.DustMotes:
                vel = new Vector2((rng.NextSingle() - 0.5f) * 14f, -4f + rng.NextSingle() * 12f);
                break;
            case EffectKind.Swarm:
                vel = new Vector2((rng.NextSingle() - 0.5f) * 22f, (rng.NextSingle() - 0.5f) * 22f);
                break;
            case EffectKind.OrbitingParticles:
                pos = center;
                vel = Vector2.Zero;
                break;
        }

        return new Particle
        {
            Pos = pos,
            Prev = pos,
            Vel = vel,
            Age = 0f,
            Life = Math.Max(0.12f, fx.Lifetime * (0.65f + rng.NextSingle() * 0.9f)),
            Size = 1.2f + rng.NextSingle() * Math.Max(2f, fx.Radius * 0.055f),
            Phase = rng.NextSingle(),
            Spin = (rng.NextSingle() - 0.5f) * 2f
        };
    }

    private static Particle SpawnFlame(Random rng, Region r, EffectInstance fx)
    {
        var b = RegionBounds(r);
        var x = b.MidX + (rng.NextSingle() - 0.5f) * b.Width * Math.Clamp(fx.WidthAmt, 0.12f, 1.1f);
        var y = b.Bottom - rng.NextSingle() * Math.Max(4f, b.Height * 0.08f);
        var pos = new Vector2(x, y);
        return new Particle
        {
            Pos = pos,
            Prev = pos,
            Vel = new Vector2((rng.NextSingle() - 0.5f) * 24f, -(35f + rng.NextSingle() * 95f) * (0.4f + fx.Speed * 0.7f)),
            Age = 0f,
            Life = Math.Max(0.22f, fx.Lifetime * (0.65f + rng.NextSingle() * 0.8f)),
            Size = 4f + rng.NextSingle() * Math.Max(6f, b.Width * 0.035f),
            Phase = rng.NextSingle(),
            Spin = 0f
        };
    }

    private static void DrawParticle(SKCanvas c, EffectInstance fx, Particle p, float amount)
    {
        var life = Math.Clamp(1f - p.Age / p.Life, 0f, 1f);
        var color = Color(fx.PrimaryColor);

        if (fx.Kind is EffectKind.Sparks or EffectKind.EnergySparks or EffectKind.ParticleBurst)
        {
            var warm = fx.Kind == EffectKind.Sparks ? new SKColor(255, 147, 34) : color;
            var col = Mix(warm, SKColors.White, life * 0.72f);
            using var glow = NewPaint(fx, Alpha(warm, Math.Clamp(amount * life * 0.48f, 0f, 0.9f)), SKPaintStyle.Stroke);
            glow.StrokeWidth = Math.Max(2f, p.Size * 1.8f);
            glow.StrokeCap = SKStrokeCap.Round;
            glow.ImageFilter = SKImageFilter.CreateBlur(3f + p.Size, 3f + p.Size);
            c.DrawLine(p.Prev.X, p.Prev.Y, p.Pos.X, p.Pos.Y, glow);
            using var core = NewPaint(fx, Alpha(col, Math.Clamp(amount * life, 0f, 1f)), SKPaintStyle.Stroke);
            core.StrokeWidth = Math.Max(0.75f, p.Size * 0.5f);
            core.StrokeCap = SKStrokeCap.Round;
            c.DrawLine(p.Prev.X, p.Prev.Y, p.Pos.X, p.Pos.Y, core);
            return;
        }

        if (fx.Kind == EffectKind.Swarm)
        {
            // Firefly-like body, warm abdomen, subtle wing glints, organic independent blinking.
            var blink = MathF.Pow(Math.Max(0f, MathF.Sin((p.Age / Math.Max(0.05f, p.Life)) * 8f + p.Phase * MathF.Tau * 3f)), 5f);
            var fire = Mix(new SKColor(180, 255, 72), color, 0.38f);
            using var glow = NewPaint(fx, Alpha(fire, Math.Clamp(amount * (0.08f + blink * 0.72f) * life, 0f, 0.9f)), SKPaintStyle.Fill);
            glow.ImageFilter = SKImageFilter.CreateBlur(4f + p.Size * 1.8f, 4f + p.Size * 1.8f);
            c.DrawCircle(p.Pos.X, p.Pos.Y, p.Size * 2.5f, glow);
            using var abdomen = NewPaint(fx, Alpha(Mix(fire, SKColors.White, 0.45f), Math.Clamp(amount * (0.25f + blink) * life, 0f, 1f)), SKPaintStyle.Fill);
            c.DrawOval(new SKRect(p.Pos.X - p.Size * 0.45f, p.Pos.Y - p.Size,
                p.Pos.X + p.Size * 0.45f, p.Pos.Y + p.Size), abdomen);
            using var wing = new SKPaint { IsAntialias = true, Color = new SKColor(210, 230, 210, (byte)(55 * life)), Style = SKPaintStyle.Stroke, StrokeWidth = 0.7f };
            c.DrawLine(p.Pos.X, p.Pos.Y, p.Pos.X - p.Size * 1.1f, p.Pos.Y - p.Size * 0.55f, wing);
            c.DrawLine(p.Pos.X, p.Pos.Y, p.Pos.X + p.Size * 1.1f, p.Pos.Y - p.Size * 0.55f, wing);
            return;
        }

        if (fx.Kind == EffectKind.Snow)
        {
            using var pnt = new SKPaint { IsAntialias = true, Color = new SKColor(245, 250, 255, (byte)Math.Clamp(amount * life * 220f, 0f, 255f)), Style = SKPaintStyle.Fill };
            c.DrawCircle(p.Pos.X, p.Pos.Y, p.Size * 0.65f, pnt);
            return;
        }

        if (fx.Kind is EffectKind.Ash or EffectKind.DustMotes)
        {
            var dust = fx.Kind == EffectKind.Ash ? new SKColor(155, 145, 135) : new SKColor(215, 205, 180);
            using var pnt = new SKPaint { IsAntialias = true, Color = Alpha(dust, Math.Clamp(amount * life * 0.4f, 0f, 0.65f)), Style = SKPaintStyle.Fill, BlendMode = SKBlendMode.SrcOver };
            c.DrawOval(new SKRect(p.Pos.X - p.Size, p.Pos.Y - p.Size * 0.35f, p.Pos.X + p.Size, p.Pos.Y + p.Size * 0.35f), pnt);
            return;
        }

        if (fx.Kind == EffectKind.Embers)
        {
            var ember = Mix(new SKColor(255, 70, 8), new SKColor(255, 220, 90), life);
            using var glow = NewPaint(fx, Alpha(ember, Math.Clamp(amount * life * 0.5f, 0f, 0.85f)), SKPaintStyle.Fill);
            glow.ImageFilter = SKImageFilter.CreateBlur(2.5f + p.Size, 2.5f + p.Size);
            c.DrawCircle(p.Pos.X, p.Pos.Y, p.Size * 1.3f, glow);
            using var core = NewPaint(fx, Alpha(ember, Math.Clamp(amount * life, 0f, 1f)), SKPaintStyle.Fill);
            c.DrawCircle(p.Pos.X, p.Pos.Y, Math.Max(0.8f, p.Size * 0.45f), core);
            return;
        }

        var twinkle = fx.Kind == EffectKind.Glitter
            ? 0.2f + 0.8f * MathF.Pow(Math.Max(0f, MathF.Sin(p.Age * 12f + p.Phase * 20f)), 5f)
            : 1f;
        using var dot = NewPaint(fx, Alpha(color, Math.Clamp(amount * life * twinkle * 0.7f, 0f, 0.95f)), SKPaintStyle.Fill);
        dot.ImageFilter = SKImageFilter.CreateBlur(1.5f + p.Size * 0.5f, 1.5f + p.Size * 0.5f);
        c.DrawCircle(p.Pos.X, p.Pos.Y, Math.Max(1f, p.Size), dot);
    }

    private static void GenerateLightning(LightningState state, Region r, EffectInstance fx, float drive)
    {
        state.Main.Clear();
        state.Branches.Clear();
        var b = RegionBounds(r);
        var horizontal = b.Width > b.Height * 1.2f;
        var start = horizontal
            ? new Vector2(b.Left + 2f, b.MidY + (state.Rng.NextSingle() - 0.5f) * b.Height * 0.3f)
            : new Vector2(b.MidX + (state.Rng.NextSingle() - 0.5f) * b.Width * 0.25f, b.Top + 2f);
        var end = horizontal
            ? new Vector2(b.Right - 2f, b.MidY + (state.Rng.NextSingle() - 0.5f) * b.Height * 0.35f)
            : new Vector2(b.MidX + (state.Rng.NextSingle() - 0.5f) * b.Width * 0.35f, b.Bottom - 2f);

        state.Main.AddRange(SubdivideBolt(start, end, state.Rng, 5, 0.16f + fx.Randomness * 0.16f));
        var branchCount = Math.Clamp((int)(2 + fx.Randomness * 8 + drive * 5), 2, 14);
        for (var i = 0; i < branchCount; i++)
        {
            var idx = state.Rng.Next(2, Math.Max(3, state.Main.Count - 2));
            idx = Math.Min(idx, state.Main.Count - 2);
            var origin = state.Main[idx];
            var mainDir = Vector2.Normalize(end - start);
            var side = new Vector2(-mainDir.Y, mainDir.X) * (state.Rng.Next(0, 2) == 0 ? -1f : 1f);
            var length = Math.Min(b.Width, b.Height) * (0.08f + state.Rng.NextSingle() * 0.2f);
            var target = origin + Vector2.Normalize(mainDir * 0.45f + side * (0.65f + state.Rng.NextSingle())) * length;
            state.Branches.Add(SubdivideBolt(origin, target, state.Rng, 3, 0.22f + fx.Randomness * 0.18f));
        }
        state.Age = 0f;
        state.Life = 0.11f + state.Rng.NextSingle() * 0.09f;
        state.Cooldown = 0.04f + state.Rng.NextSingle() * Math.Max(0.08f, 1.25f / Math.Max(0.5f, fx.Frequency));
    }

    private static List<Vector2> SubdivideBolt(Vector2 a, Vector2 b, Random rng, int iterations, float roughness)
    {
        var pts = new List<Vector2> { a, b };
        for (var pass = 0; pass < iterations; pass++)
        {
            var next = new List<Vector2>(pts.Count * 2 - 1);
            for (var i = 0; i < pts.Count - 1; i++)
            {
                var p0 = pts[i];
                var p1 = pts[i + 1];
                var d = p1 - p0;
                var normal = d.LengthSquared() > 0.01f ? Vector2.Normalize(new Vector2(-d.Y, d.X)) : Vector2.UnitY;
                var mid = (p0 + p1) * 0.5f;
                var scale = d.Length() * roughness * (rng.NextSingle() - 0.5f);
                mid += normal * scale;
                next.Add(p0);
                next.Add(mid);
            }
            next.Add(pts[^1]);
            pts = next;
        }
        return pts;
    }

    private static void DistortPixels(byte[] px, int w, int h, Region r, EffectInstance fx, float amount, float time)
    {
        var rented = ArrayPool<byte>.Shared.Rent(px.Length);
        try
        {
            Buffer.BlockCopy(px, 0, rented, 0, px.Length);
            var b = RegionBounds(r);
            var x0 = Math.Clamp((int)MathF.Floor(b.Left), 0, w - 1);
            var x1 = Math.Clamp((int)MathF.Ceiling(b.Right), 0, w);
            var y0 = Math.Clamp((int)MathF.Floor(b.Top), 0, h - 1);
            var y1 = Math.Clamp((int)MathF.Ceiling(b.Bottom), 0, h);
            var amp = Math.Clamp(fx.Distortion * amount * 14f, 0f, 34f);
            for (var y = y0; y < y1; y++)
            {
                var wave = MathF.Sin(y * 0.075f + time * (3f + fx.Speed * 6f)) +
                           0.45f * MathF.Sin(y * 0.19f - time * 4.3f);
                var shift = (int)(wave * amp);
                if (fx.Kind == EffectKind.GlitchLight && Hash(fx.Seed, y + (int)(time * 24f)) > 0.78f)
                    shift *= 3;
                for (var x = x0; x < x1; x++)
                {
                    if (!Inside(r, x, y)) continue;
                    var sx = Math.Clamp(x + shift, 0, w - 1);
                    var si = (y * w + sx) * 4;
                    var di = (y * w + x) * 4;
                    px[di] = rented[si];
                    px[di + 1] = rented[si + 1];
                    px[di + 2] = rented[si + 2];
                }
            }
        }
        finally
        {
            ArrayPool<byte>.Shared.Return(rented);
        }
    }

    private static void ScaleRegion(byte[] px, int w, int h, Region r, float mul)
    {
        mul = Math.Clamp(mul, 0.05f, 4f);
        ForRegion(w, h, r, (_, _, i) =>
        {
            px[i] = ClampByte(px[i] * mul);
            px[i + 1] = ClampByte(px[i + 1] * mul);
            px[i + 2] = ClampByte(px[i + 2] * mul);
        });
    }

    private static void DimOutside(byte[] px, int w, int h, Region r, float dim)
    {
        var keep = 1f - Math.Clamp(dim, 0f, 0.9f);
        for (var y = 0; y < h; y++)
        for (var x = 0; x < w; x++)
        {
            if (Inside(r, x, y)) continue;
            var i = (y * w + x) * 4;
            px[i] = ClampByte(px[i] * keep);
            px[i + 1] = ClampByte(px[i + 1] * keep);
            px[i + 2] = ClampByte(px[i + 2] * keep);
        }
    }

    private static void Contrast(byte[] px, int w, int h, Region r, float amount)
    {
        var k = 1f + Math.Clamp(amount, -0.8f, 2f);
        ForRegion(w, h, r, (_, _, i) =>
        {
            for (var ch = 0; ch < 3; ch++)
            {
                var v = px[i + ch] / 255f;
                px[i + ch] = ClampByte((0.5f + (v - 0.5f) * k) * 255f);
            }
        });
    }

    private static void HueRotate(byte[] px, int w, int h, Region r, float degrees)
    {
        var a = degrees * MathF.PI / 180f;
        var cos = MathF.Cos(a);
        var sin = MathF.Sin(a);
        ForRegion(w, h, r, (_, _, i) =>
        {
            var rr = px[i + 2] / 255f;
            var gg = px[i + 1] / 255f;
            var bb = px[i] / 255f;
            var nr = (0.213f + cos * 0.787f - sin * 0.213f) * rr +
                     (0.715f - cos * 0.715f - sin * 0.715f) * gg +
                     (0.072f - cos * 0.072f + sin * 0.928f) * bb;
            var ng = (0.213f - cos * 0.213f + sin * 0.143f) * rr +
                     (0.715f + cos * 0.285f + sin * 0.140f) * gg +
                     (0.072f - cos * 0.072f - sin * 0.283f) * bb;
            var nb = (0.213f - cos * 0.213f - sin * 0.787f) * rr +
                     (0.715f - cos * 0.715f + sin * 0.715f) * gg +
                     (0.072f + cos * 0.928f + sin * 0.072f) * bb;
            px[i + 2] = ClampByte(nr * 255f);
            px[i + 1] = ClampByte(ng * 255f);
            px[i] = ClampByte(nb * 255f);
        });
    }

    private static void ForRegion(int w, int h, Region r, Action<int, int, int> body)
    {
        var b = RegionBounds(r);
        var pad = (int)Math.Max(4f, r.Falloff * 12f);
        var x0 = Math.Clamp((int)MathF.Floor(b.Left) - pad, 0, w);
        var x1 = Math.Clamp((int)MathF.Ceiling(b.Right) + pad, 0, w);
        var y0 = Math.Clamp((int)MathF.Floor(b.Top) - pad, 0, h);
        var y1 = Math.Clamp((int)MathF.Ceiling(b.Bottom) + pad, 0, h);
        for (var y = y0; y < y1; y++)
        for (var x = x0; x < x1; x++)
            if (Inside(r, x, y)) body(x, y, (y * w + x) * 4);
    }

    private static bool Inside(Region r, float x, float y)
    {
        if (r.Kind == RegionKind.Trace && r.Points.Count >= 6)
            return PointInPoly(r.Points, x, y);
        if (r.Kind == RegionKind.Emitter)
        {
            var dx = x - r.X;
            var dy = y - r.Y;
            return dx * dx + dy * dy <= r.Radius * r.Radius;
        }
        var lx = x - r.X;
        var ly = y - r.Y;
        if (r.Shape is StampShape.Circle or StampShape.Ellipse)
        {
            var nx = (lx - r.Width * 0.5f) / Math.Max(1f, r.Width * 0.5f);
            var ny = (ly - r.Height * 0.5f) / Math.Max(1f, r.Height * 0.5f);
            return nx * nx + ny * ny <= 1f;
        }
        return lx >= 0f && ly >= 0f && lx <= r.Width && ly <= r.Height;
    }

    private static bool PointInPoly(List<float> pts, float x, float y)
    {
        var inside = false;
        var n = pts.Count / 2;
        for (int i = 0, j = n - 1; i < n; j = i++)
        {
            var xi = pts[i * 2];
            var yi = pts[i * 2 + 1];
            var xj = pts[j * 2];
            var yj = pts[j * 2 + 1];
            var crosses = ((yi > y) != (yj > y)) &&
                          x < (xj - xi) * (y - yi) / (Math.Abs(yj - yi) < 0.0001f ? 0.0001f : yj - yi) + xi;
            if (crosses) inside = !inside;
        }
        return inside;
    }

    private static SKRect RegionBounds(Region r)
    {
        if (r.Kind == RegionKind.Trace && r.Points.Count >= 2)
        {
            var minX = float.MaxValue;
            var minY = float.MaxValue;
            var maxX = float.MinValue;
            var maxY = float.MinValue;
            for (var i = 0; i + 1 < r.Points.Count; i += 2)
            {
                minX = Math.Min(minX, r.Points[i]);
                minY = Math.Min(minY, r.Points[i + 1]);
                maxX = Math.Max(maxX, r.Points[i]);
                maxY = Math.Max(maxY, r.Points[i + 1]);
            }
            return new SKRect(minX, minY, maxX, maxY);
        }
        if (r.Kind == RegionKind.Emitter)
            return new SKRect(r.X - r.Radius, r.Y - r.Radius, r.X + r.Radius, r.Y + r.Radius);
        return new SKRect(r.X, r.Y, r.X + Math.Max(1f, r.Width), r.Y + Math.Max(1f, r.Height));
    }

    private static Vector2 RegionCenter(Region r)
    {
        var b = RegionBounds(r);
        return new Vector2(b.MidX, b.MidY);
    }

    private static Vector2 RandomPoint(Random rng, Region r)
    {
        var b = RegionBounds(r);
        for (var tries = 0; tries < 18; tries++)
        {
            var p = new Vector2(
                b.Left + rng.NextSingle() * Math.Max(1f, b.Width),
                b.Top + rng.NextSingle() * Math.Max(1f, b.Height));
            if (Inside(r, p.X, p.Y)) return p;
        }
        return RegionCenter(r);
    }

    private static SKPaint NewPaint(EffectInstance fx, SKColor color, SKPaintStyle style)
        => new()
        {
            IsAntialias = true,
            Color = color,
            Style = style,
            BlendMode = fx.Blend switch
            {
                BlendMode.Normal => SKBlendMode.SrcOver,
                BlendMode.Screen => SKBlendMode.Screen,
                BlendMode.Multiply => SKBlendMode.Multiply,
                BlendMode.Overlay => SKBlendMode.Overlay,
                BlendMode.Lighten => SKBlendMode.Lighten,
                BlendMode.ColorDodge => SKBlendMode.ColorDodge,
                _ => SKBlendMode.Plus
            }
        };

    private static SKColor Color(uint argb)
        => new((byte)((argb >> 16) & 255), (byte)((argb >> 8) & 255), (byte)(argb & 255), (byte)((argb >> 24) & 255));

    private static SKColor Alpha(SKColor c, float alpha)
        => new(c.Red, c.Green, c.Blue, (byte)Math.Clamp((int)(alpha * 255f), 0, 255));

    private static SKColor Mix(SKColor a, SKColor b, float t)
    {
        t = Math.Clamp(t, 0f, 1f);
        return new SKColor(
            (byte)(a.Red + (b.Red - a.Red) * t),
            (byte)(a.Green + (b.Green - a.Green) * t),
            (byte)(a.Blue + (b.Blue - a.Blue) * t),
            (byte)(a.Alpha + (b.Alpha - a.Alpha) * t));
    }

    private static byte ClampByte(float v) => (byte)Math.Clamp((int)v, 0, 255);
    private static float Frac(float v) => v - MathF.Floor(v);

    private static float Hash(int seed, int i)
    {
        var x = unchecked((uint)(seed * 747796405 + i * 2891336453));
        x = (x ^ (x >> 16)) * 0x7feb352d;
        x ^= x >> 15;
        return (x & 0x00FFFFFF) / 16777215f;
    }

    private void PruneState(HashSet<Guid> live)
    {
        foreach (var id in _envelopes.Keys.Where(id => !live.Contains(id)).ToArray()) _envelopes.Remove(id);
        foreach (var id in _particles.Keys.Where(id => !live.Contains(id)).ToArray()) _particles.Remove(id);
        foreach (var id in _lightning.Keys.Where(id => !live.Contains(id)).ToArray()) _lightning.Remove(id);
    }

    public void Dispose()
    {
        _envelopes.Clear();
        _particles.Clear();
        _lightning.Clear();
    }

    private sealed class ParticleSystemState(Random rng)
    {
        public readonly Random Rng = rng;
        public readonly List<Particle> Items = new();
        public float Carry;
    }

    private struct Particle
    {
        public Vector2 Pos;
        public Vector2 Prev;
        public Vector2 Vel;
        public float Age;
        public float Life;
        public float Size;
        public float Phase;
        public float Spin;
    }

    private sealed class LightningState(Random rng)
    {
        public readonly Random Rng = rng;
        public readonly List<Vector2> Main = new();
        public readonly List<List<Vector2>> Branches = new();
        public float Age = 999f;
        public float Life;
        public float Cooldown;
    }
}
