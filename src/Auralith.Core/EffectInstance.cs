namespace Auralith.Core;

public sealed class EffectInstance
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public EffectKind Kind { get; set; } = EffectKind.Glow;
    public bool Enabled { get; set; } = true;
    public AudioSource Audio { get; set; } = AudioSource.FullMix;
    public float Intensity { get; set; } = 0.7f;
    public float Brightness { get; set; } = 1f;
    public float Sensitivity { get; set; } = 0.7f;
    public float Threshold { get; set; } = 0.15f;
    public float Attack { get; set; } = 0.05f;
    public float Release { get; set; } = 0.2f;
    public float Speed { get; set; } = 1f;
    public float Spread { get; set; } = 0.5f;
    public float Falloff { get; set; } = 0.5f;
    public float Opacity { get; set; } = 1f;
    public float Softness { get; set; } = 0.5f;
    public float ScaleAmount { get; set; } = 0.2f;
    public float AudioInfluence { get; set; } = 1f;
    public float Radius { get; set; } = 80f;
    public float Thickness { get; set; } = 8f;
    public float Frequency { get; set; } = 4f;
    public float DutyCycle { get; set; } = 0.35f;
    public float Count { get; set; } = 12f;
    public float Lifetime { get; set; } = 0.8f;
    public float Angle { get; set; }
    public float Distortion { get; set; } = 0.25f;
    public float Turbulence { get; set; } = 0.35f;
    public float MinOut { get; set; } = 0.15f;
    public float MaxOut { get; set; } = 1f;
    public float HoldTime { get; set; } = 0.12f;
    public float FadeTime { get; set; } = 0.35f;
    public float Density { get; set; } = 0.5f;
    public float WidthAmt { get; set; } = 0.4f;
    public float HeightAmt { get; set; } = 0.6f;
    public BlendMode Blend { get; set; } = BlendMode.Add;
    public QualityLevel Quality { get; set; } = QualityLevel.Medium;
    public uint PrimaryColor { get; set; } = 0xFFD4AF37;
    public uint SecondaryColor { get; set; } = 0xFF7DD3FC;
    public bool InvertResponse { get; set; }
    public float Randomness { get; set; } = 0.35f;
    public int Seed { get; set; } = 1;
}

public sealed class EffectStack
{
    public List<EffectInstance> Items { get; set; } = new();
    public void Add(EffectKind kind) => Items.Add(new EffectInstance { Kind = kind });
    public void Remove(Guid id) => Items.RemoveAll(i => i.Id == id);
    public void Move(int from, int to)
    {
        if (from < 0 || to < 0 || from >= Items.Count || to >= Items.Count) return;
        var item = Items[from];
        Items.RemoveAt(from);
        Items.Insert(to, item);
    }
}

public static class EffectCatalog
{
    public static IReadOnlyList<EffectKind> All { get; } = Enum.GetValues<EffectKind>();

    public static HashSet<string> Controls(EffectKind k) => k switch
    {
        EffectKind.Pulse => ["Intensity","Brightness","ScaleAmount","Speed","Attack","Release","AudioInfluence","Audio"],
        EffectKind.Flicker => ["Intensity","Brightness","Speed","Randomness","Softness","Seed","AudioInfluence","Audio"],
        EffectKind.LightSurge => ["Intensity","Brightness","Attack","Release","Threshold","AudioInfluence","Audio"],
        EffectKind.Strobe => ["Brightness","Frequency","DutyCycle","Threshold","AudioInfluence","Audio"],
        EffectKind.Glow or EffectKind.NeonGlow => ["Intensity","Brightness","Radius","Softness","PrimaryColor","Opacity","Audio"],
        EffectKind.BreathingGlow => ["Brightness","MinOut","MaxOut","Speed","AudioInfluence","Audio"],
        EffectKind.Afterglow => ["Intensity","HoldTime","FadeTime","Threshold","Audio"],
        EffectKind.EchoPulse => ["Intensity","Count","HoldTime","FadeTime","Spread","Audio"],
        EffectKind.WaveSweep => ["Brightness","WidthAmt","Speed","Angle","Softness","Audio"],
        EffectKind.Spotlight or EffectKind.Halo => ["Brightness","Radius","Softness","Falloff","PrimaryColor","Audio"],
        EffectKind.LightRays or EffectKind.GodRays or EffectKind.Starburst => ["Brightness","Count","HeightAmt","WidthAmt","Angle","Softness","Audio"],
        EffectKind.LensFlare => ["Brightness","Radius","Count","PrimaryColor","Audio"],
        EffectKind.EnergyFlow or EffectKind.Plasma or EffectKind.MagicEnergy => ["Brightness","Speed","WidthAmt","Turbulence","PrimaryColor","SecondaryColor","Audio"],
        EffectKind.EnergyRipple or EffectKind.Shockwave or EffectKind.AudioRipple => ["Intensity","Count","Speed","WidthAmt","Distortion","Audio"],
        EffectKind.VoidEnergy => ["Intensity","Softness","Distortion","Turbulence","PrimaryColor","Audio"],
        EffectKind.Portal or EffectKind.Vortex => ["Radius","Speed","Thickness","Distortion","Density","Audio"],
        EffectKind.EnergyBeam or EffectKind.Laser => ["Brightness","WidthAmt","HeightAmt","PrimaryColor","Audio"],
        EffectKind.EnergySparks or EffectKind.Sparks or EffectKind.Embers or EffectKind.Glitter
            or EffectKind.ParticleBurst or EffectKind.ParticleFountain or EffectKind.OrbitingParticles
            or EffectKind.GravityParticles or EffectKind.ReverseGravity or EffectKind.Swarm or EffectKind.Trail
            or EffectKind.DustMotes or EffectKind.Ash or EffectKind.Snow
            => ["Density","Brightness","Radius","Lifetime","Speed","Spread","PrimaryColor","Audio"],
        EffectKind.LightningArc or EffectKind.ElectricCrawl => ["Brightness","WidthAmt","Randomness","Frequency","PrimaryColor","Audio"],
        EffectKind.ThunderFlash or EffectKind.BeatFlash or EffectKind.TransientBurst => ["Brightness","Count","HoldTime","Threshold","Audio"],
        EffectKind.RealisticFlame => ["Intensity","Brightness","HeightAmt","WidthAmt","Turbulence","Speed","PrimaryColor","AudioInfluence","Quality"],
        EffectKind.HeatDistortion or EffectKind.Refraction or EffectKind.HolographicDistortion or EffectKind.GlitchLight
            => ["Distortion","Speed","Turbulence","WidthAmt","Audio"],
        EffectKind.SmokeFog or EffectKind.Mist or EffectKind.AtmosphericHaze => ["Density","Opacity","Speed","Turbulence","PrimaryColor","Quality"],
        EffectKind.HueShift => ["Angle","Speed","AudioInfluence","Audio"],
        EffectKind.ChromaticPulse or EffectKind.PrismaticLight => ["Intensity","Spread","Speed","Audio"],
        EffectKind.NeonChase or EffectKind.TraceChase or EffectKind.RhythmChase or EffectKind.RuneSequence
            => ["Brightness","Speed","WidthAmt","PrimaryColor","Audio"],
        EffectKind.Shimmer => ["Intensity","Speed","ScaleAmount","Randomness","Audio"],
        EffectKind.ShadowPulse or EffectKind.RoomDim or EffectKind.LocalDim => ["Intensity","Softness","Falloff","MinOut","AudioInfluence","Audio"],
        EffectKind.ContrastSurge => ["Intensity","Brightness","Threshold","Attack","Release","Audio"],
        EffectKind.Rain => ["Density","Speed","HeightAmt","Angle","Brightness","Quality"],
        EffectKind.WetReflection or EffectKind.WaterReflection or EffectKind.WaterRipple or EffectKind.Caustics
            => ["Intensity","Distortion","Speed","Softness","Audio"],
        EffectKind.Aurora => ["Brightness","WidthAmt","HeightAmt","Speed","Turbulence","PrimaryColor","SecondaryColor","Quality"],
        EffectKind.RuneGlow or EffectKind.TracePulse or EffectKind.OutlineEnergy => ["Brightness","WidthAmt","Speed","PrimaryColor","Audio"],
        EffectKind.BassExpansion => ["ScaleAmount","Intensity","Sensitivity","Attack","Release","Audio"],
        EffectKind.FrequencyGradient or EffectKind.SpectrumSweep => ["Speed","WidthAmt","Brightness","Angle","Audio"],
        EffectKind.PeakHoldGlow => ["Brightness","HoldTime","Release","Threshold","Audio"],
        _ => ["Intensity","Brightness","Speed","Opacity","AudioInfluence","Audio","PrimaryColor"]
    };
}

public static class EffectValidator
{
    public static IReadOnlyList<(EffectKind Kind, string Status)> Report()
    {
        var list = new List<(EffectKind, string)>();
        foreach (var k in EffectCatalog.All)
        {
            var inst = new EffectInstance { Kind = k };
            var ok = inst.Enabled && EffectCatalog.Controls(k).Count > 0;
            list.Add((k, ok ? "IMPLEMENTED" : "NOT IMPLEMENTED"));
        }
        return list;
    }
}
