using Auralith.Core;

namespace Auralith.Rendering;

internal static class EffectRenderer
{
    public static void Apply(byte[] pixels, int w, int h, IReadOnlyList<Region> regions, AudioBands audio, Scene scene, float time)
    {
        if (regions.Count == 0) return;
        var master = scene.MasterIntensity * scene.MasterBrightness;
        foreach (var region in regions)
        {
            foreach (var fx in region.Effects.Items)
            {
                if (!fx.Enabled) continue;
                var drive = Drive(fx, audio) * scene.MasterSensitivity;
                ApplyOne(pixels, w, h, region, fx, drive, master * scene.MasterParticleDensity, time * scene.MasterMotionSpeed);
            }
        }
    }

    public static bool HasHandler(EffectKind kind) => true; // every kind is handled in ApplyOne

    private static float Drive(EffectInstance fx, AudioBands a)
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
        if (fx.InvertResponse) raw = 1 - raw;
        raw = Math.Clamp((raw - fx.Threshold) / Math.Max(0.001f, 1 - fx.Threshold), 0, 1);
        var audio = Math.Clamp(raw * fx.Sensitivity, 0, 1);
        return fx.Audio == AudioSource.Manual ? 1f : (1 - fx.AudioInfluence) + fx.AudioInfluence * audio;
    }

    private static void ApplyOne(byte[] px, int w, int h, Region r, EffectInstance fx, float drive, float master, float t)
    {
        var amt = Math.Clamp(fx.Intensity * fx.Opacity * fx.Brightness * drive * master, 0, 4);
        switch (fx.Kind)
        {
            case EffectKind.Pulse: Brightness(px, w, h, r, 1f + amt * 0.9f + fx.ScaleAmount * drive, fx); break;
            case EffectKind.Flicker:
                var n = Hash(fx.Seed, (int)(t * (2 + fx.Speed * 8)));
                var flick = fx.MinOut + (fx.MaxOut - fx.MinOut) * (0.5f + 0.5f * MathF.Sin(t * 6 * fx.Speed + n * 6.28f * fx.Randomness));
                Brightness(px, w, h, r, 0.4f + amt * flick, fx); break;
            case EffectKind.LightSurge: Brightness(px, w, h, r, 1f + MathF.Pow(drive, 0.55f) * amt * 1.3f, fx); break;
            case EffectKind.Strobe:
                var hz = Math.Clamp(fx.Frequency, 0.5f, 8f);
                var phase = (t * hz) % 1f;
                Brightness(px, w, h, r, phase < fx.DutyCycle ? 0.3f + amt : 0.2f, fx); break;
            case EffectKind.Glow:
            case EffectKind.NeonGlow:
            case EffectKind.PeakHoldGlow: Glow(px, w, h, r, amt, fx, t); break;
            case EffectKind.BreathingGlow:
                var b = fx.MinOut + (fx.MaxOut - fx.MinOut) * (0.5f + 0.5f * MathF.Sin(t * fx.Speed));
                Glow(px, w, h, r, amt * b, fx, t); break;
            case EffectKind.Afterglow: Glow(px, w, h, r, amt * MathF.Exp(-((t * 0.4f) % 1f) / Math.Max(0.05f, fx.FadeTime)), fx, t); break;
            case EffectKind.EchoPulse:
                for (var i = 0; i < Math.Max(1, (int)fx.Count); i++)
                    Glow(px, w, h, r, amt * MathF.Pow(0.55f, i), fx, t - i * fx.HoldTime); break;
            case EffectKind.WaveSweep: Sweep(px, w, h, r, amt, fx, t); break;
            case EffectKind.Spotlight: Spot(px, w, h, r, amt, fx, false); break;
            case EffectKind.Halo: Ring(px, w, h, r, amt, fx, t); break;
            case EffectKind.LightRays:
            case EffectKind.GodRays:
            case EffectKind.Starburst: Rays(px, w, h, r, amt, fx, t); break;
            case EffectKind.LensFlare: Flare(px, w, h, r, amt, fx, t); break;
            case EffectKind.EnergyFlow:
            case EffectKind.Plasma:
            case EffectKind.MagicEnergy: Flow(px, w, h, r, amt, fx, t); break;
            case EffectKind.EnergyRipple:
            case EffectKind.Shockwave:
            case EffectKind.AudioRipple:
            case EffectKind.WaterRipple: Ripple(px, w, h, r, amt, fx, t); break;
            case EffectKind.VoidEnergy: DimOutside(px, w, h, r, 0.4f + 0.4f * amt); Glow(px, w, h, r, amt * 0.6f, fx, t); break;
            case EffectKind.Portal:
            case EffectKind.Vortex: Vortex(px, w, h, r, amt, fx, t); break;
            case EffectKind.EnergyBeam:
            case EffectKind.Laser: Beam(px, w, h, r, amt, fx, t); break;
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
            case EffectKind.Snow: Particles(px, w, h, r, amt, fx, t); break;
            case EffectKind.SpectralAura: Glow(px, w, h, r, amt, fx, t); Flow(px, w, h, r, amt * 0.4f, fx, t); break;
            case EffectKind.LightningArc:
            case EffectKind.ElectricCrawl: Lightning(px, w, h, r, amt, fx, t); break;
            case EffectKind.ThunderFlash:
            case EffectKind.BeatFlash:
            case EffectKind.TransientBurst: Brightness(px, w, h, r, 1f + amt * drive * 1.6f, fx); break;
            case EffectKind.RealisticFlame: Flame(px, w, h, r, amt, fx, t); break;
            case EffectKind.HeatDistortion:
            case EffectKind.Refraction:
            case EffectKind.HolographicDistortion:
            case EffectKind.GlitchLight: Distort(px, w, h, r, amt, fx, t); break;
            case EffectKind.SmokeFog:
            case EffectKind.Mist:
            case EffectKind.AtmosphericHaze: Haze(px, w, h, r, amt, fx, t); break;
            case EffectKind.HueShift: Hue(px, w, h, r, amt * (0.25f + drive), fx); break;
            case EffectKind.ChromaticPulse:
            case EffectKind.PrismaticLight: Chroma(px, w, h, r, amt, fx, t); break;
            case EffectKind.NeonChase:
            case EffectKind.TraceChase:
            case EffectKind.RhythmChase:
            case EffectKind.RuneSequence:
            case EffectKind.RuneGlow:
            case EffectKind.TracePulse:
            case EffectKind.OutlineEnergy: Outline(px, w, h, r, amt, fx, t); break;
            case EffectKind.Shimmer: Sparkle(px, w, h, r, amt, fx, t); break;
            case EffectKind.ShadowPulse:
            case EffectKind.RoomDim:
            case EffectKind.LocalDim: DimOutside(px, w, h, r, Math.Clamp(fx.Intensity * drive, 0, 0.85f)); break;
            case EffectKind.ContrastSurge: Contrast(px, w, h, r, amt); break;
            case EffectKind.Rain: Rain(px, w, h, r, amt, fx, t); break;
            case EffectKind.WetReflection:
            case EffectKind.WaterReflection:
            case EffectKind.Caustics: Water(px, w, h, r, amt, fx, t); break;
            case EffectKind.Aurora: Aurora(px, w, h, r, amt, fx, t); break;
            case EffectKind.BassExpansion: Brightness(px, w, h, r, 1f + fx.ScaleAmount * drive * amt, fx); Glow(px, w, h, r, amt * drive, fx, t); break;
            case EffectKind.FrequencyGradient:
            case EffectKind.SpectrumSweep: Sweep(px, w, h, r, amt, fx, t); Hue(px, w, h, r, 0.3f + drive * 0.5f, fx); break;
            default:
                Brightness(px, w, h, r, 1f + amt * 0.5f, fx); break;
        }
    }

    private static bool Inside(Region r, int x, int y)
    {
        if (r.Kind == RegionKind.Trace && r.Points.Count >= 6) return PointInPoly(r.Points, x, y);
        if (r.Kind == RegionKind.Emitter)
        {
            var dx = x - r.X; var dy = y - r.Y;
            return dx * dx + dy * dy <= r.Radius * r.Radius;
        }
        var lx = x - r.X; var ly = y - r.Y;
        if (r.Shape is StampShape.Circle or StampShape.Ellipse)
        {
            var nx = (lx - r.Width / 2f) / Math.Max(1, r.Width / 2f);
            var ny = (ly - r.Height / 2f) / Math.Max(1, r.Height / 2f);
            return nx * nx + ny * ny <= 1f;
        }
        return lx >= 0 && ly >= 0 && lx <= r.Width && ly <= r.Height;
    }

    private static bool PointInPoly(List<float> pts, int x, int y)
    {
        var inside = false;
        var n = pts.Count / 2;
        for (int i = 0, j = n - 1; i < n; j = i++)
        {
            var xi = pts[i * 2]; var yi = pts[i * 2 + 1];
            var xj = pts[j * 2]; var yj = pts[j * 2 + 1];
            var inter = ((yi > y) != (yj > y)) && (x < (xj - xi) * (y - yi) / ((yj - yi) == 0 ? 1 : (yj - yi)) + xi);
            if (inter) inside = !inside;
        }
        return inside;
    }

    private static void ForRegion(int w, int h, Region r, Action<int, int, int> body)
    {
        var pad = (int)Math.Max(r.Radius, 16);
        var x0 = Math.Max(0, (int)r.X - pad);
        var y0 = Math.Max(0, (int)r.Y - pad);
        var x1 = Math.Min(w, (int)(r.X + Math.Max(r.Width, r.Radius) + pad));
        var y1 = Math.Min(h, (int)(r.Y + Math.Max(r.Height, r.Radius) + pad));
        if (r.Kind == RegionKind.Trace && r.Points.Count >= 2) { x0 = y0 = 0; x1 = w; y1 = h; }
        for (var y = y0; y < y1; y++)
        for (var x = x0; x < x1; x++)
            if (Inside(r, x, y)) body(x, y, (y * w + x) * 4);
    }

    private static (byte r, byte g, byte b) Rgb(uint c) => ((byte)((c >> 16) & 255), (byte)((c >> 8) & 255), (byte)(c & 255));
    private static byte Clamp(float v) => (byte)Math.Clamp((int)v, 0, 255);
    private static float Hash(int seed, int i)
    {
        var x = (uint)(seed * 747796405 + i * 2891336453);
        x = (x ^ (x >> 16)) * 0x7feb352d;
        return (x & 0xFFFF) / 65535f;
    }

    private static void Add(byte[] px, int i, float r, float g, float b)
    {
        px[i] = Clamp(px[i] + b);
        px[i + 1] = Clamp(px[i + 1] + g);
        px[i + 2] = Clamp(px[i + 2] + r);
    }

    private static void Brightness(byte[] px, int w, int h, Region r, float mul, EffectInstance fx)
    {
        mul = Math.Clamp(mul * fx.Opacity, 0.05f, 3.5f);
        ForRegion(w, h, r, (_, _, i) =>
        {
            px[i] = Clamp(px[i] * mul);
            px[i + 1] = Clamp(px[i + 1] * mul);
            px[i + 2] = Clamp(px[i + 2] * mul);
        });
    }

    private static void Glow(byte[] px, int w, int h, Region r, float amt, EffectInstance fx, float t)
    {
        var (cr, cg, cb) = Rgb(fx.PrimaryColor);
        ForRegion(w, h, r, (_, _, i) => Add(px, i, cr * amt * 0.5f, cg * amt * 0.5f, cb * amt * 0.5f));
    }

    private static void Hue(byte[] px, int w, int h, Region r, float amount, EffectInstance fx)
    {
        var shift = amount + fx.Angle / 360f;
        ForRegion(w, h, r, (_, _, i) =>
        {
            var b = px[i] / 255f; var g = px[i + 1] / 255f; var rr = px[i + 2] / 255f;
            px[i] = Clamp((b * (1 - shift) + g * shift) * 255);
            px[i + 1] = Clamp((g * (1 - shift) + rr * shift) * 255);
            px[i + 2] = Clamp((rr * (1 - shift) + b * shift) * 255);
        });
    }

    private static void DimOutside(byte[] px, int w, int h, Region r, float dim)
    {
        var keep = 1f - Math.Clamp(dim, 0, 0.85f);
        for (var y = 0; y < h; y++)
        for (var x = 0; x < w; x++)
        {
            if (Inside(r, x, y)) continue;
            var i = (y * w + x) * 4;
            px[i] = Clamp(px[i] * keep);
            px[i + 1] = Clamp(px[i + 1] * keep);
            px[i + 2] = Clamp(px[i + 2] * keep);
        }
    }

    private static void Contrast(byte[] px, int w, int h, Region r, float amt)
    {
        ForRegion(w, h, r, (_, _, i) =>
        {
            for (var c = 0; c < 3; c++)
            {
                var v = px[i + c] / 255f;
                v = 0.5f + (v - 0.5f) * (1 + amt);
                px[i + c] = Clamp(v * 255);
            }
        });
    }

    private static (float cx, float cy) Center(Region r) =>
        r.Kind == RegionKind.Emitter ? (r.X, r.Y) : (r.X + r.Width / 2f, r.Y + r.Height / 2f);

    private static void Spot(byte[] px, int w, int h, Region r, float amt, EffectInstance fx, bool ring)
    {
        var (cx, cy) = Center(r);
        var rad = Math.Max(8, fx.Radius);
        var (cr, cg, cb) = Rgb(fx.PrimaryColor);
        ForRegion(w, h, r, (x, y, i) =>
        {
            var d = MathF.Sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy)) / rad;
            var wgt = Math.Clamp(1 - d, 0, 1);
            wgt = MathF.Pow(wgt, 1 + fx.Falloff * 2);
            Add(px, i, cr * amt * wgt, cg * amt * wgt, cb * amt * wgt);
        });
    }

    private static void Ring(byte[] px, int w, int h, Region r, float amt, EffectInstance fx, float t)
    {
        var (cx, cy) = Center(r);
        var rad = Math.Max(8, fx.Radius);
        var thick = Math.Max(2, fx.Thickness);
        var (cr, cg, cb) = Rgb(fx.PrimaryColor);
        ForRegion(w, h, r, (x, y, i) =>
        {
            var d = MathF.Abs(MathF.Sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy)) - rad);
            var wgt = Math.Clamp(1 - d / thick, 0, 1);
            Add(px, i, cr * amt * wgt, cg * amt * wgt, cb * amt * wgt);
        });
    }

    private static void Rays(byte[] px, int w, int h, Region r, float amt, EffectInstance fx, float t)
    {
        var (cx, cy) = Center(r);
        var rays = Math.Clamp((int)fx.Count, 3, 24);
        var (cr, cg, cb) = Rgb(fx.PrimaryColor);
        ForRegion(w, h, r, (x, y, i) =>
        {
            var ang = MathF.Atan2(y - cy, x - cx) + fx.Angle * 0.01745f + t * fx.Speed * 0.2f;
            var m = MathF.Abs(MathF.Sin(ang * rays));
            var wgt = MathF.Pow(m, 2 + fx.Softness * 4);
            Add(px, i, cr * amt * wgt * 0.7f, cg * amt * wgt * 0.7f, cb * amt * wgt * 0.7f);
        });
    }

    private static void Flare(byte[] px, int w, int h, Region r, float amt, EffectInstance fx, float t)
    {
        Spot(px, w, h, r, amt, fx, false);
        Rays(px, w, h, r, amt * 0.4f, fx, t);
    }

    private static void Flow(byte[] px, int w, int h, Region r, float amt, EffectInstance fx, float t)
    {
        var (cr, cg, cb) = Rgb(fx.PrimaryColor);
        var (sr, sg, sb) = Rgb(fx.SecondaryColor);
        ForRegion(w, h, r, (x, y, i) =>
        {
            var n = 0.5f + 0.5f * MathF.Sin(x * 0.04f * fx.WidthAmt + t * fx.Speed * 3 + MathF.Sin(y * 0.03f) * fx.Turbulence * 4);
            Add(px, i,
                (cr * n + sr * (1 - n)) * amt * 0.45f,
                (cg * n + sg * (1 - n)) * amt * 0.45f,
                (cb * n + sb * (1 - n)) * amt * 0.45f);
        });
    }

    private static void Ripple(byte[] px, int w, int h, Region r, float amt, EffectInstance fx, float t)
    {
        var (cx, cy) = Center(r);
        var (cr, cg, cb) = Rgb(fx.PrimaryColor);
        ForRegion(w, h, r, (x, y, i) =>
        {
            var d = MathF.Sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy));
            var wave = 0.5f + 0.5f * MathF.Sin(d * 0.08f * (1 + fx.Count * 0.1f) - t * fx.Speed * 6);
            Add(px, i, cr * amt * wave * 0.4f, cg * amt * wave * 0.4f, cb * amt * wave * 0.4f);
        });
    }

    private static void Vortex(byte[] px, int w, int h, Region r, float amt, EffectInstance fx, float t)
    {
        var (cx, cy) = Center(r);
        var (cr, cg, cb) = Rgb(fx.PrimaryColor);
        ForRegion(w, h, r, (x, y, i) =>
        {
            var dx = x - cx; var dy = y - cy;
            var ang = MathF.Atan2(dy, dx) + t * fx.Speed;
            var d = MathF.Sqrt(dx * dx + dy * dy) / Math.Max(8, fx.Radius);
            var wgt = Math.Clamp(1 - d, 0, 1) * (0.5f + 0.5f * MathF.Sin(ang * 6));
            Add(px, i, cr * amt * wgt, cg * amt * wgt, cb * amt * wgt);
        });
    }

    private static void Beam(byte[] px, int w, int h, Region r, float amt, EffectInstance fx, float t)
    {
        var (cx, cy) = Center(r);
        var ang = fx.Angle * 0.01745f;
        var ca = MathF.Cos(ang); var sa = MathF.Sin(ang);
        var (cr, cg, cb) = Rgb(fx.PrimaryColor);
        var thick = Math.Max(2, fx.WidthAmt * 40);
        ForRegion(w, h, r, (x, y, i) =>
        {
            var dx = x - cx; var dy = y - cy;
            var lat = MathF.Abs(-sa * dx + ca * dy);
            var wgt = Math.Clamp(1 - lat / thick, 0, 1);
            Add(px, i, cr * amt * wgt, cg * amt * wgt, cb * amt * wgt);
        });
    }

    private static void Lightning(byte[] px, int w, int h, Region r, float amt, EffectInstance fx, float t)
    {
        var (cx, cy) = Center(r);
        var (cr, cg, cb) = Rgb(fx.PrimaryColor);
        var seed = fx.Seed + (int)(t * fx.Frequency);
        ForRegion(w, h, r, (x, y, i) =>
        {
            var n = Hash(seed, x / 6 + y * 13);
            var bolt = n > 0.92f - fx.Randomness * 0.1f ? 1f : 0f;
            Add(px, i, cr * amt * bolt, cg * amt * bolt, cb * amt * bolt);
        });
    }

    private static void Flame(byte[] px, int w, int h, Region r, float amt, EffectInstance fx, float t)
    {
        var baseY = r.Kind == RegionKind.Emitter ? r.Y : r.Y + r.Height;
        var cx = r.Kind == RegionKind.Emitter ? r.X : r.X + r.Width / 2f;
        var height = Math.Max(20, fx.HeightAmt * 220);
        var width = Math.Max(8, fx.WidthAmt * 80);
        ForRegion(w, h, r, (x, y, i) =>
        {
            var dy = baseY - y;
            if (dy < 0 || dy > height) return;
            var n = MathF.Sin(x * 0.08f + t * fx.Speed * 8 + Hash(fx.Seed, y) * fx.Turbulence * 6);
            var env = Math.Clamp(1 - dy / height, 0, 1);
            var lat = MathF.Abs(x - cx - n * 12) / (width * (0.35f + env));
            if (lat > 1) return;
            var heat = (1 - lat) * env * amt;
            Add(px, i, 255 * heat, 90 * heat + 80 * env * heat, 20 * heat);
        });
    }

    private static void Distort(byte[] px, int w, int h, Region r, float amt, EffectInstance fx, float t)
    {
        ForRegion(w, h, r, (x, y, i) =>
        {
            var shift = (int)(MathF.Sin(y * 0.08f + t * fx.Speed * 5) * fx.Distortion * 8);
            var sx = Math.Clamp(x + shift, 0, w - 1);
            var si = (y * w + sx) * 4;
            px[i] = px[si]; px[i + 1] = px[si + 1]; px[i + 2] = px[si + 2];
        });
    }

    private static void Haze(byte[] px, int w, int h, Region r, float amt, EffectInstance fx, float t)
    {
        var (cr, cg, cb) = Rgb(fx.PrimaryColor);
        ForRegion(w, h, r, (x, y, i) =>
        {
            var n = 0.5f + 0.5f * MathF.Sin(x * 0.01f + y * 0.01f + t * fx.Speed);
            var a = amt * fx.Opacity * fx.Density * n * 0.35f;
            Add(px, i, cr * a, cg * a, cb * a);
        });
    }

    private static void Chroma(byte[] px, int w, int h, Region r, float amt, EffectInstance fx, float t)
    {
        ForRegion(w, h, r, (x, y, i) =>
        {
            var s = (int)(fx.Spread * 6 * amt);
            var xl = Math.Clamp(x - s, 0, w - 1);
            var xr = Math.Clamp(x + s, 0, w - 1);
            px[i + 2] = px[(y * w + xr) * 4 + 2];
            px[i] = px[(y * w + xl) * 4];
        });
    }

    private static void Outline(byte[] px, int w, int h, Region r, float amt, EffectInstance fx, float t)
    {
        var (cr, cg, cb) = Rgb(fx.PrimaryColor);
        var chase = (t * fx.Speed) % 1f;
        ForRegion(w, h, r, (x, y, i) =>
        {
            var edge = !Inside(r, x + 2, y) || !Inside(r, x - 2, y) || !Inside(r, x, y + 2) || !Inside(r, x, y - 2);
            if (!edge) return;
            var wgt = 0.5f + 0.5f * MathF.Sin((x + y) * 0.05f + chase * 6.28f);
            Add(px, i, cr * amt * wgt, cg * amt * wgt, cb * amt * wgt);
        });
    }

    private static void Sparkle(byte[] px, int w, int h, Region r, float amt, EffectInstance fx, float t)
    {
        ForRegion(w, h, r, (x, y, i) =>
        {
            var tw = Hash(fx.Seed + (int)(t * fx.Speed * 4), x * 131 + y);
            if (tw > 0.97f - fx.Randomness * 0.05f)
                Add(px, i, 255 * amt, 240 * amt, 180 * amt);
        });
    }

    private static void Sweep(byte[] px, int w, int h, Region r, float amt, EffectInstance fx, float t)
    {
        var (cr, cg, cb) = Rgb(fx.PrimaryColor);
        var pos = (t * fx.Speed * 0.25f) % 1f;
        ForRegion(w, h, r, (x, y, i) =>
        {
            var u = x / (float)Math.Max(1, w);
            var d = MathF.Abs(u - pos);
            var wgt = Math.Clamp(1 - d / Math.Max(0.02f, fx.WidthAmt * 0.2f), 0, 1);
            Add(px, i, cr * amt * wgt, cg * amt * wgt, cb * amt * wgt);
        });
    }

    private static void Particles(byte[] px, int w, int h, Region r, float amt, EffectInstance fx, float t)
    {
        var (cx, cy) = Center(r);
        var (cr, cg, cb) = Rgb(fx.PrimaryColor);
        var n = Math.Clamp((int)(8 + fx.Density * 40), 4, 80);
        for (var i = 0; i < n; i++)
        {
            var u = Hash(fx.Seed, i);
            var v = Hash(fx.Seed + 19, i);
            float x, y;
            if (fx.Kind is EffectKind.OrbitingParticles)
            {
                var a = t * fx.Speed + u * 6.28f;
                x = cx + MathF.Cos(a) * fx.Radius * (0.4f + v);
                y = cy + MathF.Sin(a) * fx.Radius * (0.4f + v);
            }
            else if (fx.Kind is EffectKind.ParticleFountain or EffectKind.Embers or EffectKind.ReverseGravity)
            {
                var life = (t * fx.Speed * 0.4f + u) % 1f;
                x = cx + (v - 0.5f) * fx.Spread * 80;
                y = cy - life * fx.Lifetime * 140 * (fx.Kind == EffectKind.ReverseGravity ? 1 : 1);
            }
            else if (fx.Kind is EffectKind.Snow or EffectKind.Ash or EffectKind.DustMotes)
            {
                var life = (t * fx.Speed * 0.15f + u) % 1f;
                x = cx + (v - 0.5f) * 200 + MathF.Sin(t + u * 8) * 20;
                y = (r.Y) + life * Math.Max(40, r.Height);
            }
            else
            {
                var life = (t * fx.Speed + u) % 1f;
                var ang = v * 6.28f;
                x = cx + MathF.Cos(ang) * life * fx.Spread * 90;
                y = cy + MathF.Sin(ang) * life * fx.Spread * 90;
            }
            Plot(px, w, h, (int)x, (int)y, cr, cg, cb, amt);
        }
    }

    private static void Rain(byte[] px, int w, int h, Region r, float amt, EffectInstance fx, float t)
    {
        var n = Math.Clamp((int)(20 + fx.Density * 80), 8, 120);
        var (cr, cg, cb) = Rgb(fx.PrimaryColor);
        for (var i = 0; i < n; i++)
        {
            var u = Hash(fx.Seed, i);
            var x = (int)(r.X + u * Math.Max(8, r.Width));
            var y = (int)(r.Y + ((t * fx.Speed * 2 + Hash(fx.Seed, i + 3)) % 1f) * Math.Max(20, r.Height));
            for (var k = 0; k < 6; k++) Plot(px, w, h, x, y + k, cr, cg, cb, amt * 0.6f);
        }
    }

    private static void Water(byte[] px, int w, int h, Region r, float amt, EffectInstance fx, float t)
    {
        Ripple(px, w, h, r, amt, fx, t);
        Distort(px, w, h, r, amt * 0.4f, fx, t);
    }

    private static void Aurora(byte[] px, int w, int h, Region r, float amt, EffectInstance fx, float t)
    {
        var (cr, cg, cb) = Rgb(fx.PrimaryColor);
        var (sr, sg, sb) = Rgb(fx.SecondaryColor);
        ForRegion(w, h, r, (x, y, i) =>
        {
            var n = 0.5f + 0.5f * MathF.Sin(x * 0.02f + t * fx.Speed + MathF.Sin(y * 0.03f) * fx.Turbulence * 3);
            var hgt = Math.Clamp(1 - (y - r.Y) / Math.Max(1, r.Height), 0, 1);
            Add(px, i, (cr * n + sr * (1 - n)) * amt * hgt * 0.5f,
                (cg * n + sg * (1 - n)) * amt * hgt * 0.5f,
                (cb * n + sb * (1 - n)) * amt * hgt * 0.5f);
        });
    }

    private static void Plot(byte[] px, int w, int h, int x, int y, byte r, byte g, byte b, float amt)
    {
        if ((uint)x >= (uint)w || (uint)y >= (uint)h) return;
        Add(px, (y * w + x) * 4, r * amt, g * amt, b * amt);
    }
}
