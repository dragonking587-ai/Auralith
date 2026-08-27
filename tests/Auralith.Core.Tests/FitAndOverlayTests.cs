using Auralith.Core;
using Xunit;

namespace Auralith.Core.Tests;

public class FitAndOverlayTests
{
    [Fact]
    public void CleanCapture_hides_overlays_and_chrome()
    {
        var s = new Scene { View = ViewMode.CleanCapture, ShowEditorOverlays = true };
        Assert.False(s.ShowOverlays);
        Assert.False(s.ShowChrome);
    }

    [Fact]
    public void Hiding_marker_does_not_clear_effects()
    {
        var r = new Region { Kind = RegionKind.Emitter, ShowEditorMarker = false };
        r.Effects.Add(EffectKind.Glow);
        Assert.False(r.ShowEditorMarker);
        Assert.Single(r.Effects.Items);
        Assert.True(r.Effects.Items[0].Enabled);
    }

    [Fact]
    public void Fit_letterboxes_wide_image()
    {
        var (x, y, w, h) = FitMath.Dest(FitMode.Fit, 1920, 800, 1920, 1080);
        Assert.Equal(1920, w, 1);
        Assert.True(h < 1080);
        Assert.True(y > 0);
    }
}
