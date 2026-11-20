import { createClient } from '@supabase/supabase-js';
export interface AudioStorage {
  upload(key: string, data: Buffer, contentType: string): Promise<void>;
  download(key: string): Promise<Buffer>;
  remove(keys: string[]): Promise<void>;
  playback(key: string): Promise<string>;
}
export function storage(): AudioStorage {
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const bucket = client.storage.from(process.env.STORAGE_BUCKET || 'quiz-audio');
  return {
    async upload(key, data, contentType) {
      const { error } = await bucket.upload(key, data, { contentType, upsert: false });
      if (error) throw error;
    },
    async download(key) {
      const { data, error } = await bucket.download(key);
      if (error) throw error;
      return Buffer.from(await data!.arrayBuffer());
    },
    async remove(keys) {
      if (!keys.length) return;
      const { error } = await bucket.remove(keys);
      if (error) throw error;
    },
    async playback(key) {
      const { data, error } = await bucket.createSignedUrl(key, 120);
      if (error) throw error;
      return data!.signedUrl;
    },
  };
}
