"""Typing dictated text into whatever program has the cursor.

Two ways, because neither works everywhere.

``SendInput`` with KEYEVENTF_UNICODE sends the characters as if they were typed,
which works in Word, Outlook, a browser, WhatsApp Web and ordinary text boxes,
and does not disturb the clipboard. It is slower for long text and a few
programs with unusual input handling ignore it.

The clipboard route puts the text on the clipboard and sends Ctrl+V. It is
instant regardless of length and works almost everywhere, but it replaces
whatever the user had copied, so the previous contents are saved and put back.

One limit that is Windows itself rather than Ksav: a program running as
administrator will not accept synthetic input from one that is not. Ksav can be
run as administrator to reach those, but that should be a choice the user makes
rather than a default.
"""

from __future__ import annotations

import sys
import time
from dataclasses import dataclass

from ..core.logging import get

log = get(__name__)

IS_WINDOWS = sys.platform == "win32"

# Win32 constants
INPUT_KEYBOARD = 1
KEYEVENTF_KEYUP = 0x0002
KEYEVENTF_UNICODE = 0x0004
VK_CONTROL = 0x11
VK_V = 0x56


@dataclass
class InjectionResult:
    ok: bool
    method: str
    message: str = ""


class Injector:
    """Sends text to the focused window."""

    def __init__(self, method: str = "sendinput") -> None:
        self.method = method

    def available(self) -> tuple[bool, str]:
        if not IS_WINDOWS:
            return False, (
                "Typing into other programs is a Windows feature. On this system "
                "dictated text can still be copied from Ksav."
            )
        return True, "Ready."

    def send(self, text: str) -> InjectionResult:
        if not text:
            return InjectionResult(True, "none")
        usable, reason = self.available()
        if not usable:
            return InjectionResult(False, "none", reason)

        if self.method == "clipboard":
            return self._via_clipboard(text)
        result = self._via_sendinput(text)
        if not result.ok:
            # Falling back rather than failing: the user said dictate into this
            # program, and the method is an implementation detail to them.
            log.info("SendInput failed (%s), trying the clipboard", result.message)
            return self._via_clipboard(text)
        return result

    # -- SendInput -------------------------------------------------------

    def _via_sendinput(self, text: str) -> InjectionResult:
        try:
            import ctypes
            from ctypes import wintypes
        except ImportError as exc:
            return InjectionResult(False, "sendinput", str(exc))

        class KEYBDINPUT(ctypes.Structure):
            _fields_ = [
                ("wVk", wintypes.WORD),
                ("wScan", wintypes.WORD),
                ("dwFlags", wintypes.DWORD),
                ("time", wintypes.DWORD),
                ("dwExtraInfo", ctypes.POINTER(wintypes.ULONG)),
            ]

        class INPUT_UNION(ctypes.Union):
            _fields_ = [("ki", KEYBDINPUT)]

        class INPUT(ctypes.Structure):
            _anonymous_ = ("u",)
            _fields_ = [("type", wintypes.DWORD), ("u", INPUT_UNION)]

        user32 = ctypes.WinDLL("user32", use_last_error=True)
        events: list[INPUT] = []

        for char in text:
            code = ord(char)
            # Anything outside the basic plane needs a surrogate pair, which
            # SendInput expects as two separate events.
            units = [code] if code <= 0xFFFF else [
                0xD800 + ((code - 0x10000) >> 10),
                0xDC00 + ((code - 0x10000) & 0x3FF),
            ]
            for unit in units:
                for flags in (KEYEVENTF_UNICODE, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP):
                    event = INPUT()
                    event.type = INPUT_KEYBOARD
                    event.ki = KEYBDINPUT(0, unit, flags, 0, None)
                    events.append(event)

        array = (INPUT * len(events))(*events)
        sent = user32.SendInput(len(events), array, ctypes.sizeof(INPUT))
        if sent != len(events):
            error = ctypes.get_last_error()
            return InjectionResult(
                False, "sendinput",
                f"Windows accepted {sent} of {len(events)} keystrokes (error {error}). "
                f"The program being typed into may be running as administrator.",
            )
        return InjectionResult(True, "sendinput")

    # -- clipboard -------------------------------------------------------

    def _via_clipboard(self, text: str) -> InjectionResult:
        try:
            from PySide6.QtGui import QGuiApplication
        except ImportError as exc:
            return InjectionResult(False, "clipboard", str(exc))

        clipboard = QGuiApplication.clipboard()
        if clipboard is None:
            return InjectionResult(False, "clipboard", "No clipboard is available.")

        previous = clipboard.text()
        clipboard.setText(text)
        result = self._send_paste()
        # Give the target program a moment to read the clipboard before the
        # user's own contents go back on it.
        time.sleep(0.15)
        try:
            clipboard.setText(previous)
        except Exception:
            pass
        return result

    def _send_paste(self) -> InjectionResult:
        if not IS_WINDOWS:
            return InjectionResult(False, "clipboard", "Windows only.")
        import ctypes
        from ctypes import wintypes

        user32 = ctypes.WinDLL("user32", use_last_error=True)
        # keybd_event is deprecated in favour of SendInput, but for two modifier
        # keystrokes it is simpler and works identically.
        user32.keybd_event(VK_CONTROL, 0, 0, 0)
        user32.keybd_event(VK_V, 0, 0, 0)
        user32.keybd_event(VK_V, 0, KEYEVENTF_KEYUP, 0)
        user32.keybd_event(VK_CONTROL, 0, KEYEVENTF_KEYUP, 0)
        return InjectionResult(True, "clipboard")


def spacing_before(previous: str, text: str) -> str:
    """Whether a space is needed before the next phrase.

    Dictation arrives a phrase at a time, and running them together is the most
    obvious way for it to look broken. A space goes in unless the previous text
    already ended in whitespace or an opening bracket, or the new text starts
    with punctuation that closes up against the word before it.
    """
    if not previous or previous[-1].isspace() or previous[-1] in "([{“‘":
        return ""
    if text[:1] in ".,;:!?)]}”’%":
        return ""
    return " "
