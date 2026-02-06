import apiClient from './client';
import type { NetworkSettings, DhcpSummary, DhcpFormat, DhcpExportOptions } from '@/types';

interface ApiResponse<T> {
  data: T;
  message?: string;
}

export const dhcpApi = {
  getNetworkSettings: async (): Promise<NetworkSettings> => {
    const response = await apiClient.get<ApiResponse<NetworkSettings>>('/dhcp/network-settings');
    return response.data.data;
  },

  saveNetworkSettings: async (settings: Partial<NetworkSettings>): Promise<NetworkSettings> => {
    const response = await apiClient.put<ApiResponse<NetworkSettings>>('/dhcp/network-settings', settings);
    return response.data.data;
  },

  getSummary: async (): Promise<DhcpSummary> => {
    const response = await apiClient.get<ApiResponse<DhcpSummary>>('/dhcp/summary');
    return response.data.data;
  },

  previewConfig: async (format: DhcpFormat, options: DhcpExportOptions = {}): Promise<string> => {
    const params = new URLSearchParams();
    params.set('format', 'text');
    if (options.configId) params.set('configId', options.configId);
    if (options.roomId) params.set('roomId', options.roomId);
    if (options.pxeOnly) params.set('pxeOnly', 'true');
    if (options.includeHeader === false) params.set('includeHeader', 'false');
    if (options.includeSubnet === false) params.set('includeSubnet', 'false');

    const response = await apiClient.get(`/dhcp/export/${format}?${params.toString()}`, {
      responseType: 'text',
      transformResponse: [(data: string) => data],
    });
    return response.data;
  },

  exportConfig: async (format: DhcpFormat, options: DhcpExportOptions = {}): Promise<Blob> => {
    const params = new URLSearchParams();
    params.set('format', 'file');
    if (options.configId) params.set('configId', options.configId);
    if (options.roomId) params.set('roomId', options.roomId);
    if (options.pxeOnly) params.set('pxeOnly', 'true');

    const response = await apiClient.get(`/dhcp/export/${format}?${params.toString()}`, {
      responseType: 'blob',
    });
    return response.data;
  },

  reloadProxy: async (): Promise<{ configPath: string; message: string; size: number }> => {
    const response = await apiClient.post<ApiResponse<{ configPath: string; message: string; size: number }>>(
      '/dhcp/reload-proxy'
    );
    return response.data.data;
  },
};
