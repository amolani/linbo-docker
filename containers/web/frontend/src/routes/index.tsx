import { Routes, Route, Navigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout';
import { ProtectedRoute } from './ProtectedRoute';

// Pages
import { LoginPage } from '@/pages/LoginPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { HostsPage } from '@/pages/HostsPage';
import { RoomsPage } from '@/pages/RoomsPage';
import { ConfigsPage } from '@/pages/ConfigsPage';
import { ImagesPage } from '@/pages/ImagesPage';
import { OperationsPage } from '@/pages/OperationsPage';
import { DhcpPage } from '@/pages/DhcpPage';
import { KernelPage } from '@/pages/KernelPage';
import { FirmwarePage } from '@/pages/FirmwarePage';
import { DriversPage } from '@/pages/DriversPage';
import { GrubThemePage } from '@/pages/GrubThemePage';

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route
        path="/"
        element={
          <ProtectedRoute>
            <AppLayout>
              <DashboardPage />
            </AppLayout>
          </ProtectedRoute>
        }
      />

      <Route
        path="/hosts"
        element={
          <ProtectedRoute>
            <AppLayout>
              <HostsPage />
            </AppLayout>
          </ProtectedRoute>
        }
      />

      <Route
        path="/rooms"
        element={
          <ProtectedRoute>
            <AppLayout>
              <RoomsPage />
            </AppLayout>
          </ProtectedRoute>
        }
      />


      <Route
        path="/configs"
        element={
          <ProtectedRoute>
            <AppLayout>
              <ConfigsPage />
            </AppLayout>
          </ProtectedRoute>
        }
      />

      <Route
        path="/images"
        element={
          <ProtectedRoute>
            <AppLayout>
              <ImagesPage />
            </AppLayout>
          </ProtectedRoute>
        }
      />

      <Route
        path="/operations"
        element={
          <ProtectedRoute>
            <AppLayout>
              <OperationsPage />
            </AppLayout>
          </ProtectedRoute>
        }
      />

      <Route
        path="/dhcp"
        element={
          <ProtectedRoute>
            <AppLayout>
              <DhcpPage />
            </AppLayout>
          </ProtectedRoute>
        }
      />

      <Route
        path="/kernel"
        element={
          <ProtectedRoute>
            <AppLayout>
              <KernelPage />
            </AppLayout>
          </ProtectedRoute>
        }
      />

      <Route
        path="/firmware"
        element={
          <ProtectedRoute>
            <AppLayout>
              <FirmwarePage />
            </AppLayout>
          </ProtectedRoute>
        }
      />

      <Route
        path="/drivers"
        element={
          <ProtectedRoute>
            <AppLayout>
              <DriversPage />
            </AppLayout>
          </ProtectedRoute>
        }
      />

      <Route
        path="/grub-theme"
        element={
          <ProtectedRoute>
            <AppLayout>
              <GrubThemePage />
            </AppLayout>
          </ProtectedRoute>
        }
      />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
