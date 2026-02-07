import { create } from 'zustand';
import type { Host, HostFilters, PaginatedResponse } from '@/types';
import { hostsApi } from '@/api/hosts';

interface HostState {
  hosts: Host[];
  selectedHosts: string[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  filters: HostFilters;
  sort: string;
  order: 'asc' | 'desc';
  isLoading: boolean;
  error: string | null;
  fetchHosts: () => Promise<void>;
  setPage: (page: number) => void;
  setLimit: (limit: number) => void;
  setFilters: (filters: HostFilters) => void;
  setSort: (sort: string, order?: 'asc' | 'desc') => void;
  selectHost: (id: string) => void;
  deselectHost: (id: string) => void;
  selectAll: () => void;
  deselectAll: () => void;
  toggleHost: (id: string) => void;
  updateHostStatus: (id: string, status: string, detectedOs?: string | null) => void;
}

export const useHostStore = create<HostState>((set, get) => ({
  hosts: [],
  selectedHosts: [],
  total: 0,
  page: 1,
  limit: 25,
  totalPages: 0,
  filters: {},
  sort: 'hostname',
  order: 'asc',
  isLoading: false,
  error: null,

  fetchHosts: async () => {
    const { page, limit, filters, sort, order } = get();
    set({ isLoading: true, error: null });
    try {
      const response: PaginatedResponse<Host> = await hostsApi.list({
        page,
        limit,
        filters,
        sort,
        order,
      });
      set({
        hosts: response.data,
        total: response.total,
        totalPages: response.totalPages,
        isLoading: false,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Fehler beim Laden der Hosts';
      set({ error: message, isLoading: false });
    }
  },

  setPage: (page: number) => {
    set({ page });
    get().fetchHosts();
  },

  setLimit: (limit: number) => {
    set({ limit, page: 1 });
    get().fetchHosts();
  },

  setFilters: (filters: HostFilters) => {
    set({ filters, page: 1 });
    get().fetchHosts();
  },

  setSort: (sort: string, order?: 'asc' | 'desc') => {
    const currentOrder = get().order;
    const currentSort = get().sort;
    const newOrder = order || (currentSort === sort && currentOrder === 'asc' ? 'desc' : 'asc');
    set({ sort, order: newOrder });
    get().fetchHosts();
  },

  selectHost: (id: string) => {
    set((state) => ({
      selectedHosts: [...state.selectedHosts, id],
    }));
  },

  deselectHost: (id: string) => {
    set((state) => ({
      selectedHosts: state.selectedHosts.filter((h) => h !== id),
    }));
  },

  selectAll: () => {
    set((state) => ({
      selectedHosts: state.hosts.map((h) => h.id),
    }));
  },

  deselectAll: () => {
    set({ selectedHosts: [] });
  },

  toggleHost: (id: string) => {
    const { selectedHosts } = get();
    if (selectedHosts.includes(id)) {
      get().deselectHost(id);
    } else {
      get().selectHost(id);
    }
  },

  updateHostStatus: (id: string, status: string, detectedOs?: string | null) => {
    set((state) => ({
      hosts: state.hosts.map((h) =>
        h.id === id
          ? {
              ...h,
              status: status as Host['status'],
              ...(detectedOs !== undefined ? { detectedOs: detectedOs as Host['detectedOs'] } : {}),
            }
          : h
      ),
    }));
  },
}));
