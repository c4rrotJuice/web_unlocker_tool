from __future__ import annotations

from io import BytesIO
from typing import Iterable

from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.pdfgen import canvas


def _draw_heading(pdf: canvas.Canvas, text: str, y: float) -> float:
    pdf.setFont("Helvetica-Bold", 16)
    pdf.drawString(1 * inch, y, text)
    return y - 0.35 * inch


def _draw_paragraph(pdf: canvas.Canvas, text: str, y: float) -> float:
    pdf.setFont("Helvetica", 11)
    pdf.drawString(1 * inch, y, text)
    return y - 0.25 * inch


def _draw_bullets(pdf: canvas.Canvas, bullets: Iterable[str], y: float) -> float:
    pdf.setFont("Helvetica", 11)
    for bullet in bullets:
        pdf.drawString(1.1 * inch, y, f"• {bullet}")
        y -= 0.25 * inch
    return y


def build_monthly_report_pdf(report: dict) -> bytes:
    buffer = BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=letter)
    width, height = letter

    # Cover page
    pdf.setFont("Helvetica-Bold", 24)
    pdf.drawString(1 * inch, height - 1.5 * inch, "Research Activity Report")
    pdf.setFont("Helvetica", 14)
    pdf.drawString(1 * inch, height - 2.1 * inch, report["user_name"])
    pdf.setFont("Helvetica", 12)
    pdf.drawString(1 * inch, height - 2.5 * inch, report["month_range"])
    pdf.showPage()

    # Executive summary + activity overview
    y = height - 1 * inch
    y = _draw_heading(pdf, "Executive Summary", y)
    y = _draw_bullets(pdf, report["summary_bullets"], y - 0.05 * inch)

    y -= 0.2 * inch
    y = _draw_heading(pdf, "Activity Overview", y)
    overview = report["overview"]
    y = _draw_paragraph(pdf, f"Articles unlocked (MTD): {overview['articles_unlocked_mtd']}", y)
    y = _draw_paragraph(pdf, f"Active days (MTD): {overview['active_days_mtd']}", y)
    y = _draw_paragraph(pdf, f"Current streak: {overview['current_streak_days']} days", y)
    y = _draw_paragraph(pdf, f"Citations created (MTD): {overview['citations_month']}", y)
    pdf.showPage()

    # Source patterns + citations + milestones
    y = height - 1 * inch
    y = _draw_heading(pdf, "Source Patterns (Top Domains)", y)
    domains = report["top_domains"]
    if domains:
        y = _draw_bullets(
            pdf,
            [f"{domain} — {count} unlocks" for domain, count in domains],
            y - 0.05 * inch,
        )
    else:
        y = _draw_paragraph(pdf, "No domains recorded for this month.", y)

    y -= 0.2 * inch
    y = _draw_heading(pdf, "Citation Breakdown", y)
    citations = report["citation_breakdown"]
    if citations:
        y = _draw_bullets(
            pdf,
            [f"{fmt.upper()}: {count}" for fmt, count in citations],
            y - 0.05 * inch,
        )
    else:
        y = _draw_paragraph(pdf, "No citations recorded for this month.", y)

    y -= 0.2 * inch
    y = _draw_heading(pdf, "Milestones Earned", y)
    milestones = report["milestones"]
    if milestones:
        y = _draw_bullets(pdf, milestones, y - 0.05 * inch)
    else:
        y = _draw_paragraph(pdf, "No milestones earned this month.", y)

    pdf.setFont("Helvetica-Oblique", 9)
    pdf.drawString(
        1 * inch,
        0.75 * inch,
        "This report summarizes your activity in the tool; no full articles are stored.",
    )
    pdf.showPage()

    pdf.save()
    buffer.seek(0)
    return buffer.read()
