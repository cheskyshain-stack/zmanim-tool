; Inno Setup script for Ksav.
;
; Build:  iscc packaging\installer.iss
; Or just: python packaging\build.py
;
; A per user install, so Windows asks for no administrator password and shows no
; consent prompt. The end user opens an installer, clicks through it, and gets a
; Start Menu entry. They never see Python, a command prompt, or a script.
;
; Signing: without a code signing certificate SmartScreen warns the first time
; anyone runs this. That is a certificate purchase, not a code problem, and it
; is the last thing standing between this and a normal Windows application.

#define AppName "Ksav"
#define AppVersion "0.1.0"
#define AppPublisher "Ksav"
#define AppExe "Ksav.exe"
#define SourceDir "..\dist\Ksav"

[Setup]
; Never change this. Windows uses it to tell an upgrade from a second copy.
AppId={{8E2C4F71-3A6D-4B58-9C21-1B7F0A5E4C33}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={localappdata}\Programs\{#AppName}
DefaultGroupName={#AppName}
OutputDir=..\dist
OutputBaseFilename=Ksav-Setup-{#AppVersion}
SetupIconFile=ksav.ico
UninstallDisplayIcon={app}\{#AppExe}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
; lowest means no administrator prompt at all, which is the whole point: a
; nontechnical person should not have to find someone with the password.
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
DisableProgramGroupPage=yes
DisableDirPage=auto
ShowLanguageDialog=no
AppendDefaultDirName=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a shortcut on the desktop"; \
    GroupDescription: "Shortcuts:"; Flags: unchecked

[Files]
; Everything PyInstaller built. Qt's translations are excluded: Ksav's interface
; is English only and they are several megabytes of nothing useful.
Source: "{#SourceDir}\*"; DestDir: "{app}"; \
    Excludes: "*\Qt\translations\*,*.pdb"; \
    Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\docs\licensing.md"; DestDir: "{app}"; \
    DestName: "Third party licences.txt"; Flags: ignoreversion
Source: "..\docs\usb.md"; DestDir: "{app}"; \
    DestName: "Putting Ksav on a USB stick.txt"; Flags: ignoreversion

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExe}"
Name: "{group}\Uninstall {#AppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#AppExe}"; Description: "Open {#AppName}"; \
    Flags: nowait postinstall skipifsilent

[UninstallDelete]
; Settings, the dictionary and downloaded models live in %LOCALAPPDATA%\Ksav and
; are deliberately left in place. Someone reinstalling should not have to
; download several gigabytes again, and their dictionary is their own work.
; Removing them is a deliberate act, not a side effect of uninstalling.
Type: filesandordirs; Name: "{app}\_internal\__pycache__"

[Messages]
WelcomeLabel2=This will install [name/ver] on your computer.%n%nKsav transcribes recordings, takes dictation and reads text from pages, entirely on this computer. Nothing you give it is uploaded anywhere.%n%nAfter installing, it will need a speech model once, either downloaded or copied from a USB stick.
