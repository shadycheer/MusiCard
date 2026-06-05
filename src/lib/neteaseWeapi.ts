/**
 * Minimal NetEase Cloud Music weapi client.
 *
 * Why this exists: NetEase's official OpenAPI requires AppId-bound device
 * fields and OAuth user login for any business endpoint — even reading a
 * track's title. The community has long used the web client's internal
 * weapi protocol instead (AES-128-CBC + RSA1024 NoPadding, the same wire
 * format YesPlayMusic / NeteaseCloudMusicApi / pyncm all rely on). This
 * file implements just enough of that protocol to fetch song metadata.
 *
 * No external deps — Node's built-in `crypto` covers everything.
 */

import { createCipheriv, publicEncrypt, randomBytes, constants } from 'node:crypto';

const IV = Buffer.from('0102030405060708', 'utf8');
const PRESET_KEY = Buffer.from('0CoJUm6Qyw8W8jud', 'utf8');
const BASE62 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDgtQn2JZ34ZC28NWYpAUd98iZ37BUrX/aKzmFbt7c
lFSs6sXqHauqKWqdtLkF2KexO40H1YTX8z2lSgBBOAxLsvaklV8k4cBFK9snQXE9/DDaFt6Rr7iVZMl
dczhC0JNgTz+SHXT6CBHuX3e9SdB1Ua44oncaTWz7OBGLbCiK45wIDAQAB
-----END PUBLIC KEY-----`;

function aesEncryptCbc(plaintext: string, key: Buffer): string {
  const cipher = createCipheriv('aes-128-cbc', key, IV);
  return Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]).toString(
    'base64',
  );
}

/** Raw RSA encrypt with no padding. The web client left-pads the 16-byte
 *  reversed secret key with zeros to fill the 128-byte modulus, then runs
 *  RSA(plain) — the equivalent of textbook RSA, deliberately insecure but
 *  required by NetEase's server. */
function rsaEncryptNoPadding(plain: string, pem: string): string {
  const padded = Buffer.alloc(128);
  const data = Buffer.from(plain, 'utf8');
  data.copy(padded, 128 - data.length);
  const encrypted = publicEncrypt(
    { key: pem, padding: constants.RSA_NO_PADDING },
    padded,
  );
  return encrypted.toString('hex');
}

function randomSecretKey(): string {
  const bytes = randomBytes(16);
  let s = '';
  for (let i = 0; i < 16; i++) s += BASE62[bytes[i] % BASE62.length];
  return s;
}

/** Encrypt a request body into the {params, encSecKey} pair that weapi
 *  endpoints accept as application/x-www-form-urlencoded body. */
export function weapi(payload: Record<string, unknown>): {
  params: string;
  encSecKey: string;
} {
  const text = JSON.stringify(payload);
  const secret = randomSecretKey();
  const firstPass = aesEncryptCbc(text, PRESET_KEY);
  const params = aesEncryptCbc(firstPass, Buffer.from(secret, 'utf8'));
  // NetEase reverses the secret before RSA — historical quirk of their
  // JavaScript implementation, not a cryptographic requirement.
  const encSecKey = rsaEncryptNoPadding(secret.split('').reverse().join(''), PUBLIC_KEY_PEM);
  return { params, encSecKey };
}

/** Minimal cookie jar matching what NetEase's web client sends on first
 *  visit. No login token — anonymous read access is fine for song detail. */
function defaultCookieHeader(): string {
  const ntesNuid = randomBytes(16).toString('hex');
  return [
    `os=pc`,
    `appver=3.1.17.204416`,
    `osver=Microsoft-Windows-10-Professional-build-19045-64bit`,
    `channel=netease`,
    `__remember_me=true`,
    `_ntes_nuid=${ntesNuid}`,
    `_ntes_nnid=${ntesNuid},${Date.now()}`,
    `NMTID=${randomBytes(8).toString('hex')}`,
  ].join('; ');
}

const WEAPI_BASE = 'https://music.163.com/weapi';

/** POST a weapi-encrypted call. Endpoint here is the *weapi* path
 *  (e.g. /v3/song/detail), not the public OpenAPI route. */
async function callWeapi<T>(endpoint: string, body: Record<string, unknown>): Promise<T> {
  const { params, encSecKey } = weapi(body);
  const form = new URLSearchParams({ params, encSecKey });
  const res = await fetch(`${WEAPI_BASE}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Referer: 'https://music.163.com/',
      Cookie: defaultCookieHeader(),
    },
    body: form.toString(),
  });
  if (!res.ok) throw new Error(`weapi ${endpoint} returned ${res.status}`);
  return (await res.json()) as T;
}

type WeapiSongDetailResponse = {
  code: number;
  songs?: Array<{
    id: number;
    name: string;
    ar?: Array<{ id: number; name: string }>;
    al?: { id: number; name: string; picUrl: string };
  }>;
};

export type WeapiTrack = {
  id: string;
  title: string;
  artist: string;
  album: string;
  coverUrl: string;
};

export async function fetchSongDetailViaWeapi(songId: string): Promise<WeapiTrack> {
  const body = {
    c: JSON.stringify([{ id: songId }]),
    csrf_token: '',
  };
  const data = await callWeapi<WeapiSongDetailResponse>('/v3/song/detail', body);
  if (data.code !== 200) throw new Error(`weapi song_detail code ${data.code}`);
  const song = data.songs?.[0];
  if (!song) throw new Error('weapi song_detail returned no songs');
  return {
    id: String(song.id),
    title: song.name,
    artist: song.ar?.map((a) => a.name).join(', ') ?? '',
    album: song.al?.name ?? '',
    coverUrl: song.al?.picUrl ?? '',
  };
}
