using System.Diagnostics;
using System.IO.Compression;
using Auralith.Update;

static string Arg(string[] args, string name)
{
    var i = Array.FindIndex(args, a => string.Equals(a, name, StringComparison.OrdinalIgnoreCase));
    return i >= 0 && i + 1 < args.Length ? args[i + 1] : "";
}

var package = Arg(args, "--package");
var target = Arg(args, "--target");
var launch = Arg(args, "--launch");
int.TryParse(Arg(args, "--pid"), out var pid);
UpdateClient.Log($"helper start package={package} target={target} pid={pid}");

if (!File.Exists(package) || !Directory.Exists(target))
{
    UpdateClient.Log("helper missing package or target");
    return 2;
}

try
{
    if (pid > 0)
    {
        try
        {
            var proc = Process.GetProcessById(pid);
            if (!proc.WaitForExit(60_000))
            {
                UpdateClient.Log("timeout waiting for Auralith exit");
                return 3;
            }
        }
        catch (ArgumentException) { /* already exited */ }
    }

    var staging = Path.Combine(Path.GetTempPath(), "Auralith-staging-" + Guid.NewGuid().ToString("N"));
    Directory.CreateDirectory(staging);
    ZipFile.ExtractToDirectory(package, staging);
    var newExe = Directory.GetFiles(staging, "Auralith.exe", SearchOption.AllDirectories).FirstOrDefault();
    if (newExe is null)
    {
        UpdateClient.Log("staging missing Auralith.exe");
        return 4;
    }
    var newRoot = Path.GetDirectoryName(newExe)!;
    foreach (var file in Directory.GetFiles(newRoot, "*", SearchOption.AllDirectories))
    {
        var rel = Path.GetRelativePath(newRoot, file);
        if (rel.Equals("Auralith.Updater.exe", StringComparison.OrdinalIgnoreCase)) continue;
        var dest = Path.Combine(target, rel);
        Directory.CreateDirectory(Path.GetDirectoryName(dest)!);
        File.Copy(file, dest, overwrite: true);
    }
    var launchPath = string.IsNullOrWhiteSpace(launch) ? Path.Combine(target, "Auralith.exe") : launch;
    Process.Start(new ProcessStartInfo(launchPath) { UseShellExecute = true, WorkingDirectory = target });
    try { Directory.Delete(staging, true); } catch { }
    try
    {
        var updates = UpdateClient.UpdatesDir;
        if (Directory.Exists(updates))
            foreach (var f in Directory.GetFiles(updates))
                try { File.Delete(f); } catch { }
    }
    catch { }
    UpdateClient.Log("helper success restart " + launchPath);
    return 0;
}
catch (Exception ex)
{
    UpdateClient.Log("helper failed " + ex);
    return 1;
}
