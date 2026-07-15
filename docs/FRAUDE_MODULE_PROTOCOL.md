# FRAUDE Module Update Protocol (FMUP) v0.1

FMUP is the shared module contract for FRAUDE Web and FRAUDE Desktop. The first
iteration deliberately keeps the catalog local. Remote artifacts must not execute
until registry signatures, capability enforcement, staging, and rollback exist.

## Boundaries

- **Core:** the Tauri/Rust shell, web shell, authentication, update engine, and
  capability broker. Only official releases may update core code.
- **Module:** a versioned workspace, widget, or data adapter described by a
  `ModuleManifest`. Modules declare web/desktop targets and capabilities.
- **Overlay:** user-authored changes stored separately from the installed artifact.
  An upstream update never overwrites an overlay without a three-way merge.

## Local v0.1 flow

1. `src/modules/catalog.ts` is the built-in registry.
2. `src/modules/storage.ts` persists enabled module versions per browser profile.
3. The Module Center displays targets, trust channel, compatibility, and permissions.
4. `src/modules/updateEngine.ts` creates a deterministic update plan and an
   AI-provider-neutral conflict prompt.
5. `src/api/platformClient.ts` keeps feature code platform-neutral: commands use
   Tauri IPC on desktop and authenticated `/v1/rpc/{command}` calls on web.
6. Registry release descriptors are verified with an authorized Ed25519 public key.
   Downloaded bytes are independently verified against the signed SHA-256 value.
7. Approved artifacts enter an isolated staging area. Web uses Cache Storage;
   desktop independently downloads and hashes the artifact in Rust.
8. Activation creates a snapshot before changing the active slot. Desktop swaps
   directories atomically inside the Tauri app-data directory; web snapshots the
   installed-module record before changing the active artifact pointer.
9. Rollback restores both the active artifact slot and the previous installed-module
   record. Runtime code loading remains separate from this artifact lifecycle.
10. Remote modules use `declarative-v1`; JavaScript, TypeScript, Rust, shell, HTML,
    and other executable artifact media types are rejected by both web and Rust.
11. Declarative tests run in a short-lived fixed-code Web Worker. Artifact data is
    passed with `postMessage`; it is never evaluated, imported, or injected as HTML.
12. Declarative data requests pass through the core capability broker. The operation,
    declared capability, signed manifest permission, argument schema, timeout, and
    output size must all pass before a request reaches a platform API.

Run `npm run registry:dev` with `VITE_FRAUDE_REGISTRY_URL=http://127.0.0.1:8787`
to exercise the complete local signature, preview, download, and hash verification
flow. The development registry uses an ephemeral key. Its diagnostic artifact is
non-executable and may be activated only to test snapshot and rollback behavior.

## Trust bootstrap

The registry cannot authorize its own signing keys in production. Remote registries
must match an Ed25519 key pinned in `VITE_FRAUDE_TRUST_KEYS`. The value is a JSON
array using the `RegistryTrustKey` shape. Localhost is the only environment allowed
to use an unpinned ephemeral development key.

Private signing keys must live outside the client and outside the repository. A
production registry should use an offline root key, a rotatable release key, key
revocation metadata, immutable artifact URLs, and an auditable contribution log.

## Registry contract

The hosted registry will expose immutable manifests and artifacts by SHA-256:

```text
GET  /v1/channels/{channel}/latest?core={version}&target={web|desktop}
GET  /v1/modules/{id}/releases
GET  /v1/releases/{sha256}
GET  /v1/artifacts/{sha256}
POST /v1/contributions
```

Every remote release must include its parent artifact hash, file-level change
metadata, requested permissions, compatibility range, author identity, and
signature. The client verifies these before producing an update preview.

## Installation invariant

Remote installation is always staged: verify -> preview -> user approval -> merge
-> test -> snapshot -> atomic activation. On a conflict, FRAUDE creates a bounded
conflict bundle and a locally generated fix prompt. AI output is treated only as a
patch and is never applied without validation and explicit approval.

FMUP now creates a versioned `ConflictBundle` containing only the affected paths,
base hashes, overlay hash, and merge constraints. The generated provider-neutral
prompt requests a unified diff only. Patch parsing, sandbox tests, and explicit
post-test approval remain required before AI output can enter staging.

## AI patch security invariant

AI patches are accepted only as unified diffs. The parser rejects file creation,
deletion, rename, traversal paths, oversized patches, overlapping hunks, mismatched
context, and any path outside the release's signed conflict set. Patchable paths are
limited to the module virtual filesystem under `views/`, `data/`, and `locales/`.
Executable extensions such as JS, TS, Rust, and shell are always rejected.

The patched bundle must pass its declared tests in the sandbox. Passing tests only
creates a review result; a separate explicit approval stores the overlay. The signed
base artifact remains immutable, and the overlay hash is recorded independently so
rollback can restore the previous base and overlay state together.

## Capability broker

Modules have no direct network or filesystem primitive. `news.latest`,
`market.snapshot`, and `workspace.read-preferences` are the first broker operations.
Each maps to exactly one manifest permission, uses validated arguments, times out,
caps returned JSON at 64 KB, and writes a metadata-only local audit event. Broker
failure does not grant a fallback capability.

## Contribution workflow

An explicitly approved overlay can be submitted to `POST /v1/contributions` with
its base artifact, overlay hash, unified diff, affected paths, and passing-test count.
The registry validates size and path constraints, deduplicates the client submission,
and returns a `pending-review` receipt. Contributions are untrusted review inputs:
submission never publishes, signs, merges, or activates a release automatically.

Each device creates an Ed25519 contributor identity on demand. The private key is
re-imported as a non-extractable `CryptoKey` and stored in IndexedDB; only its raw
public key, SHA-256 fingerprint, and contribution signature leave the device. The
registry reconstructs the canonical payload, verifies the fingerprint and signature,
and rejects submission-id collisions from another key or overlay.

The development registry persists review records under `FRAUDE_REGISTRY_DATA_DIR`
using atomic file replacement. Review endpoints require the server-only
`FRAUDE_REGISTRY_REVIEW_TOKEN`; this variable must never use the `VITE_` prefix.
Production should replace the token entry UI with authenticated server sessions,
role checks, CSRF protection, a transactional database, and append-only audit logs.

## Client loading

Workspace screens are lazy-loaded on first visit. Already visited tabs stay mounted
to preserve local UI state. This keeps heavy charts, AI rendering, module management,
and secondary workspaces out of the initial JavaScript chunk.
