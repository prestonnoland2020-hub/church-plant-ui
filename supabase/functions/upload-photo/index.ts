// Stores one compressed JPEG for a Field Report record in the private group-photos bucket.
// Auth is the team code (checked with public._check_team), so verify_jwt is off.
// POST /upload-photo?client_id=<uuid>&photo_id=<8 hex>  headers: x-team-code, body: image/jpeg
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-team-code, x-client-info',
  'Access-Control-Max-Age': '86400',
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PHOTO_ID = /^[0-9a-f]{8}$/;
const MAX_BYTES = 3 * 1024 * 1024;

function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return reply(405, { code: 'method', message: 'Use POST' });

  const url = new URL(req.url);
  const clientId = (url.searchParams.get('client_id') || '').toLowerCase();
  const photoId = (url.searchParams.get('photo_id') || '').toLowerCase();
  if (!UUID.test(clientId) || !PHOTO_ID.test(photoId)) {
    return reply(400, { code: '22023', message: 'Bad photo reference' });
  }

  const { error: teamErr } = await sb.rpc('_check_team', { p_team_code: req.headers.get('x-team-code') || '' });
  if (teamErr) {
    if (teamErr.code === '28000') return reply(401, { code: '28000', message: 'Team code is not correct' });
    return reply(500, { code: 'server', message: 'Could not check the team code' });
  }

  const path = `${clientId}/${photoId}.jpg`;

  // Record already saved: its photos are final, so never overwrite them.
  const { data: existing } = await sb.from('groups').select('code').eq('client_id', clientId).maybeSingle();
  if (existing) return reply(200, { path, already_saved: true });

  const declared = Number(req.headers.get('content-length') || 0);
  if (declared > MAX_BYTES) return reply(400, { code: '22023', message: 'Photo is too large' });
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.length > MAX_BYTES) return reply(400, { code: '22023', message: 'Photo is too large' });
  if (bytes.length < 1024 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
    return reply(400, { code: '22023', message: 'Photo must be a JPEG image' });
  }

  const { error: upErr } = await sb.storage.from('group-photos').upload(path, bytes, {
    contentType: 'image/jpeg',
    upsert: true,
  });
  if (upErr) return reply(500, { code: 'server', message: 'Could not store the photo' });

  return reply(200, { path });
});
