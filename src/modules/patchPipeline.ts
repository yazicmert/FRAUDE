import { sha256Hex } from './crypto';
import { isSafeModulePath, readStagedModuleBundle, runBundleTestsInSandbox } from './sandboxRuntime';
import type {
  DeclarativeModuleBundle,
  ModuleUpdateCandidate,
  PatchValidationReport,
} from './types';

const OVERLAY_KEY = 'fraude-approved-overlays-v1';
const OVERLAY_CACHE = 'fraude-module-overlays-v1';
const MAX_PATCH_BYTES = 200_000;

export interface ApprovedOverlay {
  moduleId: string;
  version: string;
  overlayHash: string;
  patch: string;
  changedPaths: string[];
  testsPassed: number;
  approvedAt: string;
}

interface ParsedFilePatch {
  path: string;
  hunks: Array<{
    oldStart: number;
    oldCount: number;
    newCount: number;
    lines: string[];
  }>;
}

function parseUnifiedDiff(patch: string): ParsedFilePatch[] {
  if (!patch.trim() || new TextEncoder().encode(patch).byteLength > MAX_PATCH_BYTES) {
    throw new Error('Patch is empty or exceeds the 200 KB limit.');
  }
  const lines = patch.replace(/\r\n/g, '\n').split('\n');
  const files: ParsedFilePatch[] = [];
  let index = 0;
  while (index < lines.length) {
    if (!lines[index].startsWith('--- a/')) {
      if (lines[index] === '') { index += 1; continue; }
      throw new Error(`Unexpected patch line ${index + 1}.`);
    }
    const oldPath = lines[index].slice(6);
    index += 1;
    if (!lines[index]?.startsWith('+++ b/')) throw new Error('Patch is missing a +++ file header.');
    const path = lines[index].slice(6);
    index += 1;
    if (oldPath !== path) throw new Error('File creation, deletion, and rename are not allowed in AI patches.');
    const file: ParsedFilePatch = { path, hunks: [] };
    while (index < lines.length && lines[index].startsWith('@@')) {
      const match = lines[index].match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      if (!match) throw new Error(`Invalid hunk header at line ${index + 1}.`);
      index += 1;
      const hunkLines: string[] = [];
      while (index < lines.length && !lines[index].startsWith('@@') && !lines[index].startsWith('--- a/')) {
        if (lines[index].startsWith('\\ No newline')) { index += 1; continue; }
        if (![' ', '+', '-'].includes(lines[index][0] ?? '')) throw new Error(`Invalid hunk line ${index + 1}.`);
        hunkLines.push(lines[index]);
        index += 1;
      }
      file.hunks.push({
        oldStart: Number(match[1]),
        oldCount: Number(match[2] ?? 1),
        newCount: Number(match[4] ?? 1),
        lines: hunkLines,
      });
    }
    if (file.hunks.length === 0) throw new Error(`Patch for ${path} has no hunks.`);
    files.push(file);
  }
  if (files.length > 20) throw new Error('Patch changes too many files.');
  return files;
}

function applyFilePatch(source: string, patch: ParsedFilePatch): string {
  const sourceLines = source.split('\n');
  const output: string[] = [];
  let sourceIndex = 0;
  for (const hunk of patch.hunks) {
    const target = hunk.oldStart - 1;
    if (target < sourceIndex || target > sourceLines.length) throw new Error(`Overlapping or invalid hunk in ${patch.path}.`);
    output.push(...sourceLines.slice(sourceIndex, target));
    sourceIndex = target;
    let oldSeen = 0;
    let newSeen = 0;
    for (const line of hunk.lines) {
      const marker = line[0];
      const content = line.slice(1);
      if (marker === ' ' || marker === '-') {
        if (sourceLines[sourceIndex] !== content) throw new Error(`Patch context mismatch in ${patch.path}.`);
        sourceIndex += 1;
        oldSeen += 1;
      }
      if (marker === ' ' || marker === '+') {
        output.push(content);
        newSeen += 1;
      }
    }
    if (oldSeen !== hunk.oldCount || newSeen !== hunk.newCount) throw new Error(`Hunk line counts do not match in ${patch.path}.`);
  }
  output.push(...sourceLines.slice(sourceIndex));
  return output.join('\n');
}

function readOverlays(): ApprovedOverlay[] {
  try {
    return JSON.parse(localStorage.getItem(OVERLAY_KEY) ?? '[]') as ApprovedOverlay[];
  } catch {
    return [];
  }
}

export function getApprovedOverlay(moduleId: string, version: string): ApprovedOverlay | undefined {
  return readOverlays().find((item) => item.moduleId === moduleId && item.version === version);
}

export async function validateConflictPatch(
  candidate: ModuleUpdateCandidate,
  patchText: string,
): Promise<PatchValidationReport> {
  const artifact = candidate.release.manifest.artifact;
  if (!artifact) return { valid: false, changedPaths: [], errors: ['Release artifact is missing.'], testsPassed: 0, testsFailed: 0 };
  try {
    const bundle = await readStagedModuleBundle(artifact.sha256, candidate.release.manifest.id, candidate.release.manifest.version);
    const parsed = parseUnifiedDiff(patchText);
    const allowed = new Set(candidate.plan.conflicts.map((change) => change.path));
    const changedPaths = parsed.map((file) => file.path);
    for (const file of parsed) {
      if (!isSafeModulePath(file.path) || !allowed.has(file.path)) {
        throw new Error(`Patch path is outside the signed conflict set: ${file.path}`);
      }
      if (/\.(?:js|mjs|cjs|ts|tsx|sh|rs)$/i.test(file.path)) throw new Error(`Executable source patches are forbidden: ${file.path}`);
      const target = bundle.files.find((item) => item.path === file.path);
      if (!target) throw new Error(`Bundle file not found: ${file.path}`);
      target.content = applyFilePatch(target.content, file);
    }
    const tests = await runBundleTestsInSandbox(bundle);
    const overlayHash = await sha256Hex(new TextEncoder().encode(JSON.stringify(bundle)).buffer as ArrayBuffer);
    return {
      valid: tests.valid,
      changedPaths,
      errors: tests.errors,
      testsPassed: tests.testsPassed,
      testsFailed: tests.testsFailed,
      overlayHash,
      patchedBundle: bundle,
    };
  } catch (error) {
    return { valid: false, changedPaths: [], errors: [String(error)], testsPassed: 0, testsFailed: 0 };
  }
}

export async function approveConflictPatch(
  candidate: ModuleUpdateCandidate,
  patch: string,
  report: PatchValidationReport,
): Promise<string> {
  if (!report.valid || !report.overlayHash || !report.patchedBundle) throw new Error('Only a validated patch can be approved.');
  const overlay: ApprovedOverlay = {
    moduleId: candidate.release.manifest.id,
    version: candidate.release.manifest.version,
    overlayHash: report.overlayHash,
    patch,
    changedPaths: report.changedPaths,
    testsPassed: report.testsPassed,
    approvedAt: new Date().toISOString(),
  };
  const cache = await caches.open(OVERLAY_CACHE);
  await cache.put(
    new Request(`https://overlay.fraude.invalid/${overlay.overlayHash}`),
    new Response(JSON.stringify(report.patchedBundle), { headers: { 'content-type': 'application/json' } }),
  );
  const overlays = readOverlays().filter((item) => !(item.moduleId === overlay.moduleId && item.version === overlay.version));
  localStorage.setItem(OVERLAY_KEY, JSON.stringify([overlay, ...overlays].slice(0, 10)));
  return overlay.overlayHash;
}

export async function readApprovedOverlayBundle(overlayHash: string): Promise<DeclarativeModuleBundle> {
  const cache = await caches.open(OVERLAY_CACHE);
  const response = await cache.match(new Request(`https://overlay.fraude.invalid/${overlayHash}`));
  if (!response) throw new Error('Approved overlay bundle is missing.');
  return response.json() as Promise<DeclarativeModuleBundle>;
}
