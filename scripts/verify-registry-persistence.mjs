const baseUrl = process.env.FRAUDE_REGISTRY_URL || 'http://127.0.0.1:8787';
const reviewToken = process.env.FRAUDE_REGISTRY_REVIEW_TOKEN || 'fraude-dev-review-token';
const response = await fetch(`${baseUrl}/v1/review/contributions`, {
  headers: { authorization: `Bearer ${reviewToken}` },
});
if (!response.ok) throw new Error(`Review queue failed (${response.status}).`);
const { contributions } = await response.json();
const persisted = contributions.find((item) => item.status === 'accepted' && item.reviewedAt);
if (!persisted) throw new Error('No accepted contribution survived registry restart.');
console.log(JSON.stringify({
  persistenceValid: true,
  contributionId: persisted.id,
  status: persisted.status,
  reviewedAt: persisted.reviewedAt,
}, null, 2));
