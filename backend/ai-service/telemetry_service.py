"""
SENTRIROAD AI SERVICE — telemetry parsing (drone GPS-per-frame sync)
----------------------------------------------------------------------------
Turns a telemetry file into a list of (timestamp_seconds, lat, lng) points,
sorted by time, so detect_from_video() can look up "what GPS point was the
drone at when this frame was captured."

WHY TWO FORMATS:
  1. DJI-style .srt — the real format most consumer/prosumer drones
     (DJI Mavic/Air/Mini series) embed GPS telemetry in, as text baked
     into subtitle blocks alongside the video. This is what you'll get
     from an actual drone operator in the field.
  2. A dead-simple CSV (`timestamp_seconds,lat,lng` per line, optional
     header) — for testing without a real drone. You can hand-write a
     10-line file with fake coordinates and it'll exercise the exact
     same downstream clustering code as real DJI telemetry would.

The parser auto-detects which format it's looking at (SRT files start
with a numeric block index; CSV does not), so callers don't need to
know or specify which one was uploaded.

WHAT THIS DOES NOT DO (intentionally, matches earlier discussion):
  - Does not validate the telemetry file actually matches the video's
    duration/frame count. If they're mismatched (e.g. wrong file
    uploaded), matching will just silently produce odd results near
    the tail end. Flag if you want a sanity-check added later.
  - Does not support GPX (common phone-GPS-logger export format) yet,
    even though it was floated as a synthetic-testing option earlier —
    only real DJI .srt and the plain CSV above. Easy to add if you end
    up wanting a GPX-based test file instead of CSV.
"""

import re
from typing import List, NamedTuple, Optional


class TelemetryPoint(NamedTuple):
    timestamp_seconds: float
    lat: float
    lng: float


# ---------------- PUBLIC ENTRY POINT ----------------

def parse_telemetry_file(file_path: str) -> List[TelemetryPoint]:
    """
    Reads a telemetry file from disk and returns a time-sorted list of
    TelemetryPoint. Auto-detects DJI .srt vs. plain CSV format.
    Raises ValueError if the file can't be parsed as either.
    """
    with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
        content = f.read()

    if _looks_like_srt(content):
        points = _parse_dji_srt(content)
    else:
        points = _parse_csv(content)

    if not points:
        raise ValueError(
            "Telemetry file was read but no valid GPS points were found. "
            "Expected either a DJI-style .srt with embedded "
            "[latitude: ..] [longitude: ..] tags, or a CSV of "
            "'timestamp_seconds,lat,lng' rows."
        )

    return sorted(points, key=lambda p: p.timestamp_seconds)


def gps_at_timestamp(points: List[TelemetryPoint], timestamp_seconds: float) -> Optional[TelemetryPoint]:
    """
    Finds the telemetry point closest in time to a given frame timestamp
    (nearest-neighbor match, not interpolation — good enough at 1fps
    sampling where telemetry points are typically much denser than that).
    Returns None only if points is empty.
    """
    if not points:
        return None
    return min(points, key=lambda p: abs(p.timestamp_seconds - timestamp_seconds))


# ---------------- FORMAT DETECTION ----------------

def _looks_like_srt(content: str) -> bool:
    """
    SRT blocks start with a bare integer index on its own line, followed
    by a timecode line (00:00:00,000 --> 00:00:01,000). Checking the
    first non-empty line is a cheap, reliable enough discriminator
    against CSV (which starts with a number+comma or a header word).
    """
    for line in content.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        return bool(re.fullmatch(r"\d+", stripped))
    return False


# ---------------- DJI .SRT PARSING ----------------

# Matches latitude/longitude tags as embedded by DJI firmware, e.g.:
#   [latitude: 22.535326] [longitude: 113.951263]
# Some firmware versions omit the space after the colon or use
# different casing — tolerate both.
_LAT_RE = re.compile(r"latitude\s*:\s*(-?\d+\.\d+)", re.IGNORECASE)
_LNG_RE = re.compile(r"longitude\s*:\s*(-?\d+\.\d+)", re.IGNORECASE)

# Matches the block's start timecode, e.g. "00:00:03,000 --> 00:00:04,000"
_TIMECODE_RE = re.compile(
    r"(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->"
)


def _parse_dji_srt(content: str) -> List[TelemetryPoint]:
    points: List[TelemetryPoint] = []

    # Blocks are separated by one or more blank lines.
    blocks = re.split(r"\n\s*\n", content.strip())

    for block in blocks:
        tc_match = _TIMECODE_RE.search(block)
        lat_match = _LAT_RE.search(block)
        lng_match = _LNG_RE.search(block)

        if not (tc_match and lat_match and lng_match):
            # Block doesn't have everything we need (e.g. malformed or
            # a firmware variant without GPS in this frame) — skip it
            # rather than failing the whole file over one bad block.
            continue

        hours, minutes, seconds, millis = (int(g) for g in tc_match.groups())
        timestamp_seconds = hours * 3600 + minutes * 60 + seconds + millis / 1000.0

        try:
            lat = float(lat_match.group(1))
            lng = float(lng_match.group(1))
        except ValueError:
            continue

        points.append(TelemetryPoint(timestamp_seconds, lat, lng))

    return points


# ---------------- CSV PARSING ----------------

def _parse_csv(content: str) -> List[TelemetryPoint]:
    points: List[TelemetryPoint] = []

    for line in content.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue

        parts = [p.strip() for p in line.split(",")]
        if len(parts) < 3:
            continue

        try:
            timestamp_seconds = float(parts[0])
            lat = float(parts[1])
            lng = float(parts[2])
        except ValueError:
            # Most likely a header row (e.g. "timestamp,lat,lng") —
            # skip silently rather than erroring the whole file.
            continue

        points.append(TelemetryPoint(timestamp_seconds, lat, lng))

    return points
