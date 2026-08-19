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

from zmanimboard.app import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main())
