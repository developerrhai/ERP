// apps/web/src/lib/logisticsApi.ts
import { request, type RequestOptions } from './api';

async function api<T>(path: string, opts?: RequestOptions): Promise<T> {
  const env = await request<T>(path, opts);
  return env.data;
}

export const logisticsApi = {
  // Fleet
  listVehicles: () => api<any[]>('/vehicles'),
  getVehicle: (id: string) => api<any>(`/vehicles/${id}`),
  createVehicle: (body: any) =>
    api<any>('/vehicles', { method: 'POST', body: JSON.stringify(body) }),
  addVehicleDocument: (id: string, body: any) =>
    api<any>(`/vehicles/${id}/documents`, { method: 'POST', body: JSON.stringify(body) }),
  listDrivers: () => api<any[]>('/drivers'),
  createDriver: (body: any) =>
    api<any>('/drivers', { method: 'POST', body: JSON.stringify(body) }),
  listFuelLogs: (vehicleId?: string) =>
    api<any[]>(`/fuel-logs${vehicleId ? `?vehicleId=${encodeURIComponent(vehicleId)}` : ''}`),
  createFuelLog: (body: any) =>
    api<any>('/fuel-logs', { method: 'POST', body: JSON.stringify(body) }),
  postFuelLog: (id: string) =>
    api<any>(`/fuel-logs/${id}/post`, { method: 'POST' }),
  listServices: (vehicleId?: string) =>
    api<any[]>(`/vehicle-services${vehicleId ? `?vehicleId=${encodeURIComponent(vehicleId)}` : ''}`),
  createService: (body: any) =>
    api<any>('/vehicle-services', { method: 'POST', body: JSON.stringify(body) }),
  postService: (id: string, warehouseId?: string) =>
    api<any>(`/vehicle-services/${id}/post`, { method: 'POST', body: JSON.stringify({ warehouseId }) }),

  // Logistics
  listTransporters: () => api<any[]>('/transporters'),
  upsertTransporterProfile: (supplierId: string, body: any) =>
    api<any>(`/transporters/${supplierId}/profile`, { method: 'POST', body: JSON.stringify(body) }),
  listRoutes: () => api<any[]>('/routes'),
  createRoute: (body: any) =>
    api<any>('/routes', { method: 'POST', body: JSON.stringify(body) }),
  listRateCards: () => api<any[]>('/freight-rate-cards'),
  createRateCard: (body: any) =>
    api<any>('/freight-rate-cards', { method: 'POST', body: JSON.stringify(body) }),
  approveRateCard: (id: string) =>
    api<any>(`/freight-rate-cards/${id}/approve`, { method: 'POST' }),
  calculateFreight: (body: any) =>
    api<any>('/freight/calculate', { method: 'POST', body: JSON.stringify(body) }),
  listFreightCalculations: () => api<any[]>('/freight-calculations'),
  listShipments: (status?: string) =>
    api<any[]>(`/shipments${status ? `?status=${encodeURIComponent(status)}` : ''}`),
  createShipment: (body: any) =>
    api<any>('/shipments', { method: 'POST', body: JSON.stringify(body) }),
  allocateShipment: (id: string, body: any) =>
    api<any>(`/shipments/${id}/allocate`, { method: 'POST', body: JSON.stringify(body) }),
  listTrackingEvents: (id: string) => api<any[]>(`/shipments/${id}/events`),
  addTrackingEvent: (id: string, body: any) =>
    api<any>(`/shipments/${id}/events`, { method: 'POST', body: JSON.stringify(body) }),
  listPods: () => api<any[]>('/pods'),
  recordPod: (body: any) =>
    api<any>('/pods', { method: 'POST', body: JSON.stringify(body) }),
  releasePodBilling: (id: string) =>
    api<any>(`/pods/${id}/release-billing`, { method: 'POST' }),
  listContainers: () => api<any[]>('/containers'),
  createContainer: (body: any) =>
    api<any>('/containers', { method: 'POST', body: JSON.stringify(body) }),
  recordContainerMovement: (id: string, body: any) =>
    api<any>(`/containers/${id}/movements`, { method: 'POST', body: JSON.stringify(body) }),

  // Gate
  listGatePasses: (params?: { direction?: string; passType?: string; status?: string }) => {
    const q = new URLSearchParams();
    if (params?.direction) q.set('direction', params.direction);
    if (params?.passType) q.set('passType', params.passType);
    if (params?.status) q.set('status', params.status);
    const qs = q.toString();
    return api<any[]>(`/gate-passes${qs ? `?${qs}` : ''}`);
  },
  getGatePass: (id: string) => api<any>(`/gate-passes/${id}`),
  createGatePass: (body: any) =>
    api<any>('/gate-passes', { method: 'POST', body: JSON.stringify(body) }),
  approveGatePass: (id: string) =>
    api<any>(`/gate-passes/${id}/approve`, { method: 'POST' }),
  enterGatePass: (id: string, weighInKg?: number) =>
    api<any>(`/gate-passes/${id}/enter`, { method: 'POST', body: JSON.stringify({ weighInKg }) }),
  weighGatePass: (id: string, weighOutKg: number) =>
    api<any>(`/gate-passes/${id}/weigh`, { method: 'POST', body: JSON.stringify({ weighOutKg }) }),
  exitGatePass: (id: string) =>
    api<any>(`/gate-passes/${id}/exit`, { method: 'POST' }),
  recordGateReturn: (inPassId: string, returns: any[]) =>
    api<any>(`/gate-passes/${inPassId}/returns`, { method: 'POST', body: JSON.stringify({ returns }) }),
  getOpenPosForSupplier: (supplierId: string) =>
    api<any[]>(`/gate/open-pos?supplier=${encodeURIComponent(supplierId)}`),
  getPendingDispatchLines: () => api<any[]>('/gate/pending-dispatch'),
  getOverdueReturnables: () => api<any[]>('/gate/overdue-returnables'),

  // DMS
  listFolders: () => api<any[]>('/dms/folders'),
  createFolder: (body: any) =>
    api<any>('/dms/folders', { method: 'POST', body: JSON.stringify(body) }),
  deleteFolder: (id: string) =>
    api<any>(`/dms/folders/${id}`, { method: 'DELETE' }),
  grantFolderAcl: (folderId: string, body: any) =>
    api<any>(`/dms/folders/${folderId}/acl`, { method: 'POST', body: JSON.stringify(body) }),
  searchDocuments: (q: string, folderId?: string, tagCode?: string) => {
    const p = new URLSearchParams({ q });
    if (folderId) p.set('folderId', folderId);
    if (tagCode) p.set('tag', tagCode);
    return api<any[]>(`/dms/search?${p.toString()}`);
  },
  createDocument: (body: any) =>
    api<any>('/dms/documents', { method: 'POST', body: JSON.stringify(body) }),
  checkoutDocument: (id: string) =>
    api<any>(`/dms/documents/${id}/checkout`, { method: 'POST' }),
  checkinDocument: (id: string, body: any) =>
    api<any>(`/dms/documents/${id}/checkin`, { method: 'POST', body: JSON.stringify(body) }),
  rollbackDocument: (id: string, versionNo: number) =>
    api<any>(`/dms/documents/${id}/rollback`, { method: 'POST', body: JSON.stringify({ versionNo }) }),
  setLegalHold: (id: string, legalHold: boolean, reason?: string) =>
    api<any>(`/dms/documents/${id}/hold`, { method: 'POST', body: JSON.stringify({ legalHold, reason }) }),
  createShareLink: (id: string, body: any) =>
    api<any>(`/dms/documents/${id}/share`, { method: 'POST', body: JSON.stringify(body) }),
  listTags: () => api<any[]>('/dms/tags'),
  listDispositions: () => api<any[]>('/dms/dispositions'),
  approveDisposition: (id: string) =>
    api<any>(`/dms/dispositions/${id}/approve`, { method: 'POST' }),
};
