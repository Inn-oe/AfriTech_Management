"""Designed income statement and balance sheet PDFs, coloured to match each company's own logo."""
import colorsys
import io
from datetime import datetime

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from .pdfs import STYLES, esc

PAGE_W, PAGE_H = letter
MARGIN = 0.5 * inch
CONTENT_W = PAGE_W - 2 * MARGIN
BAND_H = 1.2 * inch
PRODUCT = 'SolarPilot'

DEFAULT_BRAND = '#0f7b5a'
INK = colors.HexColor('#1f2933')
MUTED = colors.HexColor('#6b7a8c')
RULE = colors.HexColor('#e3e8ee')
LOSS = colors.HexColor('#c0392b')


# ---------------------------------------------------------------------------
# Colour: taken from the company's logo, so every company's statements look like its own
# ---------------------------------------------------------------------------

def brand_color(company):
    """The most prominent strong, dark-enough colour in the company's logo (a default green when there is none)."""
    default = colors.HexColor(DEFAULT_BRAND)
    blob = company.logo
    if not blob:
        return default
    try:
        from PIL import Image
        im = Image.open(io.BytesIO(blob)).convert('RGBA')
        im.thumbnail((120, 120))
        raw = im.tobytes()
    except Exception:
        return default
    buckets = {}
    for i in range(0, len(raw), 4):
        r, g, b, a = raw[i:i + 4]
        if a < 200 or min(r, g, b) > 225:
            continue                                   # transparent or white background
        h, sat, val = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
        if sat < 0.35 or not 0.2 <= val <= 0.85:
            continue                                   # greys, blacks and pale colours do not make a header
        n, rs, gs, bs = buckets.get(int(h * 24) % 24, (0, 0, 0, 0))
        buckets[int(h * 24) % 24] = (n + 1, rs + r, gs + g, bs + b)
    if not buckets:
        return default
    n, rs, gs, bs = max(buckets.values(), key=lambda v: v[0])
    h, sat, val = colorsys.rgb_to_hsv(rs / n / 255, gs / n / 255, bs / n / 255)
    val = min(val, 0.55)                               # dark enough for white text on top of it
    return colors.Color(*colorsys.hsv_to_rgb(h, sat, val))


def _mix(color, other, amount):
    """`color` with `amount` (0-1) of `other` blended in."""
    return colors.Color(*[c * (1 - amount) + o * amount for c, o in zip(color.rgb(), other.rgb())])


def _tint(brand, amount=0.9):
    return _mix(brand, colors.white, amount)


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------

def _money(value):
    value = value or 0
    text = f'${abs(value):,.2f}'
    return f'({text})' if value < -0.004 else text


def _pct(part, whole):
    return f'{part / whole * 100:.1f}%' if whole else '—'


def _para(text, size=9.5, color=INK, bold=False, align=0, leading=None):
    style = ParagraphStyle('s', parent=STYLES['Normal'], fontName='Helvetica-Bold' if bold else 'Helvetica',
                           fontSize=size, textColor=color, alignment=align, leading=leading or size * 1.25)
    return Paragraph(text, style)


def _fit(text, font, size, max_width, min_size=10):
    while size > min_size and stringWidth(text, font, size) > max_width:
        size -= 0.5
    return size


def _page_decor(company, brand, title, subtitle):
    """Header band and footer, drawn on every page."""
    logo = None
    if company.logo:
        try:
            logo = ImageReader(io.BytesIO(company.logo))
        except Exception:
            logo = None
    contact = '   |   '.join(x.strip() for x in [company.phone, company.email, (company.address or '').replace('\n', ', ')]
                             if x and x.strip())

    def draw(canvas, doc):
        canvas.saveState()
        canvas.setFillColor(brand)
        canvas.rect(0, PAGE_H - BAND_H, PAGE_W, BAND_H, stroke=0, fill=1)
        canvas.setFillColor(_mix(brand, colors.white, 0.25))
        canvas.rect(0, PAGE_H - BAND_H - 3, PAGE_W, 3, stroke=0, fill=1)

        x = MARGIN
        if logo is not None:
            size = 0.8 * inch
            y = PAGE_H - BAND_H + (BAND_H - size) / 2
            canvas.setFillColor(colors.white)
            canvas.roundRect(x, y, size, size, 8, stroke=0, fill=1)
            canvas.drawImage(logo, x + 4, y + 4, size - 8, size - 8, preserveAspectRatio=True, mask='auto')
            x += size + 0.2 * inch
        right_w = 2.6 * inch
        name_w = PAGE_W - MARGIN - right_w - x - 0.2 * inch
        name = company.name or ''
        canvas.setFillColor(colors.white)
        font_size = _fit(name, 'Helvetica-Bold', 21, name_w)
        canvas.setFont('Helvetica-Bold', font_size)
        while stringWidth(name, 'Helvetica-Bold', font_size) > name_w and len(name) > 4:
            name = name[:-2]
        if name != company.name:
            name = name.rstrip() + '…'
        mid = PAGE_H - BAND_H / 2
        canvas.drawString(x, mid + (4 if contact else -4), name)
        if contact:
            canvas.setFillColor(_mix(brand, colors.white, 0.8))
            small = _fit(contact, 'Helvetica', 8.5, name_w, 6.5)
            canvas.setFont('Helvetica', small)
            text = contact
            while stringWidth(text, 'Helvetica', small) > name_w and len(text) > 4:
                text = text[:-2]
            canvas.drawString(x, mid - 12, text if text == contact else text.rstrip() + '…')

        canvas.setFillColor(colors.white)
        canvas.setFont('Helvetica-Bold', 15)
        canvas.drawRightString(PAGE_W - MARGIN, mid + 6, title.upper())
        canvas.setFillColor(_mix(brand, colors.white, 0.8))
        canvas.setFont('Helvetica', 10.5)
        canvas.drawRightString(PAGE_W - MARGIN, mid - 10, subtitle)

        canvas.setStrokeColor(RULE)
        canvas.setLineWidth(0.8)
        canvas.line(MARGIN, 0.62 * inch, PAGE_W - MARGIN, 0.62 * inch)
        canvas.setFillColor(MUTED)
        canvas.setFont('Helvetica', 8)
        canvas.drawString(MARGIN, 0.45 * inch, f'Prepared {datetime.now().strftime("%d %B %Y")} with {PRODUCT}')
        canvas.drawRightString(PAGE_W - MARGIN, 0.45 * inch, f'Page {doc.page}')
        canvas.restoreState()

    return draw


def _build(company, brand, title, subtitle, story):
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=letter, leftMargin=MARGIN, rightMargin=MARGIN,
                            topMargin=BAND_H + 0.35 * inch, bottomMargin=0.85 * inch,
                            title=f'{title} - {subtitle}', author=company.name or PRODUCT)
    decor = _page_decor(company, brand, title, subtitle)
    doc.build(story, onFirstPage=decor, onLaterPages=decor)
    buffer.seek(0)
    return buffer


def _tiles(brand, items):
    """A row of summary tiles: [(label, value_text, note, value_color)]."""
    n = len(items)
    gap = 0.14 * inch
    w = (CONTENT_W - gap * (n - 1)) / n
    cells, widths = [], []
    for i, (label, value, note, value_color) in enumerate(items):
        if i:
            cells.append('')
            widths.append(gap)
        cells.append([_para(label.upper(), 7.5, MUTED, bold=True), Spacer(1, 3),
                      _para(value, 16, value_color or brand, bold=True, leading=19),
                      _para(note or '&nbsp;', 8, MUTED)])
        widths.append(w)
    table = Table([cells], colWidths=widths)
    style = [('VALIGN', (0, 0), (-1, -1), 'TOP'), ('TOPPADDING', (0, 0), (-1, -1), 9),
             ('BOTTOMPADDING', (0, 0), (-1, -1), 9), ('LEFTPADDING', (0, 0), (-1, -1), 12),
             ('RIGHTPADDING', (0, 0), (-1, -1), 8)]
    for col in range(0, len(cells), 2):
        style += [('BACKGROUND', (col, 0), (col, 0), _tint(brand, 0.93)),
                  ('LINEBEFORE', (col, 0), (col, 0), 3, brand)]
    for col in range(1, len(cells), 2):
        style += [('LEFTPADDING', (col, 0), (col, 0), 0), ('RIGHTPADDING', (col, 0), (col, 0), 0)]
    table.setStyle(TableStyle(style))
    return table


def _statement_table(brand, header, rows, widths):
    """rows: dicts with kind = section | line | sub | total | grand | note and `cells` (label first)."""
    data = [[_para(h, 8, colors.white, bold=True, align=0 if i == 0 else 2) for i, h in enumerate(header)]]
    style = [
        ('BACKGROUND', (0, 0), (-1, 0), brand), ('TOPPADDING', (0, 0), (-1, 0), 7), ('BOTTOMPADDING', (0, 0), (-1, 0), 7),
        ('LEFTPADDING', (0, 0), (-1, -1), 10), ('RIGHTPADDING', (0, 0), (-1, -1), 10),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
    ]
    for r, row in enumerate(rows, start=1):
        kind, cells = row['kind'], row['cells']
        bold = kind in ('sub', 'total', 'grand')
        if kind == 'section':
            data.append([_para(cells[0].upper(), 8.5, brand, bold=True)] + [''] * (len(header) - 1))
            style += [('BACKGROUND', (0, r), (-1, r), _tint(brand, 0.9)), ('SPAN', (0, r), (-1, r)),
                      ('TOPPADDING', (0, r), (-1, r), 6), ('BOTTOMPADDING', (0, r), (-1, r), 6)]
            continue
        if kind == 'note':
            data.append([_para(cells[0], 8.5, MUTED)] + [''] * (len(header) - 1))
            style += [('SPAN', (0, r), (-1, r)), ('TOPPADDING', (0, r), (-1, r), 5), ('BOTTOMPADDING', (0, r), (-1, r), 5),
                      ('LEFTPADDING', (0, r), (0, r), 24)]
            continue
        text_color = colors.white if kind == 'grand' else (MUTED if kind == 'detail' else INK)
        out = [_para(esc(cells[0]), 10 if bold else 9.5, text_color, bold=bold)]
        for value, raw in zip(cells[1:], row.get('raw', [None] * (len(cells) - 1))):
            color = text_color
            if kind != 'grand' and raw is not None and raw < -0.004:
                color = LOSS
            out.append(_para(value, 10 if bold else 9.5, color, bold=bold, align=2))
        data.append(out)
        style += [('TOPPADDING', (0, r), (-1, r), 6 if bold else 5), ('BOTTOMPADDING', (0, r), (-1, r), 6 if bold else 5)]
        if kind == 'line':
            style += [('LEFTPADDING', (0, r), (0, r), 24), ('LINEBELOW', (0, r), (-1, r), 0.5, RULE)]
        elif kind == 'detail':
            style += [('LEFTPADDING', (0, r), (0, r), 42), ('LINEBELOW', (0, r), (-1, r), 0.5, RULE),
                      ('TOPPADDING', (0, r), (-1, r), 3), ('BOTTOMPADDING', (0, r), (-1, r), 3)]
        elif kind == 'sub':
            style += [('LINEABOVE', (0, r), (-1, r), 0.8, brand), ('BACKGROUND', (0, r), (-1, r), _tint(brand, 0.96))]
        elif kind == 'total':
            style += [('LINEABOVE', (0, r), (-1, r), 1, INK), ('BACKGROUND', (0, r), (-1, r), _tint(brand, 0.93))]
        elif kind == 'grand':
            style += [('BACKGROUND', (0, r), (-1, r), brand), ('TOPPADDING', (0, r), (-1, r), 9),
                      ('BOTTOMPADDING', (0, r), (-1, r), 9)]
    table = Table(data, colWidths=widths, repeatRows=1)
    table.setStyle(TableStyle(style))
    return table


def _section(label):
    return {'kind': 'section', 'cells': [label]}


def _merge(month_rows, ytd_rows):
    """[(category, amount)] for the month and year to date -> [(category, month, ytd)], biggest first."""
    month, ytd = dict(month_rows), dict(ytd_rows)
    names = sorted(set(month) | set(ytd), key=lambda n: (-(ytd.get(n) or 0), n))
    return [(n, month.get(n, 0), ytd.get(n, 0)) for n in names]


# ---------------------------------------------------------------------------
# Income statement
# ---------------------------------------------------------------------------

def income_statement_pdf(company, start, month_fig, ytd_fig):
    """month_fig / ytd_fig: dicts with stock, service, revenue, other [(cat, amt)], cogs, expenses [(cat, amt)]."""
    brand = brand_color(company)
    period = start.strftime('%B %Y')
    ytd_label = f'Jan – {start.strftime("%b %Y")}' if start.month > 1 else f'Jan {start.year}'

    def totals(f):
        other = sum(a for _, a in f['other'])
        expenses = sum(a for _, a in f['expenses'])
        total_rev = f['revenue'] + other
        gross = total_rev - f['cogs']
        return dict(other=other, expenses=expenses, total_rev=total_rev, gross=gross, net=gross - expenses)

    m, y = totals(month_fig), totals(ytd_fig)
    rev = m['total_rev']

    def line(label, mv, yv, kind='line', pct=True):
        return {'kind': kind, 'cells': [label, _money(mv), _pct(mv, rev) if pct else '', _money(yv)], 'raw': [mv, None, yv]}

    rows = [_section('Revenue')]
    rows.append(line('Sales of stock items', month_fig['stock'], ytd_fig['stock']))
    rows.append(line('Services and labour', month_fig['service'], ytd_fig['service']))
    adj_m = month_fig['revenue'] - month_fig['stock'] - month_fig['service']
    adj_y = ytd_fig['revenue'] - ytd_fig['stock'] - ytd_fig['service']
    if abs(adj_m) > 0.004 or abs(adj_y) > 0.004:
        rows.append(line('Other invoice charges and adjustments', adj_m, adj_y))
    for name, mv, yv in _merge(month_fig['other'], ytd_fig['other']):
        rows.append(line(name, mv, yv))
    rows.append(line('Total revenue', m['total_rev'], y['total_rev'], 'sub'))
    rows.append(_section('Cost of goods sold'))
    rows.append(line('Cost of items sold', month_fig['cogs'], ytd_fig['cogs']))
    rows.append(line('Gross profit', m['gross'], y['gross'], 'total'))
    rows.append(_section('Operating expenses'))
    expense_rows = _merge(month_fig['expenses'], ytd_fig['expenses'])
    if expense_rows:
        for name, mv, yv in expense_rows:
            rows.append(line(name, mv, yv))
    else:
        rows.append({'kind': 'note', 'cells': ['No expenses recorded yet. Add wages, fuel, transport and other costs under '
                                               'Finance &amp; Payments → Income &amp; expenses.']})
    rows.append(line('Total operating expenses', m['expenses'], y['expenses'], 'sub'))
    rows.append(line('Net profit', m['net'], y['net'], 'grand'))

    story = [
        _tiles(brand, [
            ('Total revenue', _money(m['total_rev']), f'Year to date {_money(y["total_rev"])}', None),
            ('Gross profit', _money(m['gross']), f'{_pct(m["gross"], rev)} of revenue', None),
            ('Operating expenses', _money(m['expenses']), f'{_pct(m["expenses"], rev)} of revenue', None),
            ('Net profit', _money(m['net']), f'{_pct(m["net"], rev)} margin', LOSS if m['net'] < -0.004 else None),
        ]),
        Spacer(1, 0.22 * inch),
        _statement_table(brand, ['', period, '% of revenue', ytd_label], rows,
                         [3.2 * inch, 1.6 * inch, 1.1 * inch, 1.6 * inch]),
        Spacer(1, 0.16 * inch),
        _para('Accrual basis: revenue is counted when an invoice is raised, and cost of goods sold is the cost price of '
              'the items on those invoices. Operating expenses are the expenses recorded in the period.', 8, MUTED),
    ]
    return _build(company, brand, 'Income Statement', period, story)


# ---------------------------------------------------------------------------
# Balance sheet
# ---------------------------------------------------------------------------

def balance_sheet_pdf(company, end_day, inventory_by_category, receivables, open_invoices, liabilities):
    """inventory_by_category: [(category, value)]; end_day: the date the sheet is 'as at'."""
    brand = brand_color(company)
    inventory = sum(v for _, v in inventory_by_category)
    assets = inventory + receivables
    equity = assets - liabilities

    def line(label, value, kind='line', pct=True):
        return {'kind': kind, 'cells': [label, _money(value), _pct(value, assets) if pct else ''], 'raw': [value, None]}

    rows = [_section('Assets'), line('Inventory (stock on hand)', inventory)]
    shown = sorted(inventory_by_category, key=lambda kv: -kv[1])
    for name, value in shown[:6]:
        rows.append({'kind': 'detail', 'cells': [name or 'Uncategorised', _money(value), _pct(value, assets)],
                     'raw': [value, None]})
    if len(shown) > 6:
        rest = sum(v for _, v in shown[6:])
        rows.append({'kind': 'detail', 'cells': [f'Other categories ({len(shown) - 6})', _money(rest), _pct(rest, assets)],
                     'raw': [rest, None]})
    owed = f'Accounts receivable ({open_invoices} unpaid invoice{"s" if open_invoices != 1 else ""})' \
        if open_invoices else 'Accounts receivable'
    rows += [line(owed, receivables), line('Total assets', assets, 'sub'),
             _section('Liabilities'), line('Loans and credit', liabilities),
             line('Total liabilities', liabilities, 'sub'),
             _section('Equity'), line("Owner's equity (assets less liabilities)", equity),
             line('Total liabilities and equity', liabilities + equity, 'grand')]

    story = [
        _tiles(brand, [
            ('Total assets', _money(assets), f'Inventory {_pct(inventory, assets)}' if assets else None, None),
            ('Total liabilities', _money(liabilities), _pct(liabilities, assets) + ' of assets' if assets else None, None),
            ("Owner's equity", _money(equity), _pct(equity, assets) + ' of assets' if assets else None,
             LOSS if equity < -0.004 else None),
        ]),
        Spacer(1, 0.22 * inch),
        _statement_table(brand, ['', f'As at {end_day.strftime("%d %B %Y")}', '% of total assets'], rows,
                         [4.3 * inch, 1.9 * inch, 1.3 * inch]),
        Spacer(1, 0.16 * inch),
        _para('Assets equal liabilities plus equity. Inventory is valued at cost price (or the selling price where no cost is '
              'recorded) using the stock levels recorded today. Accounts receivable is the unpaid balance on invoices '
              'raised up to this date. Cash and bank balances are not tracked in this system.', 8, MUTED),
    ]
    return _build(company, brand, 'Balance Sheet', f'As at {end_day.strftime("%d %B %Y")}', story)
