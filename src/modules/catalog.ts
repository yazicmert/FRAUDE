// The module catalog is now derived from the plug-and-play workspace registry.
// See `workspaceRegistry.tsx` — that array is the single place to add or remove
// a module. This file is kept as a stable import surface for existing callers.
export {
  CORE_VERSION,
  moduleCatalog,
  getModuleManifest,
} from './workspaceRegistry';
