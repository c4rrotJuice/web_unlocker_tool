# payments.py
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
import httpx
import os

router = APIRouter()

PADDLE_API_KEY = os.getenv("PADDLE_API")

@router.get("/get_paddle_token")
async def get_paddle_token():
    url = "https://sandbox-api.paddle.com/client-tokens"
    headers = {
        "Authorization": f"Bearer {PADDLE_API_KEY}",
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient() as client:
        res = await client.post(url, headers=headers, json={})

    if res.status_code != 200:
        raise HTTPException(status_code=res.status_code, detail=res.text)

    data = res.json()
    token = data.get("data", {}).get("token")
    if not token:
        raise HTTPException(status_code=500, detail="Token not found in Paddle response")

    return JSONResponse(content={"token": token})
