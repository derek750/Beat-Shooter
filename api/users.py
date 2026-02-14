from fastapi import APIRouter, HTTPException
import httpx

router = APIRouter(prefix="/api", tags=["users"])


@router.get("/users")
async def get_users():
    """Fetch users from JSONPlaceholder."""
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                "https://jsonplaceholder.typicode.com/users",
                timeout=10.0,
            )
            response.raise_for_status()
            return {"success": True, "data": response.json()}
    except httpx.RequestError as e:
        raise HTTPException(status_code=500, detail=f"Error fetching users: {str(e)}")
