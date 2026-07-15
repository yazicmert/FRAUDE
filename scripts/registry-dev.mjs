import { createHash, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve } from 'node:path';

const port = Number(process.env.FRAUDE_REGISTRY_PORT || 8787);
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const publicJwk = publicKey.export({ format: 'jwk' });
const keyId = 'fraude-dev-ephemeral';
const registryDataDir = resolve(process.env.FRAUDE_REGISTRY_DATA_DIR || '.fraude-registry');
const contributionFile = resolve(registryDataDir, 'contributions.json');
const reviewToken = process.env.FRAUDE_REGISTRY_REVIEW_TOKEN || 'fraude-dev-review-token';
mkdirSync(registryDataDir, { recursive: true });

function loadContributions() {
  try {
    const rows = JSON.parse(readFileSync(contributionFile, 'utf8'));
    return new Map(rows.map((row) => [row.id, row]));
  } catch {
    return new Map();
  }
}

const contributions = loadContributions();

function persistContributions() {
  const temporary = `${contributionFile}.tmp`;
  writeFileSync(temporary, JSON.stringify([...contributions.values()], null, 2));
  renameSync(temporary, contributionFile);
}

function contributionReceipt(record) {
  return {
    id: record.id,
    clientSubmissionId: record.clientSubmissionId,
    moduleId: record.moduleId,
    status: record.status,
    submittedAt: record.submittedAt,
    reviewerNote: record.reviewerNote,
    reviewedAt: record.reviewedAt,
  };
}
const artifact = Buffer.from(JSON.stringify({
  schemaVersion: 1,
  moduleId: 'fraude.news',
  version: '0.1.1',
  runtime: { kind: 'declarative-v1' },
  requests: [{
    id: 'workspace-language',
    capability: 'storage:workspace',
    operation: 'workspace.read-preferences',
  }],
  files: [{
    path: 'views/news-feed.json',
    mediaType: 'application/json',
    content: JSON.stringify({ title: 'News security bulletin', summary: 'Signed declarative module content.' }),
  }],
  contributions: [{
    slot: 'module-center',
    kind: 'notice',
    title: { tr: 'Güvenli modül çalıştı', en: 'Secure module loaded' },
    body: {
      tr: 'Bu içerik çalıştırılabilir kod olmadan deklaratif sandbox içinde doğrulandı.',
      en: 'This content was validated in the declarative sandbox without executable code.',
    },
  }],
  tests: [
    { name: 'news-view-json', kind: 'json-valid', path: 'views/news-feed.json' },
    { name: 'signed-content', kind: 'contains', path: 'views/news-feed.json', value: 'Signed declarative' },
  ],
}));
const artifactHash = createHash('sha256').update(artifact).digest('hex');

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return value;
}

function json(response, status, body) {
  response.writeHead(status, {
    'access-control-allow-credentials': 'true',
    'access-control-allow-origin': 'http://127.0.0.1:1420',
    'content-type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(body));
}

function readJson(request, maxBytes = 256_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.byteLength;
      if (size > maxBytes) {
        reject(new Error('payload-too-large'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new Error('invalid-json')); }
    });
    request.on('error', reject);
  });
}

function validateContribution(value) {
  const safePath = /^(?:views|data|locales)\/[a-zA-Z0-9][a-zA-Z0-9._/-]{0,180}$/;
  if (!value || value.schemaVersion !== 1 || !/^fraude\.[a-zA-Z0-9._-]+$/.test(value.moduleId || '')) {
    throw new Error('invalid-contribution');
  }
  if (!/^[a-f0-9]{64}$/i.test(value.overlayHash || '') || typeof value.patch !== 'string' || value.patch.length > 200_000) {
    throw new Error('invalid-overlay');
  }
  if (!Array.isArray(value.changedPaths) || value.changedPaths.length === 0 || value.changedPaths.length > 20) {
    throw new Error('invalid-changed-paths');
  }
  for (const path of value.changedPaths) {
    if (!safePath.test(path) || path.includes('..') || !value.patch.includes(`--- a/${path}`) || !value.patch.includes(`+++ b/${path}`)) {
      throw new Error('unsafe-contribution-path');
    }
  }
  if (!Number.isInteger(value.testsPassed) || value.testsPassed < 1 || typeof value.clientSubmissionId !== 'string') {
    throw new Error('unverified-contribution');
  }
  const provenance = value.provenance;
  if (!provenance || provenance.algorithm !== 'Ed25519' || typeof provenance.publicKey !== 'string') {
    throw new Error('missing-contribution-signature');
  }
  const publicBytes = Buffer.from(provenance.publicKey, 'base64url');
  const expectedKeyId = `ed25519:${createHash('sha256').update(publicBytes).digest('hex')}`;
  if (provenance.keyId !== expectedKeyId || value.contributorId !== expectedKeyId) {
    throw new Error('contributor-key-mismatch');
  }
  const { signature, ...unsignedProvenance } = provenance;
  const payload = JSON.stringify(stableValue({ ...value, provenance: unsignedProvenance }));
  const publicKey = createPublicKey({
    key: { kty: 'OKP', crv: 'Ed25519', x: provenance.publicKey },
    format: 'jwk',
  });
  if (!verify(null, Buffer.from(payload), publicKey, Buffer.from(signature || '', 'base64url'))) {
    throw new Error('invalid-contribution-signature');
  }
}

function authorizedForReview(request) {
  return request.headers.authorization === `Bearer ${reviewToken}`;
}

function createRelease(host) {
  const unsigned = {
    manifest: {
      schemaVersion: 1,
      id: 'fraude.news',
      version: '0.1.1',
      name: { tr: 'Haber Akışı', en: 'News Feed' },
      description: {
        tr: 'FMUP imza ve staging tanılama sürümü.',
        en: 'FMUP signature and staging diagnostic release.',
      },
      kind: 'workspace',
      channel: 'official',
      targets: ['web', 'desktop'],
      compatibility: { fraude: '>=0.1.0 <1.0.0' },
      permissions: ['api:news', 'storage:workspace'],
      navigation: { tabKind: 'news', titleKey: 'newsFeed' },
      artifact: {
        sha256: artifactHash,
        url: `http://${host}/v1/artifacts/${artifactHash}`,
        sizeBytes: artifact.byteLength,
      },
    },
    baseArtifactHash: 'embedded:fraude.news@0.1.0',
    changes: [{
      path: 'views/news-feed.json',
      kind: 'modify',
      summary: {
        tr: 'Geliştirme registry güven zinciri tanılaması.',
        en: 'Development registry trust-chain diagnostic.',
      },
    }],
    releaseNotes: {
      tr: 'İmza, SHA-256, snapshot, aktivasyon ve rollback zincirini test eden çalıştırılamaz tanılama paketi.',
      en: 'A non-executable diagnostic package for testing signature, SHA-256, snapshot, activation, and rollback.',
    },
  };
  const payload = JSON.stringify(stableValue(unsigned));
  return {
    ...unsigned,
    provenance: {
      algorithm: 'Ed25519',
      keyId,
      signature: sign(null, Buffer.from(payload), privateKey).toString('base64url'),
    },
  };
}

createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://${request.headers.host}`);
  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      'access-control-allow-credentials': 'true',
      'access-control-allow-headers': 'authorization, content-type',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-origin': 'http://127.0.0.1:1420',
    });
    response.end();
    return;
  }
  if (request.method === 'GET' && url.pathname === '/v1/trust/keys') {
    json(response, 200, { keys: [{
      id: keyId,
      algorithm: 'Ed25519',
      publicKey: publicJwk.x,
      channels: ['official'],
    }] });
    return;
  }
  if (request.method === 'GET' && url.pathname === '/v1/channels/official/latest') {
    json(response, 200, { releases: [createRelease(request.headers.host || `127.0.0.1:${port}`)] });
    return;
  }
  if (request.method === 'GET' && url.pathname === `/v1/artifacts/${artifactHash}`) {
    response.writeHead(200, {
      'access-control-allow-origin': 'http://127.0.0.1:1420',
      'content-length': artifact.byteLength,
      'content-type': 'application/octet-stream',
    });
    response.end(artifact);
    return;
  }
  if (request.method === 'POST' && url.pathname === '/v1/contributions') {
    try {
      const contribution = await readJson(request);
      validateContribution(contribution);
      const duplicate = [...contributions.values()].find((item) => item.clientSubmissionId === contribution.clientSubmissionId);
      if (duplicate) {
        if (duplicate.contributorId !== contribution.contributorId || duplicate.overlayHash !== contribution.overlayHash) {
          throw new Error('client-submission-id-collision');
        }
        json(response, 200, { contribution: contributionReceipt(duplicate) });
        return;
      }
      const record = {
        id: `ctr_${createHash('sha256').update(JSON.stringify(contribution)).digest('hex').slice(0, 20)}`,
        ...contribution,
        status: 'pending-review',
      };
      contributions.set(record.id, record);
      persistContributions();
      json(response, 202, { contribution: contributionReceipt(record) });
    } catch (error) {
      json(response, 400, { error: String(error.message || error) });
    }
    return;
  }
  if (request.method === 'GET' && url.pathname.startsWith('/v1/contributions/')) {
    const id = decodeURIComponent(url.pathname.slice('/v1/contributions/'.length));
    const contribution = contributions.get(id);
    json(response, contribution ? 200 : 404, contribution ? { contribution: contributionReceipt(contribution) } : { error: 'not-found' });
    return;
  }
  if (request.method === 'GET' && url.pathname === '/v1/review/contributions') {
    if (!authorizedForReview(request)) {
      json(response, 401, { error: 'review-authorization-required' });
      return;
    }
    const status = url.searchParams.get('status');
    const rows = [...contributions.values()]
      .filter((item) => !status || item.status === status)
      .map((item) => ({ ...contributionReceipt(item), contributorId: item.contributorId, changedPaths: item.changedPaths, testsPassed: item.testsPassed }));
    json(response, 200, { contributions: rows });
    return;
  }
  if (request.method === 'POST' && url.pathname.startsWith('/v1/review/contributions/')) {
    if (!authorizedForReview(request)) {
      json(response, 401, { error: 'review-authorization-required' });
      return;
    }
    const id = decodeURIComponent(url.pathname.slice('/v1/review/contributions/'.length));
    const record = contributions.get(id);
    if (!record) {
      json(response, 404, { error: 'not-found' });
      return;
    }
    try {
      const decision = await readJson(request, 16_000);
      if (!['accepted', 'rejected'].includes(decision.status) || typeof decision.note !== 'string' || decision.note.length > 2_000) {
        throw new Error('invalid-review-decision');
      }
      record.status = decision.status;
      record.reviewerNote = decision.note;
      record.reviewedAt = new Date().toISOString();
      persistContributions();
      json(response, 200, { contribution: contributionReceipt(record) });
    } catch (error) {
      json(response, 400, { error: String(error.message || error) });
    }
    return;
  }
  json(response, 404, { error: 'not-found' });
}).listen(port, '127.0.0.1', () => {
  console.log(`FRAUDE development registry listening on http://127.0.0.1:${port}`);
  console.log('Ephemeral signing key generated; no private key is persisted.');
});
