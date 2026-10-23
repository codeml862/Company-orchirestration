"""Public web fetching with SSRF protection.

Only http/https on standard ports, only hosts that resolve to public IP addresses (checked
again on every redirect), bounded size and time. The returned text is marked untrusted so
the runner can fence it off from instructions.
"""

import ipaddress
import re
import socket
from html import unescape
from urllib.parse import urljoin, urlparse

import httpx

MAX_BYTES = 2_000_000
MAX_TEXT_CHARS = 20000
MAX_REDIRECTS = 4
TIMEOUT = 15.0
USER_AGENT = "AICO-ResearchAgent/0.1 (+https://github.com/codeml862/Company-orchirestration)"


class FetchError(Exception):
    pass


def _check_host(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise FetchError("only http and https URLs are allowed")
    if not parsed.hostname:
        raise FetchError("URL has no host")
    if parsed.port not in (None, 80, 443):
        raise FetchError("only standard ports (80, 443) are allowed")
    try:
        infos = socket.getaddrinfo(parsed.hostname, None)
    except socket.gaierror as exc:
        raise FetchError(f"cannot resolve {parsed.hostname}") from exc
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if not ip.is_global or ip.is_multicast:
            raise FetchError(f"{parsed.hostname} resolves to a non-public address; blocked")


_SCRIPT_RE = re.compile(r"<(script|style|noscript|svg)[^>]*>.*?</\1>", re.S | re.I)
_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"[ \t\r\f\v]+")
_TITLE_RE = re.compile(r"<title[^>]*>(.*?)</title>", re.S | re.I)


def html_to_text(html: str) -> tuple[str, str]:
    title_match = _TITLE_RE.search(html)
    title = unescape(title_match.group(1)).strip() if title_match else ""
    body = _SCRIPT_RE.sub(" ", html)
    body = re.sub(r"<(br|p|div|li|h[1-6]|tr)[^>]*>", "\n", body, flags=re.I)
    body = unescape(_TAG_RE.sub(" ", body))
    lines = [_WS_RE.sub(" ", line).strip() for line in body.splitlines()]
    return title, "\n".join(line for line in lines if line)


def fetch(url: str) -> dict:
    current = url
    with httpx.Client(timeout=TIMEOUT, follow_redirects=False, headers={"User-Agent": USER_AGENT}) as client:
        for _ in range(MAX_REDIRECTS + 1):
            _check_host(current)
            with client.stream("GET", current) as response:
                if response.is_redirect:
                    location = response.headers.get("location")
                    if not location:
                        raise FetchError("redirect without location")
                    current = urljoin(current, location)
                    continue
                chunks, size = [], 0
                for chunk in response.iter_bytes():
                    size += len(chunk)
                    if size > MAX_BYTES:
                        break
                    chunks.append(chunk)
                raw = b"".join(chunks)
                content_type = response.headers.get("content-type", "")
                text = raw.decode(response.encoding or "utf-8", errors="replace")
                title = ""
                if "html" in content_type:
                    title, text = html_to_text(text)
                return {
                    "url": current,
                    "status_code": response.status_code,
                    "content_type": content_type,
                    "title": title,
                    "truncated": len(text) > MAX_TEXT_CHARS or size > MAX_BYTES,
                    "untrusted_content": text[:MAX_TEXT_CHARS],
                }
    raise FetchError("too many redirects")
