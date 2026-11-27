import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  X,
  ZoomIn,
  ZoomOut,
  Download,
  Loader2,
  AlertCircle,
  FileText,
  Moon,
  Sun,
  RotateCw,
  Check,
  Bookmark,
  Trash2,
} from 'lucide-react';
import { buildPdfProxyUrl, downloadPdfFile, PDF_VIEWER_EVENT } from '../services/batchService';
import { PdfBookmarkItem } from '../types';
import { auth } from '../lib/firebase';

const LOCAL_BOOKMARKS_KEY = 'studycloud_pdf_bookmarks_v1';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface PdfOpenDetail {
  url: string;
  title?: string;
}

interface PdfPageCanvasProps {
  pdfDoc: pdfjsLib.PDFDocumentProxy;
  pageNumber: number;
  scale: number;
  containerWidth: number;
  nightMode: boolean;
}

const PdfPageCanvas: React.FC<PdfPageCanvasProps> = ({
  pdfDoc,
  pageNumber,
  scale,
  containerWidth,
  nightMode,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [rendered, setRendered] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let renderTask: pdfjsLib.RenderTask | null = null;

    (async () => {
      try {
        const page = await pdfDoc.getPage(pageNumber);
        if (cancelled) return;

        const baseViewport = page.getViewport({ scale: 1 });
        const maxReadableWidth = Math.max(300, Math.min(containerWidth - 20, 1080));
        const fitScale = (maxReadableWidth / baseViewport.width) * scale;

        // Oversample desktop (1x DPR) and retina displays for crisp vector/handwritten HD text
        const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
        const desiredOutputScale = Math.min(4, Math.max(2.75, dpr * 2.25));

        const viewport = page.getViewport({ scale: fitScale });
        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;

        // Guard against browser max canvas memory/dimension limits (~4096px / ~14MP)
        const maxDim = 4096;
        const maxPixels = 14_000_000;
        let outputScale = desiredOutputScale;
        if (viewport.width * outputScale > maxDim || viewport.height * outputScale > maxDim) {
          outputScale = Math.min(outputScale, maxDim / Math.max(viewport.width, viewport.height));
        }
        if (viewport.width * viewport.height * outputScale * outputScale > maxPixels) {
          outputScale = Math.min(
            outputScale,
            Math.sqrt(maxPixels / Math.max(1, viewport.width * viewport.height))
          );
        }
        outputScale = Math.max(1.5, outputScale);

        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

        const ctx = canvas.getContext('2d', { alpha: false });
        if (!ctx) return;

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        const transform =
          outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined;

        renderTask = page.render({
          canvasContext: ctx,
          transform,
          viewport,
        } as any);

        await renderTask.promise;
        if (!cancelled) setRendered(true);
      } catch {
        // ignore aborted render tasks on quick zoom/close
      }
    })();

    return () => {
      cancelled = true;
      if (renderTask) {
        try {
          renderTask.cancel();
        } catch {
          // ignore
        }
      }
    };
  }, [pdfDoc, pageNumber, scale, containerWidth]);

  return (
    <div className="relative flex flex-col items-center">
      <div
        className={`relative overflow-hidden rounded-xl border border-white/10 shadow-xl transition-colors ${
          nightMode ? 'bg-slate-900' : 'bg-white'
        }`}
      >
        {!rendered && (
          <div className="flex h-64 w-64 sm:w-[540px] items-center justify-center text-xs text-slate-400">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            Rendering page {pageNumber}...
          </div>
        )}
        <canvas
          ref={canvasRef}
          className={`block max-w-full ${nightMode ? 'invert hue-rotate-180 contrast-95' : ''}`}
        />
      </div>
      <span className="mt-1.5 font-mono text-[11px] font-semibold text-slate-400">
        Page {pageNumber}
      </span>
    </div>
  );
};

export const PdfViewerModal: React.FC = () => {
  const [pdfRequest, setPdfRequest] = useState<PdfOpenDetail | null>(null);
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [nightMode, setNightMode] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [bookmarks, setBookmarks] = useState<PdfBookmarkItem[]>([]);
  const [showBookmarksDrawer, setShowBookmarksDrawer] = useState(false);
  const [bookmarkNote, setBookmarkNote] = useState('');
  const [savingBookmark, setSavingBookmark] = useState(false);
  const [containerWidth, setContainerWidth] = useState<number>(
    typeof window !== 'undefined' ? window.innerWidth : 900
  );

  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const loadingTaskRef = useRef<pdfjsLib.PDFDocumentLoadingTask | null>(null);
  const pageRefs = useRef<Record<number, HTMLDivElement | null>>({});

  const loadBookmarks = useCallback(async () => {
    let localItems: PdfBookmarkItem[] = [];
    try {
      const raw = localStorage.getItem(LOCAL_BOOKMARKS_KEY);
      localItems = raw ? JSON.parse(raw) : [];
    } catch {
      localItems = [];
    }
    const token = await auth.currentUser?.getIdToken().catch(() => null);
    if (!token) {
      setBookmarks(Array.isArray(localItems) ? localItems : []);
      return;
    }
    try {
      const res = await fetch('/api/bookmarks', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (data?.success && Array.isArray(data.bookmarks)) {
        setBookmarks(data.bookmarks);
        try {
          localStorage.setItem(LOCAL_BOOKMARKS_KEY, JSON.stringify(data.bookmarks));
        } catch {
          // ignore
        }
        return;
      }
    } catch {
      // fall back to local
    }
    setBookmarks(Array.isArray(localItems) ? localItems : []);
  }, []);

  useEffect(() => {
    const handler = (evt: Event) => {
      const detail = (evt as CustomEvent<PdfOpenDetail>).detail;
      if (detail?.url) {
        setPdfRequest({
          url: detail.url,
          title: detail.title || 'Study Notes.pdf',
        });
        setZoom(1);
        setCurrentPage(1);
        setDownloaded(false);
        setShowBookmarksDrawer(false);
        void loadBookmarks();
      }
    };
    window.addEventListener(PDF_VIEWER_EVENT, handler);
    return () => window.removeEventListener(PDF_VIEWER_EVENT, handler);
  }, [loadBookmarks]);

  useEffect(() => {
    if (!pdfRequest) return;
    const onResize = () => {
      setContainerWidth(scrollContainerRef.current?.clientWidth || window.innerWidth);
    };
    onResize();
    window.addEventListener('resize', onResize);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPdfRequest(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [pdfRequest]);

  const loadPdfDocument = useCallback(async (url: string, title: string) => {
    setLoading(true);
    setError(null);
    setNumPages(0);
    if (loadingTaskRef.current) {
      try {
        await loadingTaskRef.current.destroy();
      } catch {
        // ignore
      }
      loadingTaskRef.current = null;
    }

    try {
      const proxyUrl = buildPdfProxyUrl(url, title, false);
      const res = await fetch(proxyUrl);
      if (!res.ok) {
        throw new Error(`Could not load PDF (${res.status})`);
      }
      const bytes = await res.arrayBuffer();
      if (!bytes || bytes.byteLength === 0) {
        throw new Error('Received empty PDF file from server.');
      }

      const task = pdfjsLib.getDocument({ data: new Uint8Array(bytes) });
      loadingTaskRef.current = task;
      const doc = await task.promise;
      setPdfDoc(doc);
      setNumPages(doc.numPages);
    } catch (err: any) {
      setPdfDoc(null);
      setError(err?.message || 'Unable to render this PDF inside viewer.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!pdfRequest) {
      if (pdfDoc) {
        const docAny = pdfDoc as unknown as {
          destroy?: () => Promise<void>;
          cleanup?: () => Promise<void>;
        };
        if (typeof docAny.destroy === 'function') {
          docAny.destroy().catch(() => {});
        } else if (typeof docAny.cleanup === 'function') {
          docAny.cleanup().catch(() => {});
        }
        setPdfDoc(null);
      }
      return;
    }
    void loadPdfDocument(pdfRequest.url, pdfRequest.title || 'Study Notes.pdf');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfRequest]);

  useEffect(() => {
    if (!pdfRequest || numPages === 0 || !scrollContainerRef.current) return;
    const root = scrollContainerRef.current;
    const obs = new IntersectionObserver(
      (entries) => {
        let bestPage = currentPage;
        let bestRatio = 0;
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio >= bestRatio) {
            const pg = Number((entry.target as HTMLElement).dataset.page || 1);
            bestRatio = entry.intersectionRatio;
            bestPage = pg;
          }
        }
        if (bestRatio > 0) setCurrentPage(bestPage);
      },
      { root, threshold: [0.25, 0.55, 0.85] }
    );
    Object.values(pageRefs.current).forEach((el) => {
      if (el) obs.observe(el);
    });
    return () => obs.disconnect();
  }, [pdfRequest, numPages, zoom]);

  if (!pdfRequest) return null;

  const title = pdfRequest.title || 'Study Notes.pdf';
  const currentPdfBookmarks = bookmarks.filter((b) => b.pdfUrl === pdfRequest.url);
  const isCurrentPageBookmarked = currentPdfBookmarks.some((b) => b.pageNumber === currentPage);

  const handleToggleBookmarkPage = async (noteText?: string) => {
    if (savingBookmark) return;
    setSavingBookmark(true);
    try {
      const existing = currentPdfBookmarks.find((b) => b.pageNumber === currentPage);
      const token = await auth.currentUser?.getIdToken().catch(() => null);
      if (existing && !noteText) {
        if (token) {
          const res = await fetch(`/api/bookmarks/${encodeURIComponent(existing.bookmarkId)}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` },
          });
          const data = await res.json().catch(() => ({}));
          if (data?.success && Array.isArray(data.bookmarks)) {
            setBookmarks(data.bookmarks);
            localStorage.setItem(LOCAL_BOOKMARKS_KEY, JSON.stringify(data.bookmarks));
            return;
          }
        }
        const next = bookmarks.filter((b) => b.bookmarkId !== existing.bookmarkId);
        setBookmarks(next);
        localStorage.setItem(LOCAL_BOOKMARKS_KEY, JSON.stringify(next));
        return;
      }

      if (token) {
        const res = await fetch('/api/bookmarks', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            pdfUrl: pdfRequest.url,
            pdfTitle: title,
            pageNumber: currentPage,
            note: (noteText ?? bookmarkNote).trim(),
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (data?.success && Array.isArray(data.bookmarks)) {
          setBookmarks(data.bookmarks);
          localStorage.setItem(LOCAL_BOOKMARKS_KEY, JSON.stringify(data.bookmarks));
          setBookmarkNote('');
          return;
        }
      }

      const localItem: PdfBookmarkItem = {
        bookmarkId: `local_bm_${Date.now()}`,
        userId: auth.currentUser?.uid || 'local',
        pdfUrl: pdfRequest.url,
        pdfTitle: title,
        pageNumber: currentPage,
        note: (noteText ?? bookmarkNote).trim(),
        createdAt: Date.now(),
      };
      const next = [
        localItem,
        ...bookmarks.filter((b) => !(b.pdfUrl === pdfRequest.url && b.pageNumber === currentPage)),
      ];
      setBookmarks(next);
      localStorage.setItem(LOCAL_BOOKMARKS_KEY, JSON.stringify(next));
      setBookmarkNote('');
    } finally {
      setSavingBookmark(false);
    }
  };

  const handleDeleteBookmark = async (bookmarkId: string) => {
    const token = await auth.currentUser?.getIdToken().catch(() => null);
    if (token) {
      const res = await fetch(`/api/bookmarks/${encodeURIComponent(bookmarkId)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (data?.success && Array.isArray(data.bookmarks)) {
        setBookmarks(data.bookmarks);
        localStorage.setItem(LOCAL_BOOKMARKS_KEY, JSON.stringify(data.bookmarks));
        return;
      }
    }
    const next = bookmarks.filter((b) => b.bookmarkId !== bookmarkId);
    setBookmarks(next);
    localStorage.setItem(LOCAL_BOOKMARKS_KEY, JSON.stringify(next));
  };

  const scrollToPage = (pageNum: number) => {
    const target = pageRefs.current[pageNum];
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setCurrentPage(pageNum);
      setShowBookmarksDrawer(false);
    }
  };

  const handleExplicitDownload = async () => {
    setDownloading(true);
    try {
      await downloadPdfFile(pdfRequest.url, title);
      setDownloaded(true);
      setTimeout(() => setDownloaded(false), 2500);
    } catch {
      // ignore
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex h-[100dvh] w-full flex-col bg-[#05110b]/98 text-slate-100 backdrop-blur-md">
      {/* Top Reader Toolbar */}
      <div className="flex h-14 sm:h-16 shrink-0 items-center justify-between gap-2 border-b border-emerald-500/20 bg-[#0a1c13] px-3 sm:px-5">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#22C55E]/30 bg-[#16A34A]/20 text-[#4ade80]">
            <FileText className="h-4.5 w-4.5" />
          </div>
          <div className="min-w-0">
            <h3 className="font-['Sora'] text-xs sm:text-sm font-bold text-white truncate">
              {title}
            </h3>
            <p className="font-mono text-[11px] text-emerald-200/70 flex items-center gap-1.5">
              <span>
                {loading
                  ? 'Opening HD inline PDF reader...'
                  : numPages > 0
                  ? `Page ${currentPage}/${numPages} · Inline Viewer`
                  : 'PDF Preview'}
              </span>
              <span className="rounded bg-[#16A34A]/30 border border-[#22C55E]/40 px-1.5 py-0.5 text-[9px] font-extrabold tracking-wider text-[#4ade80]">
                HD
              </span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {/* Zoom controls */}
          <div className="hidden sm:flex items-center gap-1 rounded-xl border border-emerald-500/25 bg-[#16A34A]/15 px-1.5 py-1">
            <button
              type="button"
              onClick={() => setZoom((z) => Math.max(0.6, Number((z - 0.15).toFixed(2))))}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-emerald-100 hover:bg-[#16A34A] hover:text-white transition"
              title="Zoom Out"
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setZoom(1)}
              className="px-1.5 font-mono text-[11px] font-bold text-white hover:text-[#4ade80]"
              title="Reset Zoom"
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.min(3, Number((z + 0.2).toFixed(2))))}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-emerald-100 hover:bg-[#16A34A] hover:text-white transition"
              title="Zoom In"
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Bookmark Current Page */}
          <button
            type="button"
            disabled={savingBookmark || loading}
            onClick={() => void handleToggleBookmarkPage()}
            className={`flex h-9 items-center gap-1.5 rounded-xl border px-2.5 sm:px-3 text-xs font-bold transition ${
              isCurrentPageBookmarked
                ? 'border-[#22C55E] bg-[#16A34A] text-white'
                : 'border-emerald-500/25 bg-emerald-950/60 text-emerald-100 hover:bg-[#16A34A]/25'
            }`}
            title={isCurrentPageBookmarked ? `Page ${currentPage} Bookmarked` : `Bookmark Page ${currentPage}`}
          >
            <Bookmark className={`h-3.5 w-3.5 ${isCurrentPageBookmarked ? 'fill-current' : ''}`} />
            <span className="hidden lg:inline">
              {isCurrentPageBookmarked ? `P.${currentPage} Saved` : 'Bookmark'}
            </span>
          </button>

          {/* Saved Bookmarks Drawer Toggle */}
          <button
            type="button"
            onClick={() => setShowBookmarksDrawer((prev) => !prev)}
            className={`flex h-9 items-center gap-1 rounded-xl border px-2.5 text-xs font-bold transition ${
              showBookmarksDrawer
                ? 'border-[#22C55E] bg-[#16A34A]/30 text-[#4ade80]'
                : 'border-emerald-500/25 bg-emerald-950/60 text-emerald-100 hover:bg-[#16A34A]/25'
            }`}
            title="View Saved Page Bookmarks"
          >
            <span className="font-mono text-[11px]">{currentPdfBookmarks.length}</span>
            <span className="hidden md:inline">Saved</span>
          </button>

          {/* Night Reading Mode */}
          <button
            type="button"
            onClick={() => setNightMode((prev) => !prev)}
            className={`flex h-9 items-center gap-1.5 rounded-xl border px-2.5 sm:px-3 text-xs font-bold transition ${
              nightMode
                ? 'border-[#22C55E] bg-[#16A34A]/30 text-[#4ade80]'
                : 'border-emerald-500/25 bg-emerald-950/60 text-emerald-100 hover:bg-[#16A34A]/25'
            }`}
            title="Toggle Night Reading Mode"
          >
            {nightMode ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
            <span className="hidden md:inline">{nightMode ? 'Day' : 'Dark'}</span>
          </button>

          {/* Optional Explicit Download */}
          <button
            type="button"
            disabled={downloading}
            onClick={handleExplicitDownload}
            className="flex h-9 items-center gap-1.5 rounded-xl bg-[#16A34A] px-3 text-xs font-bold text-white shadow-[0_0_14px_rgba(34,197,94,0.35)] hover:bg-[#22C55E] disabled:opacity-60 transition"
            title="Download PDF"
          >
            {downloading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : downloaded ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            <span className="hidden sm:inline">{downloaded ? 'Saved' : 'Download'}</span>
          </button>

          {/* Close Viewer */}
          <button
            type="button"
            onClick={() => setPdfRequest(null)}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-emerald-500/25 bg-emerald-950/60 text-emerald-100 hover:border-[#22C55E] hover:bg-[#16A34A] hover:text-white transition"
            aria-label="Close PDF Viewer"
            title="Close"
          >
            <X className="h-4.5 w-4.5" />
          </button>
        </div>
      </div>

      {/* Mobile Compact Zoom Bar */}
      <div className="flex sm:hidden items-center justify-between border-b border-emerald-500/15 bg-[#07160e] px-3 py-1.5 text-xs">
        <span className="font-mono text-emerald-200/80">
          {numPages > 0 ? `${numPages} pages` : 'Loading...'}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(0.6, Number((z - 0.15).toFixed(2))))}
            className="rounded-lg bg-[#16A34A]/25 border border-emerald-500/25 p-1.5 text-emerald-100 hover:bg-[#16A34A]"
            aria-label="Zoom Out"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <span className="font-mono text-[11px] font-bold text-white">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(3, Number((z + 0.2).toFixed(2))))}
            className="rounded-lg bg-[#16A34A]/25 border border-emerald-500/25 p-1.5 text-emerald-100 hover:bg-[#16A34A]"
            aria-label="Zoom In"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="relative flex flex-1 overflow-hidden">
        {/* Scrollable Rendered Pages Viewport */}
        <div
          ref={scrollContainerRef}
          className="flex-1 overflow-y-auto px-2 sm:px-6 py-5 space-y-6"
        >
          {loading ? (
            <div className="flex h-full min-h-[50vh] flex-col items-center justify-center gap-3 text-sm text-emerald-100">
              <Loader2 className="h-9 w-9 animate-spin text-[#22C55E]" />
              <span>Loading PDF pages inside Study Cloud reader...</span>
            </div>
          ) : error ? (
            <div className="mx-auto max-w-md rounded-2xl border border-emerald-500/30 bg-[#0a1c13] p-6 text-center space-y-3 mt-10">
              <AlertCircle className="h-8 w-8 text-[#4ade80] mx-auto" />
              <p className="text-sm text-emerald-100">{error}</p>
              <div className="flex items-center justify-center gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => void loadPdfDocument(pdfRequest.url, title)}
                  className="flex items-center gap-1.5 rounded-xl bg-[#16A34A] hover:bg-[#22C55E] px-4 py-2 text-xs font-bold text-white transition"
                >
                  <RotateCw className="h-3.5 w-3.5" />
                  <span>Retry</span>
                </button>
                <button
                  type="button"
                  onClick={handleExplicitDownload}
                  className="rounded-xl border border-emerald-500/25 bg-emerald-950/60 px-4 py-2 text-xs font-bold text-emerald-100 hover:bg-[#16A34A]/30 transition"
                >
                  Download Instead
                </button>
              </div>
            </div>
          ) : pdfDoc && numPages > 0 ? (
            Array.from({ length: numPages }, (_, idx) => {
              const pNum = idx + 1;
              return (
                <div
                  key={`${pdfRequest.url}-p-${pNum}`}
                  data-page={pNum}
                  ref={(el) => {
                    pageRefs.current[pNum] = el;
                  }}
                >
                  <PdfPageCanvas
                    pdfDoc={pdfDoc}
                    pageNumber={pNum}
                    scale={zoom}
                    containerWidth={containerWidth}
                    nightMode={nightMode}
                  />
                </div>
              );
            })
          ) : null}
        </div>

        {/* Saved Bookmarks Drawer */}
        {showBookmarksDrawer && (
          <div className="w-72 sm:w-80 shrink-0 border-l border-emerald-500/25 bg-[#0a1c13] p-4 flex flex-col gap-3 overflow-y-auto">
            <div className="flex items-center justify-between border-b border-emerald-500/20 pb-2.5">
              <h4 className="font-['Sora'] text-sm font-bold text-white flex items-center gap-1.5">
                <Bookmark className="h-4 w-4 text-[#22C55E]" />
                <span>Bookmarked Pages</span>
              </h4>
              <button
                type="button"
                onClick={() => setShowBookmarksDrawer(false)}
                className="rounded-lg p-1 text-emerald-200/70 hover:bg-[#16A34A]/20"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-2 rounded-xl border border-emerald-500/20 bg-emerald-950/50 p-3">
              <div className="text-[11px] font-bold text-[#4ade80]">
                Save Page {currentPage} with Note
              </div>
              <input
                type="text"
                value={bookmarkNote}
                onChange={(e) => setBookmarkNote(e.target.value)}
                placeholder="Optional note (e.g. Important formula)"
                className="w-full rounded-lg border border-emerald-500/25 bg-[#05110b] px-2.5 py-1.5 text-xs text-white focus:border-[#22C55E] focus:outline-none"
              />
              <button
                type="button"
                disabled={savingBookmark}
                onClick={() => void handleToggleBookmarkPage(bookmarkNote || `Page ${currentPage} highlight`)}
                className="w-full rounded-lg bg-[#16A34A] hover:bg-[#22C55E] py-1.5 text-xs font-bold text-white transition"
              >
                {savingBookmark ? 'Saving...' : `Bookmark Page ${currentPage}`}
              </button>
            </div>

            <div className="space-y-2">
              {currentPdfBookmarks.length === 0 ? (
                <p className="text-xs text-emerald-200/60 py-4 text-center">
                  No pages bookmarked in this PDF yet.
                </p>
              ) : (
                currentPdfBookmarks.map((bm) => (
                  <div
                    key={bm.bookmarkId}
                    className="flex items-center justify-between gap-2 rounded-xl border border-emerald-500/20 bg-emerald-950/40 p-2.5"
                  >
                    <button
                      type="button"
                      onClick={() => scrollToPage(bm.pageNumber)}
                      className="flex-1 min-w-0 text-left"
                    >
                      <div className="font-mono text-xs font-bold text-[#4ade80]">
                        Page {bm.pageNumber}
                      </div>
                      {bm.note && (
                        <div className="text-[11px] text-emerald-100/80 truncate">{bm.note}</div>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDeleteBookmark(bm.bookmarkId)}
                      className="rounded-lg p-1.5 text-emerald-200/60 hover:text-rose-400"
                      title="Remove Bookmark"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
