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


def _split_rubric_label(text: str) -> tuple[str, str]:
    """Split 'Rubric #3: Some criterion text' → ('#3', 'Some criterion text').
    Falls back to ('', text) if no label is found."""
    m = re.match(r'^Rubric\s*#?(\d+)\s*[:\-]\s*(.+)', text, re.IGNORECASE)
    if m:
        return f"#{m.group(1)}", m.group(2).strip()
    return "", text


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


def generate_rubric_pdf(analysis: dict) -> bytes:
    """Generate a branded PDF report from a Rubric Quality Analysis result."""
    buffer = BytesIO()
    styles = _styles()

    overall_quality = analysis.get("overall_quality", "")
    overall_feedback = analysis.get("overall_feedback", "")
    stats = analysis.get("stats", {})
    rubric_evals = analysis.get("rubric_evaluations", [])
    coverage_gaps = analysis.get("coverage_gaps", [])

    quality_color = (
        colors.HexColor("#16a34a") if overall_quality == "good"
        else colors.HexColor("#ca8a04") if overall_quality == "acceptable"
        else colors.HexColor("#dc2626")
    )

    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        rightMargin=20 * mm,
        leftMargin=20 * mm,
        topMargin=22 * mm,
        bottomMargin=20 * mm,
        title="Rubric Quality Analysis — Shake Analyzer",
        author="Shake Analyzer",
    )

    elements: list = []
    page_width = A4[0] - 40 * mm

    # ── Header ──────────────────────────────────────────────────────────────
    date_str = datetime.now().strftime("%B %d, %Y  %H:%M")
    logo = Paragraph(
        '<font color="#4263eb" size="22"><b>S</b></font>',
        ParagraphStyle("logo", fontSize=22, leading=24),
    )
    title_para = Paragraph(
        '<font name="Helvetica-Bold" size="14" color="#111827">Shake Analyzer</font>'
        '<br/><font size="10" color="#374151">Rubric Quality Analysis</font>',
        ParagraphStyle("title", fontSize=14, leading=18),
    )
    date_para = Paragraph(
        f'<font size="9" color="#6b7280">{date_str}</font>',
        ParagraphStyle("date", fontSize=9, leading=13, alignment=TA_LEFT),
    )
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
    elements.append(Spacer(1, 6 * mm))

    # ── Summary card ────────────────────────────────────────────────────────
    quality_label = (overall_quality or "N/A").replace("_", " ").upper()
    quality_para = Paragraph(
        f'<font name="Helvetica-Bold" size="16">{quality_label}</font>',
        ParagraphStyle("ql", fontSize=16, leading=20, textColor=colors.white, alignment=1),
    )
    feedback_para = Paragraph(
        f'<font name="Helvetica-Bold" size="11" color="#111827">Overall Quality</font>'
        f'<br/><font size="9.5" color="#374151">{_escape_xml(overall_feedback)}</font>',
        ParagraphStyle("fb", fontSize=9.5, leading=14),
    )

    stats_items = []
    if stats:
        for label, val, hex_col in [
            ("Pass", stats.get("pass", 0), "#16a34a"),
            ("Warn", stats.get("warn", 0), "#ca8a04"),
            ("Fail", stats.get("fail", 0), "#dc2626"),
            ("Total", stats.get("total_rubrics", 0), "#374151"),
        ]:
            stats_items.append(
                Paragraph(
                    f'<font name="Helvetica-Bold" size="13" color="{hex_col}">{val}</font>'
                    f'<br/><font size="8" color="#6b7280">{label}</font>',
                    ParagraphStyle(f"st_{label}", fontSize=13, leading=16, alignment=1),
                )
            )

    if stats_items:
        n = len(stats_items)
        stat_w = 18 * mm
        summary_tbl = Table(
            [[quality_para, feedback_para] + stats_items],
            colWidths=[26 * mm, page_width - 26 * mm - n * stat_w] + [stat_w] * n,
        )
    else:
        summary_tbl = Table(
            [[quality_para, feedback_para]],
            colWidths=[26 * mm, page_width - 26 * mm],
        )

    summary_tbl.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (0, 0), quality_color),
        ("BACKGROUND",    (1, 0), (-1, 0), colors.HexColor("#f0f4ff")),
        ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN",         (2, 0), (-1, 0), "CENTER"),
        ("LEFTPADDING",   (0, 0), (-1, -1), 10),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 10),
        ("TOPPADDING",    (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
        ("BOX",           (0, 0), (-1, -1), 0.5, GRAY_200),
        ("INNERGRID",     (0, 0), (-1, -1), 0.3, GRAY_200),
    ]))
    elements.append(summary_tbl)
    elements.append(Spacer(1, 6 * mm))

    # ── Per-rubric evaluation table ──────────────────────────────────────────
    if rubric_evals:
        elements.append(Paragraph("Per-Rubric Evaluation", styles["h2"]))
        elements.append(Spacer(1, 3 * mm))

        header_style = ParagraphStyle("hdr", fontName="Helvetica-Bold", fontSize=8.5,
                                       leading=12, textColor=colors.white)
        body_sm = ParagraphStyle("body_sm", fontName="Helvetica", fontSize=8.5,
                                  leading=12, textColor=GRAY_800)
        issue_sm = ParagraphStyle("issue_sm", fontName="Helvetica", fontSize=7.5,
                                   leading=11, textColor=GRAY_500)

        col_num = 8 * mm
        col_status = 14 * mm
        col_criterion = 80 * mm
        col_issues = page_width - col_num - col_status - col_criterion

        table_data = [[
            Paragraph("#", header_style),
            Paragraph("Criterion", header_style),
            Paragraph("Quality", header_style),
            Paragraph("Issues", header_style),
        ]]
        row_colors = [("BACKGROUND", (0, 0), (-1, 0), BRAND)]

        PASS_BG = colors.HexColor("#dcfce7")
        WARN_BG = colors.HexColor("#fef9c3")
        FAIL_BG = colors.HexColor("#fee2e2")

        for i, rubric in enumerate(rubric_evals):
            q = rubric.get("quality", "")
            status_bg = PASS_BG if q == "pass" else WARN_BG if q == "warn" else FAIL_BG
            status_hex = "#166534" if q == "pass" else "#92400e" if q == "warn" else "#991b1b"
            issues = rubric.get("issues", [])
            issues_content = []
            for iss in issues:
                issues_content.append(
                    Paragraph(
                        f'<font name="Helvetica-Bold">{_escape_xml(iss.get("dimension",""))}</font>'
                        f': {_escape_xml(iss.get("detail",""))}',
                        issue_sm,
                    )
                )

            status_para = Paragraph(
                f'<font name="Helvetica-Bold" color="{status_hex}">{q.upper()}</font>',
                ParagraphStyle("status_cell", fontName="Helvetica-Bold", fontSize=8,
                                leading=11, alignment=1),
            )

            row = [
                Paragraph(str(i + 1), ParagraphStyle("num", fontName="Helvetica",
                           fontSize=8, leading=11, textColor=GRAY_500, alignment=1)),
                Paragraph(_escape_xml(rubric.get("criterion", "")), body_sm),
                status_para,
                issues_content if issues_content else [Paragraph("—", issue_sm)],
            ]
            table_data.append(row)

            bg = colors.HexColor("#ffffff") if i % 2 == 0 else colors.HexColor("#f9fafb")
            row_colors.append(("BACKGROUND", (0, i + 1), (-1, i + 1), bg))
            row_colors.append(("BACKGROUND", (2, i + 1), (2, i + 1), status_bg))

        tbl = Table(
            table_data,
            colWidths=[col_num, col_criterion, col_status, col_issues],
            repeatRows=1,
        )
        style_cmds = [
            ("GRID",          (0, 0), (-1, -1), 0.4, GRAY_200),
            ("VALIGN",        (0, 0), (-1, -1), "TOP"),
            ("ALIGN",         (0, 0), (0, -1), "CENTER"),
            ("ALIGN",         (2, 0), (2, -1), "CENTER"),
            ("LEFTPADDING",   (0, 0), (-1, -1), 5),
            ("RIGHTPADDING",  (0, 0), (-1, -1), 5),
            ("TOPPADDING",    (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ("TEXTCOLOR",     (0, 0), (-1, 0), colors.white),
        ] + row_colors
        tbl.setStyle(TableStyle(style_cmds))
        elements.append(tbl)

    # ── Coverage gaps ────────────────────────────────────────────────────────
    if coverage_gaps:
        elements.append(Spacer(1, 6 * mm))
        elements.append(Paragraph("Coverage Gaps", styles["h2"]))
        elements.append(
            Paragraph("Topics found in the prompt but NOT covered by any rubric:",
                      ParagraphStyle("gap_sub", fontName="Helvetica-Oblique", fontSize=9,
                                      leading=13, textColor=GRAY_500, spaceAfter=4))
        )
        for gap in coverage_gaps:
            elements.append(
                Paragraph(
                    f'<font name="Helvetica-Bold" color="#92400e">{_escape_xml(gap.get("prompt_topic",""))}</font>'
                    f'<font color="#374151"> — {_escape_xml(gap.get("detail",""))}</font>',
                    styles["list_item"],
                )
            )

    def _footer(canvas, doc):
        canvas.saveState()
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(GRAY_500)
        canvas.drawString(20 * mm, 12 * mm, "Shake Analyzer — Jupiter Shake")
        canvas.drawRightString(A4[0] - 20 * mm, 12 * mm, f"Page {doc.page}")
        canvas.restoreState()

    doc.build(elements, onFirstPage=_footer, onLaterPages=_footer)
    return buffer.getvalue()


def generate_prompt_pdf(analysis: dict) -> bytes:
    """Generate a branded PDF report from a Prompt Quality Analysis result."""
    buffer = BytesIO()
    styles = _styles()

    overall_score = analysis.get("overall_score", 0)
    dims = analysis.get("dimensions", [])
    overall_feedback = analysis.get("overall_feedback", "")
    critical_issues = analysis.get("critical_issues", [])

    score_color = (
        colors.HexColor("#16a34a") if overall_score >= 4.5
        else colors.HexColor("#ca8a04") if overall_score >= 3
        else colors.HexColor("#dc2626")
    )

    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        rightMargin=20 * mm,
        leftMargin=20 * mm,
        topMargin=22 * mm,
        bottomMargin=20 * mm,
        title="Prompt Quality Analysis — Shake Analyzer",
        author="Shake Analyzer",
    )

    elements: list = []
    page_width = A4[0] - 40 * mm

    # ── Header ──────────────────────────────────────────────────────────────
    date_str = datetime.now().strftime("%B %d, %Y  %H:%M")
    logo = Paragraph(
        '<font color="#4263eb" size="22"><b>S</b></font>',
        ParagraphStyle("logo", fontSize=22, leading=24),
    )
    title_para = Paragraph(
        '<font name="Helvetica-Bold" size="14" color="#111827">Shake Analyzer</font>'
        '<br/><font size="10" color="#374151">Prompt Quality Analysis</font>',
        ParagraphStyle("title", fontSize=14, leading=18),
    )
    date_para = Paragraph(
        f'<font size="9" color="#6b7280">{date_str}</font>',
        ParagraphStyle("date", fontSize=9, leading=13, alignment=TA_LEFT),
    )
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
    elements.append(Spacer(1, 6 * mm))

    # ── Overall score + summary ──────────────────────────────────────────────
    overall_label = ParagraphStyle("overall_label", fontName="Helvetica-Bold",
                                    fontSize=10, leading=13, textColor=colors.white)
    overall_score_para = Paragraph(
        f'<font name="Helvetica-Bold" size="18">{overall_score:.1f}</font>'
        f'<br/><font size="8">/ 5.0</font>',
        ParagraphStyle("score_num", fontSize=18, leading=22, alignment=1,
                       textColor=colors.white),
    )
    feedback_para = Paragraph(
        f'<font name="Helvetica-Bold" size="11" color="#111827">Overall Score</font>'
        f'<br/><font size="9.5" color="#374151">{_escape_xml(overall_feedback)}</font>',
        ParagraphStyle("fb", fontSize=9.5, leading=14),
    )
    score_tbl = Table(
        [[overall_score_para, feedback_para]],
        colWidths=[22 * mm, page_width - 22 * mm],
    )
    score_tbl.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (0, 0), score_color),
        ("BACKGROUND",    (1, 0), (1, 0), colors.HexColor("#f0f4ff")),
        ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING",   (0, 0), (-1, -1), 10),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 10),
        ("TOPPADDING",    (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
        ("BOX",           (0, 0), (-1, -1), 0.5, GRAY_200),
    ]))
    elements.append(score_tbl)
    elements.append(Spacer(1, 5 * mm))

    # ── Score summary strip ──────────────────────────────────────────────────
    if dims:
        strip_style = ParagraphStyle("strip", fontName="Helvetica", fontSize=8,
                                      leading=11, textColor=GRAY_700, alignment=1)
        strip_bold = ParagraphStyle("strip_bold", fontName="Helvetica-Bold", fontSize=10,
                                     leading=13, alignment=1)
        n = len(dims)
        col_w = page_width / n
        cells = []
        for dim in dims:
            d_hex = (
                "#16a34a" if dim["score"] >= 4.5
                else "#ca8a04" if dim["score"] >= 3
                else "#dc2626"
            )
            short = (dim["name"]
                     .replace("Crisis Scenario ", "")
                     .replace(" Quality", "")
                     .replace("Organizational ", "Org. "))
            cell = [
                Paragraph(f'<font color="{d_hex}" name="Helvetica-Bold">{dim["score"]}</font>',
                          strip_bold),
                Paragraph(_escape_xml(short), strip_style),
            ]
            cells.append(cell)
        strip_tbl = Table([cells], colWidths=[col_w] * n)
        strip_tbl.setStyle(TableStyle([
            ("BACKGROUND",    (0, 0), (-1, -1), colors.HexColor("#f8f9fa")),
            ("BOX",           (0, 0), (-1, -1), 0.5, GRAY_200),
            ("INNERGRID",     (0, 0), (-1, -1), 0.3, GRAY_200),
            ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
            ("ALIGN",         (0, 0), (-1, -1), "CENTER"),
            ("TOPPADDING",    (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ]))
        elements.append(strip_tbl)
        elements.append(Spacer(1, 5 * mm))

    # ── Critical issues ──────────────────────────────────────────────────────
    if critical_issues:
        elements.append(Paragraph("Must Fix Before Submission", styles["h3"]))
        for issue in critical_issues:
            elements.append(
                Paragraph(f'<font color="#991b1b">✗</font>  {_escape_xml(issue)}',
                          styles["list_item"])
            )
        elements.append(Spacer(1, 4 * mm))

    # ── Per-dimension detail ─────────────────────────────────────────────────
    elements.append(Paragraph("Dimension Breakdown", styles["h2"]))
    elements.append(Spacer(1, 3 * mm))

    dim_label_style = ParagraphStyle("dim_label", fontName="Helvetica-Bold",
                                      fontSize=9.5, leading=13, textColor=GRAY_800)
    dim_score_style = ParagraphStyle("dim_score", fontName="Helvetica-Bold",
                                      fontSize=12, leading=15, alignment=1,
                                      textColor=colors.white)
    feedback_small = ParagraphStyle("fb_small", fontName="Helvetica-Oblique",
                                     fontSize=8.5, leading=12, textColor=GRAY_500,
                                     spaceAfter=3)
    fix_style = ParagraphStyle("fix", fontName="Helvetica", fontSize=8.5,
                                leading=12, textColor=GRAY_700,
                                leftIndent=10, spaceBefore=2, spaceAfter=2)

    for dim in dims:
        d_color = (
            colors.HexColor("#16a34a") if dim["score"] >= 4.5
            else colors.HexColor("#ca8a04") if dim["score"] >= 3
            else colors.HexColor("#dc2626")
        )
        fixes = dim.get("fixes", [])
        fix_items = [Paragraph(f'→  {_escape_xml(f)}', fix_style) for f in fixes]

        right_col = [Paragraph(_escape_xml(dim["name"]), dim_label_style)]
        if dim.get("feedback"):
            right_col.append(Paragraph(_escape_xml(dim["feedback"]), feedback_small))
        right_col.extend(fix_items)

        score_cell = Paragraph(
            f'<font name="Helvetica-Bold" size="14">{dim["score"]}</font><br/>'
            f'<font size="7">/5</font>',
            ParagraphStyle("sc_cell", fontName="Helvetica-Bold", fontSize=14,
                           leading=17, alignment=1, textColor=colors.white),
        )

        row_tbl = Table(
            [[score_cell, right_col]],
            colWidths=[16 * mm, page_width - 16 * mm],
        )
        row_tbl.setStyle(TableStyle([
            ("BACKGROUND",    (0, 0), (0, 0), d_color),
            ("BACKGROUND",    (1, 0), (1, 0), colors.HexColor("#fafafa")),
            ("BOX",           (0, 0), (-1, -1), 0.5, GRAY_200),
            ("VALIGN",        (0, 0), (0, 0), "MIDDLE"),
            ("VALIGN",        (1, 0), (1, 0), "TOP"),
            ("ALIGN",         (0, 0), (0, 0), "CENTER"),
            ("LEFTPADDING",   (1, 0), (1, 0), 10),
            ("RIGHTPADDING",  (1, 0), (1, 0), 8),
            ("TOPPADDING",    (0, 0), (-1, -1), 8),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ]))
        elements.append(row_tbl)
        elements.append(Spacer(1, 3 * mm))

    def _footer(canvas, doc):
        canvas.saveState()
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(GRAY_500)
        canvas.drawString(20 * mm, 12 * mm, "Shake Analyzer — Jupiter Shake")
        canvas.drawRightString(A4[0] - 20 * mm, 12 * mm, f"Page {doc.page}")
        canvas.restoreState()

    doc.build(elements, onFirstPage=_footer, onLaterPages=_footer)
    return buffer.getvalue()


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
        scored   = s.get("scored_points", 0)
        max_pts  = s.get("max_points", 0)
        pts_rate = s.get("points_rate", 0)
        penalty  = s.get("penalty_points", 0)
        primary_rate = pts_rate if max_pts > 0 else s.get("pass_rate", 0)
        rate_color = "#16a34a" if primary_rate >= 80 else "#ca8a04" if primary_rate >= 50 else "#dc2626"
        penalty_line = (
            f'<font size="9" color="#b91c1c"><b>Penalties applied: {penalty} pts</b></font><br/>'
            if penalty < 0 else ""
        )
        card_content = [
            Paragraph(f'<font name="Helvetica-Bold" size="11" color="#111827">'
                      f'{_escape_xml(data.get("model_name", ""))}</font>', styles["body"]),
            Paragraph(f'<font name="Helvetica-Bold" size="16" color="{rate_color}">'
                      f'{primary_rate}%</font><font size="9" color="#6b7280"> score</font>', styles["body"]),
            Paragraph(
                f'<font size="9" color="#374151">'
                f'<b>{s.get("total", 0)}</b> criteria &nbsp; '
                f'<font color="#16a34a"><b>{s.get("passed", 0)}</b></font> passed &nbsp; '
                f'<font color="#dc2626"><b>{s.get("failed", 0)}</b></font> failed'
                f'</font>',
                styles["body"]
            ),
            Paragraph(
                penalty_line +
                f'<font size="9" color="#374151">'
                f'{scored} / {max_pts} pts ({pts_rate}%)'
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
    section_title = "Comparison Table" if not is_single else "Detailed Evaluation"
    elements.append(Paragraph(section_title, styles["h2"]))
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

        col_num      = 12 * mm
        col_pts      = 10 * mm
        col_status   = 14 * mm
        col_criteria = 65 * mm
        col_reason   = page_width - col_num - col_criteria - col_pts - col_status

        num_style = ParagraphStyle("num_sm", fontName="Helvetica-Bold", fontSize=8,
                                   leading=11, textColor=GRAY_700, alignment=1)
        neg_pts_style = ParagraphStyle("neg_pts", fontName="Helvetica-Bold", fontSize=8.5,
                                       leading=12, textColor=colors.HexColor("#991b1b"), alignment=1)
        pos_pts_style = ParagraphStyle("pos_pts", fontName="Helvetica-Bold", fontSize=8.5,
                                       leading=12, textColor=colors.HexColor("#166534"), alignment=1)
        zero_pts_style = ParagraphStyle("zero_pts", fontName="Helvetica", fontSize=8.5,
                                        leading=12, textColor=GRAY_500, alignment=1)

        PENALTY_BG = colors.HexColor("#fff7ed")

        table_data = [[
            Paragraph("No.", header_style),
            Paragraph("Criteria", header_style),
            Paragraph("Pts", header_style),
            Paragraph("Status", header_style),
            Paragraph("Reason", header_style),
        ]]
        row_colors = [("BACKGROUND", (0, 0), (-1, 0), BRAND)]

        for i, ev in enumerate(evaluations):
            is_pass    = ev.get("status", "") == "PASS"
            raw_pts    = ev.get("points", 0)
            is_neg     = raw_pts < 0
            # Effective contribution: PASS applies pts, FAIL = 0
            eff_pts    = raw_pts if is_pass else 0

            rubric_label, criteria_text = _split_rubric_label(ev.get("criteria", ""))

            if eff_pts < 0:
                pts_para = Paragraph(str(eff_pts), neg_pts_style)
            elif eff_pts > 0:
                pts_para = Paragraph(f"+{eff_pts}", pos_pts_style)
            else:
                pts_para = Paragraph("0" if is_neg else "—", zero_pts_style)

            status_para = Paragraph(
                f'<font color="{"#166634" if is_pass else "#991b1b"}" name="Helvetica-Bold">'
                f'{_escape_xml(ev.get("status", ""))}</font>',
                body_sm,
            )

            row = [
                Paragraph(_escape_xml(rubric_label or str(i + 1)), num_style),
                Paragraph(_escape_xml(criteria_text), body_sm),
                pts_para,
                status_para,
                Paragraph(_escape_xml(ev.get("reason", "—")), reason_sm),
            ]
            table_data.append(row)

            bg = PENALTY_BG if is_neg else (
                colors.HexColor("#ffffff") if i % 2 == 0 else colors.HexColor("#f9fafb")
            )
            row_colors.append(("BACKGROUND", (0, i + 1), (-1, i + 1), bg))
            status_bg = PASS_COLOR if is_pass else FAIL_COLOR
            row_colors.append(("BACKGROUND", (3, i + 1), (3, i + 1), status_bg))

        tbl = Table(
            table_data,
            colWidths=[col_num, col_criteria, col_pts, col_status, col_reason],
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
            ("ALIGN",         (0, 0), (0, -1), "CENTER"),
            ("ALIGN",         (2, 0), (3, -1), "CENTER"),
        ] + row_colors
        tbl.setStyle(TableStyle(style_cmds))
        elements.append(tbl)

    else:
        # Multi-model summary table: No Reason column, one Status column per model
        max_rows = max(len(d.get("evaluations", [])) for _, d in entries)
        model_names = [d.get("model_name", k) for k, d in entries]

        col_num      = 10 * mm
        col_criteria = 65 * mm
        col_pts      = 10 * mm
        remaining_w  = page_width - col_num - col_criteria - col_pts
        col_status_w = remaining_w / len(entries)

        header_row = [
            Paragraph("No.", header_style),
            Paragraph("Criteria", header_style),
            Paragraph("Pts", header_style),
        ]
        for name in model_names:
            header_row.append(Paragraph(_escape_xml(name), header_style))

        col_widths = [col_num, col_criteria, col_pts] + [col_status_w] * len(entries)

        num_style_m = ParagraphStyle("num_sm_m", fontName="Helvetica-Bold", fontSize=7.5,
                                     leading=10, textColor=GRAY_700, alignment=1)
        total_style = ParagraphStyle("total_lbl", fontName="Helvetica-Bold", fontSize=9,
                                     leading=12, textColor=GRAY_800)

        table_data = [header_row]
        row_colors = [("BACKGROUND", (0, 0), (-1, 0), BRAND)]

        for i in range(max_rows):
            first_ev = (entries[0][1].get("evaluations") or [])[i] if i < len(entries[0][1].get("evaluations", [])) else None
            raw_criteria = first_ev.get("criteria", "—") if first_ev else "—"
            raw_pts = first_ev.get("points", 0) if first_ev else 0
            is_neg = raw_pts < 0

            rubric_label, criteria_text = _split_rubric_label(raw_criteria)

            if raw_pts < 0:
                pts_text = str(raw_pts)
            elif raw_pts > 0:
                pts_text = f"+{raw_pts}"
            else:
                pts_text = "0" if is_neg else "—"

            row = [
                Paragraph(_escape_xml(rubric_label or str(i + 1)), num_style_m),
                Paragraph(_escape_xml(criteria_text), body_sm),
                Paragraph(pts_text, body_sm),
            ]

            PENALTY_BG_M = colors.HexColor("#fff7ed")
            bg_row = PENALTY_BG_M if is_neg else (
                colors.HexColor("#ffffff") if i % 2 == 0 else colors.HexColor("#f9fafb")
            )
            row_colors.append(("BACKGROUND", (0, i + 1), (-1, i + 1), bg_row))

            col_idx = 3
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
                    row.append(status_para)
                else:
                    row.append(Paragraph("—", body_sm))
                col_idx += 1

            table_data.append(row)

        # Totals row
        totals_row = [
            Paragraph("", body_sm),
            Paragraph("Total Score", total_style),
            Paragraph("", body_sm),
        ]
        total_row_idx = len(table_data)
        for _, data in entries:
            s = data.get("summary", {})
            scored   = s.get("scored_points", 0)
            max_pts  = s.get("max_points", 0)
            pts_rate = s.get("points_rate", 0)
            rate_color = "#16a34a" if pts_rate >= 80 else "#ca8a04" if pts_rate >= 50 else "#dc2626"
            totals_row.append(Paragraph(
                f'<font name="Helvetica-Bold" color="{rate_color}">{scored}/{max_pts}</font>'
                f'<br/><font size="7" color="{rate_color}">({pts_rate}%)</font>',
                body_sm
            ))
        table_data.append(totals_row)
        row_colors.append(("BACKGROUND", (0, total_row_idx), (-1, total_row_idx), colors.HexColor("#eef2ff")))
        row_colors.append(("LINEABOVE",  (0, total_row_idx), (-1, total_row_idx), 1.2, BRAND))

        tbl = Table(table_data, colWidths=col_widths, repeatRows=1)
        style_cmds = [
            ("GRID",          (0, 0), (-1, -1), 0.4, GRAY_200),
            ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
            ("LEFTPADDING",   (0, 0), (-1, -1), 4),
            ("RIGHTPADDING",  (0, 0), (-1, -1), 4),
            ("TOPPADDING",    (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ("TEXTCOLOR",     (0, 0), (-1, 0), colors.white),
            ("ALIGN",         (0, 0), (0, -1), "CENTER"),
            ("ALIGN",         (2, 0), (-1, -1), "CENTER"),
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
