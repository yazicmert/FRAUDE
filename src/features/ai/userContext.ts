export interface UserActionLog {
  timestamp: string;
  action: string;
  detail?: string;
  module?: string;
}

export interface GlobalUserContext {
  activeModule: string;
  recentActions: UserActionLog[];
  activePayload?: Record<string, unknown> | null;
}

const listeners: Set<() => void> = new Set();
const currentContext: GlobalUserContext = {
  activeModule: 'Pano',
  recentActions: [],
  activePayload: null,
};

export function setCopilotModule(moduleName: string) {
  if (currentContext.activeModule === moduleName) return;
  currentContext.activeModule = moduleName;
  recordCopilotAction(`Modüle Geçildi: ${moduleName}`);
}

export function setCopilotActivePayload(payload: Record<string, unknown> | null) {
  currentContext.activePayload = payload;
  notifyCopilot();
}

export function recordCopilotAction(action: string, detail?: string) {
  const log: UserActionLog = {
    timestamp: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    action,
    detail,
    module: currentContext.activeModule,
  };
  currentContext.recentActions = [log, ...currentContext.recentActions.slice(0, 7)];
  notifyCopilot();
}

export function getCopilotContext(): GlobalUserContext {
  return currentContext;
}

export function subscribeCopilot(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notifyCopilot() {
  listeners.forEach((l) => l());
}
