from __future__ import annotations

import secrets
from dataclasses import dataclass

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBasic, HTTPBasicCredentials

from procurement_core.config import get_settings


security = HTTPBasic()


@dataclass
class AuthUser:
    username: str
    role: str


def _parse_users() -> dict[str, tuple[str, str]]:
    parsed: dict[str, tuple[str, str]] = {}
    for chunk in get_settings().auth_users.split(","):
        if not chunk.strip():
            continue
        username, password, role = chunk.strip().split(":")
        parsed[username] = (password, role)
    return parsed


def get_current_user(credentials: HTTPBasicCredentials = Depends(security)) -> AuthUser:
    users = _parse_users()
    if credentials.username not in users:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    expected_password, role = users[credentials.username]
    if not secrets.compare_digest(credentials.password, expected_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    return AuthUser(username=credentials.username, role=role)


def require_roles(*roles: str):
    def _dependency(user: AuthUser = Depends(get_current_user)) -> AuthUser:
        if user.role not in roles:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient role")
        return user

    return _dependency

