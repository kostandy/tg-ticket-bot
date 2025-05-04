/// <reference types="vite/client" />

// Cloudflare Workers types
interface KVNamespace {
  get(key: string, options?: { type?: 'text' | 'json' | 'arrayBuffer' | 'stream' }): Promise<string | null>;
  put(key: string, value: string | ReadableStream | ArrayBuffer | FormData, options?: { expirationTtl?: number; expiration?: number }): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<{ keys: { name: string; expiration?: number }[]; list_complete: boolean; cursor?: string }>;
}

interface ImportMetaEnv {
  readonly VITE_TEST_SUPABASE_URL: string
  readonly VITE_TEST_SUPABASE_KEY: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
} 