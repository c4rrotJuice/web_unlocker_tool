import logging
import threading
from collections import OrderedDict
from typing import Tuple

import cloudscraper

logger = logging.getLogger(__name__)


class SessionPool:
    def __init__(self, max_size: int = 32, header_factory=None) -> None:
        self.max_size = max_size
        self._lock = threading.Lock()
        self._sessions: OrderedDict[str, tuple[cloudscraper.CloudScraper, dict]] = OrderedDict()
        self._header_factory = header_factory

    def get_session(self, hostname: str) -> Tuple[cloudscraper.CloudScraper, dict]:
        if not hostname:
            hostname = "__unknown__"
        with self._lock:
            if hostname in self._sessions:
                session, headers = self._sessions.pop(hostname)
                self._sessions[hostname] = (session, headers)
                return session, headers

            session, headers = self._create_session(hostname)
            self._sessions[hostname] = (session, headers)
            logger.info("[cloudscraper_pool] Created session for hostname=%s", hostname)
            self._evict_if_needed()
            return session, headers

    def evict(self, hostname: str) -> None:
        with self._lock:
            entry = self._sessions.pop(hostname, None)
            if entry:
                session, _headers = entry
                session.close()
                logger.info("[cloudscraper_pool] Evicted session for hostname=%s", hostname)

    def evict_all(self) -> None:
        with self._lock:
            for hostname, (session, _headers) in self._sessions.items():
                session.close()
                logger.info("[cloudscraper_pool] Evicted session for hostname=%s", hostname)
            self._sessions.clear()

    def _create_session(self, hostname: str) -> tuple[cloudscraper.CloudScraper, dict]:
        session = cloudscraper.create_scraper()
        headers = self._build_session_headers(hostname)
        return session, headers

    def _evict_if_needed(self) -> None:
        while len(self._sessions) > self.max_size:
            hostname, (session, _headers) = self._sessions.popitem(last=False)
            session.close()
            logger.info("[cloudscraper_pool] Evicted LRU session for hostname=%s", hostname)

    def _build_session_headers(self, hostname: str) -> dict:
        if self._header_factory is None:
            return {}
        return dict(self._header_factory(hostname))
