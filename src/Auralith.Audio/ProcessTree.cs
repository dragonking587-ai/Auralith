using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

namespace Auralith.Audio;

public static class ProcessTree
{
    public static int ParentPid(int pid)
    {
        try
        {
            var h = OpenProcess(0x1000, false, pid);
            if (h == 0) return 0;
            try
            {
                var pbi = new ProcessBasicInformation();
                var st = NtQueryInformationProcess(h, 0, ref pbi, Marshal.SizeOf<ProcessBasicInformation>(), out _);
                if (st != 0) return 0;
                return pbi.InheritedFromUniqueProcessId.ToInt32();
            }
            finally { CloseHandle(h); }
        }
        catch { return 0; }
    }

    public static string NameOf(int pid)
    {
        try { return Process.GetProcessById(pid).ProcessName; } catch { return "?"; }
    }

    public static int RootOfSameName(int pid)
    {
        var name = NameOf(pid);
        var cur = pid;
        var guard = 0;
        while (guard++ < 16)
        {
            var parent = ParentPid(cur);
            if (parent <= 0) break;
            var pname = NameOf(parent);
            if (!string.Equals(pname, name, StringComparison.OrdinalIgnoreCase)) break;
            cur = parent;
        }
        return cur;
    }

    public static string DescribeFamily(int targetPid)
    {
        var name = NameOf(targetPid);
        var sb = new StringBuilder();
        sb.AppendLine($"target {name}.exe PID {targetPid} parent={ParentPid(targetPid)} root={RootOfSameName(targetPid)}");
        try
        {
            foreach (var p in Process.GetProcessesByName(name).OrderBy(p => p.Id))
            {
                var mark = p.Id == targetPid ? " [TARGET]" : "";
                if (p.Id == RootOfSameName(targetPid)) mark += " [ROOT]";
                sb.AppendLine($"  {name}.exe PID {p.Id} parent={ParentPid(p.Id)}{mark}");
            }
        }
        catch { }
        return sb.ToString();
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ProcessBasicInformation
    {
        public nint Reserved1;
        public nint PebBaseAddress;
        public nint Reserved2_0;
        public nint Reserved2_1;
        public nint UniqueProcessId;
        public nint InheritedFromUniqueProcessId;
    }

    [DllImport("ntdll.dll")]
    private static extern int NtQueryInformationProcess(nint process, int cls, ref ProcessBasicInformation pbi, int size, out int ret);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern nint OpenProcess(int access, bool inherit, int pid);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(nint h);
}
