#app.routes.http
import httpx

http_client = httpx.AsyncClient(
    timeout=httpx.Timeout(
        connect=10.0,
        read=20.0,
        write=10.0,
        pool=30.0
    ),
    limits=httpx.Limits(
        max_connections=20,
        max_keepalive_connections=10
    ),
    http2=True
)
