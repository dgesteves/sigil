from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class OrderLineIn(BaseModel):
    sku: str = Field(min_length=1, max_length=32)
    quantity: int = Field(gt=0, le=100)


class OrderIn(BaseModel):
    customer: str = Field(min_length=1, max_length=120)
    lines: list[OrderLineIn] = Field(min_length=1, max_length=50)


class OrderLineOut(BaseModel):
    sku: str
    quantity: int


class OrderOut(BaseModel):
    id: int
    customer: str
    status: Literal["placed", "cancelled"]
    created_at: datetime
    lines: list[OrderLineOut]
