import re
from io import BytesIO
from datetime import datetime

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT, TA_JUSTIFY
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (
    HRFlowable,
    Paragraph,
    Preformatted,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

BRAND = colors.HexColor("#4263eb")
GRAY_900 = colors.HexColor("#111827")
GRAY_800 = colors.HexColor("#1f2937")
GRAY_700 = colors.HexColor("#374151")
GRAY_500 = colors.HexColor("#6b7280")
GRAY_200 = colors.HexColor("#e5e7eb")
GRAY_100 = colors.HexColor("#f3f4f6")
BLUE_50 = colors.HexColor("#f0f4ff")
PINK = colors.HexColor("#be185d")


def _styles() -> dict:
    base = dict(fontName="Helvetica", textColor=GRAY_800, leading=17)
    return {
        "body": ParagraphStyle("body", **base, fontSize=10.5, alignment=TA_JUSTIFY, spaceAfter=5),
        "h1": ParagraphStyle("h1", fontName="Helvetica-Bold", fontSize=17, leading=22,
                             textColor=GRAY_900, spaceBefore=14, spaceAfter=6),
        "h2": ParagraphStyle("h2", fontName="Helvetica-Bold", fontSize=14, leading=18,
                             textColor=GRAY_800, spaceBefore=12, spaceAfter=5),
        "h3": ParagraphStyle("h3", fontName="Helvetica-Bold", fontSize=12, leading=16,
                             textColor=GRAY_700, spaceBefore=10, spaceAfter=4),
        "code_inline": ParagraphStyle("code_inline", fontName="Courier", fontSize=9,
                                       leading=13, textColor=GRAY_700, backColor=GRAY_100,
                                       leftIndent=8, rightIndent=8, spaceBefore=4, spaceAfter=6),
        "quote": ParagraphStyle("quote", fontName="Helvetica-Oblique", fontSize=10.5,
                                 leading=16, textColor=GRAY_700, backColor=BLUE_50,
                                 leftIndent=14, rightIndent=6, spaceBefore=5, spaceAfter=5),
        "list_item": ParagraphStyle("list_item", fontName="Helvetica", fontSize=10.5,
                                     leading=16, textColor=GRAY_800,
                                     leftIndent=14, spaceBefore=2, spaceAfter=2),
        "raw": ParagraphStyle("raw", fontName="Courier", fontSize=9, leading=13,
                               textColor=GRAY_700, spaceAfter=4),
    }


def _escape_xml(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _inline_md(text: str) -> str:
    """Convert inline markdown tokens to reportlab paragraph XML."""
    text = _escape_xml(text)
    # Bold+italic
    text = re.sub(r"\*\*\*(.+?)\*\*\*", r"<b><i>\1</i></b>", text)
    # Bold
    text = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", text)
    text = re.sub(r"__(.+?)__", r"<b>\1</b>", text)
    # Italic
    text = re.sub(r"\*(.+?)\*", r"<i>\1</i>", text)
    text = re.sub(r"(?<!\w)_(.+?)_(?!\w)", r"<i>\1</i>", text)
    # Inline code
    text = re.sub(r"`(.+?)`",
                  r'<font name="Courier" size="9" color="#be185d">\1</font>', text)
    # Strip markdown links → keep text only
    text = re.sub(r"\[(.+?)\]\(.+?\)", r"\1", text)
    return text


def _parse_md_to_elements(text: str, styles: dict) -> list:
    elements = []
    lines = text.splitlines()
    i = 0

    while i < len(lines):
        line = lines[i]

        # ── Fenced code block ──────────────────────────────────────────────
        if line.startswith("```"):
            code_lines = []
            i += 1
            while i < len(lines) and not lines[i].startswith("```"):
                code_lines.append(lines[i])
                i += 1
            code_text = "\n".join(code_lines)
            elements.append(
                Preformatted(code_text, styles["code_inline"],
                             maxLineLength=90, newLineChars="")
            )
            i += 1
            continue

        # ── Headings ───────────────────────────────────────────────────────
        if line.startswith("### "):
            elements.append(Paragraph(_inline_md(line[4:]), styles["h3"]))
        elif line.startswith("## "):
            elements.append(Paragraph(_inline_md(line[3:]), styles["h2"]))
        elif line.startswith("# "):
            elements.append(Paragraph(_inline_md(line[2:]), styles["h1"]))

        # ── Horizontal rule ────────────────────────────────────────────────
        elif re.fullmatch(r"[-*_]{3,}", line.strip()):
            elements.append(
                HRFlowable(width="100%", thickness=0.5, color=GRAY_200,
                           spaceBefore=6, spaceAfter=6)
            )

        # ── Blockquote ─────────────────────────────────────────────────────
        elif line.startswith("> "):
            elements.append(Paragraph(_inline_md(line[2:]), styles["quote"]))

        # ── Unordered list item ────────────────────────────────────────────
        elif re.match(r"^[-*+] ", line):
            content = line[2:]
            elements.append(
                Paragraph(f"• {_inline_md(content)}", styles["list_item"])
            )

        # ── Ordered list item ──────────────────────────────────────────────
        elif re.match(r"^\d+\. ", line):
            m = re.match(r"^(\d+)\. (.*)", line)
            if m:
                num, content = m.group(1), m.group(2)
                elements.append(
                    Paragraph(f"{num}. {_inline_md(content)}", styles["list_item"])
                )

        # ── Markdown table row ─────────────────────────────────────────────
        elif "|" in line and re.match(r"^\|?.*\|.*\|?$", line):
            table_lines = [line]
            while i + 1 < len(lines) and "|" in lines[i + 1]:
                i += 1
                table_lines.append(lines[i])

            # Filter out separator rows (---|---)
            data_rows = [
                r for r in table_lines
                if not re.fullmatch(r"[\|\-: ]+", r.strip())
            ]
            table_data = []
            for row in data_rows:
                cells = [c.strip() for c in row.strip("|").split("|")]
                table_data.append(cells)

            if len(table_data) >= 1:
                col_count = max(len(r) for r in table_data)
                col_width = (A4[0] - 40 * mm) / col_count

                tbl = Table(
                    [[Paragraph(_inline_md(c), styles["body"]) for c in row]
                     for row in table_data],
                    colWidths=[col_width] * col_count,
                    repeatRows=1,
                )
                tbl.setStyle(TableStyle([
                    ("BACKGROUND",  (0, 0), (-1, 0), BRAND),
                    ("TEXTCOLOR",   (0, 0), (-1, 0), colors.white),
                    ("FONTNAME",    (0, 0), (-1, 0), "Helvetica-Bold"),
                    ("FONTSIZE",    (0, 0), (-1, -1), 9),
                    ("ROWBACKGROUNDS", (0, 1), (-1, -1),
                     [colors.HexColor("#ffffff"), colors.HexColor("#f9fafb")]),
                    ("GRID",        (0, 0), (-1, -1), 0.4, GRAY_200),
                    ("VALIGN",      (0, 0), (-1, -1), "TOP"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 6),
                    ("RIGHTPADDING",(0, 0), (-1, -1), 6),
                    ("TOPPADDING",  (0, 0), (-1, -1), 5),
                    ("BOTTOMPADDING",(0, 0), (-1, -1), 5),
                ]))
                elements.append(tbl)
                elements.append(Spacer(1, 4 * mm))

        # ── Blank line → small spacer ──────────────────────────────────────
        elif line.strip() == "":
            elements.append(Spacer(1, 3 * mm))

        # ── Regular paragraph (merge consecutive plain lines) ──────────────
        else:
            para_parts = [line]
            while i + 1 < len(lines):
                nxt = lines[i + 1]
                if (nxt.strip() == ""
                        or nxt.startswith("#")
                        or nxt.startswith("```")
                        or nxt.startswith(">")
                        or re.match(r"^[-*+] ", nxt)
                        or re.match(r"^\d+\. ", nxt)
                        or re.fullmatch(r"[-*_]{3,}", nxt.strip())
                        or ("|" in nxt)):
                    break
                para_parts.append(nxt)
                i += 1
            elements.append(
                Paragraph(_inline_md(" ".join(para_parts)), styles["body"])
            )

        i += 1

    return elements


def _build_header(model_name: str, styles: dict) -> Table:
    date_str = datetime.now().strftime("%B %d, %Y  %H:%M")
    logo = Paragraph(
        '<font color="#4263eb" size="22"><b>S</b></font>',
        ParagraphStyle("logo", fontSize=22, leading=24),
    )
    title = Paragraph(
        f'<font name="Helvetica-Bold" size="14" color="#111827">Shake Analyzer</font>'
        f'<br/><font size="10" color="#374151">{model_name} — Response</font>',
        ParagraphStyle("title", fontSize=14, leading=18),
    )
    date_para = Paragraph(
        f'<font size="9" color="#6b7280">{date_str}</font>',
        ParagraphStyle("date", fontSize=9, leading=13, alignment=TA_LEFT),
    )
    page_width = A4[0] - 40 * mm
    tbl = Table(
        [[logo, title, date_para]],
        colWidths=[12 * mm, page_width - 55 * mm, 43 * mm],
    )
    tbl.setStyle(TableStyle([
        ("VALIGN",         (0, 0), (-1, -1), "MIDDLE"),
        ("LINEBELOW",      (0, 0), (-1, 0), 1.5, BRAND),
        ("BOTTOMPADDING",  (0, 0), (-1, 0), 10),
        ("LEFTPADDING",    (0, 0), (0, 0), 0),
        ("RIGHTPADDING",   (-1, 0), (-1, 0), 0),
    ]))
    return tbl


def generate_response_pdf(model_name: str, response_text: str, is_raw: bool = False) -> bytes:
    buffer = BytesIO()
    styles = _styles()

    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        rightMargin=20 * mm,
        leftMargin=20 * mm,
        topMargin=22 * mm,
        bottomMargin=20 * mm,
        title=f"Shake Analyzer — {model_name}",
        author="Shake Analyzer",
    )

    elements: list = []
    elements.append(_build_header(model_name, styles))
    elements.append(Spacer(1, 7 * mm))

    if is_raw:
        # Monospace verbatim dump
        for line in response_text.splitlines():
            safe_line = _escape_xml(line) if line.strip() else " "
            elements.append(Paragraph(safe_line, styles["raw"]))
    else:
        elements.extend(_parse_md_to_elements(response_text, styles))

    def _footer(canvas, doc):
        canvas.saveState()
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(GRAY_500)
        canvas.drawString(20 * mm, 12 * mm, "Shake Analyzer — Jupiter Shake")
        canvas.drawRightString(
            A4[0] - 20 * mm, 12 * mm,
            f"Page {doc.page}"
        )
        canvas.restoreState()

    doc.build(elements, onFirstPage=_footer, onLaterPages=_footer)
    return buffer.getvalue()
