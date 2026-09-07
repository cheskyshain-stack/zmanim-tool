"""The shortcut that starts dictation from anywhere in Windows.

``RegisterHotKey`` claims a key combination system wide and posts WM_HOTKEY to
the registering thread's message queue. Ksav is a Qt application whose main
thread already pumps Windows messages, so the hotkey is registered from that
thread and caught with a native event filter. That avoids a second thread with
its own message loop, and means the callback arrives on the thread that owns the
interface, where it is safe to touch widgets.

Two limits worth knowing, both Windows rather than Ksav. A combination another
program has already claimed cannot be registered, and Windows says so rather
than sharing it. And a few combinations are reserved by the system and cannot be
taken at all.

The parsing below is separated out and tested; the registration itself only runs
on Windows and has not been exercised on this machine.
"""

from __future__ import annotations

import abc
import sys
from dataclasses import dataclass
from typing import Callable

from ..core.logging import get

log = get(__name__)

IS_WINDOWS = sys.platform == "win32"

MOD_ALT = 0x0001
MOD_CONTROL = 0x0002
MOD_SHIFT = 0x0004
MOD_WIN = 0x0008
MOD_NOREPEAT = 0x4000
WM_HOTKEY = 0x0312

MODIFIER_NAMES = {
    "ctrl": MOD_CONTROL, "control": MOD_CONTROL,
    "alt": MOD_ALT,
    "shift": MOD_SHIFT,
    "win": MOD_WIN, "super": MOD_WIN, "meta": MOD_WIN, "cmd": MOD_WIN,
}

# Virtual key codes for the keys a shortcut is likely to use.
VIRTUAL_KEYS = {
    **{chr(c): c for c in range(ord("A"), ord("Z") + 1)},
    **{str(d): 0x30 + d for d in range(10)},
    "SPACE": 0x20, "ENTER": 0x0D, "RETURN": 0x0D, "TAB": 0x09,
    "ESC": 0x1B, "ESCAPE": 0x1B, "BACKSPACE": 0x08, "DELETE": 0x2E,
    "INSERT": 0x2D, "HOME": 0x24, "END": 0x23, "PAGEUP": 0x21, "PAGEDOWN": 0x22,
    "LEFT": 0x25, "UP": 0x26, "RIGHT": 0x27, "DOWN": 0x28,
    "`": 0xC0, "-": 0xBD, "=": 0xBB, "[": 0xDB, "]": 0xDD,
    "\\": 0xDC, ";": 0xBA, "'": 0xDE, ",": 0xBC, ".": 0xBE, "/": 0xBF,
    **{f"F{n}": 0x6F + n for n in range(1, 25)},
}


class HotkeyError(ValueError):
    """A shortcut that cannot be used. The message is shown to the user."""


@dataclass(frozen=True)
class Shortcut:
    modifiers: int
    key: int
    text: str

    @property
    def has_modifier(self) -> bool:
        return bool(self.modifiers & (MOD_CONTROL | MOD_ALT | MOD_SHIFT | MOD_WIN))


def parse(spec: str) -> Shortcut:
    """Turn "Ctrl+Alt+D" into the numbers Windows wants.

    Raises :class:`HotkeyError` with a sentence a user can act on, because this
    runs on whatever they typed into the settings box.
    """
    if not spec or not spec.strip():
        raise HotkeyError("No shortcut has been set.")

    parts = [p.strip() for p in spec.replace("-", "+").split("+") if p.strip()]
    if not parts:
        raise HotkeyError(f"'{spec}' is not a shortcut Ksav understands.")

    modifiers = 0
    key_name = None
    for part in parts:
        lowered = part.lower()
        if lowered in MODIFIER_NAMES:
            modifiers |= MODIFIER_NAMES[lowered]
        elif key_name is None:
            key_name = part
        else:
            raise HotkeyError(
                f"'{spec}' has more than one key in it. A shortcut is modifiers "
                f"plus a single key, like Ctrl+Alt+D."
            )

    if key_name is None:
        raise HotkeyError(
            f"'{spec}' is only modifier keys. Add a letter or a number, "
            f"like Ctrl+Alt+D."
        )

    key = VIRTUAL_KEYS.get(key_name.upper()) or VIRTUAL_KEYS.get(key_name)
    if key is None:
        raise HotkeyError(f"Ksav does not know the key '{key_name}'.")

    shortcut = Shortcut(modifiers, key, normalise(spec))
    if not shortcut.has_modifier:
        raise HotkeyError(
            "A global shortcut needs at least one of Ctrl, Alt, Shift or the "
            "Windows key, or it would fire while you were typing."
        )
    return shortcut


def normalise(spec: str) -> str:
    """A consistent spelling for display: Ctrl+Alt+D."""
    parts = [p.strip() for p in spec.replace("-", "+").split("+") if p.strip()]
    order = ["ctrl", "alt", "shift", "win"]
    names = {"control": "ctrl", "super": "win", "meta": "win", "cmd": "win"}

    modifiers = []
    key = ""
    for part in parts:
        lowered = names.get(part.lower(), part.lower())
        if lowered in order:
            if lowered not in modifiers:
                modifiers.append(lowered)
        else:
            key = part.upper() if len(part) == 1 else part.capitalize()

    modifiers.sort(key=order.index)
    labels = {"ctrl": "Ctrl", "alt": "Alt", "shift": "Shift", "win": "Win"}
    return "+".join([labels[m] for m in modifiers] + ([key] if key else []))


class HotkeyManager(abc.ABC):
    """Claims a shortcut across the whole system."""

    @abc.abstractmethod
    def available(self) -> tuple[bool, str]:
        ...

    @abc.abstractmethod
    def register(self, spec: str, on_press: Callable[[], None],
                 on_release: Callable[[], None] | None = None) -> tuple[bool, str]:
        ...

    @abc.abstractmethod
    def unregister(self) -> None:
        ...


class NullHotkeys(HotkeyManager):
    """Off Windows. Says so plainly rather than pretending to work."""

    def available(self) -> tuple[bool, str]:
        return False, (
            "A shortcut that works in other programs is a Windows feature. "
            "Dictation still works inside Ksav."
        )

    def register(self, spec, on_press, on_release=None) -> tuple[bool, str]:
        parse(spec)          # still validate, so the settings box gives feedback
        return False, self.available()[1]

    def unregister(self) -> None:
        pass


class WindowsHotkeys(HotkeyManager):
    """RegisterHotKey plus a Qt native event filter.

    The filter is installed on the application, so WM_HOTKEY is seen on the
    thread that owns the interface and the callback can touch widgets directly.
    """

    HOTKEY_ID = 0xB001

    def __init__(self) -> None:
        self._filter = None
        self._registered = False
        self._on_press: Callable[[], None] | None = None

    def available(self) -> tuple[bool, str]:
        if not IS_WINDOWS:
            return False, "Windows only."
        return True, "Ready."

    def register(self, spec, on_press, on_release=None) -> tuple[bool, str]:
        shortcut = parse(spec)          # raises HotkeyError with a usable message
        self.unregister()

        import ctypes

        from PySide6.QtCore import QAbstractNativeEventFilter
        from PySide6.QtWidgets import QApplication

        user32 = ctypes.WinDLL("user32", use_last_error=True)
        # MOD_NOREPEAT stops holding the keys down firing over and over.
        ok = user32.RegisterHotKey(
            None, self.HOTKEY_ID, shortcut.modifiers | MOD_NOREPEAT, shortcut.key
        )
        if not ok:
            error = ctypes.get_last_error()
            if error == 1409:           # ERROR_HOTKEY_ALREADY_REGISTERED
                return False, (
                    f"{shortcut.text} is already used by another program, so "
                    f"Windows will not give it to Ksav. Choose a different one."
                )
            return False, (
                f"Windows would not give Ksav the shortcut {shortcut.text} "
                f"(error {error}). Choose a different one."
            )

        self._on_press = on_press
        manager = self

        class Filter(QAbstractNativeEventFilter):
            def nativeEventFilter(self, event_type, message):   # noqa: N802
                if event_type != b"windows_generic_MSG":
                    return False, 0
                msg = ctypes.cast(int(message), ctypes.POINTER(_MSG)).contents
                if msg.message == WM_HOTKEY and msg.wParam == manager.HOTKEY_ID:
                    if manager._on_press:
                        manager._on_press()
                    return True, 0
                return False, 0

        self._filter = Filter()
        app = QApplication.instance()
        if app is not None:
            app.installNativeEventFilter(self._filter)
        self._registered = True
        log.info("registered global shortcut %s", shortcut.text)
        return True, f"{shortcut.text} will start dictation from anywhere."

    def unregister(self) -> None:
        if not self._registered:
            return
        try:
            import ctypes

            from PySide6.QtWidgets import QApplication

            ctypes.WinDLL("user32", use_last_error=True).UnregisterHotKey(
                None, self.HOTKEY_ID
            )
            app = QApplication.instance()
            if app is not None and self._filter is not None:
                app.removeNativeEventFilter(self._filter)
        except Exception as exc:
            log.info("releasing the shortcut raised: %s", exc)
        finally:
            self._registered = False
            self._filter = None
            self._on_press = None


if IS_WINDOWS:
    import ctypes
    from ctypes import wintypes

    class _MSG(ctypes.Structure):
        _fields_ = [
            ("hwnd", wintypes.HWND),
            ("message", wintypes.UINT),
            ("wParam", wintypes.WPARAM),
            ("lParam", wintypes.LPARAM),
            ("time", wintypes.DWORD),
            ("pt_x", wintypes.LONG),
            ("pt_y", wintypes.LONG),
        ]
else:
    _MSG = None


def build() -> HotkeyManager:
    return WindowsHotkeys() if IS_WINDOWS else NullHotkeys()
