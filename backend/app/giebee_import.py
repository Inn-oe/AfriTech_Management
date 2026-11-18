"""One-off copy of the original Giebee Engineering installation into a company of this platform.

The original system kept one company's data in a database of its own. This reads that database (never writes
to it) and creates the same records under the company called "Giebee Engineering" here, in one transaction:
either everything is copied or nothing is.

How to run it (on the Render service, no shell needed):
  1. Sign up on the platform with the company name "Giebee Engineering".
  2. Set GIEBEE_IMPORT_SOURCE_URL to the original database's *external* connection string and redeploy/restart.
  3. Read the result in the service log ("Giebee import: ..."), then delete the variable.
Running it again is harmless: a company that already has customers, quotations or invoices is left alone.

  GIEBEE_IMPORT_SOURCE_URL   connection string of the original database (read only)
  GIEBEE_IMPORT_COMPANY      company name to copy into (default "Giebee Engineering")
"""
import logging
import os
import threading
from datetime import datetime

from sqlalchemy import create_engine, func, text

from .database import db_session
from .models import (Activity, ActivityType, ActivityStatusEnum, Company, Currency, Customer, FinancialRecord,
                     FinancialType, Inventory, Invoice, InvoiceItem, InvoiceStatus, PaymentType, Payment,
                     StockChangeReason, StockTransaction, Supplier, TransactionType, quotation, quotationItem)

log = logging.getLogger('erp.giebee_import')

SOURCE_ENV = 'GIEBEE_IMPORT_SOURCE_URL'
COMPANY_ENV = 'GIEBEE_IMPORT_COMPANY'
DEFAULT_COMPANY = 'Giebee Engineering'


class ImportProblem(Exception):
    """Something the person running the import can fix (message is shown in the log)."""


def _fit(model, values):
    """Cut text to the column length so one long value cannot stop the whole copy."""
    out = {}
    for key, value in values.items():
        length = getattr(getattr(model, key).type, 'length', None)
        if isinstance(value, str) and length and len(value) > length:
            value = value[:length]
        out[key] = value
    return out


def _enum(cls, value, default=None):
    if value is None:
        return default
    text_value = str(value).strip()
    for member in cls:
        if text_value.upper() in (member.name.upper(), str(member.value).upper()):
            return member
    return default


def _num(value, default=0.0):
    try:
        return float(value) if value is not None else default
    except (TypeError, ValueError):
        return default


def _int(value, default=0):
    try:
        return int(value) if value is not None else default
    except (TypeError, ValueError):
        return default


def _clean(value):
    if isinstance(value, str):
        value = value.strip()
        return value or None
    return value


class _Unique:
    """Hands out values that are not used yet in the whole database (document numbers are unique across companies)."""

    def __init__(self, column):
        self.used = {v for (v,) in db_session.query(column) if v is not None}

    def take(self, value, tag='G'):
        if value is None:
            return None
        candidate, n = value, 0
        while candidate in self.used:
            n += 1
            candidate = f'{value}-{tag}{n}'
        self.used.add(candidate)
        return candidate


def _rows(conn, table):
    return [dict(r) for r in conn.execute(text(f'SELECT * FROM {table} ORDER BY id')).mappings()]


def find_company(name, company_id=None):
    q = db_session.query(Company)
    if company_id:
        company = q.filter(Company.id == company_id).first()
    else:
        matches = q.filter(func.lower(Company.name) == name.lower()).order_by(Company.id).all()
        if len(matches) > 1:
            raise ImportProblem(f'{len(matches)} companies are called "{name}"; remove duplicates or set a company id.')
        company = matches[0] if matches else None
    if company is None:
        raise ImportProblem(f'No company called "{name}" yet. Sign up on the platform with that company name first.')
    return company


def import_company_data(source_url, company_name=DEFAULT_COMPANY, company_id=None):
    """Copy the original installation into the company. Returns {table: rows copied, ...} (empty = nothing to do)."""
    company = find_company(company_name, company_id)
    cid = company.id
    for model in (Customer, quotation, Invoice):
        if db_session.query(model).filter_by(company_id=cid).first():
            log.info('Giebee import: company "%s" already has data; nothing copied.', company.name)
            return {}

    src = create_engine(source_url)
    counts, skipped = {}, {}
    try:
        with src.connect() as conn:
            if src.dialect.name == 'postgresql':
                conn.execute(text('SET TRANSACTION READ ONLY'))
            data = {t: _rows(conn, t) for t in (
                'suppliers', 'customers', 'inventory', 'stock_transactions', 'activity_types', 'activities',
                'quotations', 'quotation_items', 'invoices', 'invoice_items', 'payments', 'financial_records')}

        q_numbers, i_numbers = _Unique(quotation.quotation_number), _Unique(Invoice.invoice_number)
        tx_ids, cust_ids = _Unique(Payment.transaction_id), _Unique(Customer.identification_number)
        supplier_map, inv_map, type_map, act_map = {}, {}, {}, {}
        cust_map, q_map, invoice_map = {}, {}, {}

        def add(model, **values):
            obj = model(company_id=cid, **_fit(model, values))
            db_session.add(obj)
            db_session.flush()
            return obj

        for r in data['suppliers']:
            s = add(Supplier, name=_clean(r['name']) or 'Supplier', contact_person=_clean(r.get('contact_person')),
                    phone=_clean(r.get('phone')), email=_clean(r.get('email')), address=_clean(r.get('address')),
                    payment_terms=_clean(r.get('payment_terms')), notes=_clean(r.get('notes')),
                    currency=_enum(Currency, r.get('currency'), Currency.USD), date_created=r.get('date_created'))
            supplier_map[r['id']] = s.id
        counts['suppliers'] = len(supplier_map)

        for r in data['customers']:
            key = cust_ids.take(_clean(r.get('identification_number')) or f'G{r["id"]}', 'G')
            add(Customer, identification_number=key, name=_clean(r['name']) or 'Customer',
                surname=_clean(r.get('surname')), citizenship=_clean(r.get('citizenship')),
                address=_clean(r.get('address')), phone=_clean(r.get('phone')), email=_clean(r.get('email')),
                date_created=r.get('date_created'))
            cust_map[_clean(r.get('identification_number')) or f'G{r["id"]}'] = key
        counts['customers'] = len(cust_map)

        for r in data['inventory']:
            i = add(Inventory, name=_clean(r['name']) or 'Item', brand=_clean(r.get('brand')),
                    category=_clean(r.get('category')), specifications=_clean(r.get('specifications')),
                    quantity=_int(r.get('quantity')), unit_price=_num(r.get('unit_price')),
                    cost_price=_num(r.get('cost_price')), supplier_id=supplier_map.get(r.get('supplier_id')),
                    minimum_stock_level=_int(r.get('minimum_stock_level'), 5), notes=_clean(r.get('notes')),
                    date_created=r.get('date_created'), date_updated=r.get('date_updated'))
            inv_map[r['id']] = i.id
        counts['inventory'] = len(inv_map)

        for r in data['stock_transactions']:
            add(StockTransaction, inventory_id=inv_map.get(r.get('inventory_id')),
                transaction_type=_enum(TransactionType, r.get('transaction_type'), TransactionType.ADJUSTMENT),
                quantity=_int(r.get('quantity')), unit_price=_num(r.get('unit_price'), None),
                total_value=_num(r.get('total_value'), None), currency=_enum(Currency, r.get('currency'), Currency.USD),
                reason=_enum(StockChangeReason, r.get('reason')), reference_type=_clean(r.get('reference_type')),
                customer_name=_clean(r.get('customer_name')), notes=_clean(r.get('notes')),
                created_by=_clean(r.get('created_by')), date_created=r.get('date_created'))
        counts['stock_transactions'] = len(data['stock_transactions'])

        for r in data['activity_types']:
            t = add(ActivityType, name=_clean(r['name']) or 'Job', description=_clean(r.get('description')),
                    is_active=bool(r.get('is_active', True)), date_created=r.get('date_created'))
            type_map[r['id']] = t.id
        counts['activity_types'] = len(type_map)

        for r in data['activities']:
            a = add(Activity, customer_id=cust_map.get(_clean(r.get('customer_id'))),
                    activity_type_id=type_map.get(r.get('activity_type_id')), description=_clean(r.get('description')),
                    status=_enum(ActivityStatusEnum, r.get('status'), ActivityStatusEnum.SCHEDULED), date=r.get('date'),
                    completed_date=r.get('completed_date'), technician=_clean(r.get('technician')),
                    equipment_used=_clean(r.get('equipment_used')), labor_hours=r.get('labor_hours'),
                    labor_cost=r.get('labor_cost'), material_cost=r.get('material_cost'), total_cost=r.get('total_cost'),
                    currency=_enum(Currency, r.get('currency'), Currency.USD), notes=_clean(r.get('notes')),
                    date_created=r.get('date_created'))
            act_map[r['id']] = a.id
        counts['activities'] = len(act_map)

        for r in data['quotations']:
            q = add(quotation, customer_id=cust_map.get(_clean(r.get('customer_id'))),
                    total_amount=_num(r.get('total_amount')), tax_amount=_num(r.get('tax_amount')),
                    discount_amount=_num(r.get('discount_amount')), status=(_clean(r.get('status')) or 'PENDING').upper(),
                    due_date=r.get('due_date'), paid_date=r.get('paid_date'), notes=_clean(r.get('notes')),
                    quotation_number=q_numbers.take(_clean(r.get('quotation_number'))), date_created=r.get('date_created'))
            q_map[r['id']] = q.id
        counts['quotations'] = len(q_map)

        n = 0
        for r in data['quotation_items']:
            if r.get('quotation_id') not in q_map:
                skipped['quotation_items (no quotation)'] = skipped.get('quotation_items (no quotation)', 0) + 1
                continue
            add(quotationItem, quotation_id=q_map[r['quotation_id']], inventory_id=inv_map.get(r.get('inventory_id')),
                quantity=_int(r.get('quantity'), 1), unit_price=_num(r.get('unit_price')),
                description=_clean(r.get('description')), item_code=_clean(r.get('item_code')))
            n += 1
        counts['quotation_items'] = n

        for r in data['invoices']:
            total, paid = _num(r.get('total_amount')), _num(r.get('paid_amount'))
            inv = add(Invoice, customer_id=cust_map.get(_clean(r.get('customer_id'))),
                      activity_type_id=type_map.get(r.get('activity_type_id')),
                      quotation_id=q_map.get(r.get('quotation_id')), total_amount=total, paid_amount=paid,
                      balance_due=_num(r.get('balance_due'), max(total - paid, 0.0)),
                      status=_enum(InvoiceStatus, r.get('status'), InvoiceStatus.DRAFT), due_date=r.get('due_date'),
                      notes=_clean(r.get('notes')), invoice_number=i_numbers.take(_clean(r.get('invoice_number'))),
                      date_created=r.get('date_created'))
            invoice_map[r['id']] = inv.id
        counts['invoices'] = len(invoice_map)

        n = 0
        for r in data['invoice_items']:
            if r.get('invoice_id') not in invoice_map:
                skipped['invoice_items (no invoice)'] = skipped.get('invoice_items (no invoice)', 0) + 1
                continue
            qty, price = _int(r.get('quantity'), 1), _num(r.get('unit_price'))
            add(InvoiceItem, invoice_id=invoice_map[r['invoice_id']], inventory_id=inv_map.get(r.get('inventory_id')),
                item_code=_clean(r.get('item_code')), description=_clean(r.get('description')), quantity=qty,
                unit_price=price, cost_price=_num(r.get('cost_price')), amount=_num(r.get('amount'), qty * price))
            n += 1
        counts['invoice_items'] = n

        n = 0
        for r in data['payments']:
            if r.get('invoice_id') not in invoice_map:
                skipped['payments (no invoice)'] = skipped.get('payments (no invoice)', 0) + 1
                continue
            add(Payment, invoice_id=invoice_map[r['invoice_id']], amount=_num(r.get('amount')),
                payment_date=r.get('payment_date'), payment_method=_enum(PaymentType, r.get('payment_method'), PaymentType.CASH),
                payer_name=_clean(r.get('payer_name')), reference_number=_clean(r.get('reference_number')),
                transaction_id=tx_ids.take(_clean(r.get('transaction_id'))), notes=_clean(r.get('notes')),
                date_created=r.get('date_created'))
            n += 1
        counts['payments'] = n

        for r in data['financial_records']:
            add(FinancialRecord, type=_enum(FinancialType, r.get('type'), FinancialType.INCOME),
                category=_clean(r.get('category')), description=_clean(r.get('description')),
                amount=_num(r.get('amount')), date=r.get('date'), receipt_number=_clean(r.get('receipt_number')),
                vendor_supplier=_clean(r.get('vendor_supplier')),
                reference_id=invoice_map.get(r.get('reference_id')), notes=_clean(r.get('notes')),
                date_created=r.get('date_created'))
        counts['financial_records'] = len(data['financial_records'])

        db_session.commit()
    except Exception:
        db_session.rollback()
        raise
    finally:
        src.dispose()

    log.info('Giebee import into "%s" (company %s) finished: %s%s', company.name, cid,
             ', '.join(f'{k} {v}' for k, v in counts.items()),
             f'; skipped: {skipped}' if skipped else '')
    return counts


def run_from_env():
    """Called at start-up. Does nothing unless GIEBEE_IMPORT_SOURCE_URL is set."""
    url = os.environ.get(SOURCE_ENV, '').strip()
    if not url:
        return
    name = os.environ.get(COMPANY_ENV, '').strip() or DEFAULT_COMPANY
    try:
        import_company_data(url, name)
    except ImportProblem as exc:
        log.warning('Giebee import: %s', exc)
    except Exception:
        log.exception('Giebee import failed; nothing was copied. It will be tried again at the next start.')
    finally:
        db_session.remove()


def start_in_background():
    """Run the import without delaying start-up (the platform's health check must answer quickly)."""
    if os.environ.get(SOURCE_ENV, '').strip():
        threading.Thread(target=run_from_env, daemon=True, name='giebee-import').start()
