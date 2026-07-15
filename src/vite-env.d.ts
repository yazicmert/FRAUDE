/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FRAUDE_API_URL?: string;
  readonly VITE_FRAUDE_REGISTRY_URL?: string;
  readonly VITE_FRAUDE_TRUST_KEYS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
