using System.Runtime.InteropServices;

namespace Auralith.Platform.Windows;

public sealed class NativeWindow : IDisposable
{
    public const string Title = "Auralith — Native GPU Test Output";
    private const string ClassName = "AuralithNativeGpuTest";

    public nint Hwnd { get; private set; }
    public event Action<int, int>? SizeChanged;
    public event Action? Closed;

    private bool _disposed;
    private static NativeWindow? _current;
    private WndProc? _procKeepAlive;

    public void Create(int width, int height)
    {
        _procKeepAlive = WndProcImpl;
        var wc = new WNDCLASSEXW
        {
            cbSize = (uint)Marshal.SizeOf<WNDCLASSEXW>(),
            style = 0x0002 | 0x0001,
            lpfnWndProc = Marshal.GetFunctionPointerForDelegate(_procKeepAlive),
            hInstance = GetModuleHandleW(null),
            lpszClassName = ClassName,
            hCursor = LoadCursorW(0, 32512)
        };
        RegisterClassExW(ref wc);

        var style = 0x00CF0000; // WS_OVERLAPPEDWINDOW
        Hwnd = CreateWindowExW(0, ClassName, Title, style,
            unchecked((int)0x80000000), unchecked((int)0x80000000),
            Math.Max(640, width / 2), Math.Max(360, height / 2),
            0, 0, wc.hInstance, 0);
        if (Hwnd == 0)
            throw new InvalidOperationException($"CreateWindowEx failed Win32={Marshal.GetLastWin32Error()}");
        _current = this;
        ShowWindow(Hwnd, 5);
        UpdateWindow(Hwnd);
    }

    public void PumpOnce()
    {
        while (PeekMessageW(out var msg, 0, 0, 0, 1))
        {
            if (msg.message == 0x0012) // WM_QUIT
                return;
            TranslateMessage(ref msg);
            DispatchMessageW(ref msg);
        }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        if (Hwnd != 0)
        {
            DestroyWindow(Hwnd);
            Hwnd = 0;
        }
        if (ReferenceEquals(_current, this))
            _current = null;
    }

    private nint WndProcImpl(nint hWnd, uint msg, nint wParam, nint lParam)
    {
        switch (msg)
        {
            case 0x0005: // WM_SIZE
                SizeChanged?.Invoke((int)(lParam & 0xFFFF), (int)((lParam >> 16) & 0xFFFF));
                break;
            case 0x0010: // WM_CLOSE
                DestroyWindow(hWnd);
                return 0;
            case 0x0002: // WM_DESTROY
                Closed?.Invoke();
                PostQuitMessage(0);
                return 0;
        }
        return DefWindowProcW(hWnd, msg, wParam, lParam);
    }

    private delegate nint WndProc(nint hWnd, uint msg, nint wParam, nint lParam);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct WNDCLASSEXW
    {
        public uint cbSize, style;
        public nint lpfnWndProc;
        public int cbClsExtra, cbWndExtra;
        public nint hInstance, hIcon, hCursor, hbrBackground;
        public string? lpszMenuName;
        public string lpszClassName;
        public nint hIconSm;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MSG
    {
        public nint hwnd;
        public uint message;
        public nint wParam, lParam;
        public uint time;
        public int ptX, ptY;
    }

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern ushort RegisterClassExW(ref WNDCLASSEXW lpwcx);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern nint CreateWindowExW(int ex, string cls, string title, int style,
        int x, int y, int w, int h, nint parent, nint menu, nint inst, nint param);
    [DllImport("user32.dll")] private static extern bool ShowWindow(nint h, int n);
    [DllImport("user32.dll")] private static extern bool UpdateWindow(nint h);
    [DllImport("user32.dll")] private static extern bool DestroyWindow(nint h);
    [DllImport("user32.dll")] private static extern bool PeekMessageW(out MSG lpMsg, nint hWnd, uint min, uint max, uint remove);
    [DllImport("user32.dll")] private static extern bool TranslateMessage(ref MSG lpMsg);
    [DllImport("user32.dll")] private static extern nint DispatchMessageW(ref MSG lpMsg);
    [DllImport("user32.dll")] private static extern nint DefWindowProcW(nint h, uint m, nint w, nint l);
    [DllImport("user32.dll")] private static extern void PostQuitMessage(int code);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern nint LoadCursorW(nint i, int id);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern nint GetModuleHandleW(string? name);
}
