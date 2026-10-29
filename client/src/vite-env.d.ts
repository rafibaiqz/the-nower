/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_SERVER_URL?: string;
  /** 'ws' for the Cloudflare Worker build, otherwise Socket.IO. */
  readonly VITE_TRANSPORT?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
