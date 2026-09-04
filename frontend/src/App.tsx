import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import SignupPage from './pages/SignupPage';
import CitizenDashboard from './pages/citizen/CitizenDashboard';
import ReportForm from './pages/citizen/ReportForm';
import ReportDetail from './pages/citizen/ReportDetail';
import AuthorityDashboard from './pages/authority/AuthorityDashboard';
import WorkOrdersList from './pages/authority/WorkOrdersList';
import WorkOrderDetail from './pages/authority/WorkOrderDetail';
import AuthorityReportDetail from './pages/authority/ReportDetail';
import CrewDashboard from './pages/crew/CrewDashboard';
import OperatorConsole from './pages/operator/OperatorConsole';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="h-8 w-8 border-3 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (!user) return <LoginPage />;
  return <>{children}</>;
}

function RequireRole({ allowedRoles, children }: { allowedRoles: string[]; children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="h-8 w-8 border-3 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (!user) return <LoginPage />;
  if (!allowedRoles.includes(user.role)) {
    // Redirect to the correct dashboard for their role
    if (user.role === 'citizen') return <Navigate to="/citizen" replace />;
    if (user.role === 'crew') return <Navigate to="/crew" replace />;
    if (user.role === 'drone_operator') return <Navigate to="/operator" replace />;
    return <Navigate to="/authority" replace />;
  }
  return <>{children}</>;
}

function RoleRedirect() {
  const { user } = useAuth();
  if (!user) return <LoginPage />;
  if (user.role === 'citizen') return <Navigate to="/citizen" replace />;
  if (user.role === 'crew') return <Navigate to="/crew" replace />;
  if (user.role === 'drone_operator') return <Navigate to="/operator" replace />;
  return <Navigate to="/authority" replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route element={<RequireAuth><Layout /></RequireAuth>}>
            {/* Citizen routes */}
            <Route path="/citizen" element={<RequireRole allowedRoles={['citizen']}><CitizenDashboard /></RequireRole>} />
            <Route path="/citizen/new" element={<RequireRole allowedRoles={['citizen']}><ReportForm /></RequireRole>} />
            <Route path="/citizen/report/:id" element={<RequireRole allowedRoles={['citizen']}><ReportDetail /></RequireRole>} />
            {/* Authority routes */}
            <Route path="/authority" element={<RequireRole allowedRoles={['authority', 'admin']}><AuthorityDashboard /></RequireRole>} />
            <Route path="/authority/workorders" element={<RequireRole allowedRoles={['authority', 'admin']}><WorkOrdersList /></RequireRole>} />
            <Route path="/authority/workorders/:id" element={<RequireRole allowedRoles={['authority', 'admin']}><WorkOrderDetail /></RequireRole>} />
            <Route path="/authority/reports/:id" element={<RequireRole allowedRoles={['authority', 'admin']}><AuthorityReportDetail /></RequireRole>} />
            {/* Crew routes */}
            <Route path="/crew" element={<RequireRole allowedRoles={['crew']}><CrewDashboard /></RequireRole>} />
            {/* Drone Operator routes */}
            <Route path="/operator" element={<RequireRole allowedRoles={['drone_operator']}><OperatorConsole /></RequireRole>} />
          </Route>
          <Route path="*" element={<RoleRedirect />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
