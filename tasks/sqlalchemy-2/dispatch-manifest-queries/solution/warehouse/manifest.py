"""Dispatch manifest: what leaves a warehouse on a given day, parcel by parcel.

The floor app prints this every morning and the carrier integration posts it to each carrier.
"""

import datetime as dt

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload, selectinload

from warehouse.models import Parcel, ParcelItem, Shipment, Warehouse


def dispatch_manifest(session: Session, warehouse_code: str, day: dt.date) -> list[dict]:
    warehouse = session.scalars(select(Warehouse).where(Warehouse.code == warehouse_code)).one()
    # Four SELECTs in total, whatever the size of the day: the warehouse, shipments joined to their
    # carrier, all parcels of those shipments, and all items of those parcels joined to their product.
    # Many-to-ones ride along as joins; collections are loaded with one IN query per level, so the
    # shipment rows are not multiplied by parcels and items.
    shipments = session.scalars(
        select(Shipment)
        .where(Shipment.warehouse_id == warehouse.id, Shipment.dispatch_date == day)
        .order_by(Shipment.reference)
        .options(
            joinedload(Shipment.carrier),
            selectinload(Shipment.parcels)
            .selectinload(Parcel.items)
            .joinedload(ParcelItem.product),
        )
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
