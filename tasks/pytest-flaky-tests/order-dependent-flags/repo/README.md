# flagship

Feature flags for the storefront. Flags are defined in a JSON file (`FLAGSHIP_FILE`, default
`flags.json`) and can be forced on or off in-process with `flagship.override()` by ops tooling.

```json
{
  "new_checkout": {"enabled": true},
  "search_v2": {"enabled": true, "environments": ["staging"]},
  "one_click": {"enabled": true, "rollout": 25}
}
```

Settings come from the environment and are read once per process (`get_settings()` is cached):

| Variable | Default | Meaning |
| --- | --- | --- |
| `FLAGSHIP_FILE` | `flags.json` | path of the flags file |
| `FLAGSHIP_DEFAULT_ON` | `false` | value of flags that are not in the file |
| `FLAGSHIP_ENV` | `production` | environment name matched against a flag's `environments` |

## Development

Dependencies are pinned in `requirements.lock` (generated with
`uv pip compile pyproject.toml --group dev --generate-hashes --universal --python-version 3.14 -o requirements.lock`).

```sh
python -m venv .venv
.venv/bin/pip install --require-hashes --no-deps -r requirements.lock
.venv/bin/python -m pytest
```

CI runs the suite with pytest-randomly, which shuffles test order and reseeds `random` for every run.
Reproduce a CI order with `-p randomly --randomly-seed=<seed from the CI log>`; run in file order with
`-p no:randomly`.
