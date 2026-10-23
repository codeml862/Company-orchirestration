"""Routes completion requests to configured providers, with fallback.

Providers are tried in configured order. Rate limits and transient errors fall through to
the next provider; permanent errors (bad request) are raised. Clients that do not allow
external processing are only routed to local (non-external) providers.

Configuration (AICO_LLM_PROVIDERS, JSON list), for example:

    [{"name": "ollama", "base_url": "http://localhost:11434/v1", "external": false,
      "models": {"strong": "qwen3:14b", "standard": "qwen3:8b", "fast": "qwen3:4b"}},
     {"name": "groq", "base_url": "https://api.groq.com/openai/v1", "api_key_env": "GROQ_API_KEY",
      "models": {"strong": "openai/gpt-oss-120b", "standard": "openai/gpt-oss-20b"}}]
"""

import json
import logging

from app.config import get_settings
from app.providers.base import (
    CompletionRequest,
    CompletionResult,
    LLMProvider,
    NoProviderAvailable,
    ProviderError,
)
from app.providers.openai_compat import OpenAICompatibleProvider

log = logging.getLogger(__name__)


class ModelRouter:
    def __init__(self, providers: list[LLMProvider]):
        self.providers = providers

    @property
    def configured(self) -> bool:
        return bool(self.providers)

    def complete(
        self,
        request: CompletionRequest,
        *,
        tier: str,
        model_override: str | None = None,
        allow_external: bool = True,
    ) -> CompletionResult:
        candidates = [
            p for p in self.providers if (allow_external or not p.external) and p.supports(tier, model_override)
        ]
        if not candidates:
            reason = "no LLM provider is configured" if not self.providers else "no eligible provider"
            if self.providers and not allow_external:
                reason += " (this client only allows local providers)"
            raise NoProviderAvailable(reason)
        errors = []
        for provider in candidates:
            try:
                return provider.complete(request, tier=tier, model_override=model_override)
            except ProviderError as exc:
                errors.append(str(exc))
                if not exc.retryable:
                    raise
                log.warning("provider %s failed, trying next: %s", provider.name, exc)
        raise NoProviderAvailable("all providers failed: " + "; ".join(errors))


def build_router_from_settings() -> ModelRouter:
    raw = get_settings().llm_providers.strip() or "[]"
    configs = json.loads(raw)
    providers: list[LLMProvider] = [OpenAICompatibleProvider(**cfg) for cfg in configs]
    return ModelRouter(providers)
