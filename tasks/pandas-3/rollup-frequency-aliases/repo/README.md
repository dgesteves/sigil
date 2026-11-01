# roastery-ops

Rollups behind the weekly ops review notebook: revenue per hour, month, quarter and year, the
launch-week view, stock levels per bean, and euro formatting for the deck. Sample exports are in
`data/`.

The notebook charts the returned Series and DataFrames directly and the review compares each
chart with the previous one, so a change in labels (index values) shows up as a change in the
report.

## Development

```sh
python -m venv .venv
.venv/bin/pip install --require-hashes --no-deps -r requirements.lock
.venv/bin/python -m pytest
```

`requirements.lock` is generated from `pyproject.toml` with
`uv pip compile pyproject.toml --group dev --generate-hashes --universal --python-version 3.14 -o requirements.lock`.
