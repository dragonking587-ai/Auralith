using System.Runtime.InteropServices;
using NAudio.Wave;

namespace Auralith.Audio;

/// <summary>
/// True Windows process loopback via ActivateAudioInterfaceAsync +
/// VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK. Requires Windows 10 2004 (19041)+.
/// Does not fall back to whole-device capture.
/// </summary>
public sealed class ProcessLoopbackSource : IAudioCaptureSource
{
    public const string VirtualDevice = @"VAD\Process_Loopback";
    private Thread? _thread;
    private volatile bool _run;
    private WaveFormat? _format;
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
        => OperatingSystem.IsWindowsVersionAtLeast(10, 0, 19041);

    public void Start()
    {
        if (!IsSupported())
            throw new InvalidOperationException("Application Audio requires Windows 10 version 2004 (build 19041) or later for process loopback.");
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
                Failed?.Invoke(this, ex.Message);
            }
        })
        { IsBackground = true, Name = "Auralith-ProcessLoopback" };
        _thread.SetApartmentState(ApartmentState.MTA);
        _thread.Start();
        ready.Wait(TimeSpan.FromSeconds(8));
        if (startEx is not null) throw startEx;
        if (_format is null)
            throw new InvalidOperationException("Unable to activate process audio loopback for PID " + _pid);
    }

    public void Stop()
    {
        _run = false;
        if (_thread is { IsAlive: true } && !_thread.Join(1500))
        { /* abandoned; COM teardown next process start */ }
        _thread = null;
    }

    private void CaptureLoop(ManualResetEventSlim ready, ref Exception? startEx)
    {
        nint client = 0, capture = 0;
        try
        {
            client = ActivateClient(_pid, _includeTree);
            GetMixFormat(client, out var fmtPtr);
            var fmt = Marshal.PtrToStructure<WaveFormatEx>(fmtPtr)!;
            _format = ToWaveFormat(fmt);
            var hr = IAudioClient_Initialize(client, 0 /* shared */, 0, 10_000_000, 0, fmtPtr, IntPtr.Zero);
            if (hr < 0) throw new COMException("IAudioClient.Initialize failed", hr);
            var iidCapture = new Guid("C8ADBD64-E71E-48A0-A4DE-185C395CD317");
            hr = IAudioClient_GetService(client, ref iidCapture, out capture);
            if (hr < 0) throw new COMException("GetService IAudioCaptureClient failed", hr);
            hr = IAudioClient_Start(client);
            if (hr < 0) throw new COMException("IAudioClient.Start failed", hr);
            ready.Set();

            var packet = new byte[192000];
            while (_run)
            {
                hr = IAudioCaptureClient_GetNextPacketSize(capture, out var frames);
                if (hr < 0) break;
                if (frames == 0)
                {
                    Thread.Sleep(5);
                    continue;
                }
                hr = IAudioCaptureClient_GetBuffer(capture, out var data, out var got, out var flags, out _, out _);
                if (hr < 0) break;
                var bytes = (int)got * _format.BlockAlign;
                if (bytes > 0 && (flags & 0x2) == 0) // not SILENT
                {
                    if (bytes > packet.Length) packet = new byte[bytes];
                    Marshal.Copy(data, packet, 0, bytes);
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
            Failed?.Invoke(this, "Unable to activate process audio loopback. HRESULT/error: " + ex.Message);
        }
        finally
        {
            if (capture != 0) Marshal.Release(capture);
            if (client != 0) Marshal.Release(client);
        }
    }

    private static nint ActivateClient(int pid, bool includeTree)
    {
        var activation = new AudioClientActivationParams
        {
            ActivationType = 1, // PROCESS_LOOPBACK
            TargetProcessId = (uint)pid,
            ProcessLoopbackMode = includeTree ? 0 : 1
        };
        var blob = Marshal.AllocHGlobal(Marshal.SizeOf<AudioClientActivationParams>());
        try
        {
            Marshal.StructureToPtr(activation, blob, false);
            var pv = new PropVariantBlob
            {
                vt = 0x41, // VT_BLOB
                cbSize = (uint)Marshal.SizeOf<AudioClientActivationParams>(),
                pBlobData = blob
            };
            var handler = new ActivateHandler();
            var iid = new Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2"); // IAudioClient
            var hr = ActivateAudioInterfaceAsync(VirtualDevice, ref iid, ref pv, handler, out var op);
            if (hr < 0) throw new COMException("ActivateAudioInterfaceAsync failed", hr);
            if (!handler.Done.Wait(TimeSpan.FromSeconds(6)))
                throw new TimeoutException("ActivateAudioInterfaceAsync timed out.");
            if (handler.Hr < 0) throw new COMException("Process loopback activation failed", handler.Hr);
            if (handler.Result == 0) throw new InvalidOperationException("Process loopback returned no IAudioClient.");
            Marshal.Release(op);
            return handler.Result;
        }
        finally { Marshal.FreeHGlobal(blob); }
    }

    private static void GetMixFormat(nint client, out nint fmt)
    {
        var hr = IAudioClient_GetMixFormat(client, out fmt);
        if (hr < 0) throw new COMException("GetMixFormat failed", hr);
    }

    private static WaveFormat ToWaveFormat(WaveFormatEx raw)
    {
        if (raw.wFormatTag == 3)
            return WaveFormat.CreateIeeeFloatWaveFormat(raw.nSamplesPerSec, raw.nChannels);
        return new WaveFormat(raw.nSamplesPerSec, raw.wBitsPerSample, raw.nChannels);
    }

    public void Dispose() => Stop();

    [StructLayout(LayoutKind.Sequential)]
    private struct WaveFormatEx
    {
        public ushort wFormatTag, nChannels;
        public int nSamplesPerSec, nAvgBytesPerSec;
        public ushort nBlockAlign, wBitsPerSample, cbSize;
    }

    // Layout matches AUDIOCLIENT_ACTIVATION_PARAMS union used for process loopback.
    [StructLayout(LayoutKind.Sequential)]
    private struct AudioClientActivationParams
    {
        public int ActivationType;
        public uint TargetProcessId;
        public int ProcessLoopbackMode;
        public int Reserved;
    }

    [StructLayout(LayoutKind.Explicit, Size = 24)]
    private struct PropVariantBlob
    {
        [FieldOffset(0)] public ushort vt;
        [FieldOffset(8)] public uint cbSize;
        [FieldOffset(16)] public nint pBlobData;
    }

    [ComImport]
    [Guid("41D22B57-826A-4CF1-8A7C-487C5C9EE0C7")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IActivateAudioInterfaceCompletionHandler
    {
        [PreserveSig] int ActivateCompleted(nint activateOperation);
    }

    private sealed class ActivateHandler : IActivateAudioInterfaceCompletionHandler
    {
        public readonly ManualResetEventSlim Done = new(false);
        public int Hr;
        public nint Result;
        public int ActivateCompleted(nint activateOperation)
        {
            GetActivateResult(activateOperation, out Hr, out Result);
            Done.Set();
            return 0;
        }
    }

    [DllImport("Mmdevapi.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
    private static extern int ActivateAudioInterfaceAsync(
        string deviceInterfacePath,
        ref Guid riid,
        ref PropVariantBlob activationParams,
        IActivateAudioInterfaceCompletionHandler completionHandler,
        out nint activationOperation);

    [DllImport("Mmdevapi.dll", EntryPoint = "?GetActivateResult@IActivateAudioInterfaceAsyncOperation@@UEAAJPEAJPEAPEAUIUnknown@@@Z", ExactSpelling = true)]
    private static extern int GetActivateResult_Unused();

    // IActivateAudioInterfaceAsyncOperation vtable slot 3 = GetActivateResult
    private static int GetActivateResult(nint op, out int hr, out nint unk)
    {
        var vt = Marshal.ReadIntPtr(op);
        var fn = Marshal.GetDelegateForFunctionPointer<GetActivateResultDel>(Marshal.ReadIntPtr(vt, 3 * IntPtr.Size));
        return fn(op, out hr, out unk);
    }

    private delegate int GetActivateResultDel(nint self, out int activateResult, out nint activatedInterface);

    private static int IAudioClient_Initialize(nint c, int share, int flags, long buf, long per, nint fmt, nint session)
    {
        var vt = Marshal.ReadIntPtr(c);
        var fn = Marshal.GetDelegateForFunctionPointer<InitDel>(Marshal.ReadIntPtr(vt, 3 * IntPtr.Size));
        return fn(c, share, flags, buf, per, fmt, session);
    }
    private delegate int InitDel(nint s, int share, int flags, long buf, long per, nint fmt, nint session);

    private static int IAudioClient_GetMixFormat(nint c, out nint fmt)
    {
        var vt = Marshal.ReadIntPtr(c);
        var fn = Marshal.GetDelegateForFunctionPointer<MixDel>(Marshal.ReadIntPtr(vt, 8 * IntPtr.Size));
        return fn(c, out fmt);
    }
    private delegate int MixDel(nint s, out nint fmt);

    private static int IAudioClient_GetService(nint c, ref Guid iid, out nint svc)
    {
        var vt = Marshal.ReadIntPtr(c);
        var fn = Marshal.GetDelegateForFunctionPointer<SvcDel>(Marshal.ReadIntPtr(vt, 14 * IntPtr.Size));
        return fn(c, ref iid, out svc);
    }
    private delegate int SvcDel(nint s, ref Guid iid, out nint svc);

    private static int IAudioClient_Start(nint c)
    {
        var vt = Marshal.ReadIntPtr(c);
        var fn = Marshal.GetDelegateForFunctionPointer<SimpleDel>(Marshal.ReadIntPtr(vt, 10 * IntPtr.Size));
        return fn(c);
    }
    private static int IAudioClient_Stop(nint c)
    {
        var vt = Marshal.ReadIntPtr(c);
        var fn = Marshal.GetDelegateForFunctionPointer<SimpleDel>(Marshal.ReadIntPtr(vt, 11 * IntPtr.Size));
        return fn(c);
    }
    private delegate int SimpleDel(nint s);

    private static int IAudioCaptureClient_GetNextPacketSize(nint c, out uint frames)
    {
        var vt = Marshal.ReadIntPtr(c);
        var fn = Marshal.GetDelegateForFunctionPointer<PktDel>(Marshal.ReadIntPtr(vt, 5 * IntPtr.Size));
        return fn(c, out frames);
    }
    private delegate int PktDel(nint s, out uint frames);

    private static int IAudioCaptureClient_GetBuffer(nint c, out nint data, out uint frames, out int flags, out ulong pos, out ulong qpc)
    {
        var vt = Marshal.ReadIntPtr(c);
        var fn = Marshal.GetDelegateForFunctionPointer<BufDel>(Marshal.ReadIntPtr(vt, 3 * IntPtr.Size));
        return fn(c, out data, out frames, out flags, out pos, out qpc);
    }
    private delegate int BufDel(nint s, out nint data, out uint frames, out int flags, out ulong pos, out ulong qpc);

    private static int IAudioCaptureClient_ReleaseBuffer(nint c, uint frames)
    {
        var vt = Marshal.ReadIntPtr(c);
        var fn = Marshal.GetDelegateForFunctionPointer<RelDel>(Marshal.ReadIntPtr(vt, 4 * IntPtr.Size));
        return fn(c, frames);
    }
    private delegate int RelDel(nint s, uint frames);
}
