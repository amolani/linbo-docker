import apiClient from './client';
import type { HostGroup } from '@/types';

export interface CreateGroupData {
  name: string;
  description?: string;
  defaultConfigId?: string;
  defaults?: Record<string, unknown>;
}

export interface UpdateGroupData {
  name?: string;
  description?: string;
  defaultConfigId?: string | null;
  defaults?: Record<string, unknown>;
}

export const groupsApi = {
  list: async (): Promise<HostGroup[]> => {
    const response = await apiClient.get<HostGroup[]>('/groups');
    return response.data;
  },

  get: async (id: string): Promise<HostGroup> => {
    const response = await apiClient.get<HostGroup>(`/groups/${id}`);
    return response.data;
  },

  create: async (data: CreateGroupData): Promise<HostGroup> => {
    const response = await apiClient.post<HostGroup>('/groups', data);
    return response.data;
  },

  update: async (id: string, data: UpdateGroupData): Promise<HostGroup> => {
    const response = await apiClient.patch<HostGroup>(`/groups/${id}`, data);
    return response.data;
  },

  delete: async (id: string): Promise<void> => {
    await apiClient.delete(`/groups/${id}`);
  },

  applyConfig: async (id: string, configId: string): Promise<{ success: boolean; updated: number }> => {
    const response = await apiClient.post<{ success: boolean; updated: number }>(
      `/groups/${id}/apply-config`,
      { configId }
    );
    return response.data;
  },

  wakeAll: async (id: string): Promise<{ success: number; failed: number }> => {
    const response = await apiClient.post<{ success: number; failed: number }>(
      `/groups/${id}/wake-all`
    );
    return response.data;
  },
};
