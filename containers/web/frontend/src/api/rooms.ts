import apiClient from './client';
import type { Room } from '@/types';

export interface CreateRoomData {
  name: string;
  description?: string;
  location?: string;
}

export interface UpdateRoomData {
  name?: string;
  description?: string;
  location?: string;
}

export const roomsApi = {
  list: async (): Promise<Room[]> => {
    const response = await apiClient.get<Room[]>('/rooms');
    return response.data;
  },

  get: async (id: string): Promise<Room> => {
    const response = await apiClient.get<Room>(`/rooms/${id}`);
    return response.data;
  },

  create: async (data: CreateRoomData): Promise<Room> => {
    const response = await apiClient.post<Room>('/rooms', data);
    return response.data;
  },

  update: async (id: string, data: UpdateRoomData): Promise<Room> => {
    const response = await apiClient.patch<Room>(`/rooms/${id}`, data);
    return response.data;
  },

  delete: async (id: string): Promise<void> => {
    await apiClient.delete(`/rooms/${id}`);
  },

  wakeAll: async (id: string): Promise<{ success: number; failed: number }> => {
    const response = await apiClient.post<{ success: number; failed: number }>(
      `/rooms/${id}/wake-all`
    );
    return response.data;
  },

  shutdownAll: async (id: string): Promise<{ success: number; failed: number }> => {
    const response = await apiClient.post<{ success: number; failed: number }>(
      `/rooms/${id}/shutdown-all`
    );
    return response.data;
  },
};
