"""
Authentication & authorization module for FLUX.

Handles:
- JWT token creation and verification
- Password hashing and verification using bcrypt
- Role-based access control decorators (@require_auth, @require_admin)
- User database management (/data/users.json)
- Admin user initialization from environment variables
"""
import json
import logging
import os
import uuid
from datetime import datetime, timedelta
from functools import wraps
from typing import Any, Callable, Optional

import bcrypt
import jwt
from flask import request, jsonify, g

log = logging.getLogger("flux_auth")


class AuthManager:
    """Manages JWT tokens, password hashing, and user database."""

    def __init__(self, secret_key: str, expiry_hours: int = 24, data_dir: str = "/data"):
        self.secret_key = secret_key
        self.expiry_hours = expiry_hours
        self.data_dir = data_dir
        self.users_file = os.path.join(data_dir, "users.json")

    def hash_password(self, password: str) -> str:
        """Hash password using bcrypt."""
        salt = bcrypt.gensalt(rounds=12)
        return bcrypt.hashpw(password.encode("utf-8"), salt).decode("utf-8")

    def verify_password(self, password: str, hashed: str) -> bool:
        """Verify password against bcrypt hash."""
        try:
            return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))
        except Exception as e:
            log.error(f"Password verification error: {e}")
            return False

    def create_token(self, user_id: str, email: str, role: str) -> str:
        """Create JWT token with expiry."""
        now = datetime.utcnow()
        exp = now + timedelta(hours=self.expiry_hours)

        payload = {
            "user_id": user_id,
            "email": email,
            "role": role,
            "exp": int(exp.timestamp()),
            "iat": int(now.timestamp()),
        }

        token = jwt.encode(payload, self.secret_key, algorithm="HS256")
        return token

    def decode_token(self, token: str) -> Optional[dict]:
        """Decode JWT token. Returns payload if valid, None if expired/invalid."""
        try:
            payload = jwt.decode(token, self.secret_key, algorithms=["HS256"])
            return payload
        except jwt.ExpiredSignatureError:
            log.debug("Token expired")
            return None
        except jwt.InvalidTokenError as e:
            log.debug(f"Invalid token: {e}")
            return None

    def load_users(self) -> dict:
        """Load users from /data/users.json."""
        try:
            if os.path.exists(self.users_file):
                with open(self.users_file, "r", encoding="utf-8") as f:
                    return json.load(f)
        except Exception as e:
            log.error(f"Failed to load users.json: {e}")
        return {}

    def save_users(self, users: dict) -> bool:
        """Save users to /data/users.json."""
        try:
            os.makedirs(self.data_dir, exist_ok=True)
            with open(self.users_file, "w", encoding="utf-8") as f:
                json.dump(users, f, indent=2)
            return True
        except Exception as e:
            log.error(f"Failed to save users.json: {e}")
            return False

    def get_user(self, user_id: str) -> Optional[dict]:
        """Get user by ID."""
        users = self.load_users()
        return users.get(user_id)

    def get_user_by_email(self, email: str) -> Optional[dict]:
        """Get user by email."""
        users = self.load_users()
        for user_id, user in users.items():
            if user.get("email") == email:
                return {**user, "id": user_id}
        return None

    def create_user(self, email: str, password: str, role: str = "readonly") -> Optional[dict]:
        """Create new user. Returns user dict or None if email exists."""
        if self.get_user_by_email(email):
            return None

        user_id = str(uuid.uuid4())
        hashed = self.hash_password(password)

        users = self.load_users()
        users[user_id] = {
            "id": user_id,
            "email": email,
            "password_hash": hashed,
            "role": role,
            "created_at": datetime.utcnow().isoformat(),
        }

        if self.save_users(users):
            return users[user_id]
        return None

    def update_user(self, user_id: str, **kwargs) -> bool:
        """Update user fields (password, role, etc)."""
        users = self.load_users()
        if user_id not in users:
            return False

        if "password" in kwargs:
            kwargs["password_hash"] = self.hash_password(kwargs.pop("password"))

        users[user_id].update(kwargs)
        return self.save_users(users)

    def delete_user(self, user_id: str) -> bool:
        """Delete user by ID."""
        users = self.load_users()
        if user_id in users:
            del users[user_id]
            return self.save_users(users)
        return False

    def ensure_admin_exists(self) -> bool:
        """Initialize admin user from env vars if users.json doesn't exist."""
        if os.path.exists(self.users_file):
            return True  # Already initialized

        admin_email = os.environ.get("FLUX_ADMIN_USER", "")
        admin_password = os.environ.get("FLUX_ADMIN_PASSWORD", "")

        if not admin_email or not admin_password:
            log.warning(
                "FLUX_ADMIN_USER or FLUX_ADMIN_PASSWORD not set. "
                "Set both to auto-create admin user on first startup."
            )
            return False

        admin_user = self.create_user(admin_email, admin_password, role="admin")
        if admin_user:
            log.info(f"Created admin user: {admin_email}")
            return True

        log.error(f"Failed to create admin user: {admin_email}")
        return False


# Global instance (initialized by Flask app)
_auth_manager: Optional[AuthManager] = None


def init_auth(app: Any, secret_key: str, expiry_hours: int = 24, data_dir: str = "/data") -> AuthManager:
    """Initialize authentication manager for the Flask app."""
    global _auth_manager
    _auth_manager = AuthManager(secret_key, expiry_hours, data_dir)

    # Initialize admin on first run
    _auth_manager.ensure_admin_exists()

    log.info(f"Auth initialized: secret_key set, expiry={expiry_hours}h, data_dir={data_dir}")
    return _auth_manager


def get_auth_manager() -> AuthManager:
    """Get the global auth manager instance."""
    if _auth_manager is None:
        raise RuntimeError("Auth manager not initialized. Call init_auth() first.")
    return _auth_manager


def _auth_enabled() -> bool:
    """Auth is only enforced when AUTH_ENABLED=true is explicitly set."""
    return os.environ.get("AUTH_ENABLED", "false").lower() == "true"


def require_auth(f: Callable) -> Callable:
    """Decorator: require valid JWT token in Authorization header.
    Bypassed when AUTH_ENABLED != 'true' (default until frontend auth UI is ready).
    """
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not _auth_enabled():
            return f(*args, **kwargs)

        auth_header = request.headers.get("Authorization", "")

        if not auth_header.startswith("Bearer "):
            return jsonify({"error": "Missing or invalid authorization header"}), 401

        token = auth_header[7:]  # Remove "Bearer " prefix
        manager = get_auth_manager()
        payload = manager.decode_token(token)

        if not payload:
            return jsonify({"error": "Invalid or expired token"}), 401

        g.current_user = payload
        return f(*args, **kwargs)

    return decorated_function


def require_admin(f: Callable) -> Callable:
    """Decorator: require valid JWT token AND admin role.
    Bypassed when AUTH_ENABLED != 'true' (default until frontend auth UI is ready).
    """
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not _auth_enabled():
            return f(*args, **kwargs)

        auth_header = request.headers.get("Authorization", "")

        if not auth_header.startswith("Bearer "):
            return jsonify({"error": "Missing or invalid authorization header"}), 401

        token = auth_header[7:]
        manager = get_auth_manager()
        payload = manager.decode_token(token)

        if not payload:
            return jsonify({"error": "Invalid or expired token"}), 401

        if payload.get("role") != "admin":
            return jsonify({"error": "Admin access required"}), 403

        g.current_user = payload
        return f(*args, **kwargs)

    return decorated_function


def get_current_user() -> Optional[dict]:
    """Get current authenticated user from request context."""
    return getattr(g, "current_user", None)
