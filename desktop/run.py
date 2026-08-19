"""The way in.

A separate file from zmanimboard/app.py because that one is a module inside the package and
uses relative imports, so it cannot be run directly. This is also what PyInstaller is handed
when the Windows executable is built.
"""
import sys
from pathlib import Path

# Running from a checkout rather than from the built executable: make the package importable
# without anything having to be installed first.
sys.path.insert(0, str(Path(__file__).resolve().parent))

if __name__ == "__main__":
    # Handed to the built program by the build workflow, to prove it really starts. Checked
    # before the window is imported so a packaging failure shows up as a failed check rather
    # than as a crash on the way in.
    if "--selftest" in sys.argv:
        from zmanimboard.selftest import run_selftest

        sys.exit(run_selftest())

    from zmanimboard.app import main

    sys.exit(main())
