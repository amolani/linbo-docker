import { useState, ReactNode } from 'react';
import { Sidebar, MobileSidebar } from './Sidebar';
import { Header } from './Header';
import { ToastContainer } from '@/components/ui';
import { useWebSocket, useHostStatusUpdates, useNotificationEvents } from '@/hooks/useWebSocket';

interface AppLayoutProps {
  children: ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useWebSocket();
  useHostStatusUpdates();
  useNotificationEvents();

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
