"""Solar position core, ported from js/zmanim/solar.js, which is itself a 1:1 port of the
workbook's calc* LAMBDA functions.

All "day" values are fractional days: 0 is midnight, 0.5 is noon. A calendar date is an
Excel style serial day number, and the time of day for an event comes back separately as
a fraction of a day, exactly like an Excel serial's fractional part.
"""
import math
from dataclasses import dataclass
from datetime import date, timedelta

# Day 0 in Excel's serial system. No 1900 leap bug correction: it is irrelevant for any
# date this program will ever be asked about.
EXCEL_EPOCH = date(1899, 12, 30)


def excel_serial(d: date) -> int:
    return (d - EXCEL_EPOCH).days


def date_from_serial(serial: float) -> date:
    """The inverse, flooring rather than rounding.

    Every whole day serial here is already an integer, so for those it makes no
    difference. The DST lookups are the reason: they pass a whole day plus a UTC time of
    day, e.g. an evening sunset at serial + 0.91. The workbook's own calcDST_LOCAL pulls
    the calendar day out of such a value with YEAR()/DATE() arithmetic, which truncates to
    the day the moment falls in. Rounding instead pushes any evening event into the next
    calendar day, which is harmless almost all year and silently wrong for the one week
    each autumn where that crosses the real cutover a week early.
    """
    return EXCEL_EPOCH + timedelta(days=math.floor(serial))


D2R = math.pi / 180


def _sind(deg): return math.sin(deg * D2R)
def _cosd(deg): return math.cos(deg * D2R)
def _tand(deg): return math.tan(deg * D2R)
def _asind(x): return math.asin(x) / D2R
def _acosd(x): return math.acos(x) / D2R


def calc_jd(serial: float) -> float:
    return serial + 2415018.5


def calc_jd_to_jcent(jd: float) -> float:
    return (jd - 2451545) / 36525


def _geom_mean_long_sun(t):
    return (280.46646 + t * (36000.76983 + 0.0003032 * t)) % 360


def _geom_mean_anomaly_sun(t):
    return 357.52911 + t * (35999.05029 - 0.0001537 * t)


def _eccentricity_earth_orbit(t):
    return 0.016708634 - t * (0.000042037 + 0.0000001267 * t)


def _sun_eq_of_center(t):
    m = _geom_mean_anomaly_sun(t)
    return (
        _sind(m) * (1.914602 - t * (0.004817 + 0.000014 * t))
        + _sind(2 * m) * (0.019993 - 0.000101 * t)
        + _sind(3 * m) * 0.000289
    )


def _sun_true_long(t):
    return _geom_mean_long_sun(t) + _sun_eq_of_center(t)


def _sun_apparent_long(t):
    omega = 125.04 - 1934.136 * t
    return _sun_true_long(t) - 0.00569 - 0.00478 * _sind(omega)


def _mean_obliquity_of_ecliptic(t):
    seconds = 21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))
    return 23 + (26 + seconds / 60) / 60


def _obliquity_correction(t):
    omega = 125.04 - 1934.136 * t
    return _mean_obliquity_of_ecliptic(t) + 0.00256 * _cosd(omega)


def sun_declination(t):
    return _asind(_sind(_obliquity_correction(t)) * _sind(_sun_apparent_long(t)))


def equation_of_time(t):
    """In fractional days, matching the workbook's own /360."""
    epsilon = _obliquity_correction(t)
    long = _geom_mean_long_sun(t)
    e = _eccentricity_earth_orbit(t)
    m = _geom_mean_anomaly_sun(t)
    y = _tand(epsilon / 2) ** 2
    deg = (
        y * _sind(long * 2)
        - 2 * e * _sind(m)
        + 4 * e * y * _sind(m) * _cosd(2 * long)
        - 0.5 * y * y * _sind(long * 4)
        - 1.25 * e * e * _sind(m * 2)
    ) / D2R
    return deg / 360


def _hour_angle_sunrise(lat, solar_dec, zenith_deg):
    cos_h = _cosd(zenith_deg) / (_cosd(lat) * _cosd(solar_dec)) - _tand(lat) * _tand(solar_dec)
    return _acosd(max(-1.0, min(1.0, cos_h)))


def elev_adjust(elevation_meters: float) -> float:
    return _acosd(6356.9 / (6356.9 + elevation_meters / 1000))


def zenith(horizon_deg: float) -> float:
    """90 plus the horizon, not 90 minus it.

    horizon_deg is degrees below the geometric horizon, the workbook's default being 5/6,
    the sun's radius plus average refraction. The workbook stores its SETTINGS cell as
    -5/6 and its own calcZENITH negates it back before adding 90; this takes the already
    positive, human readable value directly.
    """
    return 90 + horizon_deg


def _sunrise_set_utc(rise, j_day, latitude, longitude, zenith_deg):
    t = calc_jd_to_jcent(j_day)
    eot = equation_of_time(t)
    solar_dec = sun_declination(t)
    hour_angle = _hour_angle_sunrise(latitude, solar_dec, zenith_deg)
    if not rise:
        hour_angle = -hour_angle
    return 0.5 - (longitude + hour_angle) / 360 - eot


def _sunrise_set(rise, j_day, latitude, longitude, zenith_deg):
    """Two pass refinement, returning a fractional UTC day."""
    pass_one = _sunrise_set_utc(rise, j_day + (-0.25 if rise else 0.25), latitude, longitude, zenith_deg)
    return _sunrise_set_utc(rise, j_day + pass_one, latitude, longitude, zenith_deg)


@dataclass(frozen=True)
class Timezone:
    id: str
    label: str
    utc_offset: float
    dst_offset: float
    rule: str  # 'us' or 'none'


def _nth_sunday(year: int, month: int, nth: int) -> date:
    first = date(year, month, 1)
    # date.isoweekday() is 1 for Monday through 7 for Sunday; the workbook counts Sunday
    # as 0, which is what this converts to.
    first_dow = first.isoweekday() % 7
    first_sunday = 1 + ((7 - first_dow) % 7)
    return date(year, month, first_sunday + (nth - 1) * 7)


def _us_dst_active(d: date) -> bool:
    """The US rule the workbook implements: second Sunday in March at 2am through the
    first Sunday in November at 2am, local time."""
    return _nth_sunday(d.year, 3, 2) <= d < _nth_sunday(d.year, 11, 1)


def timezone_offset(d: date, tz: Timezone):
    """calcTIMEZONE / calcDST_LOCAL, with the two rule types the workbook itself has."""
    is_dst = tz.rule == "us" and _us_dst_active(d)
    return tz.utc_offset + (tz.dst_offset if is_dst else 0), is_dst


def clamp_latitude(lat: float) -> float:
    """calcLATITUDE, clamped like the workbook so the poles cannot blow the maths up."""
    return max(-89.8, min(89.8, lat))


def sun_event(rise: bool, d: date, horizon_deg: float, settings, use_elevation: bool) -> float:
    """The sunrise/sunset core behind every zman.

    Returns a fraction of a day offset from that date's local midnight, so 0.25 is 6am.
    """
    lat = clamp_latitude(settings.latitude)
    elev_m = settings.elevation if use_elevation else 0
    z = zenith(horizon_deg) + elev_adjust(elev_m)
    serial = excel_serial(d)
    event_utc = _sunrise_set(rise, calc_jd(serial), lat, settings.longitude, z)
    offset_hours, _ = timezone_offset(date_from_serial(serial + event_utc), settings.timezone)
    return event_utc + offset_hours / 24
