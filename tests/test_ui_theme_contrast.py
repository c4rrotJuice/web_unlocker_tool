from __future__ import annotations

import re
from pathlib import Path


def _hex_to_rgb(hex_color: str) -> tuple[float, float, float]:
    hex_color = hex_color.lstrip('#')
    return tuple(int(hex_color[i:i+2], 16) / 255 for i in (0, 2, 4))


def _linearize(c: float) -> float:
    return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4


def _luminance(hex_color: str) -> float:
    r, g, b = _hex_to_rgb(hex_color)
    return 0.2126 * _linearize(r) + 0.7152 * _linearize(g) + 0.0722 * _linearize(b)


def _contrast_ratio(fg: str, bg: str) -> float:
    l1, l2 = _luminance(fg), _luminance(bg)
    lighter = max(l1, l2)
    darker = min(l1, l2)
    return (lighter + 0.05) / (darker + 0.05)


def _parse_theme_blocks() -> tuple[dict[str, str], dict[str, str]]:
    css = Path('app/static/css/theme.css').read_text()
    root_block = re.search(r':root\s*\{([^}]*)\}', css, re.S)
    dark_block = re.search(r'html\.dark\s*\{([^}]*)\}', css, re.S)
    assert root_block and dark_block

    def parse(block: str) -> dict[str, str]:
        out: dict[str, str] = {}
        for line in block.splitlines():
            m = re.search(r'(--[\w-]+):\s*(#[0-9a-fA-F]{6})\s*;', line)
            if m:
                out[m.group(1)] = m.group(2)
        return out

    return parse(root_block.group(1)), parse(dark_block.group(1))


def test_theme_token_contrast_pairs_wcag_aa() -> None:
    light, dark = _parse_theme_blocks()

    checks = [
        (light['--wu-text'], light['--wu-bg'], 4.5, 'light body text'),
        (light['--wu-text-subtle'], light['--wu-bg'], 4.5, 'light muted body text'),
        (light['--wu-nav-active-text'], light['--wu-nav-active-bg'], 4.5, 'light nav active'),
        (dark['--wu-text'], dark['--wu-bg'], 4.5, 'dark body text'),
        (dark['--wu-text-muted'], dark['--wu-bg'], 4.5, 'dark muted text'),
        (dark['--wu-nav-active-text'], dark['--wu-nav-active-bg'], 4.5, 'dark nav active'),
    ]

    failures = []
    for fg, bg, minimum, name in checks:
        ratio = _contrast_ratio(fg, bg)
        if ratio < minimum:
            failures.append(f'{name}: {ratio:.2f} < {minimum}')

    assert not failures, ' ; '.join(failures)
