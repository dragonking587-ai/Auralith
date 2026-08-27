namespace Auralith.Update;

public readonly record struct SemVer(int Major, int Minor, int Patch, string Pre, int PreNum)
{
    public static SemVer Parse(string raw)
    {
        raw = raw.Trim().TrimStart('v', 'V');
        var pre = "";
        var preNum = 0;
        var core = raw;
        var dash = raw.IndexOf('-');
        if (dash >= 0)
        {
            core = raw[..dash];
            var rest = raw[(dash + 1)..];
            var parts = rest.Split('.', 2);
            pre = parts[0];
            if (parts.Length > 1)
                int.TryParse(new string(parts[1].TakeWhile(char.IsDigit).ToArray()), out preNum);
        }
        var nums = core.Split('.');
        int.TryParse(nums.ElementAtOrDefault(0), out var maj);
        int.TryParse(nums.ElementAtOrDefault(1), out var min);
        int.TryParse(nums.ElementAtOrDefault(2), out var pat);
        return new SemVer(maj, min, pat, pre, preNum);
    }

    public int CompareTo(SemVer other)
    {
        var c = Major.CompareTo(other.Major);
        if (c != 0) return c;
        c = Minor.CompareTo(other.Minor);
        if (c != 0) return c;
        c = Patch.CompareTo(other.Patch);
        if (c != 0) return c;
        if (string.IsNullOrEmpty(Pre) && string.IsNullOrEmpty(other.Pre)) return 0;
        if (string.IsNullOrEmpty(Pre)) return 1;
        if (string.IsNullOrEmpty(other.Pre)) return -1;
        c = string.Compare(Pre, other.Pre, StringComparison.OrdinalIgnoreCase);
        if (c != 0) return c;
        return PreNum.CompareTo(other.PreNum);
    }

    public bool IsNewerThan(SemVer other) => CompareTo(other) > 0;
    public override string ToString() =>
        string.IsNullOrEmpty(Pre) ? $"{Major}.{Minor}.{Patch}" : $"{Major}.{Minor}.{Patch}-{Pre}.{PreNum}";
}
