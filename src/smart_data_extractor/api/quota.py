"""DEMO-STAGE daily usage quota guard (D-019).

演示阶段护栏（务必阅读）：本项目当前是免费 demo，这里用进程内存计数器按
「单 IP 每日 + 全站每日」双层限额保护 LLM API 预算。它**只能防君子和脚本
扫描**：X-Forwarded-For 可伪造、重启即清零、无持久化。正式对外宣发前必须
替换为按用户配额 / 持久化限流方案（决策记录见 .harness/decisions.md D-019）。

DEMO-STAGE ONLY: in-memory, per-process counters that reset on every
deploy and trust the client-supplied X-Forwarded-For. Good enough to
stop casual abuse and cap the daily API bill; NOT a real rate-limiting
solution. Replace with per-user quotas before any public promotion.
"""

from collections.abc import Callable
from datetime import date, datetime, timezone

from fastapi import HTTPException, Request

RESET_AT = "00:00 UTC"


class DailyQuota:
    """Two-layer daily counter: per client IP and global, rolled at UTC midnight.

    A layer is disabled when its limit is <= 0. Deliberately not
    thread-safe: single-process uvicorn, and a race can only under-count
    (never over-charge a user), which is acceptable for a demo guard.
    """

    def __init__(
        self,
        per_ip_limit: int,
        global_limit: int,
        clock: Callable[[], date] | None = None,
    ) -> None:
        """Store limits and the (injectable) UTC clock used for rollover.

        Args:
            per_ip_limit: max units per client IP per UTC day (<=0 disables).
            global_limit: max units across all IPs per UTC day (<=0 disables).
            clock: returns "today" as a UTC date; tests inject a fake.
        """
        self.per_ip_limit = per_ip_limit
        self.global_limit = global_limit
        self._clock = clock
        self._day = ""
        self._per_ip: dict[str, int] = {}
        self._per_endpoint: dict[str, int] = {}
        self._global_used = 0

    def _today(self) -> date:
        """Current UTC date, via the injected clock when present."""
        if self._clock is not None:
            return self._clock()
        return datetime.now(timezone.utc).date()

    def _rollover_if_needed(self) -> None:
        """Clear all counters when the UTC date changes."""
        today = self._today().isoformat()
        if today != self._day:
            self._day = today
            self._per_ip.clear()
            self._per_endpoint.clear()
            self._global_used = 0

    @staticmethod
    def client_ip(request: Request) -> str:
        """Best-effort client IP: first X-Forwarded-For entry (set by the
        Render proxy), else the socket peer, else "unknown".

        Spoofable by determined clients — the global layer is the real
        budget cap, this one just stops casual abuse.
        """
        xff = request.headers.get("x-forwarded-for")
        if xff:
            return xff.split(",")[0].strip()
        client = request.client
        return client.host if client else "unknown"

    @staticmethod
    def endpoint(request: Request) -> str:
        """Normalized endpoint label for /stats grouping ("/api/x" -> "x")."""
        path = request.url.path
        return path.removeprefix("/api").lstrip("/") or "unknown"

    def spend(self, request: Request, n: int = 1) -> None:
        """Consume n units for this IP + endpoint, or raise a 429 whose
        detail is a structured, user-friendly payload
        ({"code", "message", "reset_at"}) that the frontend localizes.

        Args:
            request: the incoming request (IP + endpoint source).
            n: units to consume — 1 per request, len(texts) for batches.
        """
        self._rollover_if_needed()
        ip = self.client_ip(request)
        endpoint = self.endpoint(request)
        if self.per_ip_limit > 0 and self._per_ip.get(ip, 0) + n > self.per_ip_limit:
            raise HTTPException(
                status_code=429,
                detail={
                    "code": "quota_per_ip",
                    "message": (
                        f"You have used all {self.per_ip_limit} free requests "
                        f"allowed per visitor today. The quota resets at {RESET_AT}."
                    ),
                    "reset_at": RESET_AT,
                },
            )
        if self.global_limit > 0 and self._global_used + n > self.global_limit:
            raise HTTPException(
                status_code=429,
                detail={
                    "code": "quota_global",
                    "message": (
                        f"This demo has reached its daily limit of "
                        f"{self.global_limit} requests. Please come back after {RESET_AT}."
                    ),
                    "reset_at": RESET_AT,
                },
            )
        self._per_ip[ip] = self._per_ip.get(ip, 0) + n
        self._per_endpoint[endpoint] = self._per_endpoint.get(endpoint, 0) + n
        self._global_used += n

    def snapshot(self) -> dict:
        """Owner-facing usage report served by GET /stats: today's totals,
        unique visitor IPs and per-endpoint demand (demo-stage traffic
        visibility, D-019)."""
        self._rollover_if_needed()
        return {
            "date": self._day,
            "global_used": self._global_used,
            "global_limit": self.global_limit,
            "unique_ips": len(self._per_ip),
            "per_ip_limit": self.per_ip_limit,
            "per_endpoint": dict(sorted(self._per_endpoint.items())),
        }
