using Microsoft.UI.Xaml;
using System.Threading;

namespace Auralith.App;

public partial class App : Application
{
    private Window? _window;
    private static Mutex? _singleInstance;

    public App()
    {
        StartupLog.Write("Auralith process started");
        _singleInstance = new Mutex(true, @"Local\AuralithAppMutex", out var created);
        if (!created) StartupLog.Write("another Auralith instance is running");
        StartupLog.Write(".NET runtime initialized " + Environment.Version);
        AppDomain.CurrentDomain.UnhandledException += (_, e) =>
        {
            if (e.ExceptionObject is Exception ex) StartupLog.Error(ex);
            else StartupLog.Write("Unhandled " + e.ExceptionObject);
        };
        this.UnhandledException += (_, e) =>
        {
            StartupLog.Error(e.Exception);
            e.Handled = true;
        };
        try
        {
            StartupLog.Write("WinUI / Windows App SDK initialization starting");
            InitializeComponent();
            StartupLog.Write("Windows App SDK initialized");
        }
        catch (Exception ex)
        {
            StartupLog.Error(ex);
            throw;
        }
    }

    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        var smoke = Environment.GetCommandLineArgs().Any(a =>
            string.Equals(a, "--smoke-test", StringComparison.OrdinalIgnoreCase)
            || string.Equals(a, "--diagnostics", StringComparison.OrdinalIgnoreCase));
        try
        {
            StartupLog.Write("MainWindow creation starting");
            _window = new MainWindow(smoke);
            StartupLog.Write("MainWindow created");
            _window.Activate();
            StartupLog.Write("Application ready");
            if (smoke)
            {
                StartupLog.Write("Smoke test requested — scheduling exit");
                _window.DispatcherQueue.TryEnqueue(async () =>
                {
                    await Task.Delay(1500);
                    Application.Current.Exit();
                    Environment.Exit(0);
                });
            }
        }
        catch (Exception ex)
        {
            StartupLog.Error(ex);
            if (smoke) Environment.Exit(2);
            throw;
        }
    }
}
