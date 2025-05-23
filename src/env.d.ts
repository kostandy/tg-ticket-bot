/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_TEST_SUPABASE_URL: string
  readonly VITE_TEST_SUPABASE_KEY: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
} 