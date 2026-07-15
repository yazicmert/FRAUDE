import { getDashboardSnapshot, getNewsFeed } from '../api/tauriClient';
import type {
  DeclarativeModuleBundle,
  ModuleCapabilityRequest,
  ModuleCapabilityResult,
  ModuleManifest,
  ModulePermission,
} from './types';

const AUDIT_KEY = 'fraude-capability-audit-v1';
const MAX_RESULT_BYTES = 64_000;
const OPERATION_PERMISSIONS: Record<ModuleCapabilityRequest['operation'], ModulePermission> = {
  'news.latest': 'api:news',
  'market.snapshot': 'api:market-data',
  'workspace.read-preferences': 'storage:workspace',
};

interface AuditEvent {
  moduleId: string;
  requestId: string;
  operation: string;
  status: ModuleCapabilityResult['status'];
  timestamp: string;
  durationMs: number;
}

function audit(event: AuditEvent) {
  try {
    const current = JSON.parse(localStorage.getItem(AUDIT_KEY) ?? '[]') as AuditEvent[];
    localStorage.setItem(AUDIT_KEY, JSON.stringify([event, ...current].slice(0, 200)));
  } catch {
    // Auditing must never grant or retry a capability.
  }
}

function validateRequest(request: ModuleCapabilityRequest, manifest: ModuleManifest) {
  if (!/^[a-z][a-z0-9._-]{0,63}$/i.test(request.id)) throw new Error('Invalid capability request id.');
  const required = OPERATION_PERMISSIONS[request.operation];
  if (!required || request.capability !== required || !manifest.permissions.includes(required)) {
    throw new Error(`Capability not declared by signed manifest: ${request.operation}`);
  }
  if (request.operation === 'news.latest' && request.args?.ticker) {
    if (typeof request.args.ticker !== 'string' || !/^[A-Z0-9.]{1,16}$/.test(request.args.ticker)) {
      throw new Error('Invalid news ticker argument.');
    }
  }
}

export function validateBundleCapabilities(bundle: DeclarativeModuleBundle, manifest: ModuleManifest) {
  if (!Array.isArray(bundle.requests) || bundle.requests.length > 10) throw new Error('Invalid capability request list.');
  const ids = new Set<string>();
  for (const request of bundle.requests) {
    validateRequest(request, manifest);
    if (ids.has(request.id)) throw new Error(`Duplicate capability request id: ${request.id}`);
    ids.add(request.id);
  }
}

async function executeOperation(request: ModuleCapabilityRequest): Promise<unknown> {
  if (request.operation === 'news.latest') {
    const rows = await getNewsFeed(typeof request.args?.ticker === 'string' ? request.args.ticker : undefined);
    return rows.slice(0, 10).map(({ title, link, pub_date, source, ticker, is_kap }) => ({
      title, link, pub_date, source, ticker, is_kap,
    }));
  }
  if (request.operation === 'market.snapshot') {
    const snapshot = await getDashboardSnapshot();
    return { generated_at: snapshot.generated_at, market_metrics: snapshot.market_metrics };
  }
  if (request.operation === 'workspace.read-preferences') {
    return { language: localStorage.getItem('i18nextLng') ?? 'tr' };
  }
  throw new Error('Unsupported broker operation.');
}

export async function executeCapabilityRequests(
  bundle: DeclarativeModuleBundle,
  manifest: ModuleManifest,
): Promise<ModuleCapabilityResult[]> {
  return Promise.all(bundle.requests.map(async (request) => {
    const startedAt = performance.now();
    let result: ModuleCapabilityResult;
    try {
      validateRequest(request, manifest);
      const data = await Promise.race([
        executeOperation(request),
        new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error('Capability timeout.')), 8_000)),
      ]);
      if (new TextEncoder().encode(JSON.stringify(data)).byteLength > MAX_RESULT_BYTES) {
        throw new Error('Capability result exceeded 64 KB.');
      }
      result = { requestId: request.id, status: 'fulfilled', data, durationMs: performance.now() - startedAt };
    } catch (error) {
      const denied = String(error).includes('not declared');
      result = {
        requestId: request.id,
        status: denied ? 'denied' : 'failed',
        error: String(error),
        durationMs: performance.now() - startedAt,
      };
    }
    audit({
      moduleId: manifest.id,
      requestId: request.id,
      operation: request.operation,
      status: result.status,
      timestamp: new Date().toISOString(),
      durationMs: result.durationMs,
    });
    return result;
  }));
}
