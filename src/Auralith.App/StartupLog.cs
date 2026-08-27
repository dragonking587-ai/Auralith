namespace Auralith.App;

internal static class StartupLog
{
    private static readonly string FilePath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "Auralith", "logs", "startup.log");

    public static void Write(string message)
    {
        try
        {
            var dir = Path.GetDirectoryName(FilePath);
            if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
            File.AppendAllText(FilePath, $"{DateTime.Now:yyyy-MM-dd HH:mm:ss.fff} {message}{Environment.NewLine}");
        }
        catch { }
    }

    public static void Error(Exception ex)
    {
        Write("EXCEPTION " + ex.GetType().FullName);
        Write(ex.Message);
        Write(ex.StackTrace ?? "");
        if (ex.InnerException is { } inner)
        {
            Write("INNER " + inner.GetType().FullName);
            Write(inner.Message);
            Write(inner.StackTrace ?? "");
        }
        if (ex is System.Runtime.InteropServices.COMException com)
            Write($"HRESULT=0x{com.HResult:X8}");
    }
}
