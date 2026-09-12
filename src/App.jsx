import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import ScrollToTop from './components/ScrollToTop'
import { AuthProvider } from './context/AuthContext'
import { ProtectedRoute, DashboardLayout } from './components/layout'
import SuperadminLayout from './components/superadmin/SuperadminLayout'

// Landing
import Landing from './pages/landing/Landing'

// Auth
import Login                from './pages/auth/Login'
import CompletarPerfil      from './pages/auth/CompletarPerfil'
import ConfirmacionPendiente from './pages/auth/ConfirmacionPendiente'
import RecuperarPassword      from './pages/auth/RecuperarPassword'
import Privacidad             from './pages/legal/Privacidad'
import Terminos               from './pages/legal/Terminos'
import Cookies                from './pages/legal/Cookies'

// Superadmin
import SuperadminDashboard  from './pages/superadmin/Dashboard'
import Organizaciones       from './pages/superadmin/Organizaciones'
import Usuarios             from './pages/superadmin/Usuarios'
import Suscripciones        from './pages/superadmin/Suscripciones'
import Encuestas            from './pages/superadmin/Encuestas'
import EncuestaBuilder      from './pages/superadmin/EncuestaBuilder'
import EncuestasOnline       from './pages/superadmin/EncuestasOnline'
import EncuestaBuilderOnline from './pages/superadmin/EncuestaBuilderOnline'

// Admin
import DashboardAdmin     from './pages/admin/Dashboard'
import MapaAdmin          from './pages/admin/Mapa'
import EncuestasAdmin     from './pages/admin/Encuestas'
import EncuestaDetalle    from './pages/admin/EncuestaDetalle'
import EquiposAdmin       from './pages/admin/Equipos'
import CoordinadoresAdmin from './pages/admin/Coordinadores'
import EncuestadoresAdmin from './pages/admin/Encuestadores'
import ReportesAdmin      from './pages/admin/Reportes'
import DescargarApp       from './pages/DescargarApp'
import DashboardEnc       from './pages/encuestador/Dashboard'
import ConfiguracionAdmin from './pages/admin/Configuracion'
import SuscripcionAdmin   from './pages/admin/Suscripcion'

// Coordinador
import DashboardCoord from './pages/coordinador/Dashboard'
import EquipoCoord    from './pages/coordinador/Equipo'
import EncuestasCoord from './pages/coordinador/Encuestas'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ScrollToTop />
        <Routes>
          {/* Public */}
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/completar-perfil" element={<CompletarPerfil />} />
          <Route path="/confirmacion-pendiente" element={<ConfirmacionPendiente />} />
          <Route path="/recuperar-password"       element={<RecuperarPassword />} />
          <Route path="/privacidad"              element={<Privacidad />} />
          <Route path="/terminos"                element={<Terminos />} />
          <Route path="/cookies"                 element={<Cookies />} />

          {/* Superadmin routes */}
          <Route element={<ProtectedRoute roles={['superadmin']} />}>
            <Route element={<SuperadminLayout />}>
              <Route path="/superadmin"                       element={<SuperadminDashboard />} />
              <Route path="/superadmin/organizaciones"        element={<Organizaciones />} />
              <Route path="/superadmin/organizaciones/nueva"  element={<Organizaciones />} />
              <Route path="/superadmin/usuarios"              element={<Usuarios />} />
              <Route path="/superadmin/usuarios/invitar"      element={<Usuarios />} />
              <Route path="/superadmin/suscripciones"         element={<Suscripciones />} />
              <Route path="/superadmin/encuestas"             element={<Encuestas />} />
              <Route path="/superadmin/encuestas/nueva"       element={<EncuestaBuilder />} />
              <Route path="/superadmin/encuestas/:id"         element={<EncuestaBuilder />} />
              <Route path="/superadmin/encuestas-online"       element={<EncuestasOnline />} />
              <Route path="/superadmin/encuestas-online/nueva" element={<EncuestaBuilderOnline />} />
              <Route path="/superadmin/encuestas-online/:id"   element={<EncuestaBuilderOnline />} />
            </Route>
          </Route>

          {/* Admin + Gestor routes */}
          <Route element={<ProtectedRoute roles={['admin', 'gestor']} />}>
            <Route element={<DashboardLayout />}>
              <Route path="/dashboard"     element={<DashboardAdmin />} />
              <Route path="/mapa"          element={<MapaAdmin />} />
              <Route path="/encuestas"     element={<EncuestasAdmin />} />
              <Route path="/encuestas/:id" element={<EncuestaDetalle />} />
              <Route path="/equipos"       element={<EquiposAdmin />} />
              <Route path="/coordinadores" element={<CoordinadoresAdmin />} />
              <Route path="/encuestadores" element={<EncuestadoresAdmin />} />
              <Route path="/reportes"      element={<ReportesAdmin />} />
              <Route path="/configuracion" element={<ConfiguracionAdmin />} />
            </Route>
          </Route>

          {/* Suscripcion — solo admin (no gestor) */}
          <Route element={<ProtectedRoute roles={['admin']} />}>
            <Route element={<DashboardLayout />}>
              <Route path="/suscripcion" element={<SuscripcionAdmin />} />
            </Route>
          </Route>

          {/* Coordinador routes */}
          <Route element={<ProtectedRoute roles={['coordinador']} />}>
            <Route element={<DashboardLayout />}>
              <Route path="/coord/dashboard" element={<DashboardCoord />} />
              <Route path="/coord/equipo"    element={<EquipoCoord />} />
              <Route path="/coord/encuestas" element={<EncuestasCoord />} />
            </Route>
          </Route>

          {/* Encuestador routes */}
          <Route element={<ProtectedRoute roles={['encuestador']} />}>
            <Route element={<DashboardLayout />}>
              <Route path="/encuestador"                   element={<DashboardEnc />} />
              <Route path="/encuestador/configuracion"     element={<ConfiguracionAdmin />} />
              <Route path="/encuestador/descargar-app"     element={<DescargarApp />} />
            </Route>
          </Route>

          {/* Descargar App — accesible para todos los roles */}
          <Route element={<ProtectedRoute roles={['admin','gestor','coordinador','encuestador']} />}>
            <Route element={<DashboardLayout />}>
              <Route path="/descargar-app"       element={<DescargarApp />} />
              <Route path="/coord/descargar-app" element={<DescargarApp />} />
            </Route>
          </Route>

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}