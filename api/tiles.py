import math
import random

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(prefix="/tiles", tags=["tiles"])

class GenerateTilesBody(BaseModel):
    width: float  # screen size x
    height: float  # screen size y
    count: int  # how many instances to create
    tile_window: int = 6  # tiles within this many before/after cannot overlap
    radius: float = 0  # minimum distance between tiles in the window (0 = no constraint)

def _distance(x1: float, y1: float, x2: float, y2: float) -> float:
    return math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2)

def _overlaps_within_window(x: float, y: float, x_coords: list[float], y_coords: list[float], idx: int, window: int, radius: float) -> bool:
    start = max(0, idx - window)
    end = min(len(x_coords), idx + window + 1)
    for i in range(start, end):
        if i == idx:
            continue
        if _distance(x, y, x_coords[i], y_coords[i]) < radius:
            return True
    return False

@router.post("/generate")
def generate_tiles(body: GenerateTilesBody):
    """Generate random x and y coordinates within the given screen size.
    Tiles within tile_window positions of each other cannot be within radius distance."""
    width = body.width
    height = body.height
    count = body.count
    window = body.tile_window
    radius = body.radius

    x_coords: list[float] = []
    y_coords: list[float] = []

    max_attempts = 500  # prevent infinite loops if constraints are impossible

    for i in range(count):
        for _ in range(max_attempts):
            x = random.uniform(0, width)
            y = random.uniform(0, height)
            if radius <= 0 or not _overlaps_within_window(x, y, x_coords, y_coords, i, window, radius):
                x_coords.append(x)
                y_coords.append(y)
                break
        else:
            # fallback: add anyway if we couldn't satisfy constraints
            x_coords.append(random.uniform(0, width))
            y_coords.append(random.uniform(0, height))

    return {"x": x_coords, "y": y_coords}
