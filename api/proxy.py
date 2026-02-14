from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException
import httpx

router = APIRouter(prefix="/api", tags=["proxy"])


@router.post("/proxy")
async def proxy_request(
    url: str,
    method: str = "GET",
    headers: Optional[Dict[str, str]] = None,
    params: Optional[Dict[str, Any]] = None,
    json_body: Optional[Dict[str, Any]] = None,
):
    """Generic proxy for any external API call."""
    try:
        async with httpx.AsyncClient() as client:
            response = await client.request(
                method=method.upper(),
                url=url,
                headers=headers,
                params=params,
                json=json_body,
                timeout=10.0,
            )
            response.raise_for_status()
            return {"success": True, "data": response.json()}
    except httpx.RequestError as e:
        raise HTTPException(status_code=500, detail=f"Error making request: {str(e)}")
