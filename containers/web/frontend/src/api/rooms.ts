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

// API response wrapper type
interface ApiResponse<T> {
  data: T;
}

export const roomsApi = {
  list: async (): Promise<Room[]> => {
    const response = await apiClient.get<ApiResponse<Room[]>>('/rooms');
    return response.data.data;
  },

  get: async (id: string): Promise<Room> => {
    const response = await apiClient.get<ApiResponse<Room>>(`/rooms/${id}`);
    return response.data.data;
  },

  create: async (data: CreateRoomData): Promise<Room> => {
    const response = await apiClient.post<ApiResponse<Room>>('/rooms', data);
    return response.data.data;
  },

  update: async (id: string, data: UpdateRoomData): Promise<Room> => {
    const response = await apiClient.patch<ApiResponse<Room>>(`/rooms/${id}`, data);
    return response.data.data;
  },

  delete: async (id: string): Promise<void> => {
    await apiClient.delete(`/rooms/${id}`);
  },

  wakeAll: async (id: string): Promise<{ success: number; failed: number }> => {
    const response = await apiClient.post<ApiResponse<{ success: number; failed: number }>>(
      `/rooms/${id}/wake-all`
    );
    return response.data.data;
  },

  shutdownAll: async (id: string): Promise<{ success: number; failed: number }> => {
    const response = await apiClient.post<ApiResponse<{ success: number; failed: number }>>(
      `/rooms/${id}/shutdown-all`
    );
    return response.data.data;
  },
};
