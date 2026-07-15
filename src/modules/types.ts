export type ModuleTarget = 'web' | 'desktop';
export type ModuleChannel = 'official' | 'verified' | 'community' | 'local';
export type ModuleKind = 'workspace' | 'widget' | 'data-adapter';
export type ModulePermission =
  | `api:${string}`
  | `network:${string}`
  | `storage:${string}`
  | `ui:${string}`;

export interface LocalizedText {
  tr: string;
  en: string;
}

export interface ModuleNavigation {
  // Tab kinds are open-ended so a new plug-in module can declare its own
  // without editing this union. The registry key is the source of truth.
  tabKind: string;
  titleKey: string;
}

export interface ModuleManifest {
  schemaVersion: 1;
  id: `fraude.${string}`;
  version: string;
  name: LocalizedText;
  description: LocalizedText;
  kind: ModuleKind;
  channel: ModuleChannel;
  targets: ModuleTarget[];
  compatibility: {
    fraude: string;
  };
  permissions: ModulePermission[];
  navigation?: ModuleNavigation;
  entrypoints?: Partial<Record<ModuleTarget, string>>;
  artifact?: {
    sha256: string;
    url: string;
    sizeBytes?: number;
  };
}

export interface InstalledModule {
  id: ModuleManifest['id'];
  version: string;
  enabled: boolean;
  installedAt: string;
  artifactHash: string;
  localOverlayHash?: string;
}

export interface ModuleChange {
  path: string;
  kind: 'add' | 'modify' | 'remove';
  summary: LocalizedText;
  baseHash?: string;
}

export interface ModuleRelease {
  manifest: ModuleManifest;
  baseArtifactHash: string;
  changes: ModuleChange[];
  releaseNotes: LocalizedText;
  provenance: {
    algorithm: 'Ed25519';
    keyId: string;
    signature: string;
  };
}

export interface ModuleUpdatePlan {
  moduleId: ModuleManifest['id'];
  fromVersion: string;
  toVersion: string;
  compatible: boolean;
  baseMatches: boolean;
  addedPermissions: ModulePermission[];
  changes: ModuleChange[];
  conflicts: ModuleChange[];
  requiresApproval: boolean;
}

export interface RegistryTrustKey {
  id: string;
  algorithm: 'Ed25519';
  publicKey: string;
  channels: ModuleChannel[];
  revokedAt?: string;
}

export interface ReleaseVerification {
  verified: boolean;
  keyId: string;
  reason?: string;
}

export interface ModuleUpdateCandidate {
  installed: InstalledModule;
  release: ModuleRelease;
  verification: ReleaseVerification;
  plan: ModuleUpdatePlan;
}

export type StagingStatus =
  | 'discovered'
  | 'verified'
  | 'approved'
  | 'staged'
  | 'activated'
  | 'rolled_back'
  | 'failed';

export interface StagingRecord {
  id: string;
  moduleId: ModuleManifest['id'];
  fromVersion: string;
  toVersion: string;
  artifactHash: string;
  status: StagingStatus;
  createdAt: string;
  updatedAt: string;
  snapshotId?: string;
  error?: string;
}

export interface ModuleActivationResult {
  moduleId: ModuleManifest['id'];
  version: string;
  artifactHash: string;
  snapshotId?: string;
  runtime: ModuleTarget;
}

export interface ConflictBundle {
  schemaVersion: 1;
  moduleId: ModuleManifest['id'];
  fromVersion: string;
  toVersion: string;
  installedArtifactHash: string;
  incomingBaseArtifactHash: string;
  localOverlayHash?: string;
  files: Array<ModuleChange & { reason: 'local-overlay-modified' | 'base-mismatch' }>;
  constraints: {
    preserveLocalChanges: true;
    rejectNewPermissions: true;
    output: 'unified-diff';
  };
}

export interface DeclarativeModuleBundle {
  schemaVersion: 1;
  moduleId: ModuleManifest['id'];
  version: string;
  runtime: { kind: 'declarative-v1' };
  requests: ModuleCapabilityRequest[];
  files: Array<{
    path: string;
    mediaType: 'application/json' | 'text/plain';
    content: string;
  }>;
  contributions: Array<{
    slot: 'module-center';
    kind: 'notice';
    title: LocalizedText;
    body: LocalizedText;
  }>;
  tests: Array<{
    name: string;
    kind: 'json-valid' | 'contains';
    path: string;
    value?: string;
  }>;
}

export interface ModuleCapabilityRequest {
  id: string;
  capability: ModulePermission;
  operation: 'news.latest' | 'market.snapshot' | 'workspace.read-preferences';
  args?: Record<string, string | number | boolean>;
}

export interface ModuleCapabilityResult {
  requestId: string;
  status: 'fulfilled' | 'denied' | 'failed';
  data?: unknown;
  error?: string;
  durationMs: number;
}

export interface ModuleContribution {
  schemaVersion: 1;
  clientSubmissionId: string;
  contributorId: string;
  moduleId: ModuleManifest['id'];
  baseVersion: string;
  targetVersion: string;
  baseArtifactHash: string;
  overlayHash: string;
  patch: string;
  changedPaths: string[];
  testsPassed: number;
  submittedAt: string;
  provenance: {
    algorithm: 'Ed25519';
    keyId: string;
    publicKey: string;
    signature: string;
  };
}

export interface ModuleContributionReceipt {
  id: string;
  clientSubmissionId: string;
  moduleId: ModuleManifest['id'];
  status: 'pending-review' | 'accepted' | 'rejected';
  submittedAt: string;
  reviewerNote?: string;
  reviewedAt?: string;
}

export interface SandboxValidationReport {
  valid: boolean;
  testsPassed: number;
  testsFailed: number;
  errors: string[];
}

export interface PatchValidationReport {
  valid: boolean;
  changedPaths: string[];
  errors: string[];
  testsPassed: number;
  testsFailed: number;
  overlayHash?: string;
  patchedBundle?: DeclarativeModuleBundle;
}
