from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    acme_webhook_secret: str
