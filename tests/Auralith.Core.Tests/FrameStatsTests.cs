using Auralith.Core;
using Xunit;

namespace Auralith.Core.Tests;

public class FrameStatsTests
{
    [Fact]
    public void Default_stage_is_idle()
    {
        Assert.Equal("Idle", new FrameStats().Stage);
    }
}
