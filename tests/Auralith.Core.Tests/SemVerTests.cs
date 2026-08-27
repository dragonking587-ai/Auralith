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

public class UpdateUrlTests
{
    [Fact]
    public void Allows_public_releases_host_only()
    {
        Assert.True(UpdateClient.IsAllowedUrl("https://github.com/dragonking587-ai/Auralith-Releases/releases/download/x/Auralith-2.0.0-alpha.5-x64-Setup.exe"));
        Assert.False(UpdateClient.IsAllowedUrl("https://github.com/dragonking587-ai/Auralith/releases/download/x/Auralith-2.0.0-alpha.5-x64-Setup.exe"));
        Assert.False(UpdateClient.IsAllowedUrl("http://github.com/dragonking587-ai/Auralith-Releases/a.exe"));
    }

    [Fact]
    public void Alpha10_is_newer_than_alpha2()
    {
        Assert.True(SemVer.Parse("2.0.0-alpha.10").IsNewerThan(SemVer.Parse("2.0.0-alpha.2")));
    }
}
