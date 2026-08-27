using Auralith.Output;
using Microsoft.UI.Xaml;
using Microsoft.UI.Dispatching;

namespace Auralith.App;

public sealed partial class MainWindow : Window
{
    private readonly NativeGpuTestController _gpu = new();
    private readonly DispatcherTimer _timer;

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
        StatusText.Text = "Status: STARTING";
        _gpu.Open(1920, 1080, 30);
        RefreshStatus();
    }

    private void OnClose(object sender, RoutedEventArgs e)
    {
        _gpu.Close();
        RefreshStatus();
    }

    private void RefreshStatus()
    {
        var s = _gpu.Status;
        StatusText.Text = $"Status: {s.Phase.ToString().ToUpperInvariant()}";
        DetailText.Text = s.Phase == Auralith.Core.GpuTestPhase.Error
            ? $"Stage: {s.Stage}\nReason: {s.Error}"
            : $"{s.Width}×{s.Height}  target {s.TargetFps} FPS  actual {s.ActualFps:0.0}  frame {s.Frame}  {s.Adapter}";
    }
}
