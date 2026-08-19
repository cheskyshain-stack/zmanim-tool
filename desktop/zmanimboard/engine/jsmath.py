"""The handful of places where Python and JavaScript disagree about arithmetic.

Every one of these caused a wrong number at some point during the port, so they live in
one file with the reason written down rather than being inlined and rediscovered.
"""
import math


def js_round(x: float) -> float:
    """Math.round: ties go up, towards positive infinity.

    Python's round() is banker's rounding, so round(0.5) is 0 and round(1.5) is 2. The
    formatted times run through this on every cell, and a tie lands on a whole minute
    often enough that the difference is not theoretical.
    """
    return math.floor(x + 0.5)


def js_trunc(x: float) -> int:
    """Math.trunc: towards zero, unlike math.floor for negatives."""
    return math.trunc(x)


def mod(n: float, d: float) -> float:
    """Excel MOD, where the result takes the sign of the divisor.

    This is what Python's own % already does, so the function exists only to keep the
    ported formulas reading the way the JavaScript and the workbook do.
    """
    return n - d * math.floor(n / d)


def at(seq, index):
    """seq[index], or None when the index is off either end.

    A negative index in JavaScript is simply missing; in Python it counts back from the
    end and quietly returns the wrong row. The parsha lookup indexes with a computed
    number that can be zero, and `rows[-1]` there would hand back the last week of the
    year instead of nothing.
    """
    if index < 0 or index >= len(seq):
        return None
    return seq[index]
