"""Provider for any OpenAI-compatible chat completions API.

One implementation covers hosted APIs (OpenAI, Groq, OpenRouter, Gemini's OpenAI endpoint,
Mistral, ...) and local servers (Ollama, vLLM, LM Studio): only base_url, key and model
names differ, and those are configuration.
"""

import os
import time

import httpx

from app.providers.base import CompletionRequest, CompletionResult, ProviderError, RateLimited


class OpenAICompatibleProvider:
    def __init__(
        self,
        *,
        name: str,
        base_url: str,
        models: dict[str, str],
        api_key: str | None = None,
        api_key_env: str | None = None,
        external: bool = True,
        prices: dict[str, list[float]] | None = None,
        timeout: float = 120.0,
        json_mode: bool = True,
    ):
        self.name = name
        self.base_url = base_url.rstrip("/")
        self.models = models  # tier -> model name, e.g. {"strong": "...", "standard": "...", "fast": "..."}
        self.api_key = api_key or (os.environ.get(api_key_env) if api_key_env else None)
        self.external = external
        self.prices = prices or {}  # model -> [usd per 1M input tokens, usd per 1M output tokens]
        self.timeout = timeout
        self.json_mode = json_mode

    def _model_for(self, tier: str, model_override: str | None) -> str | None:
        if model_override:
            provider, _, model = model_override.partition("/")
            return model if provider == self.name and model else None
        return self.models.get(tier) or self.models.get("standard")

    def supports(self, tier: str, model_override: str | None) -> bool:
        return self._model_for(tier, model_override) is not None

    def complete(self, request: CompletionRequest, *, tier: str, model_override: str | None) -> CompletionResult:
        model = self._model_for(tier, model_override)
        if model is None:
            raise ProviderError(f"{self.name} has no model for tier {tier!r}")
        body: dict = {
            "model": model,
            "messages": request.messages,
            "temperature": request.temperature,
            "max_tokens": request.max_tokens,
        }
        if request.json_mode and self.json_mode:
            body["response_format"] = {"type": "json_object"}
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        started = time.monotonic()
        try:
            response = httpx.post(f"{self.base_url}/chat/completions", json=body, headers=headers, timeout=self.timeout)
        except httpx.TimeoutException as exc:
            raise ProviderError(f"{self.name}: request timed out", retryable=True) from exc
        except httpx.HTTPError as exc:
            raise ProviderError(f"{self.name}: connection error: {exc}", retryable=True) from exc
        latency_ms = int((time.monotonic() - started) * 1000)

        if response.status_code == 429:
            raise RateLimited(f"{self.name}: rate limited")
        if response.status_code >= 500:
            raise ProviderError(f"{self.name}: server error {response.status_code}", retryable=True)
        if response.status_code >= 400:
            raise ProviderError(f"{self.name}: request rejected {response.status_code}: {response.text[:300]}")

        data = response.json()
        try:
            content = data["choices"][0]["message"]["content"] or ""
        except (KeyError, IndexError, TypeError) as exc:
            raise ProviderError(f"{self.name}: malformed response", retryable=True) from exc
        usage = data.get("usage") or {}
        prompt_tokens = int(usage.get("prompt_tokens") or 0)
        completion_tokens = int(usage.get("completion_tokens") or 0)
        price_in, price_out = self.prices.get(model, [0.0, 0.0])
        cost = (prompt_tokens * price_in + completion_tokens * price_out) / 1_000_000
        return CompletionResult(
            content=content,
            provider=self.name,
            model=model,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            latency_ms=latency_ms,
            cost_usd=cost,
        )
