from fastapi import APIRouter, HTTPException
import httpx

router = APIRouter(prefix="/api", tags=["posts"])


@router.get("/posts")
async def get_posts(limit: int = 10):
    """Fetch posts from JSONPlaceholder and return to frontend."""
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"https://jsonplaceholder.typicode.com/posts?_limit={limit}",
                timeout=10.0,
            )
            response.raise_for_status()
            return {"success": True, "data": response.json()}
    except httpx.RequestError as e:
        raise HTTPException(status_code=500, detail=f"Error fetching posts: {str(e)}")
