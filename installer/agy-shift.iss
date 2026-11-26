#ifndef AppVersion
  #define AppVersion "0.1.0"
#endif

[Setup]
AppId={{B8E2C47E-5C31-4B8F-9A42-7E52D18A9F01}}
AppName=Agy Shift
AppVersion={#AppVersion}
AppPublisher=Agy Shift
AppPublisherURL=https://github.com/KeS1Ke/agy-shift
DefaultDirName={localappdata}\Agy Shift
DefaultGroupName=Agy Shift
PrivilegesRequired=lowest
DisableProgramGroupPage=yes
OutputDir=..\target\release\bundle\inno
OutputBaseFilename=Agy-Shift_{#AppVersion}_x64-setup
SetupIconFile=..\src-tauri\icons\icon.ico
UninstallDisplayIcon={app}\agy-shift.exe
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
CloseApplications=yes
RestartApplications=no

[Languages]
Name: "chinesesimplified"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "..\target\release\agy-shift.exe"; DestDir: "{app}"; Flags: ignoreversion
; GNU builds ship the loader as a DLL. MSVC builds link it statically.
Source: "..\target\release\WebView2Loader.dll"; DestDir: "{app}"; Flags: ignoreversion skipifsourcedoesntexist

[Icons]
Name: "{autoprograms}\Agy Shift"; Filename: "{app}\agy-shift.exe"
Name: "{autodesktop}\Agy Shift"; Filename: "{app}\agy-shift.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\agy-shift.exe"; Description: "{cm:LaunchProgram,Agy Shift}"; Flags: nowait postinstall skipifsilent
Filename: "{app}\agy-shift.exe"; Flags: nowait skipifnotsilent; Check: IsUpdaterRun

[Code]
function IsUpdaterRun: Boolean;
var
  I: Integer;
begin
  Result := True;
  for I := 1 to ParamCount do
    if CompareText(ParamStr(I), '/UPDATE') = 0 then
      Exit;
  Result := False;
end;
