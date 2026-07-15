import type {
  DeclarativeModuleBundle,
  ModuleManifest,
  SandboxValidationReport,
} from './types';

const CACHE_NAME = 'fraude-module-staging-v1';
const MAX_BUNDLE_BYTES = 2 * 1024 * 1024;
const SAFE_PATH = /^(?:views|data|locales)\/[a-zA-Z0-9][a-zA-Z0-9._/-]{0,180}$/;

export function isSafeModulePath(path: string): boolean {
  return SAFE_PATH.test(path)
    && !path.includes('..')
    && !path.startsWith('/')
    && !path.includes('\\');
}

function validateBundleShape(
  value: unknown,
  moduleId: ModuleManifest['id'],
  version: string,
): DeclarativeModuleBundle {
  if (!value || typeof value !== 'object') throw new Error('Module bundle must be an object.');
  const bundle = value as DeclarativeModuleBundle;
  if (bundle.schemaVersion !== 1) throw new Error('Unsupported module bundle schema.');
  if (bundle.moduleId !== moduleId || bundle.version !== version) {
    throw new Error('Bundle identity does not match the signed release.');
  }
  if (bundle.runtime?.kind !== 'declarative-v1') {
    throw new Error('Executable module runtimes are not allowed.');
  }
  if (!Array.isArray(bundle.requests) || bundle.requests.length > 10) throw new Error('Invalid capability request list.');
  if (!Array.isArray(bundle.files) || bundle.files.length > 100) throw new Error('Invalid module file list.');
  if (!Array.isArray(bundle.contributions) || bundle.contributions.length > 25) throw new Error('Invalid contribution list.');
  if (!Array.isArray(bundle.tests) || bundle.tests.length > 100) throw new Error('Invalid module test list.');

  const seen = new Set<string>();
  for (const file of bundle.files) {
    if (!isSafeModulePath(file.path) || seen.has(file.path)) throw new Error(`Unsafe or duplicate module path: ${file.path}`);
    if (!['application/json', 'text/plain'].includes(file.mediaType)) throw new Error(`Executable media type rejected: ${file.path}`);
    if (typeof file.content !== 'string' || file.content.length > 256_000) throw new Error(`Invalid module file content: ${file.path}`);
    seen.add(file.path);
  }
  for (const contribution of bundle.contributions) {
    if (contribution.slot !== 'module-center' || contribution.kind !== 'notice') {
      throw new Error('Unsupported module contribution.');
    }
    if (!contribution.title?.tr || !contribution.title?.en || !contribution.body?.tr || !contribution.body?.en) {
      throw new Error('Contribution translations are incomplete.');
    }
  }
  for (const test of bundle.tests) {
    if (!seen.has(test.path) || !['json-valid', 'contains'].includes(test.kind)) {
      throw new Error(`Invalid bundle test: ${test.name}`);
    }
  }
  return bundle;
}

export function parseModuleBundle(
  bytes: ArrayBuffer,
  moduleId: ModuleManifest['id'],
  version: string,
): DeclarativeModuleBundle {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_BUNDLE_BYTES) throw new Error('Module bundle size is invalid.');
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error('Module artifact is not valid JSON.');
  }
  return validateBundleShape(value, moduleId, version);
}

export async function readStagedModuleBundle(
  artifactHash: string,
  moduleId: ModuleManifest['id'],
  version: string,
): Promise<DeclarativeModuleBundle> {
  const cache = await caches.open(CACHE_NAME);
  const response = await cache.match(new Request(`https://staging.fraude.invalid/${artifactHash}`));
  if (!response) throw new Error('Verified staging artifact is missing.');
  return parseModuleBundle(await response.arrayBuffer(), moduleId, version);
}

export async function runBundleTestsInSandbox(
  bundle: DeclarativeModuleBundle,
): Promise<SandboxValidationReport> {
  const workerSource = `self.onmessage = ({data}) => {
    const errors = [];
    let passed = 0;
    for (const test of data.tests) {
      const file = data.files.find((item) => item.path === test.path);
      try {
        if (!file) throw new Error('file-not-found');
        if (test.kind === 'json-valid') JSON.parse(file.content);
        else if (test.kind === 'contains' && !file.content.includes(test.value || '')) throw new Error('value-not-found');
        passed += 1;
      } catch (error) { errors.push(test.name + ': ' + String(error)); }
    }
    self.postMessage({valid: errors.length === 0, testsPassed: passed, testsFailed: errors.length, errors});
  };`;
  const url = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
  try {
    return await new Promise<SandboxValidationReport>((resolve, reject) => {
      const worker = new Worker(url);
      const timeout = window.setTimeout(() => {
        worker.terminate();
        reject(new Error('Sandbox test timeout.'));
      }, 3_000);
      worker.onmessage = (event: MessageEvent<SandboxValidationReport>) => {
        window.clearTimeout(timeout);
        worker.terminate();
        resolve(event.data);
      };
      worker.onerror = () => {
        window.clearTimeout(timeout);
        worker.terminate();
        reject(new Error('Sandbox worker failed.'));
      };
      worker.postMessage({ files: bundle.files, tests: bundle.tests });
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
