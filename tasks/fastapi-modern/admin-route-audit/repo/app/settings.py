from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    admin_token: str
    environment: str = "production"
