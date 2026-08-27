using Auralith.Core;
using Xunit;

namespace Auralith.Core.Tests;

public class GpuTestStatusTests
{
    [Fact]
    public void Default_is_closed()
    {
        var s = new GpuTestStatus();
        Assert.Equal(GpuTestPhase.Closed, s.Phase);
    }
}
