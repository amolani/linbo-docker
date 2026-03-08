import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useHostStore } from '@/stores/hostStore';
import type { Host } from '@/types';

vi.mock('@/api/hosts', () => ({
  hostsApi: { list: vi.fn() },
}));

import { hostsApi } from '@/api/hosts';

function makeHost(overrides: Partial<Host>): Host {
  return {
    id: 'default',
    hostname: 'default-host',
    macAddress: '00:00:00:00:00:00',
    status: 'offline',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

const testHosts: Host[] = [
  makeHost({ id: 'h1', hostname: 'pc01', macAddress: 'AA:BB:CC:DD:EE:01', status: 'offline', detectedOs: 'linux' }),
  makeHost({ id: 'h2', hostname: 'pc02', macAddress: 'AA:BB:CC:DD:EE:02', status: 'online', detectedOs: 'windows' }),
  makeHost({ id: 'h3', hostname: 'pc03', macAddress: 'AA:BB:CC:DD:EE:03', status: 'unknown' }),
];

describe('hostStore - updateHostStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useHostStore.setState({
      hosts: testHosts.map((h) => ({ ...h })),
      selectedHosts: [],
      total: 3,
      page: 1,
      limit: 25,
      totalPages: 1,
      filters: {},
      sort: 'hostname',
      order: 'asc',
      isLoading: false,
      error: null,
    });
  });

  it('should update status of matching host', () => {
    useHostStore.getState().updateHostStatus('h1', 'online');

    const hosts = useHostStore.getState().hosts;
    expect(hosts.find((h) => h.id === 'h1')!.status).toBe('online');
  });

  it('should preserve other host fields when updating status', () => {
    useHostStore.getState().updateHostStatus('h2', 'offline');

    const host = useHostStore.getState().hosts.find((h) => h.id === 'h2')!;
    expect(host.status).toBe('offline');
    expect(host.hostname).toBe('pc02');
    expect(host.macAddress).toBe('AA:BB:CC:DD:EE:02');
    expect(host.detectedOs).toBe('windows');
  });

  it('should update detectedOs when provided', () => {
    useHostStore.getState().updateHostStatus('h1', 'online', 'windows');

    const host = useHostStore.getState().hosts.find((h) => h.id === 'h1')!;
    expect(host.status).toBe('online');
    expect(host.detectedOs).toBe('windows');
  });

  it('should handle unknown host ID without error', () => {
    const hostsBefore = useHostStore.getState().hosts.map((h) => ({ ...h }));

    expect(() => {
      useHostStore.getState().updateHostStatus('nonexistent', 'online');
    }).not.toThrow();

    const hostsAfter = useHostStore.getState().hosts;
    expect(hostsAfter).toHaveLength(hostsBefore.length);
    // All hosts unchanged
    for (let i = 0; i < hostsBefore.length; i++) {
      expect(hostsAfter[i].id).toBe(hostsBefore[i].id);
      expect(hostsAfter[i].status).toBe(hostsBefore[i].status);
    }
  });
});

describe('hostStore - fetchHosts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useHostStore.setState({
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
    });
  });

  it('should set hosts from API response', async () => {
    const apiResponse = {
      data: testHosts,
      total: 3,
      page: 1,
      limit: 25,
      totalPages: 1,
    };
    (hostsApi.list as ReturnType<typeof vi.fn>).mockResolvedValueOnce(apiResponse);

    await useHostStore.getState().fetchHosts();

    const state = useHostStore.getState();
    expect(state.hosts).toHaveLength(3);
    expect(state.total).toBe(3);
    expect(state.totalPages).toBe(1);
    expect(state.isLoading).toBe(false);
  });
});
