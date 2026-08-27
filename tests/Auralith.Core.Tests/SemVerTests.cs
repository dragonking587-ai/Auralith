using Auralith.Update;
using Xunit;

namespace Auralith.Core.Tests;

public class SemVerTests
{
    [Fact]
    public void Alpha3_is_newer_than_alpha2()
    {
        var a = SemVer.Parse("2.0.0-alpha.2");
        var b = SemVer.Parse("2.0.0-alpha.3");
        Assert.True(b.IsNewerThan(a));
    }
}
