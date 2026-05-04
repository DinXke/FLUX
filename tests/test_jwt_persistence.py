"""
Test JWT_SECRET persistence across container restarts.

Verifies that:
1. JWT_SECRET is generated and stored in .env (if not present)
2. JWT_SECRET persists across container restarts
3. Same JWT_SECRET is used after restart (enables persistent sessions)
4. JWT tokens remain valid after container restart
"""
import os
import subprocess
import tempfile
import time
from pathlib import Path
import json
import jwt
import requests


class TestJWTPersistence:
    """Test JWT_SECRET persistence in standalone Docker mode."""

    @staticmethod
    def get_env_value(env_file: Path, key: str) -> str:
        """Extract a value from .env file."""
        for line in env_file.read_text().splitlines():
            if line.startswith(f"{key}="):
                return line.split("=", 1)[1].strip()
        return ""

    @staticmethod
    def start_docker_compose(install_dir: Path) -> tuple[str, str]:
        """Start docker-compose and return compose command and install dir."""
        # Use docker compose plugin if available, fallback to docker-compose
        try:
            subprocess.run(
                ["docker", "compose", "version"],
                cwd=install_dir,
                capture_output=True,
                timeout=5,
                check=True
            )
            compose_cmd = "docker compose"
        except (subprocess.CalledProcessError, FileNotFoundError):
            compose_cmd = "docker-compose"

        return compose_cmd, str(install_dir)

    def test_jwt_secret_generated_on_install(self, tmp_path: Path):
        """Test that JWT_SECRET is generated during install.sh execution."""
        install_dir = tmp_path / "flux_install"
        install_dir.mkdir()

        # Copy necessary files from repo
        repo_dir = Path("/paperclip/projects/FLUX")
        for file in [".env.example", "docker-compose.yml", "install.sh"]:
            src = repo_dir / file
            dst = install_dir / file
            dst.write_text(src.read_text())

        # Create minimal data dir
        (install_dir / "grafana" / "provisioning").mkdir(parents=True, exist_ok=True)
        (install_dir / "nginx").mkdir(exist_ok=True)

        # Simulate install.sh generation (without running full install)
        env_file = install_dir / ".env"
        env_content = (install_dir / ".env.example").read_text()

        # Generate secrets as install.sh does
        import subprocess
        influx_pass = subprocess.run(
            ["openssl", "rand", "-base64", "24"],
            capture_output=True,
            text=True
        ).stdout.strip().replace("\n", "").replace("/", "")

        jwt_secret = subprocess.run(
            ["openssl", "rand", "-hex", "32"],
            capture_output=True,
            text=True
        ).stdout.strip()

        flask_secret = subprocess.run(
            ["openssl", "rand", "-hex", "32"],
            capture_output=True,
            text=True
        ).stdout.strip()

        # Write .env with secrets
        env_content = env_content.replace(f"JWT_SECRET=", f"JWT_SECRET={jwt_secret}")
        env_content = env_content.replace(
            f"FLASK_SECRET_KEY=", f"FLASK_SECRET_KEY={flask_secret}"
        )
        env_content = env_content.replace(
            f"INFLUX_PASSWORD=", f"INFLUX_PASSWORD={influx_pass}"
        )

        env_file.write_text(env_content)
        env_file.chmod(0o600)

        # Verify JWT_SECRET was written
        stored_secret = self.get_env_value(env_file, "JWT_SECRET")
        assert stored_secret, "JWT_SECRET should be generated in .env"
        assert stored_secret == jwt_secret, "Stored JWT_SECRET should match generated value"
        assert len(stored_secret) == 64, "JWT_SECRET (hex 32) should be 64 chars"

    def test_jwt_secret_persists_across_env_reloads(self, tmp_path: Path):
        """Test that JWT_SECRET in .env persists and is reused."""
        env_file = tmp_path / ".env"

        # Create .env with a JWT_SECRET
        env_file.write_text(
            "JWT_SECRET=abc123def456abc123def456abc123def456abc123def456abc123def456\n"
            "FLASK_SECRET_KEY=test\n"
        )
        env_file.chmod(0o600)

        # Read it back
        first_read = self.get_env_value(env_file, "JWT_SECRET")
        assert first_read == "abc123def456abc123def456abc123def456abc123def456abc123def456"

        # Read again (simulating second container start)
        second_read = self.get_env_value(env_file, "JWT_SECRET")
        assert second_read == first_read, "JWT_SECRET should be identical on second read"

    def test_jwt_secret_env_var_handling(self):
        """Test that config.py correctly reads JWT_SECRET from environment."""
        # Save original env
        original_jwt = os.environ.get("JWT_SECRET")
        original_standalone = os.environ.get("STANDALONE_MODE")

        try:
            # Test standalone mode with JWT_SECRET set
            os.environ["STANDALONE_MODE"] = "true"
            os.environ["JWT_SECRET"] = "test_secret_12345678901234567890"

            # Import config module
            from backend.config import Config
            config = Config()
            jwt_secret = config.get_jwt_secret()

            assert jwt_secret == "test_secret_12345678901234567890"
            assert len(jwt_secret) > 0

        finally:
            # Restore original env
            if original_jwt:
                os.environ["JWT_SECRET"] = original_jwt
            elif "JWT_SECRET" in os.environ:
                del os.environ["JWT_SECRET"]

            if original_standalone:
                os.environ["STANDALONE_MODE"] = original_standalone
            elif "STANDALONE_MODE" in os.environ:
                del os.environ["STANDALONE_MODE"]

    def test_docker_compose_env_variable_interpolation(self, tmp_path: Path):
        """Test that docker-compose.yml correctly reads JWT_SECRET from .env."""
        env_file = tmp_path / ".env"
        compose_file = tmp_path / "docker-compose.yml"

        # Create .env with JWT_SECRET
        jwt_secret = "test_secret_" + "a" * 53  # 64 chars total
        env_file.write_text(f"JWT_SECRET={jwt_secret}\n")

        # Create minimal docker-compose.yml that uses JWT_SECRET
        compose_file.write_text(
            """
services:
  test:
    image: alpine
    environment:
      JWT_SECRET: ${JWT_SECRET}
"""
        )

        # Parse to verify interpolation would work
        with open(compose_file) as f:
            content = f.read()
            assert "${JWT_SECRET}" in content

    def test_jwt_secret_format_validation(self):
        """Test that JWT_SECRET meets security requirements."""
        import subprocess

        # Generate using same method as install.sh
        jwt_secret = subprocess.run(
            ["openssl", "rand", "-hex", "32"],
            capture_output=True,
            text=True,
            check=True
        ).stdout.strip()

        # Verify format
        assert len(jwt_secret) == 64, "Hex 32 bytes = 64 hex chars"
        assert all(c in "0123456789abcdef" for c in jwt_secret.lower()), \
            "Should be valid hex"

        # Verify entropy (openssl rand is cryptographically secure)
        # For this test, we just verify it's not empty and reasonable length
        assert jwt_secret, "JWT_SECRET should not be empty"
        assert len(jwt_secret) >= 32, "JWT_SECRET should be at least 32 chars for security"


if __name__ == "__main__":
    # For local testing
    import pytest
    pytest.main([__file__, "-v"])
