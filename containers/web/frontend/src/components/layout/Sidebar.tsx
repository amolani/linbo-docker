import { NavLink } from 'react-router-dom';
import {
  HomeIcon,
  ComputerDesktopIcon,
  BuildingOfficeIcon,
  UsersIcon,
  Cog6ToothIcon,
  CircleStackIcon,
  ClipboardDocumentListIcon,
} from '@heroicons/react/24/outline';

const navigation = [
  { name: 'Dashboard', href: '/', icon: HomeIcon },
  { name: 'Hosts', href: '/hosts', icon: ComputerDesktopIcon },
  { name: 'Räume', href: '/rooms', icon: BuildingOfficeIcon },
  { name: 'Gruppen', href: '/groups', icon: UsersIcon },
  { name: 'Konfigurationen', href: '/configs', icon: Cog6ToothIcon },
  { name: 'Images', href: '/images', icon: CircleStackIcon },
  { name: 'Operationen', href: '/operations', icon: ClipboardDocumentListIcon },
];

export function Sidebar() {
  return (
    <div className="hidden lg:flex lg:flex-shrink-0">
      <div className="flex flex-col w-64">
        <div className="flex flex-col flex-grow bg-linbo-darker pt-5 pb-4 overflow-y-auto">
          <div className="flex items-center flex-shrink-0 px-4">
            <span className="text-2xl mr-2">🖥️</span>
            <span className="text-xl font-bold text-white">LINBO Docker</span>
          </div>
          <nav className="mt-8 flex-1 px-2 space-y-1">
            {navigation.map((item) => (
              <NavLink
                key={item.name}
                to={item.href}
                className={({ isActive }) =>
                  `group flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                    isActive
                      ? 'bg-linbo-dark text-white'
                      : 'text-gray-300 hover:bg-linbo-dark hover:text-white'
                  }`
                }
              >
                <item.icon
                  className="mr-3 flex-shrink-0 h-6 w-6"
                  aria-hidden="true"
                />
                {item.name}
              </NavLink>
            ))}
          </nav>
        </div>
      </div>
    </div>
  );
}

export function MobileSidebar({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  if (!isOpen) return null;

  return (
    <div className="lg:hidden">
      <div className="fixed inset-0 z-40 flex">
        <div
          className="fixed inset-0 bg-gray-600 bg-opacity-75"
          onClick={onClose}
        />
        <div className="relative flex-1 flex flex-col max-w-xs w-full bg-linbo-darker">
          <div className="absolute top-0 right-0 -mr-12 pt-2">
            <button
              type="button"
              className="ml-1 flex items-center justify-center h-10 w-10 rounded-full focus:outline-none focus:ring-2 focus:ring-inset focus:ring-white"
              onClick={onClose}
            >
              <span className="sr-only">Schließen</span>
              <svg
                className="h-6 w-6 text-white"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
          <div className="flex-1 h-0 pt-5 pb-4 overflow-y-auto">
            <div className="flex items-center flex-shrink-0 px-4">
              <span className="text-2xl mr-2">🖥️</span>
              <span className="text-xl font-bold text-white">LINBO Docker</span>
            </div>
            <nav className="mt-8 px-2 space-y-1">
              {navigation.map((item) => (
                <NavLink
                  key={item.name}
                  to={item.href}
                  onClick={onClose}
                  className={({ isActive }) =>
                    `group flex items-center px-3 py-2 text-base font-medium rounded-md ${
                      isActive
                        ? 'bg-linbo-dark text-white'
                        : 'text-gray-300 hover:bg-linbo-dark hover:text-white'
                    }`
                  }
                >
                  <item.icon
                    className="mr-4 flex-shrink-0 h-6 w-6"
                    aria-hidden="true"
                  />
                  {item.name}
                </NavLink>
              ))}
            </nav>
          </div>
        </div>
      </div>
    </div>
  );
}
