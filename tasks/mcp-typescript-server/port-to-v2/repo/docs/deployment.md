# Deployment

Deploy Relay next to the services it forwards to.

Run `relay deploy` from CI after your tests pass. The deploy uploads `relay.toml`, rotates
the forwarder without dropping in-flight events, and prints the new endpoint.

Roll back with `relay deploy --rollback`, which restores the previous configuration. A
deploy that fails health checks rolls back on its own after two minutes.
