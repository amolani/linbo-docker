import { useState, useEffect, ReactNode } from 'react';
import { Sidebar, MobileSidebar } from './Sidebar';
import { Header } from './Header';
import { ToastContainer } from '@/components/ui';
import { useWebSocket, useHostStatusUpdates, useNotificationEvents } from '@/hooks/useWebSocket';
import { useServerConfigStore } from '@/stores/serverConfigStore';

interface AppLayoutProps {
  children: ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const fetchMode = useServerConfigStore((s) => s.fetchMode);

  useWebSocket();
  useHostStatusUpdates();
  useNotificationEvents();

  useEffect(() => {
    fetchMode();
  }, [fetchMode]);

  return (
    <div className="flex h-screen bg-background">
      <MobileSidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <Sidebar />

      <div className="flex-1 flex flex-col min-h-screen overflow-hidden">
        <Header onMenuClick={() => setSidebarOpen(true)} />

        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>

      <ToastContainer />
    </div>
  );
}
