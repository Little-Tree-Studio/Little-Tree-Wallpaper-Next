from __future__ import annotations

import hashlib
import socket
from dataclasses import dataclass, field


@dataclass(slots=True)
class SingleInstanceManager:
    app_key: str
    host: str = "127.0.0.1"
    port: int = 0
    _socket: socket.socket | None = field(default=None, init=False, repr=False)

    def __post_init__(self) -> None:
        digest = hashlib.sha1(self.app_key.encode("utf-8")).hexdigest()
        self.port = 42000 + int(digest[:4], 16) % 10000

    def acquire(self) -> bool:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind((self.host, self.port))
            sock.listen(1)
        except OSError:
            sock.close()
            return False
        self._socket = sock
        return True

    def release(self) -> None:
        if self._socket is not None:
            self._socket.close()
            self._socket = None
