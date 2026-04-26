from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any

from pydantic import BaseModel, ConfigDict


class ProcurementBaseModel(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


class TimestampedRead(ProcurementBaseModel):
    id: str
    created_at: datetime
    updated_at: datetime


JsonDict = dict[str, Any]
MoneyLike = Decimal | float | int | None

