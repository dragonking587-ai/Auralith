using Auralith.Core;

namespace Auralith.Rendering;

internal static class EffectRenderer
{
    public static void Apply(byte[] pixels, int w, int h, IReadOnlyList<Region> regions, AudioBands audio, Scene scene, float time)
    {
        if (regions.Count == 0) return;
        foreach (var region in regions)
        {
            if (region.Effects.Items.Count == 0) continue;
            foreach (var fx in region.Effects.Items)
            {
                if (!fx.Enabled) continue;
                var drive = Drive(fx, audio) * scene.MasterSensitivity;
                var intensity = fx.Intensity * scene.MasterIntensity * scene.MasterBrightness;
                ApplyOne(pixels, w, h, region, fx, drive, intensity, time);
            }
        }
    }

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
        return Math.Clamp(raw * fx.Sensitivity, 0, 1);
    }

    private static void ApplyOne(byte[] px, int w, int h, Region r, EffectInstance fx, float drive, float intensity, float time)
    {
        var amount = intensity * (0.25f + 0.75f * drive);
        switch (fx.Kind)
        {
            case EffectKind.Pulse:
                Brightness(px, w, h, r, 1f + amount * 0.85f, fx);
                break;
            case EffectKind.Flicker:
                var n = 0.5f + 0.5f * MathF.Sin(time * 17f + fx.Seed) * MathF.Sin(time * 7.3f + r.X);
                Brightness(px, w, h, r, 0.55f + amount * n, fx);
                break;
            case EffectKind.LightSurge:
                var surge = MathF.Pow(drive, 0.6f);
                Brightness(px, w, h, r, 1f + surge * amount * 1.2f, fx);
                break;
            case EffectKind.Strobe:
                var hz = Math.Clamp(fx.Speed * 4f, 0.5f, 8f);
                var on = (MathF.Sin(time * hz * MathF.PI * 2) > 0.15f) ? 1f : 0.15f;
                Brightness(px, w, h, r, 0.4f + amount * on, fx);
                break;
            case EffectKind.Glow:
            case EffectKind.BreathingGlow:
                var breath = fx.Kind == EffectKind.BreathingGlow ? 0.5f + 0.5f * MathF.Sin(time * fx.Speed) : 1f;
                Glow(px, w, h, r, amount * breath, fx);
                break;
            case EffectKind.HueShift:
                Hue(px, w, h, r, amount * (0.3f + drive), fx);
                break;
            case EffectKind.RoomDim:
                DimOutside(px, w, h, r, 0.35f + 0.5f * amount);
                break;
        }
    }

    private static bool Inside(Region r, int x, int y)
    {
        if (r.Kind == RegionKind.Trace && r.Points.Count >= 6)
            return PointInPoly(r.Points, x, y);
        var cx = r.X + r.Width / 2f;
        var cy = r.Y + r.Height / 2f;
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
        var x0 = Math.Max(0, (int)r.X - (int)r.Radius - 8);
        var y0 = Math.Max(0, (int)r.Y - (int)r.Radius - 8);
        var x1 = Math.Min(w, (int)(r.X + Math.Max(r.Width, r.Radius) + 8));
        var y1 = Math.Min(h, (int)(r.Y + Math.Max(r.Height, r.Radius) + 8));
        if (r.Kind == RegionKind.Trace && r.Points.Count >= 2)
        {
            x0 = y0 = 0; x1 = w; y1 = h;
        }
        for (var y = y0; y < y1; y++)
        for (var x = x0; x < x1; x++)
        {
            if (!Inside(r, x, y)) continue;
            body(x, y, (y * w + x) * 4);
        }
    }

    private static void Brightness(byte[] px, int w, int h, Region r, float mul, EffectInstance fx)
    {
        mul = Math.Clamp(mul * (fx.Opacity), 0.05f, 3f);
        ForRegion(w, h, r, (_, _, i) =>
        {
            px[i] = Clamp(px[i] * mul);
            px[i + 1] = Clamp(px[i + 1] * mul);
            px[i + 2] = Clamp(px[i + 2] * mul);
        });
    }

    private static void Glow(byte[] px, int w, int h, Region r, float amount, EffectInstance fx)
    {
        var cr = (fx.PrimaryColor >> 16) & 255;
        var cg = (fx.PrimaryColor >> 8) & 255;
        var cb = fx.PrimaryColor & 255;
        ForRegion(w, h, r, (_, _, i) =>
        {
            px[i] = Clamp(px[i] + cb * amount * 0.45f);
            px[i + 1] = Clamp(px[i + 1] + cg * amount * 0.45f);
            px[i + 2] = Clamp(px[i + 2] + cr * amount * 0.45f);
        });
    }

    private static void Hue(byte[] px, int w, int h, Region r, float amount, EffectInstance fx)
    {
        var shift = amount * 2f;
        ForRegion(w, h, r, (_, _, i) =>
        {
            var b = px[i] / 255f; var g = px[i + 1] / 255f; var rr = px[i + 2] / 255f;
            var nb = Math.Clamp(b * (1 - shift) + g * shift, 0, 1);
            var ng = Math.Clamp(g * (1 - shift) + rr * shift, 0, 1);
            var nr = Math.Clamp(rr * (1 - shift) + b * shift, 0, 1);
            px[i] = Clamp(nb * 255); px[i + 1] = Clamp(ng * 255); px[i + 2] = Clamp(nr * 255);
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

    private static byte Clamp(float v) => (byte)Math.Clamp((int)v, 0, 255);
}
