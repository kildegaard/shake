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


def generate_rhea_pdf(rhea_results: dict) -> bytes:
    """Generate a PDF report from Rhea evaluation results (one or more models)."""
    buffer = BytesIO()
    styles = _styles()

    entries = list(rhea_results.items())
    is_single = len(entries) == 1

    model_label = entries[0][1].get("model_name", entries[0][0]) if is_single else "All Models"

    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        rightMargin=20 * mm,
        leftMargin=20 * mm,
        topMargin=22 * mm,
        bottomMargin=20 * mm,
        title=f"Rhea Evaluation — {model_label}",
        author="Shake Analyzer",
    )

    elements: list = []

    # ── Header ──────────────────────────────────────────────────────────────
    date_str = datetime.now().strftime("%B %d, %Y  %H:%M")
    logo = Paragraph(
        '<font color="#4263eb" size="22"><b>S</b></font>',
        ParagraphStyle("logo", fontSize=22, leading=24),
    )
    title_para = Paragraph(
        '<font name="Helvetica-Bold" size="14" color="#111827">Shake Analyzer — Rhea Evaluation</font>'
        f'<br/><font size="10" color="#374151">{model_label}</font>',
        ParagraphStyle("title", fontSize=14, leading=18),
    )
    date_para = Paragraph(
        f'<font size="9" color="#6b7280">{date_str}</font>',
        ParagraphStyle("date", fontSize=9, leading=13, alignment=TA_LEFT),
    )
    page_width = A4[0] - 40 * mm
    header_tbl = Table(
        [[logo, title_para, date_para]],
        colWidths=[12 * mm, page_width - 55 * mm, 43 * mm],
    )
    header_tbl.setStyle(TableStyle([
        ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
        ("LINEBELOW",     (0, 0), (-1, 0), 1.5, BRAND),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 10),
        ("LEFTPADDING",   (0, 0), (0, 0), 0),
        ("RIGHTPADDING",  (-1, 0), (-1, 0), 0),
    ]))
    elements.append(header_tbl)
    elements.append(Spacer(1, 7 * mm))

    # ── Summary cards ────────────────────────────────────────────────────────
    elements.append(Paragraph("Summary", styles["h2"]))
    elements.append(Spacer(1, 3 * mm))

    summary_col_w = (page_width - (len(entries) - 1) * 4 * mm) / len(entries)
    summary_rows = []
    for _, data in entries:
        s = data.get("summary", {})
        pass_rate = s.get("pass_rate", 0)
        rate_color = "#16a34a" if pass_rate >= 80 else "#ca8a04" if pass_rate >= 50 else "#dc2626"
        card_content = [
            Paragraph(f'<font name="Helvetica-Bold" size="11" color="#111827">'
                      f'{_escape_xml(data.get("model_name", ""))}</font>', styles["body"]),
            Paragraph(f'<font name="Helvetica-Bold" size="16" color="{rate_color}">'
                      f'{pass_rate}%</font><font size="9" color="#6b7280"> pass rate</font>', styles["body"]),
            Paragraph(
                f'<font size="9" color="#374151">'
                f'<b>{s.get("total", 0)}</b> total &nbsp; '
                f'<font color="#16a34a"><b>{s.get("passed", 0)}</b></font> passed &nbsp; '
                f'<font color="#dc2626"><b>{s.get("failed", 0)}</b></font> failed'
                f'</font>',
                styles["body"]
            ),
            Paragraph(
                f'<font size="9" color="#374151">'
                f'{s.get("scored_points", 0)} / {s.get("max_points", 0)} pts '
                f'({s.get("points_rate", 0)}%)'
                f'</font>',
                styles["body"]
            ),
        ]
        summary_rows.append(card_content)

    if summary_rows:
        card_table_data = [summary_rows] if len(summary_rows) > 1 else [[summary_rows[0]]]
        if len(summary_rows) > 1:
            card_table_data = [summary_rows]
        else:
            card_table_data = [[summary_rows[0]]]

        card_tbl = Table(
            card_table_data,
            colWidths=[summary_col_w] * len(entries),
        )
        card_tbl.setStyle(TableStyle([
            ("BACKGROUND",    (0, 0), (-1, -1), colors.HexColor("#f0f4ff")),
            ("BOX",           (0, 0), (-1, -1), 0.5, GRAY_200),
            ("INNERGRID",     (0, 0), (-1, -1), 0.5, GRAY_200),
            ("VALIGN",        (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING",   (0, 0), (-1, -1), 8),
            ("RIGHTPADDING",  (0, 0), (-1, -1), 8),
            ("TOPPADDING",    (0, 0), (-1, -1), 8),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            ("ROWBACKGROUNDS", (0, 0), (-1, -1), [colors.HexColor("#f0f4ff")]),
        ]))
        elements.append(card_tbl)

    elements.append(Spacer(1, 6 * mm))

    # ── Evaluation table ─────────────────────────────────────────────────────
    elements.append(Paragraph("Detailed Evaluation", styles["h2"]))
    elements.append(Spacer(1, 3 * mm))

    PASS_COLOR = colors.HexColor("#dcfce7")
    FAIL_COLOR = colors.HexColor("#fee2e2")
    PASS_TEXT  = colors.HexColor("#166534")
    FAIL_TEXT  = colors.HexColor("#991b1b")

    body_sm = ParagraphStyle("body_sm", fontName="Helvetica", fontSize=8.5,
                              leading=12, textColor=GRAY_800)
    reason_sm = ParagraphStyle("reason_sm", fontName="Helvetica", fontSize=7.5,
                                leading=11, textColor=GRAY_500)
    header_style = ParagraphStyle("hdr", fontName="Helvetica-Bold", fontSize=8.5,
                                   leading=12, textColor=colors.white)

    if is_single:
        _, data = entries[0]
        evaluations = data.get("evaluations", [])

        col_criteria = 75 * mm
        col_pts = 10 * mm
        col_status = 14 * mm
        col_reason = page_width - col_criteria - col_pts - col_status

        table_data = [[
            Paragraph("Criteria", header_style),
            Paragraph("Pts", header_style),
            Paragraph("Status", header_style),
            Paragraph("Reason", header_style),
        ]]
        row_colors = [("BACKGROUND", (0, 0), (-1, 0), BRAND)]

        for i, ev in enumerate(evaluations):
            is_pass = ev.get("status", "") == "PASS"
            status_bg = PASS_COLOR if is_pass else FAIL_COLOR
            status_fg = PASS_TEXT if is_pass else FAIL_TEXT
            status_para = Paragraph(
                f'<font color="{"#166534" if is_pass else "#991b1b"}" name="Helvetica-Bold">'
                f'{_escape_xml(ev.get("status", ""))}</font>',
                body_sm
            )
            row = [
                Paragraph(_escape_xml(ev.get("criteria", "")), body_sm),
                Paragraph(str(ev.get("points", "")), body_sm),
                status_para,
                Paragraph(_escape_xml(ev.get("reason", "—")), reason_sm),
            ]
            table_data.append(row)
            bg = colors.HexColor("#ffffff") if i % 2 == 0 else colors.HexColor("#f9fafb")
            row_colors.append(("BACKGROUND", (0, i + 1), (-1, i + 1), bg))
            row_colors.append(("BACKGROUND", (2, i + 1), (2, i + 1), status_bg))

        tbl = Table(
            table_data,
            colWidths=[col_criteria, col_pts, col_status, col_reason],
            repeatRows=1,
        )
        style_cmds = [
            ("GRID",          (0, 0), (-1, -1), 0.4, GRAY_200),
            ("VALIGN",        (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING",   (0, 0), (-1, -1), 5),
            ("RIGHTPADDING",  (0, 0), (-1, -1), 5),
            ("TOPPADDING",    (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ("TEXTCOLOR",     (0, 0), (-1, 0), colors.white),
            ("ALIGN",         (1, 0), (1, -1), "CENTER"),
            ("ALIGN",         (2, 0), (2, -1), "CENTER"),
        ] + row_colors
        tbl.setStyle(TableStyle(style_cmds))
        elements.append(tbl)

    else:
        # Multi-model table
        max_rows = max(len(d.get("evaluations", [])) for _, d in entries)
        model_names = [d.get("model_name", k) for k, d in entries]

        col_criteria = 55 * mm
        col_pts = 9 * mm
        per_model_w = (page_width - col_criteria - col_pts) / len(entries)
        col_status = per_model_w * 0.32
        col_reason = per_model_w * 0.68

        header_row = [
            Paragraph("Criteria", header_style),
            Paragraph("Pts", header_style),
        ]
        for name in model_names:
            header_row += [
                Paragraph(_escape_xml(name), header_style),
                Paragraph("Reason", header_style),
            ]

        col_widths = [col_criteria, col_pts]
        for _ in entries:
            col_widths += [col_status, col_reason]

        table_data = [header_row]
        row_colors = [("BACKGROUND", (0, 0), (-1, 0), BRAND)]

        for i in range(max_rows):
            first_ev = (entries[0][1].get("evaluations") or [])[i] if i < len(entries[0][1].get("evaluations", [])) else None
            criteria_text = first_ev.get("criteria", "—") if first_ev else "—"
            pts_text = str(first_ev.get("points", "")) if first_ev else ""

            row = [
                Paragraph(_escape_xml(criteria_text), body_sm),
                Paragraph(pts_text, body_sm),
            ]

            bg_row = colors.HexColor("#ffffff") if i % 2 == 0 else colors.HexColor("#f9fafb")
            row_colors.append(("BACKGROUND", (0, i + 1), (-1, i + 1), bg_row))

            col_idx = 2
            for _, data in entries:
                evs = data.get("evaluations", [])
                ev = evs[i] if i < len(evs) else None
                if ev:
                    is_pass = ev.get("status", "") == "PASS"
                    status_bg = PASS_COLOR if is_pass else FAIL_COLOR
                    row_colors.append(("BACKGROUND", (col_idx, i + 1), (col_idx, i + 1), status_bg))
                    status_para = Paragraph(
                        f'<font color="{"#166534" if is_pass else "#991b1b"}" name="Helvetica-Bold">'
                        f'{_escape_xml(ev.get("status", ""))}</font>',
                        body_sm
                    )
                    row += [status_para, Paragraph(_escape_xml(ev.get("reason", "—")), reason_sm)]
                else:
                    row += [Paragraph("—", body_sm), Paragraph("—", reason_sm)]
                col_idx += 2

            table_data.append(row)

        tbl = Table(table_data, colWidths=col_widths, repeatRows=1)
        style_cmds = [
            ("GRID",          (0, 0), (-1, -1), 0.4, GRAY_200),
            ("VALIGN",        (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING",   (0, 0), (-1, -1), 4),
            ("RIGHTPADDING",  (0, 0), (-1, -1), 4),
            ("TOPPADDING",    (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ("TEXTCOLOR",     (0, 0), (-1, 0), colors.white),
            ("ALIGN",         (1, 0), (1, -1), "CENTER"),
        ] + row_colors
        tbl.setStyle(TableStyle(style_cmds))
        elements.append(tbl)

    def _footer(canvas, doc):
        canvas.saveState()
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(GRAY_500)
        canvas.drawString(20 * mm, 12 * mm, "Shake Analyzer — Jupiter Shake")
        canvas.drawRightString(A4[0] - 20 * mm, 12 * mm, f"Page {doc.page}")
        canvas.restoreState()

    doc.build(elements, onFirstPage=_footer, onLaterPages=_footer)
    return buffer.getvalue()


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
