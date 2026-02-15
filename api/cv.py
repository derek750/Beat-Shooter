"""
Colour tracking API: accepts video frames (base64 JPEG), runs OpenCV colour tracking,
returns center, bbox, error from screen center, and projected point based on rotation.
Used by GameScreen for blue object tracking and direction calculation.
"""
import base64
import io
import math
from typing import Any

import cv2 as cv
import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/cv", tags=["cv"])

# --- Config (track blue only) ---
ACTIVE_COLORS = ["blue"]  # track only blue
COLOR_RANGES: dict[str, list[tuple[tuple[int, int, int], tuple[int, int, int]]]] = {
    "green": [
        ((35, 80, 80), (85, 255, 255)),
        ((25, 52, 72), (102, 255, 255)),
    ],
    "blue": [
        ((100, 80, 80), (130, 255, 255)),
        ((90, 50, 50), (130, 255, 255)),
    ],
    "orange": [
        ((10, 100, 100), (25, 255, 255)),
    ],
}
MIN_AREA = 500
DEADBAND_PX = 10
CENTER_SMOOTH_ALPHA = 0.3
ERROR_SMOOTH_ALPHA = 0.2
MASK_KERNEL = (5, 5)
OPEN_ITERS = 1
CLOSE_ITERS = 2
PROJECTION_Z = 100.0  # constant distance (in arbitrary units) for calculating projection


class ColourTracker:
    def __init__(
        self,
        active_colors: list[str] | None = None,
        color_ranges: dict[str, list[tuple[tuple[int, int, int], tuple[int, int, int]]]] | None = None,
    ):
        self.active_colors = active_colors or ACTIVE_COLORS
        self.color_ranges = color_ranges or COLOR_RANGES
        self.min_area = MIN_AREA
        self.deadband_px = DEADBAND_PX
        self.alpha = CENTER_SMOOTH_ALPHA
        self.error_alpha = ERROR_SMOOTH_ALPHA
        self._smoothed_center: tuple[float, float] | None = None
        self._smoothed_error: tuple[float, float] | None = None
        self.kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, MASK_KERNEL)

    def _build_mask(self, hsv: np.ndarray) -> np.ndarray:
        mask = np.zeros(hsv.shape[:2], dtype=np.uint8)
        for color_name in self.active_colors:
            for lower, upper in self.color_ranges.get(color_name, []):
                mask = cv.bitwise_or(mask, cv.inRange(hsv, np.array(lower), np.array(upper)))
        return mask

    def _smooth_center(self, cx: int, cy: int) -> tuple[int, int]:
        if self._smoothed_center is None:
            self._smoothed_center = (float(cx), float(cy))
        else:
            sx, sy = self._smoothed_center
            sx = (1 - self.alpha) * sx + self.alpha * cx
            sy = (1 - self.alpha) * sy + self.alpha * cy
            self._smoothed_center = (sx, sy)
        return int(self._smoothed_center[0]), int(self._smoothed_center[1])

    def _smooth_error(self, ex: int, ey: int) -> tuple[int, int]:
        if self._smoothed_error is None:
            self._smoothed_error = (float(ex), float(ey))
        else:
            sx, sy = self._smoothed_error
            sx = (1 - self.error_alpha) * sx + self.error_alpha * ex
            sy = (1 - self.error_alpha) * sy + self.error_alpha * ey
            self._smoothed_error = (sx, sy)
        return int(self._smoothed_error[0]), int(self._smoothed_error[1])

    def process(self, frame_bgr: np.ndarray) -> dict[str, Any]:
        H, W = frame_bgr.shape[:2]
        frame_bgr = cv.GaussianBlur(frame_bgr, (5, 5), 0)
        hsv = cv.cvtColor(frame_bgr, cv.COLOR_BGR2HSV)
        mask = self._build_mask(hsv)
        mask = cv.morphologyEx(mask, cv.MORPH_OPEN, self.kernel, iterations=OPEN_ITERS)
        mask = cv.morphologyEx(mask, cv.MORPH_CLOSE, self.kernel, iterations=CLOSE_ITERS)
        contours, _ = cv.findContours(mask, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)

        result: dict[str, Any] = {
            "found": False,
            "bbox": None,
            "center": None,
            "raw_center": None,
            "error": None,
            "area": 0,
            "rotation_angle": None,
            "projected_point": None,
        }

        if not contours:
            self._smoothed_center = None
            self._smoothed_error = None
            return result

        c = max(contours, key=cv.contourArea)
        area = cv.contourArea(c)
        if area < self.min_area:
            self._smoothed_center = None
            self._smoothed_error = None
            return result

        x, y, w, h = cv.boundingRect(c)
        raw_cx = x + w // 2
        raw_cy = y + h // 2
        cx, cy = self._smooth_center(raw_cx, raw_cy)
        error_x = cx - (W // 2)
        error_y = cy - (H // 2)
        error_x, error_y = self._smooth_error(error_x, error_y)
        if abs(error_x) < self.deadband_px:
            error_x = 0
        if abs(error_y) < self.deadband_px:
            error_y = 0

        # Get rotation angle from minAreaRect
        rect = cv.minAreaRect(c)
        angle = rect[2]  # rotation angle in degrees (-90 to 0)
        
        # Convert angle to radians and calculate projected point
        # Angle increases counter-clockwise from the horizontal
        angle_rad = math.radians(angle)
        
        # Project point at distance Z in the direction of the angle
        projected_x = cx + PROJECTION_Z * math.cos(angle_rad)
        projected_y = cy + PROJECTION_Z * math.sin(angle_rad)
        
        # Invert x coordinate to match the video mirror
        projected_x_inverted = W - projected_x

        result.update({
            "found": True,
            "bbox": (int(x), int(y), int(w), int(h)),
            "center": (int(cx), int(cy)),
            "raw_center": (int(raw_cx), int(raw_cy)),
            "error": (int(error_x), int(error_y)),
            "area": int(area),
            "rotation_angle": float(angle),
            "projected_point": (int(projected_x_inverted), int(projected_y)),
        })
        return result


# One shared tracker so smoothing works across frames
_tracker: ColourTracker | None = None


def _get_tracker() -> ColourTracker:
    global _tracker
    if _tracker is None:
        _tracker = ColourTracker()
    return _tracker


class TrackBody(BaseModel):
    """Base64-encoded image (JPEG). Prefix 'data:image/jpeg;base64,' is optional."""
    image: str


@router.post("/track")
def track(body: TrackBody) -> dict[str, Any]:
    """
    Run colour tracking on a single frame. Send base64 JPEG (e.g. from canvas.toDataURL).
    Returns center (x,y), bbox (x,y,w,h), error from screen center, rotation angle, and projected point.
    """
    raw = body.image.strip()
    if raw.startswith("data:"):
        raw = raw.split(",", 1)[-1]
    try:
        buf = base64.b64decode(raw, validate=True)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid base64 image: {e}") from e
    arr = np.frombuffer(buf, dtype=np.uint8)
    frame = cv.imdecode(arr, cv.IMREAD_COLOR)
    if frame is None:
        raise HTTPException(status_code=400, detail="Could not decode image as JPEG")
    tracker = _get_tracker()
    return tracker.process(frame)