import brotli

from app.services import unprotector


def test_decode_response_body_with_brotli():
    html = "<html><body>Hello Brotli</body></html>"
    compressed = brotli.compress(html.encode("utf-8"))
    headers = {
        "Content-Encoding": "br",
        "Content-Type": "text/html; charset=utf-8",
    }

    decoded = unprotector._decode_response_body(compressed, headers, "utf-8")

    assert decoded == html


def test_decode_response_body_with_plain_text_and_brotli_header():
    html = "<html><body>Already decoded</body></html>"
    headers = {
        "Content-Encoding": "br",
        "Content-Type": "text/html; charset=utf-8",
    }

    decoded = unprotector._decode_response_body(html.encode("utf-8"), headers, "utf-8")

    assert decoded == html
