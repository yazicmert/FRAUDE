/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FRAUDE_API_URL?: string;
  readonly VITE_FRAUDE_REGISTRY_URL?: string;
  readonly VITE_FRAUDE_TRUST_KEYS?: string;
  /** Tanıtım sitesinin kökü; GitHub girişinin devir sayfası buradan kurulur. */
  readonly VITE_FRAUDE_SITE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
