using System.Diagnostics;

namespace Auralith.Core;

public static class NativeLog
{
    private static readonly object Gate = new();
    private static readonly string Path = System.IO.Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "Auralith", "native-gpu.log");

    public static void Write(string message)
    {
        var line = $"{DateTime.Now:HH:mm:ss.fff} {message}";
        Debug.WriteLine(line);
        Console.WriteLine(line);
        try
        {
            var dir = System.IO.Path.GetDirectoryName(Path);
            if (!string.IsNullOrEmpty(dir))
                Directory.CreateDirectory(dir);
            lock (Gate)
                File.AppendAllText(Path, line + Environment.NewLine);
        }
        catch
        {
            // never throw from diagnostics
        }
    }

    public static void Error(string stage, string reason, int? win32 = null, int? hr = null)
    {
        var extra = "";
        if (win32 is int w) extra += $" Win32={w}";
        if (hr is int h) extra += $" HRESULT=0x{h:X8}";
        Write($"[NativeBroadcast ERROR] Stage: {stage} Reason: {reason}{extra}");
    }
}
