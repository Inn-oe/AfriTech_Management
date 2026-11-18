"""PDF documents (quotations, invoices, receipts, financial statements)."""
import io
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (HRFlowable, Image, Paragraph, SimpleDocTemplate, Spacer,
                                Table, TableStyle)

STYLES = getSampleStyleSheet()
ITEM_COLS = [0.4 * inch, 1.1 * inch, 3.0 * inch, 0.7 * inch, 1 * inch, 1.3 * inch]


def money(value):
    return f'${(value or 0):,.2f}'


def esc(value):
    return escape(str(value)) if value is not None else ''


def customer_name(customer):
    if not customer:
        return 'Unknown customer'
    return f"{customer.name} {customer.surname or ''}".strip()


def safe_filename(text):
    return ''.join(c for c in text if c.isalnum() or c == ' ').strip().replace(' ', '_')


def _build(story):
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=letter, topMargin=0.5 * inch, bottomMargin=0.5 * inch,
                            leftMargin=0.5 * inch, rightMargin=0.5 * inch)
    doc.build(story)
    buffer.seek(0)
    return buffer


def _lines(text):
    """Multi-line free text -> bold, escaped paragraph markup."""
    return '<br/>'.join(f'<b>{esc(line.strip())}</b>' for line in (text or '').splitlines() if line.strip())


def _logo(company):
    """The company logo as a flowable, or None (no logo, or a file reportlab cannot read)."""
    blob = company.logo
    if not blob:
        return None
    try:
        return Image(io.BytesIO(blob), width=1.2 * inch, height=1.2 * inch, kind='proportional')
    except Exception:
        return None


def _letterhead(company, title, number):
    name_style = ParagraphStyle('company', parent=STYLES['h1'], fontSize=22, textColor=colors.red, leading=26)
    small = ParagraphStyle('small', parent=STYLES['Normal'], fontSize=9, leading=11)
    small_right = ParagraphStyle('small_right', parent=small, alignment=2)
    contact = _lines(chr(10).join(filter(None, [company.phone, company.email])))
    name = Paragraph(f'<b>{esc(company.name)}</b>', name_style)
    logo = _logo(company)
    if logo is not None:
        # logo on the left over both rows, name across the top, contact details and address underneath
        header = Table([
            [logo, name, ''],
            ['', Paragraph(contact, small), Paragraph(_lines(company.address), small_right)],
        ], colWidths=[1.3 * inch, 3.5 * inch, 2.7 * inch])
        header.setStyle(TableStyle([
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('SPAN', (0, 0), (0, 1)),
            ('SPAN', (1, 0), (2, 0)),
            ('ALIGN', (2, 1), (2, 1), 'RIGHT'),
        ]))
    else:
        header = Table([
            [name, ''],
            [Paragraph(contact, small), Paragraph(_lines(company.address), small_right)],
        ], colWidths=[4.3 * inch, 3.2 * inch])
        header.setStyle(TableStyle([
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('SPAN', (0, 0), (1, 0)),
            ('ALIGN', (1, 1), (1, 1), 'RIGHT'),
        ]))
    title_style = ParagraphStyle('doc_title', parent=STYLES['h2'], fontSize=16, spaceAfter=8)
    return [
        header,
        Spacer(1, 0.1 * inch),
        HRFlowable(width='100%', thickness=1.5, color=colors.red),
        Spacer(1, 0.2 * inch),
        Paragraph(title, title_style),
        Paragraph(esc(number), STYLES['Normal']),
        Spacer(1, 0.2 * inch),
    ]


def _detail(label, value):
    style = ParagraphStyle('detail', parent=STYLES['Normal'], fontSize=12, spaceAfter=10, leading=16)
    return Paragraph(f'<b>{label}:</b> {esc(value)}', style)


def _banking(company):
    if not (company.banking_details or '').strip():
        return []
    style = ParagraphStyle('banking', parent=STYLES['Normal'], spaceBefore=20, fontSize=10)
    details = '<br/>'.join(esc(line.strip()) for line in company.banking_details.splitlines() if line.strip())
    return [Paragraph('<b>Banking Details</b>', style), Paragraph(details, STYLES['Normal'])]


def _items_table(rows):
    data = [['Sr', 'Item Code', 'Description', 'Quantity', 'Price', 'Total Amount']]
    for i, (code, desc, qty, price) in enumerate(rows, start=1):
        data.append([str(i), Paragraph(esc(code or 'N/A'), STYLES['Normal']),
                     Paragraph(esc(desc or 'N/A'), STYLES['Normal']), str(qty),
                     money(price), money(qty * price)])
    table = Table(data, colWidths=ITEM_COLS, repeatRows=1)
    table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.lightgrey),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('ALIGN', (3, 0), (-1, -1), 'RIGHT'),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('TOPPADDING', (0, 0), (-1, 0), 12),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
        ('BACKGROUND', (0, 1), (-1, -1), colors.whitesmoke),
        ('GRID', (0, 0), (-1, -1), 1, colors.black),
        ('FONTSIZE', (0, 0), (-1, -1), 10),
    ]))
    return table


def _totals_table(rows):
    data = [['', '', '', '', label, money(value)] for label, value in rows]
    table = Table(data, colWidths=ITEM_COLS)
    style = [('ALIGN', (4, 0), (-1, -1), 'RIGHT'), ('FONTNAME', (4, 0), (-1, -1), 'Helvetica-Bold')]
    if len(rows) > 1:
        style.append(('LINEABOVE', (4, len(rows) - 1), (-1, len(rows) - 1), 1, colors.black))
    table.setStyle(TableStyle(style))
    return table


def _item_rows(items):
    rows = []
    for item in items:
        desc = item.description
        if (not desc or desc == item.item_code) and item.inventory:
            desc = item.inventory.name
        code = item.item_code or (item.inventory.specifications if item.inventory else None)
        rows.append((code, desc, item.quantity, item.unit_price))
    return rows


def quotation_pdf(company, q):
    story = _letterhead(company, 'Quotation', q.quotation_number or f'QTN-{q.id:05d}')
    story += [_detail('Customer', customer_name(q.customer)),
              _detail('Date', q.date_created.strftime('%d-%m-%Y')),
              Spacer(1, 0.2 * inch),
              _items_table(_item_rows(q.items)),
              Spacer(1, 0.2 * inch),
              _totals_table([('Net Price:', q.total_amount)]),
              Spacer(1, 0.4 * inch)]
    story += _banking(company)
    return _build(story), f'Quotation_{q.quotation_number or q.id}.pdf'


def invoice_pdf(company, inv):
    story = _letterhead(company, 'Tax Invoice', inv.invoice_number or f'INV-{inv.id:05d}')
    story += [_detail('Customer', customer_name(inv.customer)),
              _detail('Date', inv.date_created.strftime('%d-%m-%Y')),
              _detail('Status', inv.status.value if inv.status else ''),
              Spacer(1, 0.2 * inch),
              _items_table(_item_rows(inv.items)),
              Spacer(1, 0.2 * inch),
              _totals_table([('Total:', inv.total_amount), ('Paid:', inv.paid_amount),
                             ('Balance:', inv.balance_due)]),
              Spacer(1, 0.4 * inch)]
    story += _banking(company)
    name = safe_filename(customer_name(inv.customer))
    return _build(story), f'Invoice_{inv.invoice_number or inv.id}_{name}.pdf'


def receipt_pdf(company, payment):
    invoice = payment.invoice
    customer = invoice.customer if invoice else None
    story = _letterhead(company, 'Payment Receipt', f'RCPT-{payment.id:05d}')
    story += [_detail('Received From', payment.payer_name or customer_name(customer)),
              _detail('Transaction ID', payment.transaction_id or 'N/A'),
              _detail('Date', payment.payment_date.strftime('%d-%m-%Y')),
              _detail('Payment Method', payment.payment_method.value if payment.payment_method else '')]
    if payment.reference_number:
        story.append(_detail('Reference', payment.reference_number))
    story.append(Spacer(1, 0.2 * inch))
    if invoice:
        story.append(_detail('Payment For', f'Invoice {invoice.invoice_number or invoice.id}'))
    if payment.notes:
        story.append(_detail('Notes', payment.notes))
    story.append(Spacer(1, 0.2 * inch))

    amount = Table([['Amount Received', money(payment.amount)]], colWidths=[2 * inch, 2 * inch])
    amount.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), colors.lightgrey),
        ('ALIGN', (1, 0), (1, 0), 'RIGHT'),
        ('FONTNAME', (0, 0), (-1, -1), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 14),
        ('TOPPADDING', (0, 0), (-1, -1), 12),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 12),
        ('BOX', (0, 0), (-1, -1), 1, colors.black),
    ]))
    story += [amount, Spacer(1, 0.4 * inch), Paragraph('Thank you for your business!', STYLES['Normal'])]
    name = safe_filename(customer_name(customer))
    return _build(story), f'Payment_{payment.id}_{name}.pdf'


def statement_pdf(company, title, rows):
    """Simple two-column financial statement (income statement / balance sheet)."""
    title_style = ParagraphStyle('stmt_title', parent=STYLES['Heading1'], fontSize=16,
                                 spaceAfter=18, alignment=1)
    data = [[label, money(value) if value is not None else ''] for label, value in rows]
    table = Table(data, colWidths=[260, 140])
    table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.grey),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('ALIGN', (1, 0), (-1, -1), 'RIGHT'),
        ('FONTSIZE', (0, 0), (-1, -1), 10),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
        ('BACKGROUND', (0, 1), (-1, -1), colors.beige),
        ('GRID', (0, 0), (-1, -1), 1, colors.black),
    ]))
    name_style = ParagraphStyle('stmt_company', parent=STYLES['Heading2'], alignment=1)
    return _build([Paragraph(esc(company.name), name_style), Paragraph(esc(title), title_style),
                   Spacer(1, 12), table])
