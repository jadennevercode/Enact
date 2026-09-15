"""API error type shared by every route."""

from __future__ import annotations


class ApiError(Exception):
    """An error that maps to one JSON response: {"error": code, "message": text}."""

    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


def not_built() -> ApiError:
    return ApiError(404, "not_built", "this project has no built graph yet")
