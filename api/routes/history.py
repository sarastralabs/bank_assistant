"""Query history HTTP routes."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from api import history as history_store

router = APIRouter(prefix="/history", tags=["history"])


@router.get("")
def list_items(limit: int = 50) -> dict:
    items = history_store.list_history(limit=min(max(limit, 1), 200))
    return {"items": items, "count": len(items)}


@router.get("/{item_id}")
def get_item(item_id: int) -> dict:
    item = history_store.get_history_item(item_id, include_audio=True)
    if item is None:
        raise HTTPException(status_code=404, detail="History item not found")
    return item


@router.delete("/{item_id}")
def delete_item(item_id: int) -> dict:
    if not history_store.delete_history_item(item_id):
        raise HTTPException(status_code=404, detail="History item not found")
    return {"ok": True, "id": item_id}


@router.delete("")
def clear_all() -> dict:
    deleted = history_store.clear_history()
    return {"ok": True, "deleted": deleted}
