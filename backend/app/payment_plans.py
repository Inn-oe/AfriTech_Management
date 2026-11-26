"""Payment plans: a customer who cannot pay an invoice in full agrees to pay the balance in monthly instalments.

A plan splits the balance (what is still owed when the plan is made) into equal monthly instalments. Money paid after
that is counted against the instalments in order, oldest first. An instalment that is past its due date and not fully
paid makes the invoice overdue.
"""
import calendar
from datetime import datetime

from .models import InvoiceStatus

MAX_MONTHS = 60


def add_months(day, months):
    """The same day of the month `months` later (or the last day of a shorter month: 31 Jan + 1 month = 28 Feb)."""
    year, month0 = divmod(day.month - 1 + months, 12)
    year += day.year
    month = month0 + 1
    return day.replace(year=year, month=month, day=min(day.day, calendar.monthrange(year, month)[1]))


def build_schedule(balance, months, first_due):
    """[(due date, amount)]: equal monthly instalments, the last one absorbing any rounding."""
    base = int(balance * 100 // months) / 100
    amounts = [base] * (months - 1) + [round(balance - base * (months - 1), 2)]
    return [(add_months(first_due, i), amount) for i, amount in enumerate(amounts)]


def plan_view(inv, today=None):
    """The schedule with what has been paid against each instalment, or None when the invoice has no plan."""
    today = today or datetime.now()
    instalments = sorted(inv.installments, key=lambda i: i.number)
    if not instalments:
        return None
    covered = max(0.0, round((inv.paid_amount or 0) - (inv.plan_base_paid or 0), 2))
    before, rows, next_due, overdue_amount, overdue_since = 0.0, [], None, 0.0, None
    for item in instalments:
        paid = min(item.amount, max(0.0, round(covered - before, 2)))
        before = round(before + item.amount, 2)
        outstanding = round(item.amount - paid, 2)
        open_ = outstanding > 0.004
        late = open_ and item.due_date.date() < today.date()
        if late:
            overdue_amount += outstanding
            overdue_since = overdue_since or item.due_date
        elif open_ and next_due is None:
            next_due = {'due_date': item.due_date.isoformat(), 'amount': outstanding}
        rows.append({'id': item.id, 'number': item.number, 'due_date': item.due_date.isoformat(), 'amount': item.amount,
                     'paid': round(paid, 2), 'outstanding': outstanding, 'overdue': late,
                     'status': 'PAID' if not open_ else ('PARTIAL' if paid > 0.004 else 'UNPAID')})
    return {'installments': rows, 'count': len(rows), 'overdue_amount': round(overdue_amount, 2),
            'overdue_since': overdue_since.isoformat() if overdue_since else None, 'next_due': next_due}


def overdue_info(inv, today=None):
    """(is overdue, amount overdue, since when). With a plan it is the missed instalments; without one, the due date."""
    today = today or datetime.now()
    if inv.status in (InvoiceStatus.CANCELLED, InvoiceStatus.PAID) or (inv.balance_due or 0) <= 0.004:
        return False, 0.0, None
    plan = plan_view(inv, today)
    if plan is not None:
        late = plan['overdue_amount'] > 0
        return late, plan['overdue_amount'], plan['overdue_since']
    if inv.due_date and inv.due_date.date() < today.date():
        return True, round(inv.balance_due, 2), inv.due_date.isoformat()
    return False, 0.0, None
