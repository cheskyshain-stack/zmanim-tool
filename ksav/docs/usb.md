# Putting Ksav on a USB stick

The offline computer never needs an internet connection. You do everything that
needs one on a computer that has it, then carry the result across.

## On the computer that has internet

Build the program, then build the bundle:

```
pyinstaller packaging/ksav.spec --noconfirm
iscc packaging\installer.iss
python packaging\make-usb-bundle.py --models whisper-medium --out D:\
```

To see the choices first:

```
python packaging\make-usb-bundle.py --list
```

Most machines want `whisper-medium`. A computer with an NVIDIA graphics card can
take `whisper-large-v3`. A Yiddish or Hebrew shiur is better served by
`ivrit-turbo`. You can pass several at once and choose on the other side.

The download resumes: if it is interrupted, run the same command again and it
carries on rather than starting over.

## What you get

```
KsavUSB/
    START HERE.txt          plain instructions for whoever carries the stick
    Ksav-Setup-0.1.0.exe    the installer
    Ksav/                   the program, ready to run without installing
        Ksav.exe
        ksav-portable.txt   the marker that switches on portable mode
    Models/
        whisper-medium/     the speech model
```

Copy that whole folder to the stick.

## On the offline computer

Two ways, and neither involves a browser, a command prompt, or a file dialog.

**Run it from the stick.** Open `KsavUSB\Ksav` and double click `Ksav`. It runs
straight off the stick and keeps its settings, dictionary and models on the
stick. Nothing is written to the computer, so a borrowed or shared machine is
left exactly as it was found.

**Or install it.** Double click the setup file. It is a per user install, so
Windows does not ask for an administrator password. When Ksav opens it scans
every removable drive and the folder it is sitting in, notices the models on the
stick, and offers to copy them across. One button.

## How Ksav finds the stick

`app/platform/media.py` asks Windows which drives are removable, then checks each
one, plus the folder the program is in, for anything that looks like a model:
a folder holding every file the catalogue says that model needs. A folder that
is only half copied is not offered, because a partly copied model fails later in
ways that look like bad transcription.

The user is never asked where they put something. Choosing a folder by hand is
still there as a fallback, but it is not the path.

## Portable mode

A file named `ksav-portable.txt` beside `Ksav.exe` moves the data root from
`%LOCALAPPDATA%\Ksav` to a `KsavData` folder next to the program.

If the stick turns out to be write protected, Ksav falls back to the computer's
own folders and says so in Settings rather than failing to open. A read only
drive should slow the program down, not stop it.

Delete the marker file if you would rather a copy on the stick used the host
computer's folders instead.

## Not a browser

Ksav is a normal Windows program: a native window, a Start Menu entry, an icon
in the taskbar. There is no web page, no local server, no browser involved at
any point, online or offline. Nothing in the application opens a browser, and a
test checks that stays true.
