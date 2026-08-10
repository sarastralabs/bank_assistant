"""Admin login routes (separate from the lobby agent)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field

from api import admin_auth

router = APIRouter(tags=["admin"])


class LoginBody(BaseModel):
    username: str = Field(..., min_length=1)
    password: str = Field(..., min_length=1)


@router.post("/admin/login")
def admin_login(body: LoginBody) -> dict:
    try:
        return admin_auth.login(body.username.strip(), body.password)
    except PermissionError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc


@router.get("/admin/me")
def admin_me(admin: dict = Depends(admin_auth.require_admin)) -> dict:
    return {**admin, "demo_mode": True}


@router.post("/admin/logout")
def admin_logout(authorization: str | None = Header(default=None)) -> dict:
    admin_auth.logout(authorization)
    return {"ok": True}
