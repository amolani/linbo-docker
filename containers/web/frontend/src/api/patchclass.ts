import apiClient from './client';
import type {
  Patchclass,
  PatchclassDetail,
  DriverSet,
  DriverMap,
  DriverFile,
  DeviceRule,
  PostsyncDeployResult,
  CatalogEntry,
  CatalogCategory,
  CatalogSearchResult,
} from '@/types';

interface ApiResponse<T> {
  data: T;
}

export const patchclassApi = {
  // Patchclass CRUD
  listPatchclasses: async (): Promise<Patchclass[]> => {
    const response = await apiClient.get<ApiResponse<Patchclass[]>>('/patchclass');
    return response.data.data;
  },

  createPatchclass: async (name: string): Promise<Patchclass> => {
    const response = await apiClient.post<ApiResponse<Patchclass>>('/patchclass', { name });
    return response.data.data;
  },

  getPatchclassDetail: async (name: string): Promise<PatchclassDetail> => {
    const response = await apiClient.get<ApiResponse<PatchclassDetail>>(`/patchclass/${encodeURIComponent(name)}`);
    return response.data.data;
  },

  deletePatchclass: async (name: string): Promise<void> => {
    await apiClient.delete(`/patchclass/${encodeURIComponent(name)}`);
  },

  // Driver Map
  getDriverMap: async (name: string): Promise<DriverMap> => {
    const response = await apiClient.get<ApiResponse<DriverMap>>(`/patchclass/${encodeURIComponent(name)}/driver-map`);
    return response.data.data;
  },

  updateDriverMap: async (name: string, map: DriverMap): Promise<DriverMap> => {
    const response = await apiClient.put<ApiResponse<DriverMap>>(`/patchclass/${encodeURIComponent(name)}/driver-map`, map);
    return response.data.data;
  },

  // Driver Sets
  listDriverSets: async (name: string): Promise<DriverSet[]> => {
    const response = await apiClient.get<ApiResponse<DriverSet[]>>(`/patchclass/${encodeURIComponent(name)}/driver-sets`);
    return response.data.data;
  },

  createDriverSet: async (pcName: string, setName: string): Promise<DriverSet> => {
    const response = await apiClient.post<ApiResponse<DriverSet>>(
      `/patchclass/${encodeURIComponent(pcName)}/driver-sets`,
      { name: setName }
    );
    return response.data.data;
  },

  deleteDriverSet: async (pcName: string, setName: string): Promise<void> => {
    await apiClient.delete(`/patchclass/${encodeURIComponent(pcName)}/driver-sets/${encodeURIComponent(setName)}`);
  },

  // Files
  listDriverSetFiles: async (pcName: string, setName: string): Promise<DriverFile[]> => {
    const response = await apiClient.get<ApiResponse<DriverFile[]>>(
      `/patchclass/${encodeURIComponent(pcName)}/driver-sets/${encodeURIComponent(setName)}/files`
    );
    return response.data.data;
  },

  uploadDriverFile: async (pcName: string, setName: string, file: File, relPath?: string): Promise<{ path: string; size: number }> => {
    const formData = new FormData();
    formData.append('file', file);
    if (relPath) formData.append('path', relPath);

    const response = await apiClient.post<ApiResponse<{ path: string; size: number }>>(
      `/patchclass/${encodeURIComponent(pcName)}/driver-sets/${encodeURIComponent(setName)}/upload`,
      formData,
      { headers: { 'Content-Type': 'multipart/form-data' } }
    );
    return response.data.data;
  },

  extractDriverZip: async (pcName: string, setName: string, file: File): Promise<{ entryCount: number; totalUncompressed: number }> => {
    const formData = new FormData();
    formData.append('file', file);

    const response = await apiClient.post<ApiResponse<{ entryCount: number; totalUncompressed: number }>>(
      `/patchclass/${encodeURIComponent(pcName)}/driver-sets/${encodeURIComponent(setName)}/extract`,
      formData,
      { headers: { 'Content-Type': 'multipart/form-data' } }
    );
    return response.data.data;
  },

  deleteDriverFile: async (pcName: string, setName: string, filePath: string): Promise<void> => {
    await apiClient.delete(
      `/patchclass/${encodeURIComponent(pcName)}/driver-sets/${encodeURIComponent(setName)}/files`,
      { data: { path: filePath } }
    );
  },

  // Device Rules
  addDeviceRule: async (pcName: string, rule: Omit<DeviceRule, 'category'> & { category?: string }): Promise<DriverMap> => {
    const response = await apiClient.post<ApiResponse<DriverMap>>(
      `/patchclass/${encodeURIComponent(pcName)}/device-rules`,
      rule
    );
    return response.data.data;
  },

  removeDeviceRule: async (pcName: string, ruleName: string): Promise<DriverMap> => {
    const response = await apiClient.delete<ApiResponse<DriverMap>>(
      `/patchclass/${encodeURIComponent(pcName)}/device-rules/${encodeURIComponent(ruleName)}`
    );
    return response.data.data;
  },

  // Catalog
  getCatalog: async (): Promise<{ categories: CatalogCategory[]; catalog: CatalogEntry[] }> => {
    const response = await apiClient.get<ApiResponse<{ categories: CatalogCategory[]; catalog: CatalogEntry[] }>>(
      '/patchclass/catalog'
    );
    return response.data.data;
  },

  searchCatalog: async (query: string): Promise<CatalogSearchResult[]> => {
    const response = await apiClient.get<ApiResponse<CatalogSearchResult[]>>(
      `/patchclass/catalog/search?q=${encodeURIComponent(query)}`
    );
    return response.data.data;
  },

  // Postsync
  deployPostsync: async (pcName: string, imageName: string): Promise<PostsyncDeployResult> => {
    const response = await apiClient.post<ApiResponse<PostsyncDeployResult>>(
      `/patchclass/${encodeURIComponent(pcName)}/deploy-postsync/${encodeURIComponent(imageName)}`
    );
    return response.data.data;
  },
};
