import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import LandingPage from './pages/LandingPage';
import LoginPage from './pages/LoginPage';
import PrivacyPolicyPage from './pages/PrivacyPolicyPage';
import TermsAndConditionsPage from './pages/TermsAndConditionsPage';
import AdminDashboard from './pages/AdminDashboard';
import UsersPage from './pages/UsersPage';
import ConnectionsPage from './pages/ConnectionsPage';
import ProductsPage from './pages/ProductsPage';
import ConnectNetworkPage from './pages/ConnectNetworkPage';
import MetaOAuthCallback from './pages/MetaOAuthCallback';
import MetricsPage from './pages/MetricsPage';
import ProfilePage from './pages/ProfilePage';
import SupportInboxPage from './pages/SupportInboxPage';
import ProtectedRoute from './components/ProtectedRoute';

function App() {
  const { user } = useAuth();

  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/landing" element={<LandingPage />} />
      <Route path="/privacy-policy" element={<PrivacyPolicyPage />} />
      <Route path="/terms-and-conditions" element={<TermsAndConditionsPage />} />
      <Route
        path="/login"
        element={user ? <Navigate to="/admin" replace /> : <LoginPage />}
      />
      {/* Rutas de Admin (solo role=admin) */}
      {/* admin-dashboard-metrics (design.md D6/D14, OQ1 resuelto 2026-08-18):
          /admin es el dashboard de métricas. Reemplaza el redirect provisional
          a /admin/users que dejó admin-user-management (su propio design.md
          D6 ya anticipaba este reemplazo: "el change hermano es dueño del
          elemento de la ruta /admin"). No se agrega /admin/dashboard como
          ruta separada. /admin/users (gestión de usuarios) no se toca. */}
      <Route
        path="/admin"
        element={<ProtectedRoute requiredRole="admin"><AdminDashboard /></ProtectedRoute>}
      />
      <Route
        path="/admin/users"
        element={<ProtectedRoute requiredRole="admin"><UsersPage /></ProtectedRoute>}
      />
      {/* support-messaging: bandeja "Comunicados y Reportes" (design.md D8) */}
      <Route
        path="/admin/support"
        element={<ProtectedRoute requiredRole="admin"><SupportInboxPage /></ProtectedRoute>}
      />
      {/* Ruta vieja del alta (era una página completa); el alta ahora es un
          modal dentro de /admin/users. */}
      <Route
        path="/admin/register-user"
        element={<ProtectedRoute requiredRole="admin"><Navigate to="/admin/users" replace /></ProtectedRoute>}
      />
      {/* Rutas de usuario común */}
      <Route
        path="/app/connections"
        element={<ProtectedRoute><ConnectionsPage /></ProtectedRoute>}
      />
      <Route
        path="/app/connect-network"
        element={<ProtectedRoute><ConnectNetworkPage /></ProtectedRoute>}
      />
      <Route
        path="/app/products"
        element={<ProtectedRoute><ProductsPage /></ProtectedRoute>}
      />
      <Route
        path="/app/metrics"
        element={<ProtectedRoute><MetricsPage /></ProtectedRoute>}
      />
      <Route
        path="/app/profile"
        element={<ProtectedRoute><ProfilePage /></ProtectedRoute>}
      />
      {/* Redirigir /app a /app/connections */}
      <Route path="/app" element={<Navigate to="/app/connections" replace />} />

      {/* OAuth Callbacks */}
      <Route path="/oauth/meta/callback" element={<MetaOAuthCallback />} />
      <Route path="/oauth/x/callback" element={<MetaOAuthCallback />} />

      {/* Redirigir /admin/connections y /admin/connect-network a /app/ */}
      <Route path="/admin/connections" element={<Navigate to="/app/connections" replace />} />
      <Route path="/admin/connect-network" element={<Navigate to="/app/connect-network" replace />} />
    </Routes>
  );
}

export default App;
