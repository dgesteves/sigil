"""Dispatch manifest: what leaves a warehouse on a given day, parcel by parcel.

The floor app prints this every morning and the carrier integration posts it to each carrier.
"""

import datetime as dt

from sqlalchemy import select
from sqlalchemy.orm import Session

from warehouse.models import Shipment, Warehouse


def dispatch_manifest(session: Session, warehouse_code: str, day: dt.date) -> list[dict]:
    warehouse = session.scalars(select(Warehouse).where(Warehouse.code == warehouse_code)).one()
    shipments = session.scalars(
        select(Shipment)
        .where(Shipment.warehouse_id == warehouse.id, Shipment.dispatch_date == day)
        .order_by(Shipment.reference)
    ).all()

    manifest = []
    for shipment in shipments:
        parcels = []
        for parcel in sorted(shipment.parcels, key=lambda p: p.label):
            items = [
                {"sku": item.product.sku, "name": item.product.name, "quantity": item.quantity}
                for item in sorted(parcel.items, key=lambda i: i.product.sku)
            ]
            parcels.append(
                {
                    "label": parcel.label,
                    "weight_grams": parcel.weight_grams,
                    "items": items,
                }
            )
        manifest.append(
            {
                "reference": shipment.reference,
                "carrier": shipment.carrier.name,
                "service_level": shipment.carrier.service_level,
                "instructions": shipment.instructions,
                "parcel_count": len(parcels),
                "total_weight_grams": sum(p["weight_grams"] for p in parcels),
                "parcels": parcels,
            }
        )
    return manifest
