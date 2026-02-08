import apiClient from './client';
import type { KernelVariant, KernelStatus, KernelSwitchResponse } from '@/types';

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
};
