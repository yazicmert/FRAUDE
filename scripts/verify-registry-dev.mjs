import { createHash, createPublicKey, generateKeyPairSync, randomUUID, sign, verify } from 'node:crypto';

const baseUrl = process.env.FRAUDE_REGISTRY_URL || 'http://127.0.0.1:8787';

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

const [{ keys }, { releases }] = await Promise.all([
  fetch(`${baseUrl}/v1/trust/keys`).then((response) => response.json()),
  fetch(`${baseUrl}/v1/channels/official/latest?target=web&core=0.1.0`).then((response) => response.json()),
]);
const release = releases[0];
const key = keys.find((item) => item.id === release.provenance.keyId);
if (!key) throw new Error('Signing key is missing.');

const { provenance, ...unsigned } = release;
const publicKey = createPublicKey({
  key: { kty: 'OKP', crv: 'Ed25519', x: key.publicKey },
  format: 'jwk',
});
const signatureValid = verify(
  null,
  Buffer.from(JSON.stringify(stableValue(unsigned))),
  publicKey,
  Buffer.from(provenance.signature, 'base64url'),
);
if (!signatureValid) throw new Error('Release signature is invalid.');

const artifact = Buffer.from(await fetch(release.manifest.artifact.url).then((response) => response.arrayBuffer()));
const artifactHash = createHash('sha256').update(artifact).digest('hex');
if (artifactHash !== release.manifest.artifact.sha256) {
  throw new Error('Artifact SHA-256 does not match the signed release.');
}
const bundle = JSON.parse(artifact.toString('utf8'));
if (bundle.runtime?.kind !== 'declarative-v1' || bundle.moduleId !== release.manifest.id) {
  throw new Error('Artifact is not a matching declarative bundle.');
}
const contributorKeys = generateKeyPairSync('ed25519');
const contributorPublicJwk = contributorKeys.publicKey.export({ format: 'jwk' });
const contributorKeyId = `ed25519:${createHash('sha256').update(Buffer.from(contributorPublicJwk.x, 'base64url')).digest('hex')}`;
const unsignedContribution = {
  schemaVersion: 1,
  clientSubmissionId: randomUUID(),
  contributorId: contributorKeyId,
  moduleId: release.manifest.id,
  baseVersion: '0.1.0',
  targetVersion: release.manifest.version,
  baseArtifactHash: release.baseArtifactHash,
  overlayHash: 'a'.repeat(64),
  patch: '--- a/views/news-feed.json\n+++ b/views/news-feed.json\n@@ -1 +1 @@\n-old\n+new',
  changedPaths: ['views/news-feed.json'],
  testsPassed: 2,
  submittedAt: new Date().toISOString(),
};
const unsignedProvenance = { algorithm: 'Ed25519', keyId: contributorKeyId, publicKey: contributorPublicJwk.x };
const contributionPayload = JSON.stringify(stableValue({ ...unsignedContribution, provenance: unsignedProvenance }));
const testContribution = {
  ...unsignedContribution,
  provenance: {
    ...unsignedProvenance,
    signature: sign(null, Buffer.from(contributionPayload), contributorKeys.privateKey).toString('base64url'),
  },
};
const contributionResponse = await fetch(`${baseUrl}/v1/contributions`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(testContribution),
});
if (contributionResponse.status !== 202) throw new Error('Valid contribution was not queued.');
const { contribution } = await contributionResponse.json();
const receipt = await fetch(`${baseUrl}/v1/contributions/${contribution.id}`).then((response) => response.json());
if (receipt.contribution?.status !== 'pending-review') throw new Error('Contribution receipt was not persisted.');
const unauthorizedReview = await fetch(`${baseUrl}/v1/review/contributions`);
if (unauthorizedReview.status !== 401) throw new Error('Review queue allowed an unauthorized request.');
const reviewToken = process.env.FRAUDE_REGISTRY_REVIEW_TOKEN || 'fraude-dev-review-token';
const reviewResponse = await fetch(`${baseUrl}/v1/review/contributions/${contribution.id}`, {
  method: 'POST',
  headers: { authorization: `Bearer ${reviewToken}`, 'content-type': 'application/json' },
  body: JSON.stringify({ status: 'accepted', note: 'Automated registry verification.' }),
});
if (!reviewResponse.ok) throw new Error('Authorized review decision failed.');
const reviewed = await reviewResponse.json();
if (reviewed.contribution?.status !== 'accepted') throw new Error('Review status was not updated.');
const unsafeResponse = await fetch(`${baseUrl}/v1/contributions`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ ...testContribution, clientSubmissionId: 'unsafe', changedPaths: ['../src/main.ts'] }),
});
if (unsafeResponse.status !== 400) throw new Error('Unsafe contribution path was not rejected.');

console.log(JSON.stringify({
  module: release.manifest.id,
  version: release.manifest.version,
  signatureValid,
  artifactHashValid: true,
  keyId: key.id,
  runtime: bundle.runtime.kind,
  capabilityRequests: bundle.requests.length,
  contributionStatus: contribution.status,
  reviewedStatus: reviewed.contribution.status,
  unauthorizedReviewRejected: true,
  unsafeContributionRejected: true,
}, null, 2));
