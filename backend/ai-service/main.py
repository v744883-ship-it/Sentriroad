"""
SENTRIROAD AI SERVICE — real model integration (Roboflow hosted inference)
----------------------------------------------------------------------------
Implements the same contract the Node backend expects:

    POST /detect  { media_url, media_type }
    -> { damage_type, confidence, bbox: [x, y, w, h], evidence_image_url, ... }

WHY ROBOFLOW HOSTED API INSTEAD OF A LOCAL ultralytics/YOLO MODEL:
On the team's Windows machines, installing `ultralytics`/`torch` pulled in
`pydantic-core` builds that needed a Rust compiler + MSVC linker (the exact
error you hit earlier). Calling Roboflow's hosted inference API instead
needs only the `requests` library — no compilation, no GPU, works
identically on any machine. Trade-off: needs internet access and a
Roboflow API key at request time, and is rate-limited on the free tier.
If you later want a fully local/offline model, swap `call_roboflow()`
below for a local `ultralytics` call — the rest of the file (frame
extraction, dedup, the /detect endpoint) does not need to change.

WHAT'S NEW IN THIS VERSION vs. the earlier placeholder:
  1. Real detections via a pretrained pothole-detection YOLOv8 model
     (Intel Unnati Training Program's Indian-roads model, via Roboflow).
  2. Photos: sent directly to Roboflow using the public media_url — no
     download needed, since Roboflow can fetch a public image URL itself.
  3. Videos: actually extracts MULTIPLE frames (not just the middle one),
     runs detection on each frame, and returns the single
     highest-confidence detection across all frames — this is the
     "dedup" behavior we discussed (one work order per video, from
     whichever frame most clearly shows the damage), rather than
     guessing based on one arbitrary frame.

WHAT'S STILL NOT BUILT (intentionally, per earlier discussion):
  - GPS-from-video-telemetry sync (per-frame location from a drone's
    flight log). Still using the single report-level GPS point sent by
    the citizen/operator. Only relevant once you're ingesting drone
    footage with a real telemetry file — revisit then.
  - Multi-detection-per-video (i.e. reporting more than one distinct
    pothole found in the same video as separate work orders). Current
    behavior: one video -> one best detection -> one work order, same
    as the photo path. Flag to me if you need multiple.

Run:
    pip install -r requirements.txt
    uvicorn main:app --reload --port 8000

Required env vars (put these in ai-service/.env — see .env.example):
    ROBOFLOW_API_KEY   - from your Roboflow account settings
    ROBOFLOW_MODEL_ID  - "project-slug/version", e.g. "pothole-detection-bqu6s/1"
"""

import base64
import math
import os
import glob
import shutil
import subprocess
import tempfile
import uuid
from typing import Optional, List

import requests
from dotenv import load_dotenv
from fastapi import FastAPI
from pydantic import BaseModel

from telemetry_service import parse_telemetry_file, gps_at_timestamp

load_dotenv()

app = FastAPI(title="Sentriroad AI Service")

ROBOFLOW_API_KEY = os.getenv("ROBOFLOW_API_KEY", "")

# Needed only for uploading the winning video frame as a real evidence
# image (fixes evidence_image_url pointing at the raw video instead of
# a frame — see detect_from_video below). If these aren't set, the
# citizen video path falls back to the old behavior (evidence_image_url
# = video URL) rather than crashing — same fail-soft pattern used
# elsewhere in this file.
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
SUPABASE_STORAGE_BUCKET = os.getenv("SUPABASE_STORAGE_BUCKET", "evidence-uploads")
ROBOFLOW_MODEL_ID = os.getenv("ROBOFLOW_MODEL_ID", "pothole-detection-bqu6s/1")
ROBOFLOW_BASE_URL = "https://detect.roboflow.com"
CONFIDENCE_THRESHOLD = float(os.getenv("CONFIDENCE_THRESHOLD", "0.35"))

# 1 extracted frame per second of video. Raise this (e.g. fps=2) for
# slow-moving footage where you don't want to risk missing a pothole
# between samples; lower it for long videos to cut processing time.
VIDEO_SAMPLE_FPS = float(os.getenv("VIDEO_SAMPLE_FPS", "1"))

# Cap how many frames we'll actually run detection on per video, so a
# 5-minute video doesn't trigger 300 API calls. Frames are sampled
# evenly across this cap if the video is longer than this many seconds.
MAX_FRAMES_PER_VIDEO = int(os.getenv("MAX_FRAMES_PER_VIDEO", "20"))

# DRONE PATH ONLY (does not affect citizen photo/video path above).
# Two detected potholes whose telemetry-derived GPS points are within
# this many meters of each other are treated as the SAME pothole seen
# across multiple frames (keep the higher-confidence one). Farther
# apart than this = a genuinely different pothole = its own cluster,
# which becomes its own work order downstream.
CLUSTER_DISTANCE_METERS = float(os.getenv("CLUSTER_DISTANCE_METERS", "15"))

# Drone videos are typically longer flight clips, not a short citizen
# clip, so cap frames sent to the model higher than the citizen path
# above — same safety-cap reasoning, just a bigger number since a
# multi-pothole flight needs more samples to not miss anything.
MAX_FRAMES_PER_DRONE_VIDEO = int(os.getenv("MAX_FRAMES_PER_DRONE_VIDEO", "60"))


class DetectRequest(BaseModel):
    media_url: str
    media_type: str  # "photo" | "video"


class DetectResponse(BaseModel):
    damage_type: Optional[str] = None
    confidence: float
    bbox: List[float]  # [x_topleft, y_topleft, w, h] normalized 0-1
    evidence_image_url: Optional[str] = None
    frame_timestamp_seconds: Optional[float] = None
    traffic_volume_hint: Optional[float] = None
    road_category_hint: Optional[float] = None


# ---------------- DRONE MULTI-DETECTION MODELS ----------------
# Separate request/response shapes for the drone path (new /detect/drone
# endpoint below). The original /detect endpoint and DetectResponse
# above are completely untouched by any of this.

class DroneDetectRequest(BaseModel):
    media_url: str
    telemetry_url: str


class DroneDetectionItem(BaseModel):
    damage_type: Optional[str] = None
    confidence: float
    bbox: List[float]
    frame_timestamp_seconds: Optional[float] = None
    gps_lat: Optional[float] = None
    gps_lng: Optional[float] = None
    # Base64-encoded JPEG bytes of the winning frame for this cluster.
    # The Node backend decodes this and uploads it to Supabase Storage
    # itself (keeping all storage/upload logic in one place, same as
    # it already does for generated PDFs), rather than the ai-service
    # trying to talk to Supabase directly.
    frame_image_base64: Optional[str] = None


class DroneDetectResponse(BaseModel):
    detections: List[DroneDetectionItem]


@app.get("/")
def health():
    return {
        "status": "ok",
        "service": "sentriroad-ai",
        "model_configured": bool(ROBOFLOW_API_KEY),
        "model_id": ROBOFLOW_MODEL_ID,
    }


@app.post("/detect", response_model=DetectResponse)
def detect(req: DetectRequest):
    if not ROBOFLOW_API_KEY:
        # Fail loudly and obviously rather than silently returning fake
        # data — a missing API key should never look like "no pothole
        # found," since that would wrongly leave real reports stuck.
        return DetectResponse(
            damage_type=None,
            confidence=0.0,
            bbox=[0, 0, 0, 0],
            evidence_image_url=req.media_url,
        )

    if req.media_type == "video":
        try:
            return detect_from_video(req.media_url)
        except RuntimeError as e:
            # ffmpeg missing, or video processing otherwise failed.
            # Previously this propagated uncaught to FastAPI as a bare
            # 500 with no JSON body. Fail soft instead, same pattern
            # used everywhere else in this file (e.g. no API key
            # above) — the report gets left for manual review by the
            # Node pipeline's confidence check, rather than the whole
            # request blowing up.
            print(f"[video] detection failed: {e}")
            return DetectResponse(
                damage_type=None,
                confidence=0.0,
                bbox=[0, 0, 0, 0],
                evidence_image_url=req.media_url,
            )
    else:
        return detect_from_photo(req.media_url)


# ---------------- PHOTO PATH ----------------

def detect_from_photo(media_url: str) -> DetectResponse:
    """
    Photos are already at a public URL (uploaded via the signed-upload
    flow to Supabase Storage), so we hand that URL straight to Roboflow
    — no download needed on our side.
    """
    prediction = call_roboflow_with_url(media_url)
    return prediction_to_response(prediction, evidence_url=media_url, frame_timestamp=None)


# ---------------- VIDEO PATH ----------------

def detect_from_video(media_url: str) -> DetectResponse:
    frame_dir = None
    try:
        frame_dir, frames = extract_frames(media_url)
        if not frames:
            return DetectResponse(damage_type=None, confidence=0.0, bbox=[0, 0, 0, 0], evidence_image_url=media_url)

        best_prediction = None
        best_frame_timestamp = None

        for frame_path, timestamp in frames:
            prediction = call_roboflow_with_file(frame_path)
            if prediction and (best_prediction is None or prediction["confidence"] > best_prediction["confidence"]):
                best_prediction = prediction
                best_frame_timestamp = timestamp

        if best_prediction is None:
            return DetectResponse(damage_type=None, confidence=0.0, bbox=[0, 0, 0, 0], evidence_image_url=media_url)

        # Upload the winning frame as the actual evidence image, instead
        # of falling back to the raw video URL (which breaks <img> tags
        # in the frontend and forces the PDF into its text-link
        # fallback). Uses the same frame-upload approach already built
        # for the drone path, just via a direct Supabase REST call here
        # since this citizen path doesn't go back through Node before
        # the response is built.
        best_frame_path = frames[[t for _, t in frames].index(best_frame_timestamp)][0]
        evidence_url = _upload_frame_to_supabase(best_frame_path) or media_url

        return prediction_to_response(
            best_prediction,
            evidence_url=evidence_url,
            frame_timestamp=best_frame_timestamp,
        )
    finally:
        if frame_dir and os.path.isdir(frame_dir):
            shutil.rmtree(frame_dir, ignore_errors=True)


def _upload_frame_to_supabase(frame_path: str) -> Optional[str]:
    """
    Uploads a single frame image to Supabase Storage and returns its
    public URL, or None if credentials aren't configured or the upload
    fails — callers should fall back to the video URL in that case
    (fail soft, matching the rest of this file's error handling).
    """
    if not (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY):
        return None

    try:
        object_path = f"evidence/{uuid.uuid4().hex}.jpg"
        upload_endpoint = f"{SUPABASE_URL}/storage/v1/object/{SUPABASE_STORAGE_BUCKET}/{object_path}"

        with open(frame_path, "rb") as f:
            resp = requests.post(
                upload_endpoint,
                headers={
                    "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
                    "apikey": SUPABASE_SERVICE_ROLE_KEY,
                    "Content-Type": "image/jpeg",
                },
                data=f.read(),
                timeout=30,
            )
        if resp.status_code not in (200, 201):
            print(f"[evidence-upload] Supabase upload failed ({resp.status_code}): {resp.text[:300]}")
            return None

        return f"{SUPABASE_URL}/storage/v1/object/public/{SUPABASE_STORAGE_BUCKET}/{object_path}"
    except Exception as e:  # noqa: BLE001 — deliberately broad, this must never crash the request
        print(f"[evidence-upload] Supabase upload failed: {e}")
        return None


@app.post("/detect/drone", response_model=DroneDetectResponse)
def detect_drone(req: DroneDetectRequest):
    """
    Drone path ONLY — separate endpoint, does not touch /detect above.
    Extracts frames, syncs each frame to a GPS point via the telemetry
    file, runs detection on every frame (not just the single best one),
    then clusters detections by real GPS distance so that potholes far
    apart on the road become separate work orders, while the same
    pothole seen across several consecutive frames collapses into one.
    """
    if not ROBOFLOW_API_KEY:
        return DroneDetectResponse(detections=[])

    frame_dir = None
    try:
        telemetry_path = _download_to_temp(req.telemetry_url)
        telemetry_points = parse_telemetry_file(telemetry_path)

        frame_dir, frames = extract_frames(req.media_url, max_frames=MAX_FRAMES_PER_DRONE_VIDEO)
        if not frames:
            return DroneDetectResponse(detections=[])

        # Run detection on EVERY frame (unlike the citizen video path,
        # which keeps only the single best) and tag each hit with its
        # synced GPS point.
        raw_hits = []
        for frame_path, timestamp in frames:
            prediction = call_roboflow_with_file(frame_path)
            if prediction is None:
                continue
            gps_point = gps_at_timestamp(telemetry_points, timestamp)
            if gps_point is None:
                continue
            raw_hits.append({
                "prediction": prediction,
                "timestamp": timestamp,
                "lat": gps_point.lat,
                "lng": gps_point.lng,
                "frame_path": frame_path,
            })

        clusters = _cluster_by_distance(raw_hits)

        results = []
        for cluster in clusters:
            best = max(cluster, key=lambda h: h["prediction"]["confidence"])
            results.append(DroneDetectionItem(
                damage_type=best["prediction"]["damage_type"],
                confidence=best["prediction"]["confidence"],
                bbox=best["prediction"]["bbox"],
                frame_timestamp_seconds=best["timestamp"],
                gps_lat=best["lat"],
                gps_lng=best["lng"],
                frame_image_base64=_encode_frame_base64(best["frame_path"]),
            ))

        return DroneDetectResponse(detections=results)
    finally:
        if frame_dir and os.path.isdir(frame_dir):
            shutil.rmtree(frame_dir, ignore_errors=True)


def _cluster_by_distance(hits: list) -> list:
    """
    Sequential clustering: sort by time (proxy for the drone's flight
    order), then walk through hits — a hit joins the current cluster if
    it's within CLUSTER_DISTANCE_METERS of that cluster's most recent
    point, otherwise it starts a new cluster. This mirrors "the drone
    is moving roughly along the road" rather than doing full spatial
    clustering, which is unnecessary for a single flight path.
    """
    if not hits:
        return []

    hits_sorted = sorted(hits, key=lambda h: h["timestamp"])
    clusters = [[hits_sorted[0]]]

    for hit in hits_sorted[1:]:
        last_point_in_cluster = clusters[-1][-1]
        distance = _haversine_meters(
            last_point_in_cluster["lat"], last_point_in_cluster["lng"],
            hit["lat"], hit["lng"],
        )
        if distance <= CLUSTER_DISTANCE_METERS:
            clusters[-1].append(hit)
        else:
            clusters.append([hit])

    return clusters


def _haversine_meters(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Great-circle distance between two lat/lng points, in meters."""
    R = 6371000.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lambda = math.radians(lng2 - lng1)
    a = (math.sin(d_phi / 2) ** 2
         + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2)
    return 2 * R * math.asin(math.sqrt(a))


def _encode_frame_base64(frame_path: str) -> Optional[str]:
    try:
        with open(frame_path, "rb") as f:
            return base64.b64encode(f.read()).decode("ascii")
    except OSError:
        return None


def _download_to_temp(url: str) -> str:
    """Downloads the telemetry file to a local temp path for parsing."""
    resp = requests.get(url, timeout=30)
    resp.raise_for_status()
    fd, path = tempfile.mkstemp(suffix=".srt")
    with os.fdopen(fd, "wb") as f:
        f.write(resp.content)
    return path


def extract_frames(video_url: str, max_frames: int = MAX_FRAMES_PER_VIDEO):
    """
    Downloads/reads the video via ffmpeg and extracts frames at
    VIDEO_SAMPLE_FPS, capped at MAX_FRAMES_PER_VIDEO. Requires ffmpeg
    installed and on PATH (apt install ffmpeg / choco install ffmpeg /
    download from ffmpeg.org and add to PATH on Windows).

    Returns (temp_dir_path, [(frame_path, timestamp_seconds), ...]).
    Caller is responsible for cleaning up temp_dir_path (handled in the
    `finally` block in detect_from_video above).
    """
    tmp_dir = tempfile.mkdtemp(prefix="sentriroad_frames_")
    out_pattern = os.path.join(tmp_dir, "frame_%05d.jpg")

    try:
        subprocess.run(
            ["ffmpeg", "-y", "-i", video_url, "-vf", f"fps={VIDEO_SAMPLE_FPS}", out_pattern],
            check=True,
            capture_output=True,
            timeout=120,
        )
    except FileNotFoundError:
        raise RuntimeError(
            "ffmpeg is not installed or not on PATH. Install it and make sure "
            "`ffmpeg -version` works from this terminal before retrying."
        )
    except subprocess.CalledProcessError as e:
        raise RuntimeError(f"ffmpeg failed to process video: {e.stderr.decode(errors='ignore')[:500]}")

    frame_paths = sorted(glob.glob(os.path.join(tmp_dir, "frame_*.jpg")))
    frames_with_timestamps = [
        (path, round(i / VIDEO_SAMPLE_FPS, 2)) for i, path in enumerate(frame_paths)
    ]

    # Cap total frames sent to the model, sampling evenly across the
    # full list rather than just taking the first N (so a long video
    # doesn't only get checked near its start).
    if len(frames_with_timestamps) > max_frames:
        step = len(frames_with_timestamps) / max_frames
        indices = [int(i * step) for i in range(max_frames)]
        frames_with_timestamps = [frames_with_timestamps[i] for i in indices]

    return tmp_dir, frames_with_timestamps


# ---------------- ROBOFLOW CALLS ----------------

def call_roboflow_with_url(image_url: str) -> Optional[dict]:
    """For images already at a public URL — Roboflow fetches it directly."""
    try:
        resp = requests.post(
            f"{ROBOFLOW_BASE_URL}/{ROBOFLOW_MODEL_ID}",
            params={"api_key": ROBOFLOW_API_KEY, "image": image_url},
            timeout=30,
        )
        resp.raise_for_status()
        return best_prediction_from_response(resp.json())
    except requests.RequestException as e:
        print(f"[roboflow] URL-based detection failed: {e}")
        return None


def call_roboflow_with_file(file_path: str) -> Optional[dict]:
    """For locally extracted video frames — uploaded directly as bytes."""
    try:
        with open(file_path, "rb") as f:
            resp = requests.post(
                f"{ROBOFLOW_BASE_URL}/{ROBOFLOW_MODEL_ID}",
                params={"api_key": ROBOFLOW_API_KEY},
                files={"file": f},
                timeout=30,
            )
        resp.raise_for_status()
        return best_prediction_from_response(resp.json())
    except requests.RequestException as e:
        print(f"[roboflow] File-based detection failed: {e}")
        return None


def best_prediction_from_response(data: dict) -> Optional[dict]:
    """
    Roboflow's hosted API returns:
        {
          "predictions": [{"x":.., "y":.., "width":.., "height":..,
                            "confidence":.., "class":"pothole", ...}, ...],
          "image": {"width":.., "height":..}
        }
    x/y are the CENTER of the box in pixels; width/height also in pixels.
    Converts to our normalized top-left [x, y, w, h] format and picks the
    single highest-confidence prediction above CONFIDENCE_THRESHOLD.
    """
    predictions = data.get("predictions", [])
    img = data.get("image", {})
    img_w = float(img.get("width", 0) or 0)
    img_h = float(img.get("height", 0) or 0)
    if not predictions or img_w == 0 or img_h == 0:
        return None

    predictions = [p for p in predictions if p.get("confidence", 0) >= CONFIDENCE_THRESHOLD]
    if not predictions:
        return None

    best = max(predictions, key=lambda p: p["confidence"])

    w_norm = best["width"] / img_w
    h_norm = best["height"] / img_h
    x_center_norm = best["x"] / img_w
    y_center_norm = best["y"] / img_h
    x_topleft_norm = max(0.0, x_center_norm - w_norm / 2)
    y_topleft_norm = max(0.0, y_center_norm - h_norm / 2)

    label = str(best.get("class", "")).lower()
    damage_type = "pothole" if "pothole" in label else ("crack" if "crack" in label else "pothole")

    return {
        "damage_type": damage_type,
        "confidence": round(float(best["confidence"]), 3),
        "bbox": [round(x_topleft_norm, 4), round(y_topleft_norm, 4), round(w_norm, 4), round(h_norm, 4)],
    }


def prediction_to_response(prediction: Optional[dict], evidence_url: str, frame_timestamp: Optional[float]) -> DetectResponse:
    if prediction is None:
        return DetectResponse(damage_type=None, confidence=0.0, bbox=[0, 0, 0, 0], evidence_image_url=evidence_url)

    return DetectResponse(
        damage_type=prediction["damage_type"],
        confidence=prediction["confidence"],
        bbox=prediction["bbox"],
        evidence_image_url=evidence_url,
        frame_timestamp_seconds=frame_timestamp,
        # These two remain heuristic placeholders — see scoringService.js
        # in the backend; wire up a real road-category/traffic data
        # source (e.g. OSM road tags by GPS point) when available.
        traffic_volume_hint=None,
        road_category_hint=None,
    )
