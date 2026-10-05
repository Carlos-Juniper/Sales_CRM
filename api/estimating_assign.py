"""Estimate assignment endpoint (Handoff 54 §6).

Extracted from api/estimating.py to keep that module under the 3520-line cap.
Registered via estimating_assign.register(app, require_auth).
"""
from __future__ import annotations

import uuid

from fastapi import Depends, HTTPException

from db import execute, query, transaction
from api import authz


def register(app, require_auth) -> None:
    @app.post("/api/estimating/estimates/{estimate_id}/assign", status_code=204)
    async def assign_estimate(
        estimate_id: str, body: dict, _user: dict = Depends(require_auth)
    ):
        """Assign LS/IRR estimator slots. Managers only; branch-scoped.

        Both the UPDATE on estimates and the INSERT into estimate_assignments are
        wrapped in a single transaction so a partial write (UPDATE succeeds,
        INSERT fails) cannot leave the audit log out of sync with the row.
        """
        if not authz.is_estimating_manager(_user.get("role")):
            raise HTTPException(status_code=403, detail="Only estimating managers may assign")
        rows = await query(
            "SELECT id, aspire_branch_id, assigned_ls_estimator, assigned_irr_estimator"
            " FROM estimates WHERE id = %s",
            [estimate_id],
        )
        if not rows:
            raise HTTPException(status_code=404, detail="Estimate not found")
        est = rows[0]
        scope = await authz.resolve_branch_scope(_user)
        if scope.kind == "branch" and est.get("aspire_branch_id") not in scope.ids:
            raise HTTPException(status_code=403, detail="Estimate is outside your branch scope")
        note = body.get("note")
        slots = [
            ("lsEstimatorId", "assigned_ls_estimator", "ls"),
            ("irrEstimatorId", "assigned_irr_estimator", "irr"),
        ]
        async with transaction():
            for body_key, col, role in slots:
                new_val = body.get(body_key)
                if new_val is None:
                    continue
                old_val = est.get(col)
                if new_val == old_val:
                    continue
                await execute(
                    f"UPDATE estimates SET {col} = %s WHERE id = %s",
                    [new_val, estimate_id],
                )
                await execute(
                    "INSERT INTO estimate_assignments"
                    " (id, estimate_id, from_user_id, to_user_id, role, assigned_by, note)"
                    " VALUES (%s, %s, %s, %s, %s, %s, %s)",
                    [str(uuid.uuid4()), estimate_id, old_val, new_val, role, _user["id"], note],
                )
