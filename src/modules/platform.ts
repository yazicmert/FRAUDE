import type { ModuleTarget } from './types';

export function getRuntimeTarget(): ModuleTarget {
  return '__TAURI_INTERNALS__' in window ? 'desktop' : 'web';
}
