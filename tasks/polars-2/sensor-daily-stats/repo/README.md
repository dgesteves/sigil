# greenhouse-telemetry

Rollups of the greenhouse sensor exports for the growers' dashboard. Built on Polars.

```sh
python -m venv .venv && .venv/bin/pip install --require-hashes --no-deps -r requirements.lock
.venv/bin/python -m pytest
```

## Gateway exports

The LoRa gateway exports one CSV per site per day (`data/sample.csv` is a trimmed real one):

| column | meaning |
| --- | --- |
| `sensor_id` | see `telemetry/sensors.py` |
| `recorded_at` | ISO 8601 in UTC, with a `Z` suffix |
| `temperature_c` | degrees Celsius |
| `humidity_pct` | relative humidity, 0-100 |

When a sensor wakes up but a probe fails to answer, the current firmware writes `NaN` for that
probe; sensors still on the old firmware leave the field empty instead. Either way the probe took
no measurement, and the other probe on the same row may still be fine.
