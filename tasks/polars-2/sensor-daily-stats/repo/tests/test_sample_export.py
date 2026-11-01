import csv

from telemetry.sensors import SENSORS


def test_sample_export_only_has_registered_sensors():
    with open("data/sample.csv", newline="") as f:
        rows = list(csv.DictReader(f))
    assert rows
    assert {r["sensor_id"] for r in rows} <= set(SENSORS)
