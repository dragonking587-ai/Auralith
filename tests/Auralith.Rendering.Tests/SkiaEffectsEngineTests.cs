using Auralith.Core;
using Auralith.Rendering;
using Xunit;

namespace Auralith.Rendering.Tests;

public sealed class SkiaEffectsEngineTests
{
    [Fact]
    public void Every_effect_kind_has_a_renderer_handler()
    {
        var kinds = Enum.GetValues<EffectKind>();
        Assert.Equal(80, kinds.Length);
        foreach (var kind in kinds)
            Assert.True(SkiaEffectsEngine.HasHandler(kind), $"Missing renderer handler for {kind}");
    }

    [Fact]
    public void Every_effect_kind_renders_multiple_frames_without_throwing()
    {
        const int width = 320;
        const int height = 180;
        var scene = new Scene
        {
            CanvasWidth = width,
            CanvasHeight = height,
            TargetFps = 30,
            MasterIntensity = 1f,
            MasterBrightness = 1f,
            MasterSensitivity = 1f,
            MasterParticleDensity = 0.65f,
            MasterMotionSpeed = 1f
        };
        var audio = new AudioBands
        {
            Raw = 0.8f, Bass = 0.82f, Low = 0.7f, Mid = 0.62f,
            High = 0.74f, Full = 0.78f, Beat = 1f, Transient = 1f
        };

        foreach (var kind in Enum.GetValues<EffectKind>())
        {
            using var engine = new SkiaEffectsEngine();
            var pixels = NewFrame(width, height);
            var region = new Region
            {
                Kind = RegionKind.Stamp,
                Shape = StampShape.Ellipse,
                X = 60,
                Y = 30,
                Width = 200,
                Height = 120,
                Radius = 60,
                Spread = 0.55f,
                Falloff = 0.45f
            };
            region.Effects.Items.Add(new EffectInstance
            {
                Kind = kind,
                Audio = AudioSource.Manual,
                Intensity = 0.8f,
                Brightness = 1f,
                Opacity = 0.85f,
                Density = 0.5f,
                Count = 8f,
                Lifetime = 0.45f,
                Speed = 1f,
                Radius = 40f,
                WidthAmt = 0.45f,
                HeightAmt = 0.6f,
                Turbulence = 0.4f,
                Randomness = 0.45f,
                Frequency = 4f,
                Quality = QualityLevel.Low
            });

            var ex = Record.Exception(() =>
            {
                for (var frame = 0; frame < 6; frame++)
                    engine.Apply(pixels, width, height, new[] { region }, audio, scene, frame / 30f);
            });

            Assert.True(ex is null, $"{kind} threw: {ex}");
        }
    }

    [Fact]
    public void Persistent_sparks_and_lightning_change_the_frame()
    {
        AssertEffectChangesFrame(EffectKind.Sparks);
        AssertEffectChangesFrame(EffectKind.LightningArc);
        AssertEffectChangesFrame(EffectKind.Swarm);
        AssertEffectChangesFrame(EffectKind.RealisticFlame);
    }

    private static void AssertEffectChangesFrame(EffectKind kind)
    {
        const int width = 240;
        const int height = 140;
        var scene = new Scene { CanvasWidth = width, CanvasHeight = height, TargetFps = 30 };
        var audio = new AudioBands { Full = 1f, Bass = 1f, High = 1f, Beat = 1f, Transient = 1f };
        var region = new Region { Kind = RegionKind.Stamp, Shape = StampShape.Rectangle, X = 20, Y = 15, Width = 200, Height = 110 };
        region.Effects.Items.Add(new EffectInstance
        {
            Kind = kind,
            Audio = AudioSource.Manual,
            Intensity = 1f,
            Brightness = 1f,
            Opacity = 1f,
            Density = 1f,
            Lifetime = 0.8f,
            Frequency = 8f,
            Quality = QualityLevel.Low
        });
        var pixels = NewFrame(width, height);
        var before = (byte[])pixels.Clone();
        using var engine = new SkiaEffectsEngine();
        for (var frame = 0; frame < 12; frame++)
            engine.Apply(pixels, width, height, new[] { region }, audio, scene, frame / 30f);
        Assert.False(before.SequenceEqual(pixels), $"{kind} did not modify the rendered frame.");
    }

    private static byte[] NewFrame(int width, int height)
    {
        var pixels = new byte[width * height * 4];
        for (var i = 0; i < pixels.Length; i += 4)
        {
            pixels[i] = 18;
            pixels[i + 1] = 16;
            pixels[i + 2] = 14;
            pixels[i + 3] = 255;
        }
        return pixels;
    }
}
