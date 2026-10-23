"""Model-provider abstraction. The orchestration engine only talks to this interface."""

from dataclasses import dataclass, field
from typing import Protocol


@dataclass
class CompletionRequest:
    messages: list[dict]  # [{"role": "system"|"user"|"assistant", "content": str}]
    temperature: float = 0.2
    max_tokens: int = 4096
    json_mode: bool = True


@dataclass
class CompletionResult:
    content: str
    provider: str
    model: str
    prompt_tokens: int = 0
    completion_tokens: int = 0
    latency_ms: int = 0
    cost_usd: float = 0.0
    raw: dict = field(default_factory=dict)


class ProviderError(Exception):
    def __init__(self, message: str, *, retryable: bool = False):
        super().__init__(message)
        self.retryable = retryable


class RateLimited(ProviderError):
    def __init__(self, message: str):
        super().__init__(message, retryable=True)


class NoProviderAvailable(Exception):
    """No configured provider can serve the request (none configured, or all failed)."""


class LLMProvider(Protocol):
    name: str
    # True when requests leave our infrastructure (hosted APIs). Clients that have not
    # allowed external processing are only ever routed to non-external (local) providers.
    external: bool

    def supports(self, tier: str, model_override: str | None) -> bool: ...

    def complete(self, request: CompletionRequest, *, tier: str, model_override: str | None) -> CompletionResult: ...
