using System.Text.Json;
using System.Text.Json.Serialization;

namespace Auralith.Core;

public sealed record ProjectLoadResult(Scene Scene, IReadOnlyList<string> Warnings);

/// <summary>
/// Reads current Skia-era projects and migrates the older Tauri project shape without
/// re-introducing its AI systems. All loaded values are normalized before reaching the renderer.
/// </summary>
public static class SceneProjectCodec
{
    public const int CurrentSchemaVersion = 3;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        WriteIndented = true,
        Converters = { new JsonStringEnumConverter() }
    };

    public static string Serialize(Scene scene)
    {
        Normalize(scene);
        return JsonSerializer.Serialize(scene, JsonOptions);
    }

    public static ProjectLoadResult Deserialize(string json)
    {
        if (string.IsNullOrWhiteSpace(json))
            throw new InvalidDataException("Project file is empty.");

        using var doc = JsonDocument.Parse(json, new JsonDocumentOptions
        {
            AllowTrailingCommas = true,
            CommentHandling = JsonCommentHandling.Skip,
            MaxDepth = 128
        });

        if (doc.RootElement.ValueKind != JsonValueKind.Object)
            throw new InvalidDataException("Project root must be a JSON object.");

        var warnings = new List<string>();
        Scene scene;
        if (IsLegacyTauri(doc.RootElement))
        {
            scene = MigrateLegacyTauri(doc.RootElement, warnings);
            warnings.Insert(0, "Migrated legacy Auralith project to the Skia project schema.");
        }
        else
        {
            scene = JsonSerializer.Deserialize<Scene>(json, JsonOptions)
                    ?? throw new InvalidDataException("Project could not be read.");
        }

        Normalize(scene, warnings);
        return new ProjectLoadResult(scene, warnings);
    }

    public static void Normalize(Scene scene) => Normalize(scene, null);

    private static void Normalize(Scene scene, List<string>? warnings)
    {
        scene.SchemaVersion = CurrentSchemaVersion;
        scene.CanvasWidth = Math.Clamp(scene.CanvasWidth, 320, 7680);
        scene.CanvasHeight = Math.Clamp(scene.CanvasHeight, 180, 4320);
        scene.TargetFps = Math.Clamp(scene.TargetFps, 15, 120);
        scene.MasterIntensity = Clean(scene.MasterIntensity, 1f, 0f, 4f);
        scene.MasterBrightness = Clean(scene.MasterBrightness, 1f, 0f, 4f);
        scene.MasterSensitivity = Clean(scene.MasterSensitivity, 1f, 0f, 4f);
        scene.MasterParticleDensity = Clean(scene.MasterParticleDensity, 1f, 0f, 4f);
        scene.MasterMotionSpeed = Clean(scene.MasterMotionSpeed, 1f, 0.05f, 4f);
        scene.BackdropPath = string.IsNullOrWhiteSpace(scene.BackdropPath) ? null : scene.BackdropPath.Trim();
        scene.BackdropDataUrl = NormalizeDataUrl(scene.BackdropDataUrl, warnings);
        scene.Regions ??= new();

        foreach (var r in scene.Regions)
        {
            if (r.Id == Guid.Empty) r.Id = Guid.NewGuid();
            r.Name = string.IsNullOrWhiteSpace(r.Name) ? r.Kind.ToString() : r.Name.Trim();
            r.X = Clean(r.X, 0f, -scene.CanvasWidth * 2f, scene.CanvasWidth * 3f);
            r.Y = Clean(r.Y, 0f, -scene.CanvasHeight * 2f, scene.CanvasHeight * 3f);
            r.Width = Clean(r.Width, 160f, 1f, scene.CanvasWidth * 4f);
            r.Height = Clean(r.Height, 160f, 1f, scene.CanvasHeight * 4f);
            r.Rotation = Clean(r.Rotation, 0f, -36000f, 36000f);
            r.Radius = Clean(r.Radius, 80f, 1f, Math.Max(scene.CanvasWidth, scene.CanvasHeight) * 4f);
            r.Direction = Clean(r.Direction, 0f, -36000f, 36000f);
            r.Spread = Clean(r.Spread, 0.5f, 0f, 4f);
            r.Falloff = Clean(r.Falloff, 0.5f, 0f, 4f);
            r.Points ??= new();
            for (var i = r.Points.Count - 1; i >= 0; i--)
                if (!float.IsFinite(r.Points[i])) r.Points.RemoveAt(i);
            if ((r.Points.Count & 1) != 0) r.Points.RemoveAt(r.Points.Count - 1);

            r.Effects ??= new EffectStack();
            r.Effects.Items ??= new();
            foreach (var fx in r.Effects.Items)
                NormalizeEffect(fx);
        }
    }

    private static void NormalizeEffect(EffectInstance fx)
    {
        if (fx.Id == Guid.Empty) fx.Id = Guid.NewGuid();
        fx.Intensity = Clean(fx.Intensity, 0.7f, 0f, 4f);
        fx.Brightness = Clean(fx.Brightness, 1f, 0f, 4f);
        fx.Sensitivity = Clean(fx.Sensitivity, 0.7f, 0f, 4f);
        fx.Threshold = Clean(fx.Threshold, 0.15f, 0f, 1f);
        fx.Attack = Clean(fx.Attack, 0.05f, 0.002f, 10f);
        fx.Release = Clean(fx.Release, 0.2f, 0.002f, 10f);
        fx.Speed = Clean(fx.Speed, 1f, 0.01f, 20f);
        fx.Spread = Clean(fx.Spread, 0.5f, 0f, 4f);
        fx.Falloff = Clean(fx.Falloff, 0.5f, 0f, 4f);
        fx.Opacity = Clean(fx.Opacity, 1f, 0f, 1f);
        fx.Softness = Clean(fx.Softness, 0.5f, 0f, 4f);
        fx.ScaleAmount = Clean(fx.ScaleAmount, 0.2f, 0f, 4f);
        fx.AudioInfluence = Clean(fx.AudioInfluence, 1f, 0f, 1f);
        fx.Radius = Clean(fx.Radius, 80f, 1f, 4000f);
        fx.Thickness = Clean(fx.Thickness, 8f, 0.1f, 400f);
        fx.Frequency = Clean(fx.Frequency, 4f, 0.05f, 20f);
        fx.DutyCycle = Clean(fx.DutyCycle, 0.35f, 0.01f, 0.99f);
        fx.Count = Clean(fx.Count, 12f, 1f, 1000f);
        fx.Lifetime = Clean(fx.Lifetime, 0.8f, 0.01f, 30f);
        fx.Angle = Clean(fx.Angle, 0f, -36000f, 36000f);
        fx.Distortion = Clean(fx.Distortion, 0.25f, 0f, 4f);
        fx.Turbulence = Clean(fx.Turbulence, 0.35f, 0f, 4f);
        fx.MinOut = Clean(fx.MinOut, 0.15f, 0f, 4f);
        fx.MaxOut = Clean(fx.MaxOut, 1f, 0f, 4f);
        fx.HoldTime = Clean(fx.HoldTime, 0.12f, 0f, 10f);
        fx.FadeTime = Clean(fx.FadeTime, 0.35f, 0f, 10f);
        fx.Density = Clean(fx.Density, 0.5f, 0f, 4f);
        fx.WidthAmt = Clean(fx.WidthAmt, 0.4f, 0.01f, 4f);
        fx.HeightAmt = Clean(fx.HeightAmt, 0.6f, 0.01f, 4f);
        fx.Randomness = Clean(fx.Randomness, 0.35f, 0f, 1f);
    }

    private static bool IsLegacyTauri(JsonElement root)
        => TryGet(root, "version", out _) && (TryGet(root, "masters", out _) || TryGet(root, "backdropDataUrl", out _));

    private static Scene MigrateLegacyTauri(JsonElement root, List<string> warnings)
    {
        var scene = new Scene
        {
            SchemaVersion = CurrentSchemaVersion,
            CanvasWidth = Int(root, "width", 1920),
            CanvasHeight = Int(root, "height", 1080),
            Fit = EnumValue(root, "fit", FitMode.Fit),
            BackdropDataUrl = String(root, "backdropDataUrl"),
            ShowEditorOverlays = Bool(root, "showMarkers", true),
            View = ViewMode.Edit
        };

        if (TryGet(root, "masters", out var masters) && masters.ValueKind == JsonValueKind.Object)
        {
            scene.MasterIntensity = Float(masters, "intensity", 1f);
            scene.MasterBrightness = Float(masters, "brightness", 1f);
            scene.MasterSensitivity = Float(masters, "sensitivity", 1f);
            scene.MasterParticleDensity = Float(masters, "density", 1f);
            scene.MasterMotionSpeed = Float(masters, "motion", 1f);
        }

        if (!TryGet(root, "regions", out var regions) || regions.ValueKind != JsonValueKind.Array)
            return scene;

        foreach (var old in regions.EnumerateArray())
        {
            if (old.ValueKind != JsonValueKind.Object) continue;
            var oldKind = String(old, "kind") ?? "Stamp";
            var kind = oldKind switch
            {
                "Trace" => RegionKind.Trace,
                "Emitter" => RegionKind.Emitter,
                "Shape" => RegionKind.Stamp,
                "Prop" => RegionKind.Stamp,
                _ => RegionKind.Stamp
            };
            if (oldKind is "Shape" or "Prop")
                warnings.Add($"Legacy {oldKind} region converted to a Stamp region; external prop imagery is not imported.");

            var r = new Region
            {
                Id = GuidValue(old, "id"),
                Kind = kind,
                Name = String(old, "label") ?? oldKind,
                X = Float(old, "x", 0f),
                Y = Float(old, "y", 0f),
                Width = Float(old, "width", Math.Max(8f, Float(old, "sx", 160f))),
                Height = Float(old, "height", Math.Max(8f, Float(old, "sy", 160f))),
                Rotation = Float(old, "rotation", 0f),
                Radius = Float(old, "radius", 80f),
                ShowEditorMarker = true
            };

            if (TryGet(old, "points", out var points) && points.ValueKind == JsonValueKind.Array)
            {
                foreach (var p in points.EnumerateArray())
                {
                    if (p.ValueKind == JsonValueKind.Object)
                    {
                        r.Points.Add(Float(p, "x", 0f));
                        r.Points.Add(Float(p, "y", 0f));
                    }
                }
            }

            if (TryGet(old, "effects", out var effects) && effects.ValueKind == JsonValueKind.Array)
            {
                foreach (var oldFx in effects.EnumerateArray())
                {
                    if (oldFx.ValueKind != JsonValueKind.Object) continue;
                    var oldName = String(oldFx, "kind") ?? "Pulse";
                    var mapped = MapLegacyEffect(oldName, out var approximate);
                    if (approximate)
                        warnings.Add($"Legacy effect {oldName} converted to {mapped}; AI-only behavior was not restored.");
                    var fx = new EffectInstance
                    {
                        Id = GuidValue(oldFx, "id"),
                        Kind = mapped,
                        Enabled = Bool(oldFx, "enabled", true),
                        Intensity = Float(oldFx, "intensity", 0.8f),
                        Brightness = Float(oldFx, "brightness", 1f),
                        Opacity = Float(oldFx, "opacity", 1f),
                        Speed = Float(oldFx, "speed", 1f),
                        ScaleAmount = Math.Max(0f, Float(oldFx, "scale", 1f) - 1f),
                        Audio = MapAudio(String(oldFx, "audio")),
                        AudioInfluence = Float(oldFx, "audioInfluence", 0.7f),
                        PrimaryColor = ParseColor(String(oldFx, "color"), 0xFFD4AF37),
                        SecondaryColor = ParseColor(String(oldFx, "color2"), 0xFF7DD3FC),
                        Spread = Float(oldFx, "spread", 0.5f),
                        Softness = Float(oldFx, "feather", 0.5f)
                    };
                    r.Effects.Items.Add(fx);
                }
            }
            scene.Regions.Add(r);
        }

        return scene;
    }

    private static EffectKind MapLegacyEffect(string name, out bool approximate)
    {
        approximate = false;
        if (Enum.TryParse<EffectKind>(name, true, out var exact)) return exact;
        var mapped = name switch
        {
            "GlowBloom" => EffectKind.Glow,
            "GlitterSparkle" => EffectKind.Glitter,
            "FrostIce" => EffectKind.Snow,
            "CrystalGrowth" => EffectKind.OutlineEnergy,
            "IceShimmer" => EffectKind.Shimmer,
            "FrozenBreath" => EffectKind.Mist,
            "Fireflies" => EffectKind.OrbitingParticles,
            "BioluminescentSpores" => EffectKind.ParticleFountain,
            "SigilActivation" => EffectKind.RuneSequence,
            "ShadowTendrils" => EffectKind.VoidEnergy,
            "Eclipse" => EffectKind.LocalDim,
            "GravityWell" => EffectKind.GravityParticles,
            "SpatialWarp" => EffectKind.Refraction,
            "Kaleidoscope" => EffectKind.PrismaticLight,
            "MirrorFracture" => EffectKind.GlitchLight,
            "PixelDissolve" => EffectKind.ParticleBurst,
            "ScanlinePulse" => EffectKind.WaveSweep,
            "RgbSplit" => EffectKind.ChromaticPulse,
            "FilmBurn" => EffectKind.RealisticFlame,
            "CelestialStars" => EffectKind.Glitter,
            "CosmicNebula" => EffectKind.Aurora,
            "SmartNeon" => EffectKind.NeonGlow,
            _ => EffectKind.Pulse
        };
        approximate = true;
        return mapped;
    }

    private static AudioSource MapAudio(string? value)
        => Enum.TryParse<AudioSource>(value, true, out var a) ? a : AudioSource.Manual;

    private static string? NormalizeDataUrl(string? value, List<string>? warnings)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        value = value.Trim();
        if (!value.StartsWith("data:image/", StringComparison.OrdinalIgnoreCase) || !value.Contains(";base64,", StringComparison.OrdinalIgnoreCase))
        {
            warnings?.Add("Ignored an invalid embedded backdrop payload.");
            return null;
        }
        var comma = value.IndexOf(',');
        if (comma < 0) return null;
        try
        {
            var bytes = Convert.FromBase64String(value[(comma + 1)..]);
            if (bytes.Length == 0 || bytes.Length > 64 * 1024 * 1024)
            {
                warnings?.Add("Ignored an empty or oversized embedded backdrop.");
                return null;
            }
        }
        catch (FormatException)
        {
            warnings?.Add("Ignored a malformed embedded backdrop.");
            return null;
        }
        return value;
    }

    public static byte[]? DecodeBackdropDataUrl(string? dataUrl)
    {
        if (string.IsNullOrWhiteSpace(dataUrl)) return null;
        var comma = dataUrl.IndexOf(',');
        if (comma < 0) return null;
        try { return Convert.FromBase64String(dataUrl[(comma + 1)..]); }
        catch (FormatException) { return null; }
    }

    private static float Clean(float value, float fallback, float min, float max)
        => float.IsFinite(value) ? Math.Clamp(value, min, max) : fallback;

    private static bool TryGet(JsonElement obj, string name, out JsonElement value)
    {
        if (obj.TryGetProperty(name, out value)) return true;
        foreach (var p in obj.EnumerateObject())
            if (p.Name.Equals(name, StringComparison.OrdinalIgnoreCase)) { value = p.Value; return true; }
        value = default;
        return false;
    }

    private static string? String(JsonElement obj, string name)
        => TryGet(obj, name, out var e) && e.ValueKind == JsonValueKind.String ? e.GetString() : null;

    private static int Int(JsonElement obj, string name, int fallback)
        => TryGet(obj, name, out var e) && e.TryGetInt32(out var v) ? v : fallback;

    private static float Float(JsonElement obj, string name, float fallback)
        => TryGet(obj, name, out var e) && e.ValueKind == JsonValueKind.Number && e.TryGetSingle(out var v) ? v : fallback;

    private static bool Bool(JsonElement obj, string name, bool fallback)
        => TryGet(obj, name, out var e) && e.ValueKind is JsonValueKind.True or JsonValueKind.False ? e.GetBoolean() : fallback;

    private static Guid GuidValue(JsonElement obj, string name)
        => Guid.TryParse(String(obj, name), out var g) && g != Guid.Empty ? g : Guid.NewGuid();

    private static T EnumValue<T>(JsonElement obj, string name, T fallback) where T : struct, Enum
        => Enum.TryParse<T>(String(obj, name), true, out var v) ? v : fallback;

    private static uint ParseColor(string? text, uint fallback)
    {
        if (string.IsNullOrWhiteSpace(text)) return fallback;
        var s = text.Trim().TrimStart('#');
        if (s.Length == 6 && uint.TryParse(s, System.Globalization.NumberStyles.HexNumber, null, out var rgb))
            return 0xFF000000u | rgb;
        if (s.Length == 8 && uint.TryParse(s, System.Globalization.NumberStyles.HexNumber, null, out var argb))
            return argb;
        return fallback;
    }
}
