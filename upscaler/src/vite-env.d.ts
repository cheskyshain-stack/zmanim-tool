/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  /** Where the "home" button goes, when this build is part of a portal. */
  readonly VITE_PORTAL_HOME?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
