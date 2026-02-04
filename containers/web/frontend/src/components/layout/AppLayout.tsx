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

  // Initialize WebSocket and event handlers
  useWebSocket();
  useHostStatusUpdates();
  useNotificationEvents();

  return (
    <div className="min-h-screen bg-gray-100">
      <MobileSidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex">
        <Sidebar />

        <div className="flex-1 flex flex-col min-h-screen">
          <Header onMenuClick={() => setSidebarOpen(true)} />

          <main className="flex-1 p-6">
            {children}
          </main>
        </div>
      </div>

      <ToastContainer />
    </div>
  );
}
