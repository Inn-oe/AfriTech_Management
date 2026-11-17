import { Link, Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import Layout from './components/Layout.jsx';
import { Loading } from './components/ui.jsx';
import { MetaProvider } from './meta.jsx';
import { Account, ActivityLog, CompanySettings, Team } from './pages/Admin.jsx';
import AuthPage from './pages/AuthPage.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Inventory from './pages/Inventory.jsx';
import Quotations from './pages/Quotations.jsx';
import Invoices from './pages/Invoices.jsx';
import DocumentForm from './pages/DocumentForm.jsx';
import DocumentView from './pages/DocumentView.jsx';
import Payments from './pages/Payments.jsx';
import Projects from './pages/Projects.jsx';
import Reports from './pages/Reports.jsx';
import Enquiries from './pages/Enquiries.jsx';
import Training from './pages/Training.jsx';
import WhatsApp from './pages/WhatsApp.jsx';
import Financial from './pages/Financial.jsx';
import {
  Activities, ActivityTypes, Customers, FinancialCategories, FuelRecords, Journeys, Locations,
  MileageRecords, PricingPage, Suppliers,
} from './pages/SimplePages.jsx';

function NotFound() {
  return (
    <div className="text-center py-5">
      <h1 className="display-5 fw-bold">404</h1>
      <p className="text-muted">That page does not exist.</p>
      <Link to="/" className="btn btn-primary">Back to start</Link>
    </div>
  );
}

// People without dashboard access (e.g. technicians) start on the first page they can use.
function Home() {
  const { can } = useAuth();
  if (can('dashboard')) return <Dashboard />;
  if (can('operations')) return <Navigate to="/activities" replace />;
  if (can('inventory')) return <Navigate to="/inventory" replace />;
  return <Navigate to="/account" replace />;
}

export default function App() {
  const { user, loading } = useAuth();

  if (loading) return <div className="vh-100 d-flex align-items-center justify-content-center"><Loading /></div>;

  if (!user) {
    return (
      <Routes>
        <Route path="/signup" element={<AuthPage mode="signup" />} />
        <Route path="*" element={<AuthPage mode="login" />} />
      </Routes>
    );
  }

  return (
    <MetaProvider>
      <Routes>
        <Route path="login" element={<Navigate to="/" replace />} />
        <Route path="signup" element={<Navigate to="/" replace />} />
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="customers" element={<Customers />} />
          <Route path="suppliers" element={<Suppliers />} />
          <Route path="inventory" element={<Inventory />} />

          <Route path="quotations" element={<Quotations />} />
          <Route path="quotations/new" element={<DocumentForm kind="quotation" />} />
          <Route path="quotations/:id" element={<DocumentView kind="quotation" />} />
          <Route path="quotations/:id/edit" element={<DocumentForm kind="quotation" />} />

          <Route path="invoices" element={<Invoices />} />
          <Route path="invoices/new" element={<DocumentForm kind="invoice" />} />
          <Route path="invoices/:id" element={<DocumentView kind="invoice" />} />
          <Route path="invoices/:id/edit" element={<DocumentForm kind="invoice" />} />

          <Route path="payments" element={<Payments />} />
          <Route path="projects" element={<Projects />} />
          <Route path="reports" element={<Reports />} />
          <Route path="whatsapp" element={<WhatsApp />} />
          <Route path="enquiries" element={<Enquiries />} />
          <Route path="training" element={<Training />} />
          <Route path="settings" element={<Navigate to="/account" replace />} />
          <Route path="activities" element={<Activities />} />
          <Route path="activity-types" element={<ActivityTypes />} />
          <Route path="financial" element={<Financial />} />
          <Route path="financial-categories" element={<FinancialCategories />} />
          <Route path="fuel" element={<FuelRecords />} />
          <Route path="mileage" element={<MileageRecords />} />
          <Route path="journeys" element={<Journeys />} />
          <Route path="locations" element={<Locations />} />
          <Route path="pricing" element={<PricingPage />} />

          <Route path="team" element={<Team />} />
          <Route path="company" element={<CompanySettings />} />
          <Route path="activity-log" element={<ActivityLog />} />
          <Route path="account" element={<Account />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </MetaProvider>
  );
}
