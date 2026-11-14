// Pages that are plain list + add/edit/delete, built on <CrudPage>.
import { Link } from 'react-router-dom';
import CrudPage from '../components/CrudPage.jsx';
import { StatCard, StatusBadge } from '../components/ui.jsx';
import { date, dateTime, humanize, money, nowLocal, number, today } from '../format.js';
import { useApi } from '../hooks.js';
import { useEnum } from '../meta.jsx';
import { initials } from '../nav.js';

const truncate = (s, n = 60) => (s && s.length > n ? `${s.slice(0, n)}…` : s || '—');

export function Suppliers() {
  const currencies = useEnum('currency');
  return (
    <CrudPage config={{
      title: 'Suppliers', singular: 'Supplier', icon: 'fa-truck', endpoint: '/suppliers',
      searchKeys: ['name', 'contact_person', 'phone', 'email'],
      deleteWarning: 'Inventory items from this supplier will be kept but unlinked.',
      defaults: () => ({ currency: 'USD' }),
      columns: [
        { key: 'name', label: 'Name', render: (r) => <span className="fw-semibold">{r.name}</span> },
        { key: 'contact_person', label: 'Contact' },
        { key: 'phone', label: 'Phone' },
        { key: 'email', label: 'Email' },
        { key: 'payment_terms', label: 'Terms' },
        { key: 'currency', label: 'Currency' },
      ],
      fields: [
        { name: 'name', label: 'Company name', required: true },
        { name: 'contact_person', label: 'Contact person' },
        { name: 'phone', label: 'Phone', type: 'tel' },
        { name: 'email', label: 'Email', type: 'email' },
        { name: 'address', label: 'Address', col: 12 },
        { name: 'payment_terms', label: 'Payment terms', placeholder: 'e.g. Net 30' },
        { name: 'currency', label: 'Currency', type: 'select', options: currencies },
        { name: 'notes', label: 'Notes', type: 'textarea', col: 12 },
      ],
    }} />
  );
}

export function Customers() {
  return (
    <CrudPage config={{
      title: 'Customers', singular: 'Customer', icon: 'fa-users', endpoint: '/customers',
      idKey: 'identification_number',
      searchKeys: ['identification_number', 'full_name', 'phone', 'email', 'address'],
      deleteWarning: 'Their quotations, invoices and activities will be kept but unlinked.',
      summary: (rows) => {
        const withSales = rows.filter((r) => r.invoice_count > 0).length;
        const owed = rows.reduce((t, r) => t + (r.balance_due || 0), 0);
        const billed = rows.reduce((t, r) => t + (r.total_billed || 0), 0);
        return (
          <div className="row g-3 mb-4">
            <div className="col-sm-6 col-xl-3"><StatCard label="Total customers" value={rows.length} icon="fa-user-group" /></div>
            <div className="col-sm-6 col-xl-3"><StatCard label="With sales" value={withSales} icon="fa-bolt" color="info" hint={`${rows.length - withSales} without an invoice yet`} /></div>
            <div className="col-sm-6 col-xl-3"><StatCard label="Total billed" value={money(billed)} icon="fa-wallet" color="warning" hint={withSales ? `${money(billed / withSales)} per customer` : undefined} /></div>
            <div className="col-sm-6 col-xl-3"><StatCard label="Outstanding" value={money(owed)} icon="fa-hourglass-half" color="danger" hint="Unpaid invoice balances" tone={owed ? 'bad' : ''} /></div>
          </div>
        );
      },
      columns: [
        {
          key: 'full_name', label: 'Customer',
          render: (r) => (
            <span className="d-inline-flex align-items-center gap-2">
              <span className="avatar soft" style={{ width: 32, height: 32, fontSize: '0.7rem' }}>{initials(r.full_name)}</span>
              <span><span className="fw-semibold d-block">{r.full_name}</span><code className="small text-muted">{r.identification_number}</code></span>
            </span>
          ),
        },
        { key: 'address', label: 'Location', render: (r) => truncate(r.address, 34) },
        { key: 'phone', label: 'Phone' },
        {
          key: 'invoice_count', label: 'Invoices',
          render: (r) => (r.invoice_count
            ? <Link to={`/invoices?customer=${encodeURIComponent(r.identification_number)}`}>{r.invoice_count} · {money(r.total_billed)}</Link>
            : <span className="text-muted">None</span>),
        },
        { key: 'job_count', label: 'Jobs', render: (r) => (r.job_count ? `${r.job_count} job${r.job_count > 1 ? 's' : ''}` : '—') },
        { key: 'balance_due', label: 'Owes', className: 'text-end', render: (r) => (r.balance_due > 0 ? <span className="fw-semibold text-danger">{money(r.balance_due)}</span> : '—') },
        {
          key: 'status', label: 'Status',
          render: (r) => (r.balance_due > 0 ? <span className="badge text-bg-warning">Owes</span>
            : r.invoice_count > 0 ? <span className="badge text-bg-success">Active</span> : <span className="badge text-bg-primary">Prospect</span>),
        },
      ],
      fields: [
        {
          name: 'identification_number', label: 'Customer ID', lockOnEdit: true,
          placeholder: 'Leave blank to auto-generate', help: 'National ID or any unique number.',
        },
        { name: 'citizenship', label: 'Citizenship' },
        { name: 'name', label: 'First name', required: true },
        { name: 'surname', label: 'Surname' },
        { name: 'phone', label: 'Phone', type: 'tel' },
        { name: 'email', label: 'Email', type: 'email' },
        { name: 'address', label: 'Address', type: 'textarea', col: 12, rows: 2 },
      ],
    }} />
  );
}

export function Locations() {
  const categories = useEnum('location_category');
  return (
    <CrudPage config={{
      title: 'Locations', singular: 'Location', icon: 'fa-location-dot', endpoint: '/locations',
      searchKeys: ['name', 'address', 'category'],
      defaults: () => ({ category: 'OTHER' }),
      columns: [
        { key: 'name', label: 'Name', render: (r) => <span className="fw-semibold">{r.name}</span> },
        { key: 'address', label: 'Address' },
        { key: 'category', label: 'Category', render: (r) => humanize(r.category) },
        {
          key: 'coords', label: 'Coordinates',
          render: (r) => (r.latitude != null && r.longitude != null ? (
            <a href={`https://www.google.com/maps?q=${r.latitude},${r.longitude}`} target="_blank" rel="noreferrer">
              {r.latitude}, {r.longitude} <i className="fas fa-external-link-alt small" />
            </a>
          ) : '—'),
        },
        { key: 'notes', label: 'Notes', render: (r) => truncate(r.notes) },
      ],
      fields: [
        { name: 'name', label: 'Name', required: true },
        { name: 'category', label: 'Category', type: 'select', options: categories },
        { name: 'address', label: 'Address', col: 12 },
        { name: 'latitude', label: 'Latitude', type: 'number' },
        { name: 'longitude', label: 'Longitude', type: 'number' },
        { name: 'notes', label: 'Notes', type: 'textarea', col: 12 },
      ],
    }} />
  );
}

export function PricingPage() {
  const currencies = useEnum('currency');
  return (
    <CrudPage config={{
      title: 'Pricing', singular: 'Price', icon: 'fa-dollar-sign', endpoint: '/pricing',
      subtitle: 'Standard service and product rates',
      searchKeys: ['item_name', 'item_type'],
      defaults: () => ({ currency: 'USD', effective_date: today() }),
      columns: [
        { key: 'item_name', label: 'Item', render: (r) => <span className="fw-semibold">{r.item_name}</span> },
        { key: 'item_type', label: 'Type' },
        { key: 'price', label: 'Price', className: 'text-end', render: (r) => money(r.price, r.currency) },
        { key: 'unit', label: 'Unit' },
        { key: 'effective_date', label: 'Effective', render: (r) => date(r.effective_date) },
        { key: 'expiry_date', label: 'Expires', render: (r) => date(r.expiry_date) },
      ],
      fields: [
        { name: 'item_name', label: 'Item name', required: true },
        { name: 'item_type', label: 'Item type', required: true, placeholder: 'e.g. Service, Installation' },
        { name: 'price', label: 'Price', type: 'number', required: true, col: 4 },
        { name: 'currency', label: 'Currency', type: 'select', options: currencies, col: 4 },
        { name: 'unit', label: 'Unit', placeholder: 'e.g. per hour', col: 4 },
        { name: 'effective_date', label: 'Effective date', type: 'date' },
        { name: 'expiry_date', label: 'Expiry date', type: 'date' },
        { name: 'notes', label: 'Notes', type: 'textarea', col: 12 },
      ],
    }} />
  );
}

export function ActivityTypes() {
  return (
    <CrudPage config={{
      title: 'Activity Types', singular: 'Activity type', icon: 'fa-tags', endpoint: '/activity-types',
      searchKeys: ['name', 'description'],
      defaults: () => ({ is_active: true }),
      columns: [
        { key: 'name', label: 'Name', render: (r) => <span className="fw-semibold">{r.name}</span> },
        { key: 'description', label: 'Description', render: (r) => truncate(r.description, 80) },
        {
          key: 'is_active', label: 'Status',
          render: (r) => <span className={`badge text-bg-${r.is_active ? 'success' : 'secondary'}`}>{r.is_active ? 'Active' : 'Inactive'}</span>,
        },
      ],
      fields: [
        { name: 'name', label: 'Name', required: true, col: 12 },
        { name: 'description', label: 'Description', type: 'textarea', col: 12 },
        { name: 'is_active', label: 'Active (available when creating activities and invoices)', type: 'checkbox' },
      ],
    }} />
  );
}

export function FinancialCategories() {
  const types = useEnum('financial_type');
  return (
    <CrudPage config={{
      title: 'Financial Categories', singular: 'Category', icon: 'fa-folder-tree', endpoint: '/financial-categories',
      searchKeys: ['name', 'type', 'description'],
      defaults: () => ({ type: 'EXPENSE', is_active: true }),
      columns: [
        { key: 'name', label: 'Name', render: (r) => <span className="fw-semibold">{r.name}</span> },
        { key: 'type', label: 'Type', render: (r) => <StatusBadge value={r.type} /> },
        { key: 'description', label: 'Description', render: (r) => truncate(r.description, 80) },
      ],
      fields: [
        { name: 'name', label: 'Name', required: true },
        { name: 'type', label: 'Type', type: 'select', options: types, required: true },
        { name: 'description', label: 'Description', type: 'textarea', col: 12 },
        { name: 'is_active', label: 'Active', type: 'checkbox' },
      ],
    }} />
  );
}

export function Activities() {
  const statuses = useEnum('activity_status');
  const currencies = useEnum('currency');
  const { data: customers } = useApi('/customers', []);
  const { data: types } = useApi('/activity-types', []);
  return (
    <CrudPage config={{
      title: 'Activities', singular: 'Activity', icon: 'fa-list-check', endpoint: '/activities',
      searchKeys: ['customer_name', 'activity_type_name', 'description', 'technician', 'status'],
      defaults: () => ({ status: 'SCHEDULED', date: today(), currency: 'USD' }),
      columns: [
        { key: 'date', label: 'Date', render: (r) => date(r.date) },
        { key: 'customer_name', label: 'Customer', render: (r) => r.customer_name || <span className="text-muted">Unlinked</span> },
        { key: 'activity_type_name', label: 'Type' },
        { key: 'description', label: 'Description', render: (r) => truncate(r.description) },
        { key: 'technician', label: 'Technician' },
        { key: 'status', label: 'Status', render: (r) => <StatusBadge value={r.status} /> },
        { key: 'total_cost', label: 'Cost', className: 'text-end', render: (r) => (r.total_cost != null ? money(r.total_cost, r.currency) : '—') },
      ],
      fields: [
        {
          name: 'customer_id', label: 'Customer', type: 'select', required: true,
          options: (customers || []).map((c) => ({ value: c.identification_number, label: `${c.full_name} (${c.identification_number})` })),
        },
        {
          name: 'activity_type_id', label: 'Activity type', type: 'select', required: true,
          options: (types || []).filter((t) => t.is_active).map((t) => ({ value: t.id, label: t.name })),
        },
        { name: 'date', label: 'Date', type: 'date', required: true },
        { name: 'status', label: 'Status', type: 'select', options: statuses, required: true },
        { name: 'technician', label: 'Technician' },
        { name: 'total_cost', label: 'Total cost', type: 'number', col: 3 },
        { name: 'currency', label: 'Currency', type: 'select', options: currencies, col: 3 },
        { name: 'description', label: 'Description', type: 'textarea', col: 12, required: true },
        { name: 'notes', label: 'Notes', type: 'textarea', col: 12, rows: 2 },
      ],
    }} />
  );
}

export function FuelRecords() {
  const fuelTypes = useEnum('fuel_type');
  return (
    <CrudPage config={{
      title: 'Fuel Tracking', singular: 'Fuel record', icon: 'fa-gas-pump', endpoint: '/fuel-records',
      subtitle: 'New fuel records are automatically booked as Fuel expenses.',
      searchKeys: ['vehicle_id', 'fuel_station', 'fuel_type'],
      defaults: () => ({ date: today(), fuel_type: 'DIESEL' }),
      summary: (rows) => (
        <div className="row g-3 mb-4">
          <div className="col-md-4"><StatCard label="Total fuel cost" value={money(rows.reduce((s, r) => s + (r.total_cost || 0), 0))} icon="fa-dollar-sign" color="danger" /></div>
          <div className="col-md-4"><StatCard label="Total litres" value={number(rows.reduce((s, r) => s + (r.quantity_liters || 0), 0), 1)} icon="fa-gas-pump" color="warning" /></div>
          <div className="col-md-4"><StatCard label="Fill-ups" value={rows.length} icon="fa-receipt" color="info" /></div>
        </div>
      ),
      columns: [
        { key: 'date', label: 'Date', render: (r) => date(r.date) },
        { key: 'vehicle_id', label: 'Vehicle', render: (r) => <span className="fw-semibold">{r.vehicle_id}</span> },
        { key: 'fuel_type', label: 'Fuel', render: (r) => humanize(r.fuel_type) },
        { key: 'quantity_liters', label: 'Litres', className: 'text-end', render: (r) => number(r.quantity_liters, 2) },
        { key: 'price_per_liter', label: 'Price/L', className: 'text-end', render: (r) => money(r.price_per_liter) },
        { key: 'total_cost', label: 'Total', className: 'text-end fw-semibold', render: (r) => money(r.total_cost) },
        { key: 'fuel_station', label: 'Station' },
      ],
      fields: [
        { name: 'date', label: 'Date', type: 'date', required: true },
        { name: 'vehicle_id', label: 'Vehicle (registration)', required: true },
        { name: 'fuel_type', label: 'Fuel type', type: 'select', options: fuelTypes },
        { name: 'fuel_station', label: 'Fuel station' },
        { name: 'quantity_liters', label: 'Quantity (litres)', type: 'number', required: true },
        { name: 'price_per_liter', label: 'Price per litre', type: 'number', required: true },
        { name: 'notes', label: 'Notes', type: 'textarea', col: 12, rows: 2 },
      ],
    }} />
  );
}

export function MileageRecords() {
  return (
    <CrudPage config={{
      title: 'Mileage Tracking', singular: 'Mileage record', icon: 'fa-road', endpoint: '/mileage-records',
      searchKeys: ['vehicle_id', 'start_location', 'end_location'],
      defaults: () => ({ date: today() }),
      summary: (rows) => (
        <div className="row g-3 mb-4">
          <div className="col-md-6"><StatCard label="Total distance" value={`${number(rows.reduce((s, r) => s + (r.distance_km || 0), 0), 1)} km`} icon="fa-road" /></div>
          <div className="col-md-6"><StatCard label="Records" value={rows.length} icon="fa-list" color="info" /></div>
        </div>
      ),
      columns: [
        { key: 'date', label: 'Date', render: (r) => date(r.date) },
        { key: 'vehicle_id', label: 'Vehicle', render: (r) => <span className="fw-semibold">{r.vehicle_id}</span> },
        { key: 'route', label: 'Route', render: (r) => (r.start_location || r.end_location ? `${r.start_location || '?'} → ${r.end_location || '?'}` : '—') },
        { key: 'start_odometer', label: 'Start odo', className: 'text-end', render: (r) => number(r.start_odometer) },
        { key: 'end_odometer', label: 'End odo', className: 'text-end', render: (r) => number(r.end_odometer) },
        { key: 'distance_km', label: 'Distance', className: 'text-end fw-semibold', render: (r) => `${number(r.distance_km, 1)} km` },
      ],
      fields: [
        { name: 'date', label: 'Date', type: 'date', required: true },
        { name: 'vehicle_id', label: 'Vehicle', required: true },
        { name: 'start_location', label: 'From' },
        { name: 'end_location', label: 'To' },
        { name: 'start_odometer', label: 'Start odometer', type: 'number', col: 4 },
        { name: 'end_odometer', label: 'End odometer', type: 'number', col: 4 },
        { name: 'distance_km', label: 'Distance (km)', type: 'number', col: 4, help: 'Calculated from odometer if left blank' },
        { name: 'notes', label: 'Notes', type: 'textarea', col: 12, rows: 2 },
      ],
    }} />
  );
}

export function Journeys() {
  const statuses = useEnum('journey_status');
  return (
    <CrudPage config={{
      title: 'Journey Tracking', singular: 'Journey', icon: 'fa-car', endpoint: '/journeys',
      searchKeys: ['vehicle_id', 'driver', 'start_location', 'end_location', 'purpose'],
      defaults: () => ({ start_time: nowLocal(), status: 'PLANNED' }),
      columns: [
        { key: 'start_time', label: 'Start', render: (r) => dateTime(r.start_time) },
        { key: 'vehicle_id', label: 'Vehicle', render: (r) => <span className="fw-semibold">{r.vehicle_id}</span> },
        { key: 'driver', label: 'Driver' },
        { key: 'route', label: 'Route', render: (r) => `${r.start_location || '?'} → ${r.end_location || '?'}` },
        { key: 'purpose', label: 'Purpose', render: (r) => truncate(r.purpose, 40) },
        { key: 'total_distance', label: 'Distance', className: 'text-end', render: (r) => `${number(r.total_distance, 1)} km` },
        { key: 'status', label: 'Status', render: (r) => <StatusBadge value={r.status} /> },
      ],
      fields: [
        { name: 'vehicle_id', label: 'Vehicle', required: true },
        { name: 'driver', label: 'Driver' },
        { name: 'start_location', label: 'From', required: true },
        { name: 'end_location', label: 'To', required: true },
        { name: 'start_time', label: 'Start time', type: 'datetime-local', required: true },
        { name: 'end_time', label: 'End time', type: 'datetime-local' },
        { name: 'total_distance', label: 'Distance (km)', type: 'number' },
        { name: 'status', label: 'Status', type: 'select', options: statuses },
        { name: 'purpose', label: 'Purpose', col: 12 },
        { name: 'notes', label: 'Notes', type: 'textarea', col: 12, rows: 2 },
      ],
    }} />
  );
}
