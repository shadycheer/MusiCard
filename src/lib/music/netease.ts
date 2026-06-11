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
    /* Runtime in ms. */
    dt?: number;
  }>;
};

export type WeapiTrack = {
  id: string;
  title: string;
  artist: string;
  albumId: string;
  albumName: string;
  coverUrl: string;
  durationMs: number | null;
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
    albumId: song.al?.id ? String(song.al.id) : '',
    albumName: song.al?.name ?? '',
    coverUrl: song.al?.picUrl ?? '',
    durationMs: song.dt ?? null,
  };
}

/* NOTE: this is the LEGACY /weapi/search/get shape — `artists`, not the
   `ar` of v3 endpoints. The newer /cloudsearch/get/web rejects anonymous
   weapi calls with code 50000005, so legacy search is the one that works
   without a logged-in cookie. */
type WeapiSearchResponse = {
  code: number;
  result?: {
    songs?: Array<{
      id: number;
      name: string;
      artists?: Array<{ id: number; name: string }>;
      /* Runtime in ms. */
      duration?: number;
    }>;
  };
};

/* Same recording, possibly different platform encodings/trailing
   silence — a few seconds of slack. Different VERSIONS (radio edit,
   live) usually differ by far more than this. */
const DURATION_TOLERANCE_MS = 4000;

/* T→S fold for title/artist comparison ("就是愛妳" vs NetEase's
   "就是爱你"). Curated subset instead of opencc-js because npm's
   resolver currently crashes on this lockfile — swap to the real lib
   once that's fixed. Index-aligned string pair. */
const TRAD =
  '愛妳個們來對時過說學國會為與風飛樂聽詩韻還沒開關門問間見親舊夢淚離別邊雙後裡裏點線紅綠藍黃萬億幾兩隻鳥馬魚雲電車東動鐘錯鋼鐵銀願讓誰話語謝請讀寫書畫號處場廣應該條樣機構區醫藥頭臉髮體聲嚴斷繼續終結給絕經統總織緣約純細紙帶幫歸當灣濤漢滿漸燈熱憶懷戀慶憂擱擁擇據揮損換摯敗數斂暈曉曠歡歲殘氣決沖況淺溫滅烏無煙燒爛牽獨現瑪環異發盡眾確禮種籃類練罰義習聯聰肅膽臺興艱蘭蟲術衛計訊記訴詞試誌認誤調談論諾謊證識譯議護讚賣質賴贏輕輸轉辭農運遠適選遺鄉釋長閃陽階隨險靈靜順須預頻顆題顏驚鬆鳴麗齊龍' +
  '這嗎麼陳張劉楊鄭吳趙孫許鄧馮蔣盧蕭葉蘇呂韓羅鍾錢賈韋龔鳳島橋貓豬雞鴨鴿鴻鷹蝦蟹龜鶴煩惱憐憫慟戲劇團圓園壇墻壞壓墊';
const SIMP =
  '爱你个们来对时过说学国会为与风飞乐听诗韵还没开关门问间见亲旧梦泪离别边双后里里点线红绿蓝黄万亿几两只鸟马鱼云电车东动钟错钢铁银愿让谁话语谢请读写书画号处场广应该条样机构区医药头脸发体声严断继续终结给绝经统总织缘约纯细纸带帮归当湾涛汉满渐灯热忆怀恋庆忧搁拥择据挥损换挚败数敛晕晓旷欢岁残气决冲况浅温灭乌无烟烧烂牵独现玛环异发尽众确礼种篮类练罚义习联聪肃胆台兴艰兰虫术卫计讯记诉词试志认误调谈论诺谎证识译议护赞卖质赖赢轻输转辞农运远适选遗乡释长闪阳阶随险灵静顺须预频颗题颜惊松鸣丽齐龙' +
  '这吗么陈张刘杨郑吴赵孙许邓冯蒋卢萧叶苏吕韩罗钟钱贾韦龚凤岛桥猫猪鸡鸭鸽鸿鹰虾蟹龟鹤烦恼怜悯恸戏剧团圆园坛墙坏压垫';

if ([...TRAD].length !== [...SIMP].length) {
  throw new Error('TRAD/SIMP fold tables out of alignment');
}

const T2S = new Map<string, string>();
for (let i = 0; i < TRAD.length; i++) T2S.set(TRAD[i], SIMP[i]);

/* Loose comparison for cross-platform title/artist matching: lowercase,
   fold Traditional→Simplified, strip whitespace and common punctuation
   so "化蝶 (Live)" / "化蝶" and "Kiri T" / "KIRI T" compare equal-ish.
   Exported for the lyrics route's LRCLIB search fallback, which needs
   the same charset-insensitive title comparison. */
export function looseNorm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\s　·•・,，.。'’"“”!！?？\-—–()（）\[\]【】]/g, '')
    .replace(/./gu, (ch) => T2S.get(ch) ?? ch);
}

/** Best-matching NetEase song id for "title artist", or null. A wrong
 *  song's lyrics are worse than none, so every accept path requires a
 *  loose title match plus either an artist overlap or a duration match. */
export async function searchNeteaseSongId(
  title: string,
  artist: string,
  durationMs?: number | null,
): Promise<string | null> {
  const body = {
    s: `${title} ${artist}`,
    type: '1',
    limit: 8,
    offset: 0,
    csrf_token: '',
  };
  const data = await callWeapi<WeapiSearchResponse>('/search/get', body);
  if (data.code !== 200) {
    throw new Error(`weapi search code ${data.code}`);
  }
  const songs = data.result?.songs ?? [];

  const wantTitle = looseNorm(title);
  /* Artist strings arrive as "A, B" / "A & B" / "A、B" — any fragment
     matching any of the song's artists counts. */
  const wantArtists = artist
    .split(/[,&、/]|feat\.?/i)
    .map(looseNorm)
    .filter((a) => a.length > 0);

  for (const [rank, song] of songs.entries()) {
    const gotTitle = looseNorm(song.name ?? '');
    if (!gotTitle) continue;
    const gotArtists = (song.artists ?? []).map((a) => looseNorm(a.name ?? ''));
    const artistExact =
      wantArtists.length > 0 && gotArtists.some((g) => wantArtists.includes(g));
    const artistOk =
      wantArtists.length === 0 ||
      gotArtists.some((g) =>
        wantArtists.some((w) => g === w || g.includes(w) || w.includes(g)),
      );

    const titleOk =
      gotTitle === wantTitle ||
      gotTitle.includes(wantTitle) ||
      wantTitle.includes(gotTitle);
    if (titleOk && artistOk) return String(song.id);

    /* Runtime is charset/language-independent — rescues artist-name
       mismatches (何韻詩 vs Denise Ho) the fold table can't. */
    const durationOk =
      durationMs != null &&
      typeof song.duration === 'number' &&
      song.duration > 0 &&
      Math.abs(song.duration - durationMs) <= DURATION_TOLERANCE_MS;
    if (titleOk && durationOk) return String(song.id);

    /* Variant chars outside the fold table: T→S is char-for-char, so
       both spellings of one title agree at every non-variant position.
       Top result + exact artist only — positional similarity can't
       tell 爱你/愛妳 apart from 爱你/爱我. */
    if (rank === 0 && artistExact && gotTitle.length === wantTitle.length) {
      let same = 0;
      for (let i = 0; i < gotTitle.length; i++) {
        if (gotTitle[i] === wantTitle[i]) same++;
      }
      if (same / gotTitle.length >= 0.5) return String(song.id);
    }
  }
  return null;
}

type WeapiLyricResponse = {
  code: number;
  lrc?: { lyric?: string | null };
  klyric?: { lyric?: string | null };
  tlyric?: { lyric?: string | null };
  romalrc?: { lyric?: string | null };
  // 'nolyric' / 'uncollected' surface as boolean flags on miss responses.
  nolyric?: boolean;
  uncollected?: boolean;
};

/** Pulls plain lyrics from NetEase's /song/lyric weapi endpoint. Returns
 *  null when the track has no lyrics (typical for instrumentals or songs
 *  NetEase hasn't collected yet). Otherwise returns the timestamp-stripped
 *  lines from the original (lrc), ignoring tlyric translations so the
 *  shared card stays in the language the user actually picked. */
export async function fetchLyricViaWeapi(songId: string): Promise<string[] | null> {
  const body = {
    id: songId,
    lv: -1,
    kv: -1,
    tv: -1,
    csrf_token: '',
  };
  const data = await callWeapi<WeapiLyricResponse>('/song/lyric', body);
  if (data.code !== 200) return null;
  if (data.nolyric || data.uncollected) return null;
  const raw = data.lrc?.lyric?.trim();
  if (!raw) return null;
  return raw
    .split(/\r?\n/)
    .map((line) =>
      line
        // Strip per-line `[mm:ss.xxx]` timestamps. NetEase sometimes also
        // emits a leading `[ti:]/[ar:]/[al:]/[by:]` metadata block — those
        // become empty after this filter and get dropped below.
        .replace(/^\s*(?:\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]\s*)+/, '')
        .replace(/^\s*\[(?:ti|ar|al|by|offset|length):[^\]]*\]\s*$/i, '')
        .trim(),
    )
    .filter((line) => line.length > 0)
    // Drop NetEase's inlined credit lines (作词/作曲/编曲/制作 …): they live
    // as regular lyric rows with no special marker, so the LRC-tag filter
    // above misses them. Match either a Chinese colon (：) or ASCII colon
    // following the credit label.
    .filter((line) => !/^(作词|作曲|编曲|制作|出品|监制|混音|母带)\s*[：:]/i.test(line));
}
