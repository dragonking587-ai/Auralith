using Auralith.Core;

namespace Auralith.Core.Tests;

public class EffectLibraryTests
{
    [Fact]
    public void Every_effect_kind_is_catalogued()
    {
        Assert.Equal(Enum.GetValues<EffectKind>().Length, EffectCatalog.All.Count);
        Assert.All(EffectValidator.Report(), r => Assert.Equal("IMPLEMENTED", r.Status));
    }

    [Fact]
    public void Every_kind_has_controls_and_can_roundtrip()
    {
        foreach (var kind in EffectCatalog.All)
        {
            Assert.NotEmpty(EffectCatalog.Controls(kind));
            var fx = new EffectInstance { Kind = kind, Intensity = 0.4f, Audio = AudioSource.Bass };
            var json = System.Text.Json.JsonSerializer.Serialize(fx);
            var back = System.Text.Json.JsonSerializer.Deserialize<EffectInstance>(json)!;
            Assert.Equal(kind, back.Kind);
            Assert.Equal(AudioSource.Bass, back.Audio);
            Assert.True(back.Enabled);
        }
    }
}
