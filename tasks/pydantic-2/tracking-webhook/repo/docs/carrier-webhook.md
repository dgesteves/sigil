# Carrier tracking webhook

The carrier POSTs one JSON object per tracking event:

```json
{
  "trackingNumber": "ns4471209nl",
  "status": "in_transit",
  "occurredAt": "2026-10-31T14:05:12+01:00",
  "location": { "city": "Utrecht", "countryCode": "nl" },
  "estimatedDelivery": "2026-11-02",
  "weightGrams": 1250,
  "carrierRef": "e1f3-77"
}
```

| Key | Rules |
| --- | --- |
| `trackingNumber` | required string; trim surrounding spaces and upper-case it |
| `status` | required; one of `label_created`, `in_transit`, `out_for_delivery`, `delivered`, `exception` |
| `occurredAt` | required ISO 8601 timestamp **with** a UTC offset; reject timestamps without one; we store it in UTC |
| `location` | optional, may be missing or `null`; when present it has `city` (required) and `countryCode` (required, two letters, upper-cased) |
| `estimatedDelivery` | optional date, may be missing or `null` |
| `signedBy` | optional string, usually only on `delivered` events |
| `weightGrams` | optional whole number of grams, at least 1. The carrier sometimes sends it as a string (`"1250"`); accept that, but reject fractional grams |

The carrier adds keys without notice (`carrierRef` above): ignore keys we don't know.

## The tracking_events row

`event_row` maps an event to the columns of `tracking_events`: `tracking_number`, `status`,
`occurred_at` (a UTC `datetime`), `location_city`, `location_country`, `estimated_delivery`,
`signed_by`, `weight_grams`. Missing values are `None`.
