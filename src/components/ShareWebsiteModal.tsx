import React, { useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import {
  Check,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  Globe,
  MessageCircle,
  QrCode,
  Send,
  Share2,
  Sparkles,
  X,
} from 'lucide-react';

interface ShareWebsiteModalProps {
  onClose: () => void;
}

export const ShareWebsiteModal: React.FC<ShareWebsiteModalProps> = ({ onClose }) => {
  const qrCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [copiedType, setCopiedType] = useState<'url' | 'promo' | null>(null);
  const [promoVariant, setPromoVariant] = useState<'hinglish' | 'english'>('hinglish');

  const websiteUrl = useMemo(() => {
    if (typeof window === 'undefined') return '';
    return window.location.origin + '/';
  }, []);

  const promoMessages = useMemo(() => {
    return {
      hinglish: `🔥 *Study Cloud* — Free Padhai ka All-in-One Hub!\n\n✅ 18,000+ PW Batches & Live Classes\n✅ Full Khazana Faculty Vault & Pi OTT\n✅ Offline MP4 Video + Audio Download (Seedha Gallery & App mein)\n✅ Live CBT Tests, DPP Quiz & Study AI Doubt Solver\n\nAbhi kholein aur dosto ko bhi bhejein 👇\n${websiteUrl}`,
      english: `🚀 Study Cloud — Free All-in-One Learning Platform!\n\n• 18,000+ Study Batches & Khazana Lectures\n• Pi OTT Concept Vault & Live CBT Test Series\n• Offline MP4 Lecture Downloads & Study AI\n\nJoin now & share with your study group 👇\n${websiteUrl}`,
    };
  }, [websiteUrl]);

  const activeMessage = promoMessages[promoVariant];

  useEffect(() => {
    const canvas = qrCanvasRef.current;
    if (!canvas || !websiteUrl) return;
    void QRCode.toCanvas(canvas, websiteUrl, {
      width: 176,
      margin: 2,
      color: {
        dark: '#0f172a',
        light: '#ffffff',
      },
    });
  }, [websiteUrl]);

  const handleCopy = async (text: string, type: 'url' | 'promo') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedType(type);
      window.setTimeout(() => {
        setCopiedType((prev) => (prev === type ? null : prev));
      }, 2200);
    } catch {
      // ignore clipboard errors
    }
  };

  const handleNativeShare = async () => {
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: 'Study Cloud — Free Batches, Khazana & Tests',
          text: activeMessage,
          url: websiteUrl,
        });
        return;
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
      }
    }
    await handleCopy(activeMessage, 'promo');
  };

  const handleDownloadQrPoster = () => {
    const qrCanvas = qrCanvasRef.current;
    if (!qrCanvas) return;

    const poster = document.createElement('canvas');
    poster.width = 640;
    poster.height = 800;
    const ctx = poster.getContext('2d');
    if (!ctx) return;

    // Dark gradient card background
    const grad = ctx.createLinearGradient(0, 0, 640, 800);
    grad.addColorStop(0, '#09090f');
    grad.addColorStop(1, '#1e1b4b');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 640, 800);

    // Title
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 46px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Study Cloud', 320, 95);

    ctx.fillStyle = '#34d399';
    ctx.font = 'bold 22px sans-serif';
    ctx.fillText('18,000+ Batches • Khazana • Tests • Offline MP4', 320, 140);

    // White rounded box for QR
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.roundRect(140, 195, 360, 360, 28);
    ctx.fill();

    ctx.drawImage(qrCanvas, 170, 225, 300, 300);

    ctx.fillStyle = '#e2e8f0';
    ctx.font = 'bold 24px sans-serif';
    ctx.fillText('Scan QR to Open Website Free', 320, 625);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '16px monospace';
    const shortUrl = websiteUrl.length > 52 ? `${websiteUrl.slice(0, 49)}...` : websiteUrl;
    ctx.fillText(shortUrl, 320, 675);

    const a = document.createElement('a');
    a.href = poster.toDataURL('image/png');
    a.download = 'Study-Cloud-Share-QR.png';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const whatsappHref = `https://wa.me/?text=${encodeURIComponent(activeMessage)}`;
  const telegramHref = `https://t.me/share/url?url=${encodeURIComponent(websiteUrl)}&text=${encodeURIComponent(activeMessage)}`;
  const twitterHref = `https://twitter.com/intent/tweet?text=${encodeURIComponent('Check out Study Cloud — Free 18,000+ Batches, Khazana Lectures, Tests & Offline MP4 Downloads!')}&url=${encodeURIComponent(websiteUrl)}`;

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/75 p-3 sm:p-4 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-[var(--card-border)] bg-[var(--card-bg)] text-[var(--text-primary)] shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-[var(--card-border)] bg-[var(--bg-secondary)] px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--primary-color)]/15 text-[var(--primary-color)]">
              <Share2 className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-['Sora'] text-base sm:text-lg font-extrabold leading-tight">
                Share & Promote Website
              </h2>
              <p className="text-xs text-[var(--text-secondary)]">
                WhatsApp, Telegram, QR Code & Google Search Discovery
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-xl bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Social Preview Card */}
          <div className="overflow-hidden rounded-2xl border border-[var(--card-border)] bg-[var(--bg-secondary)]">
            <div className="aspect-[16/9] w-full max-h-44 overflow-hidden bg-slate-950">
              <img
                src="/og-banner.jpg"
                alt="Study Cloud Social Preview Banner"
                className="h-full w-full object-cover"
              />
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5">
              <div className="min-w-0">
                <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-400">
                  Live Social Link Preview Active
                </div>
                <div className="font-mono text-xs text-[var(--text-secondary)] truncate mt-0.5">
                  {websiteUrl}
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleCopy(websiteUrl, 'url')}
                className="flex shrink-0 items-center justify-center gap-1.5 rounded-xl bg-[var(--primary-color)] px-3.5 py-2 text-xs font-bold text-white hover:opacity-90 transition"
              >
                {copiedType === 'url' ? (
                  <>
                    <Check className="h-3.5 w-3.5" />
                    <span>Link Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    <span>Copy Link</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* 1-Tap Social Share Grid */}
          <div className="space-y-2">
            <div className="text-xs font-extrabold uppercase tracking-wider text-[var(--text-secondary)]">
              1-Tap Sabko Bhejein (Direct Share)
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <a
                href={whatsappHref}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 rounded-2xl border border-emerald-500/30 bg-emerald-500/15 px-3 py-3 text-xs font-extrabold text-emerald-400 hover:bg-emerald-600 hover:text-white transition"
              >
                <MessageCircle className="h-4 w-4" />
                <span>WhatsApp</span>
              </a>

              <a
                href={telegramHref}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 rounded-2xl border border-sky-500/30 bg-sky-500/15 px-3 py-3 text-xs font-extrabold text-sky-400 hover:bg-sky-600 hover:text-white transition"
              >
                <Send className="h-4 w-4" />
                <span>Telegram</span>
              </a>

              <a
                href={twitterHref}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 rounded-2xl border border-[var(--card-border)] bg-[var(--bg-secondary)] px-3 py-3 text-xs font-extrabold text-[var(--text-primary)] hover:border-[var(--primary-color)] transition"
              >
                <Share2 className="h-4 w-4 text-indigo-400" />
                <span>X / Twitter</span>
              </a>

              <button
                type="button"
                onClick={handleNativeShare}
                className="flex items-center justify-center gap-2 rounded-2xl bg-[var(--primary-color)] px-3 py-3 text-xs font-extrabold text-white hover:opacity-90 transition"
              >
                <Sparkles className="h-4 w-4" />
                <span>More Apps</span>
              </button>
            </div>
          </div>

          {/* QR Code + Promo Message Grid */}
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            {/* QR Code Box */}
            <div className="md:col-span-2 flex flex-col items-center justify-between rounded-2xl border border-[var(--card-border)] bg-[var(--bg-secondary)] p-4 text-center space-y-3">
              <div className="flex items-center gap-1.5 text-xs font-extrabold text-[var(--text-primary)]">
                <QrCode className="h-4 w-4 text-[var(--primary-color)]" />
                <span>Website QR Code</span>
              </div>
              <div className="overflow-hidden rounded-2xl bg-white p-2 shadow-sm">
                <canvas ref={qrCanvasRef} className="block h-36 w-36" />
              </div>
              <button
                type="button"
                onClick={handleDownloadQrPoster}
                className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/15 px-3 py-2 text-xs font-bold text-emerald-400 hover:bg-emerald-600 hover:text-white transition"
              >
                <Download className="h-3.5 w-3.5" />
                <span>Save QR Poster</span>
              </button>
            </div>

            {/* Ready Promo Message */}
            <div className="md:col-span-3 flex flex-col justify-between rounded-2xl border border-[var(--card-border)] bg-[var(--bg-secondary)] p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-extrabold text-[var(--text-primary)]">
                  Group / Channel Invite Post
                </span>
                <div className="flex rounded-lg border border-[var(--card-border)] bg-[var(--bg-primary)] p-0.5 text-[11px] font-bold">
                  <button
                    type="button"
                    onClick={() => setPromoVariant('hinglish')}
                    className={`rounded-md px-2 py-1 transition ${
                      promoVariant === 'hinglish'
                        ? 'bg-[var(--primary-color)] text-white'
                        : 'text-[var(--text-secondary)]'
                    }`}
                  >
                    Hinglish
                  </button>
                  <button
                    type="button"
                    onClick={() => setPromoVariant('english')}
                    className={`rounded-md px-2 py-1 transition ${
                      promoVariant === 'english'
                        ? 'bg-[var(--primary-color)] text-white'
                        : 'text-[var(--text-secondary)]'
                    }`}
                  >
                    English
                  </button>
                </div>
              </div>

              <pre className="whitespace-pre-wrap rounded-xl border border-[var(--card-border)] bg-[var(--bg-primary)] p-3 font-sans text-[11px] leading-relaxed text-[var(--text-secondary)] max-h-40 overflow-y-auto">
                {activeMessage}
              </pre>

              <button
                type="button"
                onClick={() => handleCopy(activeMessage, 'promo')}
                className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-[var(--bg-tertiary)] py-2 text-xs font-bold text-[var(--text-primary)] hover:bg-[var(--primary-color)] hover:text-white transition"
              >
                {copiedType === 'promo' ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-400" />
                    <span>Promo Message Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    <span>Copy Message for WhatsApp / Telegram</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Google Search & Public Discovery Status */}
          <div className="rounded-2xl border border-indigo-500/30 bg-indigo-500/10 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-indigo-300">
                <Globe className="h-4 w-4" />
                <span>Google Search & SEO Active</span>
              </div>
              <div className="flex flex-wrap gap-2">
                <a
                  href="/sitemap.xml"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-lg bg-white/10 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-white/20 transition"
                >
                  <span>Sitemap XML</span>
                  <ExternalLink className="h-3 w-3" />
                </a>
                <a
                  href="https://search.google.com/search-console"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-indigo-500 transition"
                >
                  <span>Google Search Console</span>
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-slate-200">
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                <span>Google Site Verification & Meta Tags Active</span>
              </div>
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                <span>Robots.txt & Dynamic Sitemap.xml Live</span>
              </div>
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                <span>WhatsApp / Telegram Rich Banner Card Ready</span>
              </div>
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                <span>Schema.org JSON-LD Rich Search Snippet</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
