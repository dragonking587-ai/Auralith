#ifndef MyAppVersion
#define MyAppVersion "0.0.0"
#endif

#define MyAppName "Auralith"
#define MyAppPublisher "Auralith"
#define MyAppExeName "Auralith.exe"
#ifndef PublishDir
#define PublishDir "..\\artifacts\\Auralith"
#endif

[Setup]
AppId={{8C3E2A71-6B4F-4D9A-9E12-A1B2C3D4E5F6}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppVerName={#MyAppName} {#MyAppVersion}
DefaultDirName={localappdata}\Programs\Auralith
DefaultGroupName=Auralith
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=.
OutputBaseFilename=Auralith-{#MyAppVersion}-x64-Setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayIcon={app}\{#MyAppExeName}
UninstallDisplayName=Auralith
CloseApplications=yes
RestartApplications=no
SetupMutex=AuralithSetupMutex
AppMutex=AuralithAppMutex
MinVersion=10.0.17763
VersionInfoVersion=2.0.0.19
VersionInfoProductName=Auralith
SetupIconFile=assets\auralith.ico

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut"; GroupDescription: "Additional shortcuts:"

[Files]
Source: "{#PublishDir}\\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\Auralith"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"; Comment: "Audio-reactive visual effects editor"; IconFilename: "{app}\Assets\auralith.ico"
Name: "{autodesktop}\Auralith"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"; Comment: "Audio-reactive visual effects editor"; IconFilename: "{app}\Assets\auralith.ico"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Launch Auralith"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
Type: files; Name: "{app}\*.tmp"
