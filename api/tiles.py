import random

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(prefix="/tiles", tags=["tiles"])

class GenerateTilesBody(BaseModel):
    width: float  # screen size x
    height: float  # screen size y
    count: int  # how many instances to create

@router.post("/generate")
def generate_tiles(body: GenerateTilesBody):
    """Generate random x and y coordinates within the given screen size."""
    width = body.width
    height = body.height
    count = body.count

    x_coords = [random.uniform(0, width) for _ in range(count)]
    y_coords = [random.uniform(0, height) for _ in range(count)]

    return {"x": x_coords, "y": y_coords}
