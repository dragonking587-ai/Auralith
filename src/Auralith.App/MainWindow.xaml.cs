using Auralith.Core;
using Auralith.Output;
using Microsoft.UI.Xaml;

namespace Auralith.App;

public sealed partial class MainWindow : Window
{
    private readonly NativeGpuTestController _gpu = new();
    private readonly DispatcherTimer _timer;
    private DateTimeOffset? _startedAt;

    public MainWindow()
    {
        InitializeComponent();
        Title = "Auralith";
        _timer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(250) };
        _timer.Tick += (_, _) => RefreshStatus();
        _timer.Start();
        Closed += (_, _) =>
        {
            _timer.Stop();
            _gpu.Dispose();
        };
    }

    private void OnOpen(object sender, RoutedEventArgs e)
    {
        NativeLog.Write("[NativeBroadcast] UI Open clicked");
        StatusText.Text = "Status: STARTING";
        _startedAt = DateTimeOffset.UtcNow;
        _gpu.Open(1920, 1080, 30);
        RefreshStatus();
    }

    private void OnClose(object sender, RoutedEventArgs e)
    {
        _startedAt = null;
        _gpu.Close();
        RefreshStatus();
    }

    private void RefreshStatus()
    {
        var s = _gpu.Status;
        if (s.Phase == GpuTestPhase.Starting && _startedAt is { } t
            && DateTimeOffset.UtcNow - t > TimeSpan.FromSeconds(12)
            && s.Error is null)
        {
            StatusText.Text = "Status: ERROR";
            DetailText.Text =
                "Native GPU Test Output failed to start.\n" +
                $"Stage: {s.Stage}\n" +
                "Reason: Startup timed out.";
            return;
        }
        if (s.Phase is GpuTestPhase.Running or GpuTestPhase.Error or GpuTestPhase.Closed)
            _startedAt = null;
        StatusText.Text = $"Status: {s.Phase.ToString().ToUpperInvariant()}";
        DetailText.Text = s.Phase == GpuTestPhase.Error
            ? $"Native GPU Test Output failed to start.\nStage: {s.Stage}\nReason: {s.Error}"
            : $"{s.Width}×{s.Height}  target {s.TargetFps} FPS  actual {s.ActualFps:0.0}  frame {s.Frame}\n{s.Adapter}\nStage: {s.Stage}";
    }
}
