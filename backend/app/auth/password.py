"""Password hashing using argon2."""
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, InvalidHashError

ph = PasswordHasher(
    time_cost=2,
    memory_cost=65536,
    parallelism=1,
)


def hash_password(password: str) -> str:
    """Hash a password using argon2id."""
    return ph.hash(password)


def verify_password(password: str, hashed: str) -> bool:
    """Verify a password against its hash."""
    try:
        ph.verify(hashed, password)
        return True
    except (VerifyMismatchError, InvalidHashError):
        return False


def needs_rehash(hashed: str) -> bool:
    """Check if a hash needs to be rehashed (e.g., params changed)."""
    return ph.check_needs_rehash(hashed)
