/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FEEDBACK_URL?: string;
  readonly VITE_CUSTOM_IMAGERY_URL?: string;
  readonly VITE_CUSTOM_IMAGERY_MAXZOOM?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
