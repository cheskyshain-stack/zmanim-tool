; Inno Setup script for Ksav.
;
; Per user install, so no administrator rights are needed and Windows does not
; prompt. The end user opens an installer, clicks through it, and gets a Start
; Menu entry. They never see Python, a command prompt, or a script.
;
; Build:  iscc packaging\installer.iss
;
; Signing: without a code signing certificate, SmartScreen warns on first run.
; That is a certificate purchase, not a code problem. See docs/licensing.md.

#define AppName "Ksav"
#define AppVersion "0.1.0"
#define AppPublisher "Ksav"
#define AppExe "Ksav.exe"

[Setup]
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
OutputBaseFilename=Ksav-Setup-{#AppVersion}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
DisableProgramGroupPage=yes
UninstallDisplayIcon={app}\{#AppExe}

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a shortcut on the desktop"; GroupDescription: "Shortcuts:"

[Files]
Source: "..\dist\Ksav\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\docs\licensing.md"; DestDir: "{app}"; DestName: "Third party licences.txt"; Flags: ignoreversion

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#AppExe}"; Description: "Open {#AppName}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; Models and settings live in %LOCALAPPDATA%\Ksav and are deliberately left in
; place on uninstall. A user who reinstalls should not have to download several
; gigabytes again. Removing them is a manual choice, not a side effect.
