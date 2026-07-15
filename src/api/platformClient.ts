import { invoke as tauriInvoke } from '@tauri-apps/api/core';

interface RpcResponse<T> {
  data?: T;
  error?: string;
}

export function isDesktopRuntime(): boolean {
  return '__TAURI_INTERNALS__' in window;
}

export function isWebApiConfigured(): boolean {
  return Boolean(import.meta.env.VITE_FRAUDE_API_URL?.trim());
}

export function isDataRuntimeConfigured(): boolean {
  return isDesktopRuntime() || isWebApiConfigured();
}

export async function invokePlatform<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (isDesktopRuntime()) {
    return tauriInvoke<T>(command, args);
  }

  const apiBase = import.meta.env.VITE_FRAUDE_API_URL?.trim().replace(/\/$/, '');
  if (!apiBase) {
    throw new Error('FRAUDE Web API is not configured. Set VITE_FRAUDE_API_URL.');
  }

  const response = await fetch(`${apiBase}/v1/rpc/${encodeURIComponent(command)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(args ?? {}),
  });
  const payload = await response.json() as RpcResponse<T>;

  if (!response.ok || payload.error) {
    throw new Error(payload.error ?? `FRAUDE API request failed (${response.status}).`);
  }
  if (payload.data === undefined) {
    throw new Error(`FRAUDE API returned no data for ${command}.`);
  }
  return payload.data;
}
