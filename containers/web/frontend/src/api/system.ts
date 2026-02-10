import apiClient from './client';
import type { KernelVariant, KernelStatus, KernelSwitchResponse, FirmwareEntry, FirmwareStatus, FirmwareCatalogCategory, BulkAddResult, WlanConfig } from '@/types';

interface ApiResponse<T> {
  data: T;
}

export const systemApi = {
  getKernelVariants: async (): Promise<KernelVariant[]> => {
    const response = await apiClient.get<ApiResponse<KernelVariant[]>>('/system/kernel-variants');
    return response.data.data;
  },

  getKernelStatus: async (): Promise<KernelStatus> => {
    const response = await apiClient.get<ApiResponse<KernelStatus>>('/system/kernel-status');
    return response.data.data;
  },

  switchKernel: async (variant: string): Promise<KernelSwitchResponse> => {
    const response = await apiClient.post<ApiResponse<KernelSwitchResponse>>('/system/kernel-switch', { variant });
    return response.data.data;
  },

  repairKernelConfig: async (rebuild = false): Promise<{ message: string; variant: string; jobId?: string }> => {
    const response = await apiClient.post<ApiResponse<{ message: string; variant: string; jobId?: string }>>('/system/kernel-repair', { rebuild });
    return response.data.data;
  },

  updateLinbofs: async (): Promise<{ success: boolean; message: string; output?: string; duration?: number }> => {
    const response = await apiClient.post<ApiResponse<{ success: boolean; message: string; output?: string; duration?: number }>>('/system/update-linbofs');
    return response.data.data;
  },

  getLinbofsStatus: async (): Promise<{ status: string; message: string }> => {
    const response = await apiClient.get<ApiResponse<{ status: string; message: string }>>('/system/linbofs-status');
    return response.data.data;
  },

  // Firmware Management
  getFirmwareEntries: async (): Promise<FirmwareEntry[]> => {
    const response = await apiClient.get<ApiResponse<FirmwareEntry[]>>('/system/firmware-entries');
    return response.data.data;
  },

  getFirmwareStatus: async (): Promise<FirmwareStatus> => {
    const response = await apiClient.get<ApiResponse<FirmwareStatus>>('/system/firmware-status');
    return response.data.data;
  },

  addFirmwareEntry: async (entry: string): Promise<FirmwareEntry> => {
    const response = await apiClient.post<ApiResponse<FirmwareEntry>>('/system/firmware-entries', { entry });
    return response.data.data;
  },

  removeFirmwareEntry: async (entry: string): Promise<{ removed: string }> => {
    const response = await apiClient.post<ApiResponse<{ removed: string }>>('/system/firmware-entries/remove', { entry });
    return response.data.data;
  },

  searchAvailableFirmware: async (query: string, limit = 50): Promise<string[]> => {
    const response = await apiClient.get<ApiResponse<string[]>>('/system/firmware-available', {
      params: { query, limit },
    });
    return response.data.data;
  },

  // Firmware Catalog
  getFirmwareCatalog: async (expand = false): Promise<FirmwareCatalogCategory[]> => {
    const response = await apiClient.get<ApiResponse<FirmwareCatalogCategory[]>>('/system/firmware-catalog', {
      params: expand ? { expand: 'true' } : {},
    });
    return response.data.data;
  },

  bulkAddFirmwareEntries: async (entries: string[]): Promise<BulkAddResult> => {
    const response = await apiClient.post<ApiResponse<BulkAddResult>>('/system/firmware-entries/bulk', { entries });
    return response.data.data;
  },

  // WLAN Configuration
  getWlanConfig: async (): Promise<WlanConfig> => {
    const response = await apiClient.get<ApiResponse<WlanConfig>>('/system/wlan-config');
    return response.data.data;
  },

  setWlanConfig: async (config: { ssid: string; keyMgmt: string; psk?: string }): Promise<WlanConfig> => {
    const response = await apiClient.put<ApiResponse<WlanConfig>>('/system/wlan-config', config);
    return response.data.data;
  },

  deleteWlanConfig: async (): Promise<void> => {
    await apiClient.delete('/system/wlan-config');
  },
};
