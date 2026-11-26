"""The income and expense categories every solar company starts with.

They are copied into each company's own Settings -> Financial Categories list (when it signs up, and once for
companies that existed before this list was added), so a company can rename, hide or add to them freely.
"""
from sqlalchemy import select

from .models import Company, FinancialCategory, FinancialType

# (name, description), grouped for readability only; the app shows them in alphabetical order.
EXPENSE_CATEGORIES = [
    # Staff and labour
    ('Wages', 'Weekly or daily pay for hourly and casual workers'),
    ('Salaries', 'Monthly salaries for office and permanent staff'),
    ('Installer and technician pay', 'Pay for installation teams and electricians'),
    ('Casual labour', 'Day workers hired for a job'),
    ('Commissions', 'Sales commissions paid to staff or agents'),
    ('Bonuses and overtime', 'Bonuses, overtime and allowances'),
    ('Payroll taxes and pension', 'PAYE, NSSA, pension and other payroll contributions'),
    ('Staff food and refreshments', 'Meals and drinks for staff, on site or in the office'),
    ('Staff medical and welfare', 'Medical aid, clinic costs and staff welfare'),
    ('Staff training and certification', 'Courses, safety training and installer certification'),
    ('Uniforms and protective gear (PPE)', 'Workwear, helmets, gloves, harnesses and safety boots'),
    # Transport and vehicles
    ('Fuel', 'Petrol and diesel for company vehicles and generators'),
    ('Transport fees', 'Transport, kombi, taxi and delivery fees'),
    ('Vehicle repairs', 'Repairs after breakdowns or accidents'),
    ('Vehicle maintenance and servicing', 'Services, oil, tyres, batteries and spares'),
    ('Vehicle insurance and licence', 'Insurance, vehicle licence, road permits and tracking'),
    ('Tolls and parking', 'Toll gates, parking and road fees'),
    ('Freight and courier', 'Shipping, courier and freight for goods and stock'),
    ('Customs and import duties', 'Import duty, clearing agent and border fees'),
    ('Travel and accommodation', 'Lodging and travel allowances for out-of-town jobs'),
    # Stock and project costs
    ('Solar panels purchase', 'Panels bought for resale or for a project'),
    ('Inverters and batteries purchase', 'Inverters, charge controllers and batteries bought'),
    ('Cables, mounting and accessories', 'Cables, breakers, isolators, brackets and fittings'),
    ('Installation materials', 'Consumables used on installations'),
    ('Subcontractor fees', 'Payments to subcontractors and outside specialists'),
    ('Tools and equipment purchase', 'Drills, ladders, meters, testers and other equipment'),
    ('Equipment hire', 'Hired scaffolding, vehicles, cranes or tools'),
    ('Solar system maintenance', 'Servicing and maintaining systems already installed'),
    ('After-sales repairs and warranty', 'Repairs and replacements covered under warranty'),
    ('Damaged or lost stock', 'Stock written off because it was damaged, lost or stolen'),
    # Premises and running costs
    ('Rent', 'Office, shop and warehouse rent'),
    ('Electricity and water', 'Utility bills for the premises'),
    ('Internet, airtime and data', 'Phone, airtime, internet and data bundles'),
    ('Office supplies and stationery', 'Paper, printing, files and general office items'),
    ('Cleaning and security', 'Cleaning services and security guards'),
    ('Building repairs and maintenance', 'Repairs to the office, shop or warehouse'),
    ('Software and subscriptions', 'Software, cloud tools and online subscriptions'),
    # Sales and marketing
    ('Advertising and marketing', 'Adverts, flyers, billboards and promotions'),
    ('Website and social media', 'Website, hosting and social media costs'),
    ('Branding and printing', 'Business cards, signage, vehicle branding and printing'),
    ('Customer entertainment and gifts', 'Meals and gifts for customers and partners'),
    # Admin, finance and compliance
    ('Accounting and audit fees', 'Bookkeeping, accountant and audit fees'),
    ('Legal and professional fees', 'Lawyers, consultants and other professional help'),
    ('Licences, permits and registrations', 'Trade licences, ZESA/ZERA approvals and council permits'),
    ('Insurance', 'Business, stock and equipment insurance'),
    ('Bank charges', 'Bank fees, card fees and transfer charges'),
    ('Loan interest', 'Interest paid on loans and overdrafts'),
    ('Loan repayments', 'Repayments on loans (capital)'),
    ('Taxes and levies', 'ZIMRA, VAT, income tax and other taxes and levies'),
    ('Owner drawings', 'Money the owner takes out of the business'),
    ('Donations', 'Donations and community contributions'),
    ('Other expenses', 'Anything that does not fit another category'),
]

INCOME_CATEGORIES = [
    ('Installation income', 'Income from installation work recorded outside an invoice'),
    ('Maintenance and service income', 'Income from servicing and maintenance contracts'),
    ('Consulting and design income', 'System design, site surveys and consulting'),
    ('Rental income', 'Equipment or space rented out'),
    ('Interest received', 'Bank interest and similar income'),
    ('Refunds received', 'Refunds from suppliers'),
    ('Other income', 'Any other money received'),
]


def add_default_categories(session, company_id):
    """Add the standard categories to a company, skipping any it already has. Returns how many were added."""
    session.flush()   # the app runs without autoflush; make sure rows added a moment ago are seen
    have = {(n.strip().lower(), t) for n, t in
            session.execute(select(FinancialCategory.name, FinancialCategory.type)
                            .where(FinancialCategory.company_id == company_id)).all()}
    added = 0
    for kind, rows in ((FinancialType.EXPENSE, EXPENSE_CATEGORIES), (FinancialType.INCOME, INCOME_CATEGORIES)):
        for name, description in rows:
            if (name.lower(), kind) in have:
                continue
            session.add(FinancialCategory(company_id=company_id, name=name, type=kind,
                                          description=description, is_active=True))
            added += 1
    return added


def add_defaults_to_existing_companies(session):
    """One-off for companies created before the defaults existed (each company is done once)."""
    pending = session.query(Company).filter(
        (Company.finance_defaults_added.is_(None)) | (Company.finance_defaults_added.is_(False))).all()
    for company in pending:
        add_default_categories(session, company.id)
        company.finance_defaults_added = True
    return len(pending)
