using Auralith.Core;
using Xunit;

namespace Auralith.Core.Tests;

public class SceneProjectCodecTests
{
    [Fact]
    public void Current_project_roundtrip_preserves_portable_backdrop_and_masters()
    {
        var scene = new Scene
        {
            BackdropPath = @"C:\images\wolf.png",
            BackdropDataUrl = "data:image/png;base64,AQIDBA==",
            MasterIntensity = 1.4f,
            MasterBrightness = 0.8f,
            MasterSensitivity = 1.2f,
            MasterParticleDensity = 1.7f,
            MasterMotionSpeed = 0.9f
        };
        var region = new Region { Kind = RegionKind.Emitter, Name = "Energy" };
        region.Effects.Items.Add(new EffectInstance
        {
            Kind = EffectKind.MagicEnergy,
            PrimaryColor = 0xFF112233,
            SecondaryColor = 0xFF445566,
            Quality = QualityLevel.High
        });
        scene.Regions.Add(region);

        var loaded = SceneProjectCodec.Deserialize(SceneProjectCodec.Serialize(scene)).Scene;

        Assert.Equal(SceneProjectCodec.CurrentSchemaVersion, loaded.SchemaVersion);
        Assert.Equal(scene.BackdropDataUrl, loaded.BackdropDataUrl);
        Assert.Equal(1.4f, loaded.MasterIntensity);
        Assert.Equal(1.7f, loaded.MasterParticleDensity);
        Assert.Single(loaded.Regions);
        Assert.Equal(0xFF112233u, loaded.Regions[0].Effects.Items[0].PrimaryColor);
        Assert.Equal(QualityLevel.High, loaded.Regions[0].Effects.Items[0].Quality);
    }

    [Fact]
    public void Legacy_tauri_project_migrates_without_restoring_ai()
    {
        const string json = """
        {
          "version": 1,
          "width": 1920,
          "height": 1080,
          "fit": "Fill",
          "backdropDataUrl": "data:image/png;base64,AQIDBA==",
          "showMarkers": true,
          "masters": { "intensity": 1.25, "brightness": 0.75, "sensitivity": 1.1, "density": 1.4, "motion": 0.8 },
          "regions": [{
            "id": "1a85c40e-58ca-4a4f-8f9a-4b9c72b366b9",
            "kind": "Trace",
            "label": "Wolf outline",
            "x": 100,
            "y": 120,
            "points": [{"x":100,"y":120},{"x":220,"y":120},{"x":220,"y":260}],
            "effects": [
              {"kind":"GlowBloom","enabled":true,"intensity":0.9,"brightness":1.2,"color":"#112233","color2":"#445566"},
              {"kind":"SmartNeon","enabled":true,"intensity":0.8,"brightness":1.0}
            ]
          }]
        }
        """;

        var result = SceneProjectCodec.Deserialize(json);
        var scene = result.Scene;

        Assert.Equal(FitMode.Fill, scene.Fit);
        Assert.Equal(1.25f, scene.MasterIntensity);
        Assert.Equal(1.4f, scene.MasterParticleDensity);
        Assert.Equal("data:image/png;base64,AQIDBA==", scene.BackdropDataUrl);
        Assert.Single(scene.Regions);
        Assert.Equal(new float[] { 100, 120, 220, 120, 220, 260 }, scene.Regions[0].Points);
        Assert.Equal(EffectKind.Glow, scene.Regions[0].Effects.Items[0].Kind);
        Assert.Equal(EffectKind.NeonGlow, scene.Regions[0].Effects.Items[1].Kind);
        Assert.Contains(result.Warnings, w => w.Contains("SmartNeon"));
    }

    [Fact]
    public void Malformed_values_are_normalized_before_rendering()
    {
        const string json = """
        {
          "SchemaVersion": 2,
          "CanvasWidth": -1,
          "CanvasHeight": 99999,
          "TargetFps": 999,
          "MasterIntensity": 999,
          "Regions": [{
            "Kind": "Emitter",
            "X": 0,
            "Y": 0,
            "Radius": -4,
            "Points": [1, 2, 3],
            "Effects": { "Items": [{ "Kind": "Glow", "Opacity": 99, "Attack": 0 }] }
          }]
        }
        """;

        var scene = SceneProjectCodec.Deserialize(json).Scene;

        Assert.Equal(320, scene.CanvasWidth);
        Assert.Equal(4320, scene.CanvasHeight);
        Assert.Equal(120, scene.TargetFps);
        Assert.Equal(4f, scene.MasterIntensity);
        Assert.Equal(1f, scene.Regions[0].Radius);
        Assert.Equal(2, scene.Regions[0].Points.Count);
        Assert.Equal(1f, scene.Regions[0].Effects.Items[0].Opacity);
        Assert.True(scene.Regions[0].Effects.Items[0].Attack >= 0.002f);
    }
}
