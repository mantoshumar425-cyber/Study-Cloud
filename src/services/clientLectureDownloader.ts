import muxjs from 'mux.js';

export interface BrowserDownloadProgress {
  percent: number;
  downloadedBytes: number;
  processedSecs: number;
  totalDurationSecs: number;
}

export interface BrowserDownloadParams {
  url: string;
  format: 'mp4' | 'm4a';
  isDirectMp4?: boolean;
  durationSecs?: number;
  signal?: AbortSignal;
  onProgress?: (progress: BrowserDownloadProgress) => void;
}

export interface BrowserDownloadResult {
  blob: Blob;
  sizeBytes: number;
  durationSecs: number;
  mimeType: string;
}

interface HlsKeyInfo {
  method: string;
  uri: string;
  ivHex?: string;
}

interface HlsSegmentItem {
  index: number;
  url: string;
  duration: number;
  keyInfo: HlsKeyInfo | null;
  mapUri: string | null;
}

const MP4_RANGE_CHUNK_BYTES = 3 * 1024 * 1024; // 3MB (< Vercel 4.5MB response limit)

function toHlsProxyUrl(rawUrl: string): string {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('/api/hls-proxy')) return trimmed;
  try {
    const parsed = new URL(trimmed, window.location.origin);
    if (parsed.pathname === '/api/hls-proxy') {
      return `${parsed.pathname}${parsed.search}`;
    }
    const sig = parsed.search ? parsed.search.slice(1) : '';
    return `/api/hls-proxy?url=${encodeURIComponent(trimmed)}${sig ? `&sig=${encodeURIComponent(sig)}` : ''}`;
  } catch {
    return `/api/hls-proxy?url=${encodeURIComponent(trimmed)}`;
  }
}

function resolveRelativeUrl(uri: string, baseUrl: string): string {
  const trimmed = uri.trim();
  if (!trimmed) return trimmed;
  if (trimmed.startsWith('/api/') || trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed;
  }
  try {
    return new URL(trimmed, baseUrl).toString();
  } catch {
    return trimmed;
  }
}

function parseAttributes(attrLine: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const regex = /([A-Z0-9-]+)=("([^"]*)"|([^,]*))/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(attrLine)) !== null) {
    const key = match[1].toUpperCase();
    const val = match[3] !== undefined ? match[3] : match[4];
    attrs[key] = (val || '').trim();
  }
  return attrs;
}

function buildIvBytes(ivHex: string | undefined, sequenceNum: number): Uint8Array<ArrayBuffer> {
  const iv = new Uint8Array(new ArrayBuffer(16));
  if (ivHex) {
    const clean = ivHex.replace(/^0x/i, '').padStart(32, '0').slice(-32);
    for (let i = 0; i < 16; i++) {
      iv[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16) || 0;
    }
    return iv;
  }
  // RFC 8216 default IV: 16-byte big-endian media sequence number
  let val = Math.max(0, Math.floor(sequenceNum));
  for (let i = 15; i >= 8 && val > 0; i--) {
    iv[i] = val & 0xff;
    val = Math.floor(val / 256);
  }
  return iv;
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  attempts = 3
): Promise<Response> {
  let lastErr: any;
  for (let i = 0; i < attempts; i++) {
    if (init.signal?.aborted) {
      throw new DOMException('Download cancelled', 'AbortError');
    }
    try {
      const res = await fetch(url, init);
      if (!res.ok && res.status !== 206) {
        if (res.status >= 400 && res.status < 500 && res.status !== 403 && res.status !== 429) {
          throw new Error(`HTTP ${res.status}`);
        }
        throw new Error(`HTTP ${res.status}`);
      }
      return res;
    } catch (err: any) {
      if (err?.name === 'AbortError' || init.signal?.aborted) {
        throw new DOMException('Download cancelled', 'AbortError');
      }
      lastErr = err;
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, 350 * (i + 1)));
      }
    }
  }
  throw lastErr || new Error('Network request failed');
}

async function downloadDirectMp4(
  rawUrl: string,
  durationSecs: number,
  signal: AbortSignal | undefined,
  onProgress?: (p: BrowserDownloadProgress) => void
): Promise<BrowserDownloadResult> {
  const proxiedUrl = toHlsProxyUrl(rawUrl);

  const firstRes = await fetchWithRetry(
    proxiedUrl,
    {
      headers: { Range: `bytes=0-${MP4_RANGE_CHUNK_BYTES - 1}` },
      signal,
    },
    3
  );

  if (firstRes.status === 206) {
    const contentRange = firstRes.headers.get('content-range') || '';
    const totalMatch = contentRange.match(/\/(\d+)$/);
    const firstBuf = new Uint8Array(await firstRes.arrayBuffer());
    const totalBytes = totalMatch ? Number(totalMatch[1]) : firstBuf.byteLength;

    if (!totalBytes || firstBuf.byteLength >= totalBytes) {
      const blob = new Blob([firstBuf], { type: 'video/mp4' });
      onProgress?.({
        percent: 94,
        downloadedBytes: blob.size,
        processedSecs: durationSecs,
        totalDurationSecs: durationSecs,
      });
      return { blob, sizeBytes: blob.size, durationSecs, mimeType: 'video/mp4' };
    }

    const totalChunks = Math.ceil(totalBytes / MP4_RANGE_CHUNK_BYTES);
    const parts: BlobPart[] = new Array(totalChunks);
    parts[0] = firstBuf;
    let received = firstBuf.byteLength;

    onProgress?.({
      percent: Math.min(94, Math.max(2, Math.round((received / totalBytes) * 94))),
      downloadedBytes: received,
      processedSecs: Math.round((received / totalBytes) * durationSecs),
      totalDurationSecs: durationSecs,
    });

    let nextIdx = 1;
    const workers = Math.min(3, Math.max(1, totalChunks - 1));
    const runWorker = async () => {
      while (true) {
        const idx = nextIdx++;
        if (idx >= totalChunks) return;
        const start = idx * MP4_RANGE_CHUNK_BYTES;
        const end = Math.min(totalBytes - 1, start + MP4_RANGE_CHUNK_BYTES - 1);
        const res = await fetchWithRetry(
          proxiedUrl,
          { headers: { Range: `bytes=${start}-${end}` }, signal },
          3
        );
        const chunk = new Uint8Array(await res.arrayBuffer());
        parts[idx] = chunk;
        received += chunk.byteLength;
        onProgress?.({
          percent: Math.min(94, Math.max(2, Math.round((received / totalBytes) * 94))),
          downloadedBytes: received,
          processedSecs: Math.round((received / totalBytes) * durationSecs),
          totalDurationSecs: durationSecs,
        });
      }
    };

    await Promise.all(Array.from({ length: workers }, () => runWorker()));
    const blob = new Blob(parts, { type: 'video/mp4' });
    return { blob, sizeBytes: blob.size, durationSecs, mimeType: 'video/mp4' };
  }

  // Fallback for 200 OK without Range support
  const contentLen = Number(firstRes.headers.get('content-length') || 0);
  if (firstRes.body) {
    const reader = firstRes.body.getReader();
    const chunks: BlobPart[] = [];
    let received = 0;
    while (true) {
      if (signal?.aborted) {
        await reader.cancel().catch(() => {});
        throw new DOMException('Download cancelled', 'AbortError');
      }
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(new Uint8Array(value));
        received += value.byteLength;
        const pct = contentLen > 0 ? Math.min(94, Math.max(2, Math.round((received / contentLen) * 94))) : 45;
        onProgress?.({
          percent: pct,
          downloadedBytes: received,
          processedSecs: durationSecs,
          totalDurationSecs: durationSecs,
        });
      }
    }
    const blob = new Blob(chunks, { type: 'video/mp4' });
    return { blob, sizeBytes: blob.size, durationSecs, mimeType: 'video/mp4' };
  }

  const ab = await firstRes.arrayBuffer();
  const blob = new Blob([ab], { type: 'video/mp4' });
  onProgress?.({
    percent: 94,
    downloadedBytes: blob.size,
    processedSecs: durationSecs,
    totalDurationSecs: durationSecs,
  });
  return { blob, sizeBytes: blob.size, durationSecs, mimeType: 'video/mp4' };
}

async function fetchHlsPlaylistText(
  rawUrl: string,
  signal: AbortSignal | undefined
): Promise<{ text: string; requestUrl: string }> {
  const proxiedUrl = toHlsProxyUrl(rawUrl);
  const res = await fetchWithRetry(proxiedUrl, { signal }, 3);
  const text = await res.text();
  return { text, requestUrl: proxiedUrl };
}

function pickVariantFromMaster(masterText: string, baseUrl: string, preferLowest: boolean): string | null {
  const lines = masterText.split(/\r?\n/);
  const variants: Array<{ bandwidth: number; url: string }> = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('#EXT-X-STREAM-INF:')) {
      const bwMatch = line.match(/BANDWIDTH=(\d+)/i);
      const bandwidth = bwMatch ? Number(bwMatch[1]) : 800000;
      for (let j = i + 1; j < lines.length; j++) {
        const nextLine = lines[j].trim();
        if (!nextLine) continue;
        if (nextLine.startsWith('#')) continue;
        variants.push({
          bandwidth,
          url: resolveRelativeUrl(nextLine, baseUrl),
        });
        break;
      }
    }
  }

  if (variants.length === 0) return null;
  variants.sort((a, b) => a.bandwidth - b.bandwidth);
  return preferLowest ? variants[0].url : variants[variants.length - 1].url;
}

function parseMediaPlaylist(playlistText: string, baseUrl: string): {
  mediaSequence: number;
  totalDurationSecs: number;
  segments: HlsSegmentItem[];
} {
  const lines = playlistText.split(/\r?\n/);
  let mediaSequence = 0;
  let currentDuration = 0;
  let totalDurationSecs = 0;
  let currentKey: HlsKeyInfo | null = null;
  let currentMapUri: string | null = null;
  const segments: HlsSegmentItem[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
      const seq = Number(line.split(':')[1]);
      if (Number.isFinite(seq)) mediaSequence = seq;
      continue;
    }

    if (line.startsWith('#EXT-X-KEY:')) {
      const attrs = parseAttributes(line.slice('#EXT-X-KEY:'.length));
      const method = (attrs.METHOD || 'NONE').toUpperCase();
      if (method === 'NONE' || !attrs.URI) {
        currentKey = null;
      } else {
        currentKey = {
          method,
          uri: toHlsProxyUrl(resolveRelativeUrl(attrs.URI, baseUrl)),
          ivHex: attrs.IV,
        };
      }
      continue;
    }

    if (line.startsWith('#EXT-X-MAP:')) {
      const attrs = parseAttributes(line.slice('#EXT-X-MAP:'.length));
      if (attrs.URI) {
        currentMapUri = toHlsProxyUrl(resolveRelativeUrl(attrs.URI, baseUrl));
      }
      continue;
    }

    if (line.startsWith('#EXTINF:')) {
      const sec = parseFloat(line.slice('#EXTINF:'.length).split(',')[0]);
      currentDuration = Number.isFinite(sec) ? sec : 0;
      continue;
    }

    if (line.startsWith('#')) {
      continue;
    }

    const segUrl = toHlsProxyUrl(resolveRelativeUrl(line, baseUrl));
    const idx = segments.length;
    segments.push({
      index: idx,
      url: segUrl,
      duration: currentDuration,
      keyInfo: currentKey ? { ...currentKey } : null,
      mapUri: currentMapUri,
    });
    totalDurationSecs += currentDuration;
    currentDuration = 0;
  }

  return {
    mediaSequence,
    totalDurationSecs,
    segments,
  };
}

export async function downloadLectureInBrowser(
  params: BrowserDownloadParams
): Promise<BrowserDownloadResult> {
  const { url, format, isDirectMp4, durationSecs = 0, signal, onProgress } = params;
  const mimeType = format === 'm4a' ? 'audio/mp4' : 'video/mp4';

  if (isDirectMp4 || /\.mp4(\?|$)/i.test(url)) {
    return downloadDirectMp4(url, durationSecs, signal, onProgress);
  }

  // 1. Fetch HLS playlist (and resolve master -> variant if needed)
  let { text: playlistText, requestUrl } = await fetchHlsPlaylistText(url, signal);
  if (playlistText.includes('#EXT-X-STREAM-INF:')) {
    const variantUrl = pickVariantFromMaster(playlistText, requestUrl, format === 'm4a');
    if (!variantUrl) {
      throw new Error('Is lecture ki stream playlist mein koi video track nahi mila.');
    }
    const variantRes = await fetchHlsPlaylistText(variantUrl, signal);
    playlistText = variantRes.text;
    requestUrl = variantRes.requestUrl;
  }

  const parsed = parseMediaPlaylist(playlistText, requestUrl);
  if (parsed.segments.length === 0) {
    throw new Error('Lecture video segments available nahi hain.');
  }

  const totalDuration = Math.round(parsed.totalDurationSecs || durationSecs || 0);
  const keyCache = new Map<string, Promise<CryptoKey>>();

  const getAesKey = (keyUri: string): Promise<CryptoKey> => {
    const cached = keyCache.get(keyUri);
    if (cached) return cached;
    const p = (async () => {
      if (typeof crypto === 'undefined' || !crypto.subtle) {
        throw new Error('Is browser mein encrypted lecture decryption support nahi hai.');
      }
      const res = await fetchWithRetry(keyUri, { signal }, 3);
      const rawKey = await res.arrayBuffer();
      if (rawKey.byteLength !== 16) {
        throw new Error(`Invalid HLS decryption key (${rawKey.byteLength} bytes)`);
      }
      return crypto.subtle.importKey('raw', rawKey, { name: 'AES-CBC' }, false, ['decrypt']);
    })();
    keyCache.set(keyUri, p);
    return p;
  };

  const fetchAndDecryptSegment = async (seg: HlsSegmentItem): Promise<Uint8Array> => {
    const res = await fetchWithRetry(seg.url, { signal }, 3);
    const rawBuf = await res.arrayBuffer();
    if (!seg.keyInfo || seg.keyInfo.method === 'NONE') {
      return new Uint8Array(rawBuf);
    }
    if (seg.keyInfo.method !== 'AES-128') {
      throw new Error(`Unsupported stream encryption (${seg.keyInfo.method}).`);
    }
    const aesKey = await getAesKey(seg.keyInfo.uri);
    const iv = buildIvBytes(seg.keyInfo.ivHex, parsed.mediaSequence + seg.index);
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, aesKey, rawBuf);
    return new Uint8Array(decrypted);
  };

  const isFmp4Hls = Boolean(parsed.segments[0]?.mapUri);
  const outputParts: BlobPart[] = [];
  let totalOutputBytes = 0;

  if (isFmp4Hls && parsed.segments[0]?.mapUri) {
    const initRes = await fetchWithRetry(parsed.segments[0].mapUri, { signal }, 3);
    const initBytes = new Uint8Array(await initRes.arrayBuffer());
    outputParts.push(initBytes);
    totalOutputBytes += initBytes.byteLength;
  }

  let hasMp4Init = false;
  const TransmuxerCtor =
    muxjs?.mp4?.Transmuxer || (muxjs as any)?.default?.mp4?.Transmuxer;
  if (!isFmp4Hls && typeof TransmuxerCtor !== 'function') {
    throw new Error('Browser MP4 transmuxer initialize nahi ho paya.');
  }
  const transmuxer = isFmp4Hls
    ? null
    : new TransmuxerCtor({
        remux: format !== 'm4a',
        keepOriginalTimestamps: false,
      });

  if (transmuxer) {
    transmuxer.on('data', (segment) => {
      if (format === 'm4a' && segment.type && segment.type !== 'audio') {
        return;
      }
      if (!hasMp4Init && segment.initSegment && segment.initSegment.byteLength > 0) {
        hasMp4Init = true;
        const initCopy = new Uint8Array(segment.initSegment);
        outputParts.push(initCopy);
        totalOutputBytes += initCopy.byteLength;
      }
      if (segment.data && segment.data.byteLength > 0) {
        const dataCopy = new Uint8Array(segment.data);
        outputParts.push(dataCopy);
        totalOutputBytes += dataCopy.byteLength;
      }
    });
  }

  // Download segments in ordered parallel batches of 4 so playback order is strictly preserved
  const totalSegs = parsed.segments.length;
  const BATCH_SIZE = 4;
  let processedSecs = 0;

  for (let start = 0; start < totalSegs; start += BATCH_SIZE) {
    if (signal?.aborted) {
      throw new DOMException('Download cancelled', 'AbortError');
    }
    const batch = parsed.segments.slice(start, start + BATCH_SIZE);
    const buffers = await Promise.all(batch.map((seg) => fetchAndDecryptSegment(seg)));

    for (let i = 0; i < batch.length; i++) {
      const segBytes = buffers[i];
      if (transmuxer) {
        transmuxer.push(segBytes);
        transmuxer.flush();
      } else {
        const copy = new Uint8Array(segBytes);
        outputParts.push(copy);
        totalOutputBytes += copy.byteLength;
      }

      processedSecs += batch[i].duration || 0;
      const doneCount = start + i + 1;
      const pct = Math.min(94, Math.max(2, Math.round((doneCount / totalSegs) * 94)));
      onProgress?.({
        percent: pct,
        downloadedBytes: totalOutputBytes,
        processedSecs: Math.round(processedSecs),
        totalDurationSecs: totalDuration,
      });
    }
  }

  if (outputParts.length === 0 || totalOutputBytes === 0) {
    throw new Error('Video conversion complete nahi ho payi — dusri quality try karein.');
  }

  const blob = new Blob(outputParts, { type: mimeType });
  return {
    blob,
    sizeBytes: blob.size,
    durationSecs: totalDuration,
    mimeType,
  };
}
