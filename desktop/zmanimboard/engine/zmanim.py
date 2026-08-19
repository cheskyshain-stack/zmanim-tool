"""The named zmanim, ported from js/zmanim/zmanim.js, which is a 1:1 port of the
workbook's defined names.

Every function returns a fraction of a day representing a local time, exactly as the
Excel formulas do: add it to a date's serial to get a date and time.
"""
from datetime import date

from . import solar

MIN = 1 / 1440  # one minute, as a fraction of a day


# SUNRISE / SUNSET: the horizon is adjustable and elevation is always applied. The
# workbook carries a note saying so: "elevation used in this function will adjust even if
# the 'use elevation for zmanim' setting is set to false".
def sunrise(d: date, s, horizon_deg=None) -> float:
    return solar.sun_event(True, d, s.horizon if horizon_deg is None else horizon_deg, s, True)


def sunset(d: date, s, horizon_deg=None) -> float:
    return solar.sun_event(False, d, s.horizon if horizon_deg is None else horizon_deg, s, True)


# SUNRISE_elev / SUNSET_elev: the horizon comes from settings, and elevation is applied
# only when the "use elevation for zmanim" toggle is on.
def sunrise_elev(d: date, s) -> float:
    return solar.sun_event(True, d, s.horizon, s, s.use_elevation)


def sunset_elev(d: date, s) -> float:
    return solar.sun_event(False, d, s.horizon, s, s.use_elevation)


def solar_noon(d: date, s) -> float:
    """SOLAR_NOON, true solar noon, astronomical chatzos."""
    lon = s.longitude / 360
    serial = solar.excel_serial(d)
    j_day = solar.calc_jd(serial)
    eot1 = solar.equation_of_time(solar.calc_jd_to_jcent(j_day - lon))
    eot2 = solar.equation_of_time(solar.calc_jd_to_jcent(j_day - lon - eot1))
    noon_utc = 0.5 - lon - eot2
    offset_hours, _ = solar.timezone_offset(solar.date_from_serial(serial + noon_utc), s.timezone)
    return noon_utc + offset_hours / 24


def dst_local(d: date, s) -> bool:
    """calcDST_LOCAL. The sheet formulas branch on it directly, so it is exposed."""
    return solar.timezone_offset(d, s.timezone)[1]


# Alos and Misheyakir, degree based, off plain SUNRISE.
def alos_16_1(d, s): return sunrise(d, s, 16.1)
def misheyakir_10_2(d, s): return sunrise(d, s, 10.2)


# Tzais, minute and degree based, off SUNSET / SUNSET_elev.
def tzais_50(d, s): return sunset_elev(d, s) + 50 * MIN
def tzais_60(d, s): return sunset_elev(d, s) + 60 * MIN
def tzais_72(d, s): return sunset_elev(d, s) + 72 * MIN
def tzais_geonim_8_5(d, s): return sunset(d, s, 8.5)


def alos_72(d, s): return sunrise_elev(d, s) - 72 * MIN


def _from_end_of_day(end_of_day, midday, start_of_day, full_day_fraction, half_day_fraction, use_astronomical_chatzos):
    """The proportional day pattern behind MINCHA_GEDOLA / KETANA, PLAG_HAMINCHA and
    SAMUCH_LEMINCHA_KETANA, counted back from the end of the day."""
    if use_astronomical_chatzos:
        return end_of_day - (end_of_day - midday) * half_day_fraction
    return end_of_day - (end_of_day - start_of_day) * full_day_fraction


def _from_start_of_day(start_of_day, midday, end_of_day, full_day_fraction, half_day_fraction, use_astronomical_chatzos):
    """The same pattern for SOF_ZMAN_SHMA / TFILA, counted forward from the start."""
    if use_astronomical_chatzos:
        return start_of_day + (midday - start_of_day) * half_day_fraction
    return start_of_day + (end_of_day - start_of_day) * full_day_fraction


def mincha_gedola(d, s):
    return _from_end_of_day(sunset_elev(d, s), solar_noon(d, s), sunrise_elev(d, s), 5.5 / 12, 5.5 / 6, s.use_astronomical_chatzos)


def mincha_gedola_30_min_after_chatzos(d, s):
    return solar_noon(d, s) + 30 * MIN


def mincha_gedola_lechumra(d, s):
    """MINCHA_GEDOLA_LECHUMRA: the later of the two."""
    return max(mincha_gedola(d, s), mincha_gedola_30_min_after_chatzos(d, s))


def mincha_ketana(d, s):
    return _from_end_of_day(sunset_elev(d, s), solar_noon(d, s), sunrise_elev(d, s), 2.5 / 12, 2.5 / 6, s.use_astronomical_chatzos)


def samuch_lemincha_ketana(d, s):
    return _from_end_of_day(sunset_elev(d, s), solar_noon(d, s), sunrise_elev(d, s), 1 / 4, 1 / 2, s.use_astronomical_chatzos)


def plag_hamincha(d, s):
    return _from_end_of_day(sunset_elev(d, s), solar_noon(d, s), sunrise_elev(d, s), 1.25 / 12, 1.25 / 6, s.use_astronomical_chatzos)


def plag_hamincha_custom(end_of_day: float, start_of_day: float) -> float:
    """__PLAG_HAMINCHA(end_of_day, <midday omitted>, start_of_day), used directly by the
    sheets. With midday omitted the astronomical chatzos toggle is irrelevant: the
    workbook falls straight through to the full day branch."""
    return end_of_day - (end_of_day - start_of_day) * (1.25 / 12)


def sof_zman_shma_gra(d, s):
    return _from_start_of_day(sunrise_elev(d, s), solar_noon(d, s), sunset_elev(d, s), 1 / 4, 1 / 2, s.use_astronomical_chatzos)


def sof_zman_shma_mga_72(d, s):
    return _from_start_of_day(alos_72(d, s), solar_noon(d, s), tzais_72(d, s), 1 / 4, 1 / 2, s.use_astronomical_chatzos)


def sof_zman_tfila_gra(d, s):
    return _from_start_of_day(sunrise_elev(d, s), solar_noon(d, s), sunset_elev(d, s), 1 / 3, 1 / 1.5, s.use_astronomical_chatzos)
