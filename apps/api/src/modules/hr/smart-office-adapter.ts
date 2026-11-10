// apps/api/src/modules/hr/smart-office-adapter.ts
// Biometric vendor adapter interface + Smart Office style implementation.
// Safe & sandboxed: API keys are never printed, never logged, never returned in API responses.

export interface NormalizedPunch {
  biometricCode: string;
  punchAt: Date;
  direction?: 'IN' | 'OUT' | null;
  serialNumber?: string | null;
  rawJson?: Record<string, unknown>;
}

export interface VendorAdapter {
  fetchLogs(params: {
    baseUrl: string;
    apiKey: string;
    serialNo?: string | null;
    fromDate: string; // YYYY-MM-DD HH:mm:ss
    toDate: string; // YYYY-MM-DD HH:mm:ss
    timeoutMs?: number;
  }): Promise<{ success: boolean; punches: NormalizedPunch[]; error?: string }>;
}

export class SmartOfficeAdapter implements VendorAdapter {
  async fetchLogs(params: {
    baseUrl: string;
    apiKey: string;
    serialNo?: string | null;
    fromDate: string;
    toDate: string;
    timeoutMs?: number;
  }): Promise<{ success: boolean; punches: NormalizedPunch[]; error?: string }> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), params.timeoutMs ?? 10000);

      // Clean base url
      const url = new URL(params.baseUrl.replace(/\/+$/, '') + '/GetDeviceLogs');
      url.searchParams.set('FromDate', params.fromDate);
      url.searchParams.set('ToDate', params.toDate);
      if (params.serialNo) {
        url.searchParams.set('SerialNumber', params.serialNo);
      }

      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${params.apiKey}`,
          'Accept': 'application/json',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return {
          success: false,
          punches: [],
          error: `HTTP ${response.status}`,
        };
      }

      const body = (await response.json()) as unknown;

      // Handle standard SmartOffice response: { status: true, data: [...] } or direct array
      let rawList: unknown[] = [];
      if (Array.isArray(body)) {
        rawList = body;
      } else if (body && typeof body === 'object') {
        const obj = body as Record<string, unknown>;
        if (obj.status === false) {
          return { success: false, punches: [], error: 'Vendor API returned status: false' };
        }
        if (Array.isArray(obj.data)) {
          rawList = obj.data;
        } else if (Array.isArray(obj.logs)) {
          rawList = obj.logs;
        }
      }

      const punches: NormalizedPunch[] = [];

      for (const item of rawList) {
        if (!item || typeof item !== 'object') continue;
        const row = item as Record<string, unknown>;
        const rawCode = row.EmployeeCode ?? row.UserId ?? row.EnrollNumber;
        const rawTime = row.LogDate ?? row.DateTime ?? row.PunchTime;

        if (!rawCode || !rawTime) continue;

        const codeStr = String(rawCode).trim();
        const timeObj = new Date(String(rawTime));

        if (isNaN(timeObj.getTime())) continue;

        let direction: 'IN' | 'OUT' | null = null;
        if (row.Direction === 'IN' || row.Direction === 1) direction = 'IN';
        if (row.Direction === 'OUT' || row.Direction === 2) direction = 'OUT';

        punches.push({
          biometricCode: codeStr,
          punchAt: timeObj,
          direction,
          serialNumber: row.SerialNumber ? String(row.SerialNumber) : null,
          rawJson: row,
        });
      }

      return { success: true, punches };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      return { success: false, punches: [], error: msg };
    }
  }
}

export const smartOfficeAdapter = new SmartOfficeAdapter();

