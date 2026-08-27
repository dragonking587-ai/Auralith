using System.Runtime.InteropServices;
using NAudio.Wave;

namespace Auralith.Audio;

/// <summary>
/// Microsoft Application Loopback capture:
/// ActivateAudioInterfaceAsync(VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK)
/// + AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK.
/// Requires Windows 10 build 20348+.
/// </summary>
public sealed class ProcessLoopbackSource : IAudioCaptureSource
{
    public const string VirtualDevice = @"VAD\Process_Loopback";
    private static readonly Guid IidAudioClient = new("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2");
    private static readonly Guid IidCaptureClient = new("C8ADBD64-E71E-48A0-A4DE-185C395CD317");

    private Thread? _thread;
    private volatile bool _run;
    private WaveFormat? _format;
    private nint _eventHandle;
    private readonly int _pid;
    private readonly bool _includeTree;
    public string Name { get; }
    public WaveFormat? Format => _format;
    public event EventHandler<WaveInEventArgs>? DataAvailable;
    public event EventHandler<string>? Failed;

    public ProcessLoopbackSource(int pid, string name, bool includeTree = true)
    {
        _pid = pid;
        _includeTree = includeTree;
        Name = name;
    }

    public static bool IsSupported()
        => OperatingSystem.IsWindowsVersionAtLeast(10, 0, 20348);

    public static string WindowsVersion()
        => Environment.OSVersion.VersionString;

    public void Start()
    {
        if (!IsSupported())
            throw new InvalidOperationException("Per-application audio requires Windows 10 build 20348 or later. Desktop Output Device remains available.");
        Stop();
        _run = true;
        var ready = new ManualResetEventSlim(false);
        Exception? startEx = null;
        _thread = new Thread(() =>
        {
            try { CaptureLoop(ready, ref startEx); }
            catch (Exception ex)
            {
                startEx = ex;
                ready.Set();
                Failed?.Invoke(this, FormatError("CaptureLoop", ex));
            }
        })
        { IsBackground = true, Name = "Auralith-ProcessLoopback" };
        _thread.SetApartmentState(ApartmentState.MTA);
        _thread.Start();
        if (!ready.Wait(TimeSpan.FromSeconds(10)))
            throw new TimeoutException(FormatError("ActivateAudioInterfaceAsync", "Completion callback not reached", unchecked((int)0x80070102)));
        if (startEx is not null) throw startEx;
        if (_format is null)
            throw new InvalidOperationException(FormatError("Activate", "IAudioClient obtained: NO", unchecked((int)0x80004005)));
    }

    public void Stop()
    {
        _run = false;
        if (_thread is { IsAlive: true }) _thread.Join(1500);
        _thread = null;
    }

    public void Dispose() => Stop();

    private void CaptureLoop(ManualResetEventSlim ready, ref Exception? startEx)
    {
        nint client = 0, capture = 0, fmtPtr = 0;
        try
        {
            Log($"ProcessLoopback Stage: ActivateAudioInterfaceAsync PID:{_pid} Mode:{(_includeTree ? "IncludeProcessTree" : "ExcludeProcessTree")} Win:{WindowsVersion()} Interface:{VirtualDevice}");
            client = ActivateClient(_pid, _includeTree);
            Log("ProcessLoopback IAudioClient obtained: YES");
            // Process-loopback clients return E_NOTIMPL (0x80004001) from GetMixFormat.
            // Use the Microsoft ApplicationLoopback capture format instead.
            _format = new WaveFormat(44100, 16, 2);
            var wf = new WaveFormatEx
            {
                wFormatTag = 1,
                nChannels = 2,
                nSamplesPerSec = 44100,
                wBitsPerSample = 16,
                nBlockAlign = 4,
                nAvgBytesPerSec = 176400,
                cbSize = 0
            };
            fmtPtr = Marshal.AllocHGlobal(Marshal.SizeOf<WaveFormatEx>());
            Marshal.StructureToPtr(wf, fmtPtr, false);
            Log("ProcessLoopback Stage: CaptureFormat PCM16 stereo 44100 (GetMixFormat skipped)");
            const int Loopback = 0x00020000;
            const int EventCb = 0x00040000;
            const int AutoPcm = unchecked((int)0x80000000);
            const int SrcQual = 0x08000000;
            var flags = Loopback | EventCb | AutoPcm | SrcQual;
            var hr = IAudioClient_Initialize(client, 0, flags, 0, 0, fmtPtr, IntPtr.Zero);
            if (hr < 0)
            {
                Log($"ProcessLoopback Initialize with event/auto flags failed {Hex(hr)}; retry 1s buffer");
                hr = IAudioClient_Initialize(client, 0, Loopback | AutoPcm, 10_000_000, 0, fmtPtr, IntPtr.Zero);
            }
            if (hr < 0) throw Com("IAudioClient.Initialize", hr);
            Log($"ProcessLoopback Stage: Initialize SUCCESS {Hex(hr)}");
            hr = IAudioClient_GetBufferSize(client, out var bufFrames);
            if (hr < 0) throw Com("GetBufferSize", hr);
            Log($"ProcessLoopback Stage: GetBufferSize SUCCESS frames={bufFrames}");
            var iid = IidCaptureClient;
            hr = IAudioClient_GetService(client, ref iid, out capture);
            if (hr < 0) throw Com("GetService IAudioCaptureClient", hr);
            Log("ProcessLoopback Stage: GetCaptureClient SUCCESS");
            var evt = CreateEventW(IntPtr.Zero, false, false, null);
            if (evt == 0) throw Com("CreateEvent", Marshal.GetHRForLastWin32Error());
            hr = IAudioClient_SetEventHandle(client, evt);
            if (hr < 0)
            {
                Log($"ProcessLoopback SetEventHandle {Hex(hr)} — continuing with poll");
                CloseHandle(evt);
                evt = 0;
            }
            else Log("ProcessLoopback Stage: SetEventHandle SUCCESS");
            hr = IAudioClient_Start(client);
            if (hr < 0) throw Com("IAudioClient.Start", hr);
            Log("ProcessLoopback Stage: Start SUCCESS");
            ready.Set();
            _eventHandle = evt;

            var packet = new byte[192000];
            var first = false;
            while (_run)
            {
                hr = IAudioCaptureClient_GetNextPacketSize(capture, out var frames);
                if (hr < 0) throw Com("GetNextPacketSize", hr);
                if (frames == 0)
                {
                    if (_eventHandle != 0) WaitForSingleObject(_eventHandle, 50);
                    else Thread.Sleep(4);
                    continue;
                }
                hr = IAudioCaptureClient_GetBuffer(capture, out var data, out var got, out var flags, out _, out _);
                if (hr < 0) throw Com("GetBuffer", hr);
                var bytes = (int)got * _format.BlockAlign;
                if (bytes > 0 && (flags & 0x2) == 0)
                {
                    if (bytes > packet.Length) packet = new byte[bytes];
                    Marshal.Copy(data, packet, 0, bytes);
                    if (!first)
                    {
                        first = true;
                        float peak = 0;
                        for (var i = 0; i + 3 < Math.Min(bytes, 256); i += 4)
                            peak = Math.Max(peak, Math.Abs(BitConverter.ToSingle(packet, i)));
                        Log($"ProcessLoopback First packet received: YES bytes={bytes} frames={got} peak~={peak:0.000}");
                    }
                    DataAvailable?.Invoke(this, new WaveInEventArgs(packet, bytes));
                }
                IAudioCaptureClient_ReleaseBuffer(capture, got);
            }
            IAudioClient_Stop(client);
        }
        catch (Exception ex)
        {
            startEx = ex;
            ready.Set();
            Failed?.Invoke(this, ex.Message);
        }
        finally
        {
            if (_eventHandle != 0) { CloseHandle(_eventHandle); _eventHandle = 0; }
            if (fmtPtr != 0) Marshal.FreeHGlobal(fmtPtr);
            if (capture != 0) Marshal.Release(capture);
            if (client != 0) Marshal.Release(client);
        }
    }

    private static nint ActivateClient(int pid, bool includeTree)
    {
        var activation = new AudioClientActivationParams
        {
            ActivationType = 1,
            TargetProcessId = unchecked((uint)pid),
            ProcessLoopbackMode = includeTree ? 0 : 1
        };
        var blob = Marshal.AllocHGlobal(Marshal.SizeOf<AudioClientActivationParams>());
        var pv = Marshal.AllocHGlobal(24);
        var handler = new ActivateHandler();
        var handle = GCHandle.Alloc(handler);
        try
        {
            Marshal.StructureToPtr(activation, blob, false);
            var prop = new PropVariantBlob
            {
                vt = 0x41,
                cbSize = (uint)Marshal.SizeOf<AudioClientActivationParams>(),
                pBlobData = blob
            };
            Marshal.StructureToPtr(prop, pv, false);
            var iid = IidAudioClient;
            Log($"ProcessLoopback ActivationType=1 TargetProcessId={pid} ProcessLoopbackMode={(includeTree ? 0 : 1)} blobSize={prop.cbSize}");
            Log("ProcessLoopback Before ActivateAudioInterfaceAsync");
            var hr = ActivateAudioInterfaceAsync(VirtualDevice, ref iid, pv, handler, out var op);
            Log($"ProcessLoopback ActivateAudioInterfaceAsync return {Hex(hr)}");
            if (hr < 0) throw Com("ActivateAudioInterfaceAsync", hr);
            if (!handler.Done.Wait(TimeSpan.FromSeconds(8)))
                throw Com("ActivateCompleted callback", unchecked((int)0x80070102));
            Log($"ProcessLoopback Completion callback reached: YES GetActivateResult {Hex(handler.ActivateHr)}");
            if (handler.ActivateHr < 0) throw Com("GetActivateResult", handler.ActivateHr);
            if (handler.Result == 0) throw Com("IAudioClient obtained: NO", unchecked((int)0x80004003));
            if (op != 0) Marshal.Release(op);
            return handler.Result;
        }
        finally
        {
            if (handle.IsAllocated) handle.Free();
            Marshal.FreeHGlobal(pv);
            Marshal.FreeHGlobal(blob);
        }
    }

    private static WaveFormat ToWaveFormat(WaveFormatEx raw)
    {
        if (raw.wFormatTag == 3 || raw.wFormatTag == 0xFFFE && raw.wBitsPerSample == 32)
            return WaveFormat.CreateIeeeFloatWaveFormat(raw.nSamplesPerSec, raw.nChannels);
        return new WaveFormat(raw.nSamplesPerSec, raw.wBitsPerSample, raw.nChannels);
    }

    internal static string Hex(int hr) => $"0x{unchecked((uint)hr):X8}";
    private static COMException Com(string stage, int hr)
        => new($"ProcessLoopback Stage: {stage} HRESULT: {Hex(hr)} ({hr}) {Marshal.GetExceptionForHR(hr)?.Message}", hr);

    private static string FormatError(string stage, Exception ex)
        => FormatError(stage, ex.Message, ex is COMException c ? c.HResult : unchecked((int)0x80004005));

    private static string FormatError(string stage, string message, int hr)
        => $"ProcessLoopback Stage: {stage} HRESULT: {Hex(hr)} Message: {message}";

    private static void Log(string s)
    {
        try
        {
            var dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Auralith", "Logs");
            Directory.CreateDirectory(dir);
            File.AppendAllText(Path.Combine(dir, "audio.log"), DateTime.Now.ToString("o") + " " + s + Environment.NewLine);
        }
        catch { }
    }

    [StructLayout(LayoutKind.Sequential, Pack = 4)]
    private struct WaveFormatEx
    {
        public ushort wFormatTag, nChannels;
        public int nSamplesPerSec, nAvgBytesPerSec;
        public ushort nBlockAlign, wBitsPerSample, cbSize;
    }

    [StructLayout(LayoutKind.Sequential, Pack = 4)]
    private struct AudioClientActivationParams
    {
        public int ActivationType;
        public uint TargetProcessId;
        public int ProcessLoopbackMode;
    }

    [StructLayout(LayoutKind.Explicit, Size = 24)]
    private struct PropVariantBlob
    {
        [FieldOffset(0)] public ushort vt;
        [FieldOffset(8)] public uint cbSize;
        [FieldOffset(16)] public nint pBlobData;
    }

    [ComImport]
    [Guid("41D949AB-ECED-47B4-AF3E-B1901D4252FC")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IActivateAudioInterfaceCompletionHandler
    {
        [PreserveSig] int ActivateCompleted(nint activateOperation);
    }

    [ComVisible(true)]
    private sealed class ActivateHandler : IActivateAudioInterfaceCompletionHandler
    {
        public readonly ManualResetEventSlim Done = new(false);
        public int ActivateHr;
        public nint Result;
        public int ActivateCompleted(nint activateOperation)
        {
            try
            {
                var call = GetActivateResult(activateOperation, out ActivateHr, out Result);
                if (call < 0 && ActivateHr >= 0) ActivateHr = call;
            }
            catch (Exception ex)
            {
                ActivateHr = ex.HResult;
            }
            Done.Set();
            return 0;
        }
    }

    [DllImport("Mmdevapi.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
    private static extern int ActivateAudioInterfaceAsync(
        [MarshalAs(UnmanagedType.LPWStr)] string deviceInterfacePath,
        ref Guid riid,
        nint activationParams,
        IActivateAudioInterfaceCompletionHandler completionHandler,
        out nint activationOperation);

    private static int GetActivateResult(nint op, out int hr, out nint unk)
    {
        // IActivateAudioInterfaceAsyncOperation: IUnknown + GetActivateResult (slot 3)
        var vt = Marshal.ReadIntPtr(op);
        var fn = Marshal.GetDelegateForFunctionPointer<GetActivateResultDel>(Marshal.ReadIntPtr(vt, 3 * IntPtr.Size));
        return fn(op, out hr, out unk);
    }

    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int GetActivateResultDel(nint self, out int activateResult, out nint activatedInterface);

    private static int IAudioClient_Initialize(nint c, int share, int flags, long buf, long per, nint fmt, nint session)
        => Call<InitDel>(c, 3)(c, share, flags, buf, per, fmt, session);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int InitDel(nint s, int share, int flags, long buf, long per, nint fmt, nint session);

    private static int IAudioClient_GetMixFormat(nint c, out nint fmt)
        => Call<MixDel>(c, 8)(c, out fmt);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int MixDel(nint s, out nint fmt);

    private static int IAudioClient_GetBufferSize(nint c, out uint frames)
        => Call<BufSizeDel>(c, 4)(c, out frames);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int BufSizeDel(nint s, out uint frames);

    private static int IAudioClient_SetEventHandle(nint c, nint evt)
        => Call<EvtDel>(c, 13)(c, evt);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int EvtDel(nint s, nint evt);

    private static int IAudioClient_GetService(nint c, ref Guid iid, out nint svc)
        => Call<SvcDel>(c, 14)(c, ref iid, out svc);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int SvcDel(nint s, ref Guid iid, out nint svc);

    private static int IAudioClient_Start(nint c) => Call<SimpleDel>(c, 10)(c);
    private static int IAudioClient_Stop(nint c) => Call<SimpleDel>(c, 11)(c);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int SimpleDel(nint s);

    private static int IAudioCaptureClient_GetBuffer(nint c, out nint data, out uint frames, out int flags, out ulong pos, out ulong qpc)
        => Call<BufDel>(c, 3)(c, out data, out frames, out flags, out pos, out qpc);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int BufDel(nint s, out nint data, out uint frames, out int flags, out ulong pos, out ulong qpc);

    private static int IAudioCaptureClient_ReleaseBuffer(nint c, uint frames)
        => Call<RelDel>(c, 4)(c, frames);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int RelDel(nint s, uint frames);

    private static int IAudioCaptureClient_GetNextPacketSize(nint c, out uint frames)
        => Call<PktDel>(c, 5)(c, out frames);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int PktDel(nint s, out uint frames);

    private static T Call<T>(nint c, int slot) where T : Delegate
        => Marshal.GetDelegateForFunctionPointer<T>(Marshal.ReadIntPtr(Marshal.ReadIntPtr(c), slot * IntPtr.Size));
}
