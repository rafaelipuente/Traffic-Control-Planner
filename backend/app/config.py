"""Application configuration from environment variables."""
from functools import lru_cache
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings loaded from environment."""
    
    # Database
    database_url: str = "postgresql://tcp_user:tcp_password@localhost:5432/tcp_db"
    
    # JWT
    jwt_secret_key: str = "CHANGE-ME-IN-PRODUCTION-min-32-chars"
    jwt_algorithm: str = "HS256"
    jwt_access_token_expire_minutes: int = 30
    jwt_refresh_token_expire_days: int = 7
    
    # Anthropic
    anthropic_api_key: str = ""
    
    # CORS
    cors_origins: str = "http://localhost:3333,http://localhost:3000"
    
    # Environment
    environment: str = "development"
    
    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",")]
    
    @property
    def is_development(self) -> bool:
        return self.environment == "development"
    
    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


@lru_cache
def get_settings() -> Settings:
    return Settings()
