using System.Diagnostics;
using NAudio.CoreAudioApi;

namespace Auralith.Audio;

public sealed record AudioAppSession(
    int Pid,
    string ProcessName,
    string Display,
    string SessionId,
    string EndpointId,
    string EndpointName,
    bool Active);

public static class AudioSessions
{
    public static IReadOnlyList<AudioAppSession> List()
    {
        var result = new List<AudioAppSession>();
        var seen = new HashSet<string>();
        try
        {
            var en = new MMDeviceEnumerator();
            foreach (var dev in en.EnumerateAudioEndPoints(DataFlow.Render, DeviceState.Active))
            {
                SessionCollection? sessions = null;
                try { sessions = dev.AudioSessionManager.Sessions; } catch { continue; }
                if (sessions is null) continue;
                for (var i = 0; i < sessions.Count; i++)
                {
                    using var s = sessions[i];
                    int pid = 0;
                    try { pid = (int)s.GetProcessID; } catch { }
                    if (pid <= 0) continue;
                    string pname = "pid-" + pid;
                    try { pname = Process.GetProcessById(pid).ProcessName; } catch { }
                    var display = string.IsNullOrWhiteSpace(s.DisplayName) ? pname : s.DisplayName;
                    var key = pid + ":" + display;
                    if (!seen.Add(key)) continue;
                    var active = false;
                    try { active = s.State == NAudio.CoreAudioApi.Interfaces.AudioSessionState.AudioSessionStateActive; } catch { }
                    result.Add(new AudioAppSession(pid, pname + ".exe", $"{display} — {pname}.exe", s.GetSessionIdentifier ?? key, dev.ID, dev.FriendlyName, active));
                }
            }
        }
        catch { }
        return result.OrderByDescending(x => x.Active).ThenBy(x => x.Display).ToList();
    }
}
