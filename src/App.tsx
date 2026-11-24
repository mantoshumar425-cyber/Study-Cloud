import { useState, useEffect, useMemo } from 'react';
import {
  Search,
  GraduationCap,
  Sparkles,
  WifiOff,
  Flame,
  RefreshCw,
  Compass,
  Trophy,
  Plus,
  Gem,
} from 'lucide-react';
import { AdventureState, BatchItem, WatchHistoryItem, ThemeId, NavTab, AppControls } from './types';
import {
  clearBatchCatalogCache,
  fetchFastBatchesAndHydrate,
  fetchPiOttCategories,
  fetchAppControls,
  getFavorites,
  toggleFavorite as toggleFavoriteService,
  getWatchHistory,
  clearWatchHistory as clearWatchHistoryService,
  getStoredTheme,
  prefetchPiHome,
  setStoredTheme,
} from './services/batchService';
import {
  addCustomBatch,
  getAdventureMetrics,
  getAdventureState,
  resetAdventureProgress,
  toggleEnrolledBatch,
  toggleLectureCompleted,
} from './services/adventureService';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import { Header } from './components/Header';
import { BottomNav } from './components/BottomNav';
import { PWAInstallBanner } from './components/PWAInstallBanner';
import { BatchCard } from './components/BatchCard';
import { BatchDetailsModal } from './components/BatchDetailsModal';
import { VideoPlayerView, ActiveLectureInput } from './components/VideoPlayerView';
import { ThemeModal } from './components/ThemeModal';
import { AboutModal } from './components/AboutModal';
import { AddBatchModal } from './components/AddBatchModal';
import { FavoritesView } from './components/FavoritesView';
import { WatchHistoryView } from './components/WatchHistoryView';
import { SettingsView } from './components/SettingsView';
import { StudyAiPanel } from './components/StudyAiPanel';
import { KhazanaExplorer } from './components/KhazanaExplorer';
import { Sidebar } from './components/Sidebar';
import { PiView } from './components/PiView';
import { CommunityView } from './components/CommunityView';
import { TestView } from './components/TestView';
import { LectureDownloadCenter } from './components/LectureDownloadCenter';
import { DownloadsView } from './components/DownloadsView';
import { ShareWebsiteModal } from './components/ShareWebsiteModal';
import { registerDownloadActionHandlers } from './services/lectureDownloadManager';
import {
  listOfflineLectureMeta,
  OfflineLectureMeta,
  subscribeOfflineVault,
} from './services/offlineLectureDb';

const VALID_NAV_TABS: NavTab[] = [
  'batches',
  'khazana',
  'pi',
  'community',
  'test',
  'ai',
  'downloads',
  'favorites',
  'history',
  'settings',
];

function getInitialNavTab(): NavTab {
  if (typeof window === 'undefined') return 'batches';
  try {
    const t = new URLSearchParams(window.location.search).get('tab') as NavTab | null;
    if (t && VALID_NAV_TABS.includes(t)) return t;
  } catch {
    // ignore
  }
  return 'batches';
}

export default function App() {
  const isOnline = useOnlineStatus();

  // State
  const [allBatches, setAllBatches] = useState<BatchItem[]>([]);
  const [vidyapeethBatches, setVidyapeethBatches] = useState<BatchItem[]>([]);
  const [isLoadingBatches, setIsLoadingBatches] = useState(true);
  const [batchError, setBatchError] = useState<string | null>(null);

  const [currentTab, setCurrentTab] = useState<NavTab>(() => getInitialNavTab());
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [selectedLanguage, setSelectedLanguage] = useState<string>('all');
  const [selectedClass, setSelectedClass] = useState<string>('all');

  // Favorites, History & Batch Adventure
  const [favorites, setFavorites] = useState<string[]>([]);
  const [watchHistory, setWatchHistory] = useState<WatchHistoryItem[]>([]);
  const [downloadsCount, setDownloadsCount] = useState<number>(0);
  const [adventureState, setAdventureState] = useState<AdventureState>(() => getAdventureState());

  // Modals & Active Viewers
  const [selectedBatch, setSelectedBatch] = useState<BatchItem | null>(null);
  const [activeLecture, setActiveLecture] = useState<ActiveLectureInput | null>(null);
  const [isThemeModalOpen, setIsThemeModalOpen] = useState(false);
  const [isAboutModalOpen, setIsAboutModalOpen] = useState(false);
  const [isAddBatchModalOpen, setIsAddBatchModalOpen] = useState(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [currentTheme, setCurrentTheme] = useState<ThemeId>('dark');
  const [appControls, setAppControls] = useState<AppControls | null>(null);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isDesktopSidebarCollapsed, setIsDesktopSidebarCollapsed] = useState(false);
  const [initialAiPrompt, setInitialAiPrompt] = useState<string | null>(null);

  // Pagination for large 18k batch catalog
  const [displayCount, setDisplayCount] = useState(36);

  const playOfflineItem = (item: OfflineLectureMeta) => {
    setActiveLecture({
      batchId: 'offline-vault',
      batchName: item.batchName || 'Offline Downloads',
      subjectId: 'offline-subject',
      subjectName: item.subjectName || item.qualityLabel,
      topicId: 'offline-topic',
      videoId: item.id,
      title: item.title,
      videoImg: item.thumbnail,
      offlineId: item.id,
      offlineFormat: item.format,
    });
  };

  // Initialize theme, favorites, history, offline vault count, and controls
  useEffect(() => {
    const savedTheme = getStoredTheme();
    setCurrentTheme(savedTheme);
    setStoredTheme(savedTheme);

    setFavorites(getFavorites());
    setWatchHistory(getWatchHistory());

    const refreshOfflineCount = () => {
      void listOfflineLectureMeta().then((list) => setDownloadsCount(list.length));
    };
    refreshOfflineCount();
    const unsubVault = subscribeOfflineVault(refreshOfflineCount);

    registerDownloadActionHandlers({
      onOpenDownloadsTab: () => {
        setCurrentTab('downloads');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      },
      onPlayOffline: (meta) => playOfflineItem(meta),
    });

    fetchAppControls().then((ctrl) => {
      setAppControls(ctrl);
    });

    loadBatches();

    const idlePiTimer = window.setTimeout(() => {
      void fetchPiOttCategories().catch(() => {});
      prefetchPiHome('660fa5f8a224340018a9aa02');
    }, 1000);

    return () => {
      unsubVault();
      window.clearTimeout(idlePiTimer);
    };
  }, []);

  const loadBatches = async () => {
    setIsLoadingBatches(true);
    setBatchError(null);
    try {
      const data = await fetchFastBatchesAndHydrate((fullData) => {
        setAllBatches(fullData.batches || []);
        setVidyapeethBatches(fullData.vidyapeeth || []);
      });
      setAllBatches(data.batches || []);
      setVidyapeethBatches(data.vidyapeeth || []);
    } catch (err: any) {
      setBatchError(err.message || 'Failed to load batches');
    } finally {
      setIsLoadingBatches(false);
    }
  };

  const handleSelectTheme = (theme: ThemeId) => {
    setCurrentTheme(theme);
    setStoredTheme(theme);
    setIsThemeModalOpen(false);
  };

  const handleToggleFavorite = (batchId: string) => {
    toggleFavoriteService(batchId);
    setFavorites(getFavorites());
  };

  const handleClearHistory = () => {
    clearWatchHistoryService();
    setWatchHistory([]);
  };

  const handleRefreshHistory = () => {
    setWatchHistory(getWatchHistory());
  };

  const handleAskAi = (prompt?: string) => {
    if (prompt) {
      setInitialAiPrompt(prompt);
    }
    setCurrentTab('ai');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const adventureMetrics = useMemo(() => getAdventureMetrics(adventureState), [adventureState]);

  const myBatches = useMemo(() => {
    const enrolledSet = new Set(adventureState.enrolledBatchIds);
    const customMap = new Map(adventureState.customBatches.map((b) => [b.batch_id, b]));
    const combined = [...allBatches, ...vidyapeethBatches];
    const seen = new Set<string>();
    const out: BatchItem[] = [];

    for (const cb of adventureState.customBatches) {
      if (!seen.has(cb.batch_id)) {
        seen.add(cb.batch_id);
        out.push(cb);
      }
    }
    for (const b of combined) {
      if (enrolledSet.has(b.batch_id) && !seen.has(b.batch_id)) {
        seen.add(b.batch_id);
        out.push(customMap.get(b.batch_id) || b);
      }
    }
    return out;
  }, [allBatches, vidyapeethBatches, adventureState.enrolledBatchIds, adventureState.customBatches]);

  // Filter batches
  const filteredBatches = useMemo(() => {
    let source =
      activeCategory === 'mybatches'
        ? myBatches
        : activeCategory === 'vidyapeeth'
        ? vidyapeethBatches
        : [...adventureState.customBatches, ...allBatches.filter((b) => !adventureState.customBatches.some((c) => c.batch_id === b.batch_id))];

    if (activeCategory !== 'all' && activeCategory !== 'vidyapeeth' && activeCategory !== 'mybatches') {
      const catLower = activeCategory.toLowerCase();
      source = source.filter((b) => {
        const exam = (b.exam || '').toLowerCase();
        const name = (b.name || '').toLowerCase();
        const cls = (b.class || '').toLowerCase();

        if (catLower === 'jee') return exam.includes('jee') || name.includes('jee');
        if (catLower === 'neet') return exam.includes('neet') || name.includes('neet');
        if (catLower === 'class12') return cls === '12' || name.includes('12');
        if (catLower === 'class11') return cls === '11' || name.includes('11');
        if (catLower === 'class10') return cls === '10' || name.includes('10');
        if (catLower === 'class9') return cls === '9' || name.includes('9');
        if (catLower === 'dropper') return cls.includes('dropper') || name.includes('dropper');
        if (catLower === 'upsc') return exam.includes('upsc') || name.includes('upsc');
        return true;
      });
    }

    if (selectedLanguage !== 'all') {
      source = source.filter((b) => (b.language || '').toLowerCase() === selectedLanguage.toLowerCase());
    }

    if (selectedClass !== 'all') {
      source = source.filter((b) => (b.class || '').toLowerCase() === selectedClass.toLowerCase());
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const terms = q.split(/\s+/).filter(Boolean);
      source = source
        .filter((b) => {
          const hay = `${b.name || ''} ${b.exam || ''} ${b.byName || ''} ${b.class || ''}`.toLowerCase();
          return terms.every((t) => hay.includes(t));
        })
        .sort((a, b) => {
          const aName = (a.name || '').toLowerCase();
          const bName = (b.name || '').toLowerCase();
          const aExact = aName.includes(q) ? 1 : 0;
          const bExact = bName.includes(q) ? 1 : 0;
          if (aExact !== bExact) return bExact - aExact;
          const ta = a.start_date ? Date.parse(a.start_date) : 0;
          const tb = b.start_date ? Date.parse(b.start_date) : 0;
          return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
        });
    }

    const seenBatchIds = new Set<string>();
    return source.filter((b) => {
      if (!b?.batch_id || seenBatchIds.has(b.batch_id)) return false;
      seenBatchIds.add(b.batch_id);
      return true;
    });
  }, [allBatches, vidyapeethBatches, myBatches, adventureState.customBatches, activeCategory, selectedLanguage, selectedClass, searchQuery]);

  const displayedBatches = useMemo(() => {
    return filteredBatches.slice(0, displayCount);
  }, [filteredBatches, displayCount]);

  const favoriteBatchItems = useMemo(() => {
    const favSet = new Set(favorites);
    const combined = [...adventureState.customBatches, ...allBatches, ...vidyapeethBatches];
    const seen = new Set<string>();
    return combined.filter((b) => {
      if (!favSet.has(b.batch_id) || seen.has(b.batch_id)) return false;
      seen.add(b.batch_id);
      return true;
    });
  }, [allBatches, vidyapeethBatches, adventureState.customBatches, favorites]);

  // Categories list
  const categories = [
    { id: 'all', label: 'All Batches', count: allBatches.length || '18K+' },
    { id: 'mybatches', label: 'My Batches', icon: Compass, count: myBatches.length },
    { id: 'jee', label: 'IIT-JEE', icon: Flame },
    { id: 'neet', label: 'NEET', icon: Sparkles },
    { id: 'vidyapeeth', label: 'Vidyapeeth Centers', count: vidyapeethBatches.length || '2.2K+' },
    { id: 'class12', label: 'Class 12' },
    { id: 'class11', label: 'Class 11' },
    { id: 'class10', label: 'Class 10' },
    { id: 'class9', label: 'Class 9' },
    { id: 'dropper', label: 'Droppers' },
    { id: 'upsc', label: 'UPSC' },
  ];

  return (
    <div className="min-h-screen flex bg-[var(--bg-primary)] text-[var(--text-primary)] transition-colors">
      {/* Persistent Collapsible Desktop Slidebar & Mobile Slide-Over Drawer */}
      <Sidebar
        currentTab={currentTab}
        onSelectTab={(tab) => {
          setCurrentTab(tab);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        onOpenThemes={() => setIsThemeModalOpen(true)}
        onOpenAbout={() => setIsAboutModalOpen(true)}
        onOpenShare={() => setIsShareModalOpen(true)}
        currentTheme={currentTheme}
        favoritesCount={favorites.length}
        downloadsCount={downloadsCount}
        adventureStats={{
          xp: adventureMetrics.xp,
          level: adventureMetrics.level,
          rank: adventureMetrics.rank,
          currentStreak: adventureMetrics.currentStreak,
        }}
        isMobileOpen={isMobileSidebarOpen}
        onCloseMobile={() => setIsMobileSidebarOpen(false)}
        isDesktopCollapsed={isDesktopSidebarCollapsed}
      />

      <div className="flex-1 min-w-0 flex flex-col">
        {/* App Header */}
        <Header
          currentTab={currentTab}
          onTabChange={(tab) => {
            setCurrentTab(tab);
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          onOpenThemes={() => setIsThemeModalOpen(true)}
          onOpenAbout={() => setIsAboutModalOpen(true)}
          onOpenShare={() => setIsShareModalOpen(true)}
          onRefresh={async () => {
            await clearBatchCatalogCache();
            await loadBatches();
          }}
          onOpenMobileSidebar={() => setIsMobileSidebarOpen(true)}
          isDesktopSidebarCollapsed={isDesktopSidebarCollapsed}
          onToggleDesktopSidebar={() => setIsDesktopSidebarCollapsed((prev) => !prev)}
          isRefreshing={isLoadingBatches}
          downloadsCount={downloadsCount}
        />

        {/* PWA Install Banner */}
        <PWAInstallBanner />

        {/* Offline Toast */}
        {!isOnline && (
          <div className="sticky top-[58px] z-20 flex items-center justify-center gap-2 bg-amber-500 py-1.5 px-3 text-xs font-bold text-white shadow-md">
            <WifiOff className="h-3.5 w-3.5" />
            <span>Offline Mode — Cached study batches and saved history are active.</span>
          </div>
        )}

        {/* Main Content Area */}
        <main className="flex-1 pb-16 lg:pb-6">
          {/* VIEW 1: STUDY AI */}
          {currentTab === 'ai' ? (
            <div className="mx-auto max-w-6xl px-3 sm:px-5 py-4">
              <StudyAiPanel
                variant="page"
                scopeKey="global"
                initialPrompt={initialAiPrompt}
                onConsumeInitialPrompt={() => setInitialAiPrompt(null)}
              />
            </div>
          ) : currentTab === 'pi' ? (
            /* VIEW 1A: PW PI PRO (OTT) WORKSPACE */
            <div className="w-full px-3 sm:px-5 lg:px-6 py-4 sm:py-5">
              <PiView
                onAskAi={(prompt) => handleAskAi(prompt)}
                onActivityUpdate={() => setAdventureState(getAdventureState())}
                xp={adventureMetrics.xp}
                onPlayLecture={(lec) => {
                  setActiveLecture({
                    batchId: lec.batchId,
                    batchName: lec.batchName,
                    programId: lec.programId,
                    subjectId: lec.subjectId,
                    subjectName: lec.subjectName,
                    topicId: lec.topicId,
                    topicName: lec.topicName,
                    videoId: lec.videoId,
                    findKey: lec.findKey,
                    videoDetailsId: lec.videoDetailsId,
                    typeId: lec.typeId,
                    title: lec.title,
                    videoImg: lec.videoImg,
                    videoType: lec.videoType,
                    playType: lec.playType,
                    rawVideoUrl: lec.rawVideoUrl,
                  });
                  handleRefreshHistory();
                }}
              />
            </div>
          ) : currentTab === 'community' ? (
            /* VIEW 1B: STUDENT COMMUNITY & CHANNELS */
            <div className="w-full px-3 sm:px-5 lg:px-6 py-4 sm:py-5">
              <CommunityView
                appControls={appControls}
                myBatches={myBatches}
                allBatches={allBatches}
                onAskAi={(prompt) => handleAskAi(prompt)}
                onSelectBatch={(batch) => setSelectedBatch(batch)}
              />
            </div>
          ) : currentTab === 'test' ? (
            /* VIEW 1C: TEST CBT PRACTICE & AI MOCK EXAM */
            <div className="w-full px-3 sm:px-5 lg:px-6 py-4 sm:py-5">
              <TestView
                myBatches={myBatches}
                allBatches={allBatches}
                onAskAi={(prompt) => handleAskAi(prompt)}
                onActivityUpdate={() => setAdventureState(getAdventureState())}
              />
            </div>
          ) : currentTab === 'khazana' ? (
            /* VIEW 1D: KHAZANA LECTURE VAULT */
            <div className="w-full px-3 sm:px-5 lg:px-6 py-4 sm:py-5">
              <KhazanaExplorer
                adventureState={adventureState}
                onToggleLectureComplete={(params) => setAdventureState(toggleLectureCompleted(params))}
                onPlayLecture={(lec) => {
                  setActiveLecture({
                    batchId: lec.batchId,
                    batchName: lec.batchName,
                    programId: lec.programId,
                    subjectId: lec.subjectId,
                    subjectName: lec.subjectName,
                    topicId: lec.topicId,
                    topicName: lec.topicName,
                    videoId: lec.videoId,
                    findKey: lec.findKey,
                    videoDetailsId: lec.videoDetailsId,
                    typeId: lec.typeId,
                    title: lec.title,
                    videoImg: lec.videoImg,
                    videoType: lec.videoType,
                    playType: lec.playType,
                    rawVideoUrl: lec.rawVideoUrl,
                  });
                  handleRefreshHistory();
                }}
              />
            </div>
          ) : currentTab === 'downloads' ? (
          /* VIEW 1E: IN-APP OFFLINE DOWNLOADS VAULT */
          <div className="mx-auto max-w-6xl px-3 sm:px-5 py-4 sm:py-5">
            <DownloadsView
              onPlayOffline={(item) => playOfflineItem(item)}
              onBrowseBatches={() => setCurrentTab('batches')}
            />
          </div>
          ) : currentTab === 'favorites' ? (
          /* VIEW 2: FAVORITES */
          <div className="mx-auto max-w-6xl px-3 sm:px-5 py-4 sm:py-5">
            <FavoritesView
              favoriteBatches={favoriteBatchItems}
              onToggleFavorite={handleToggleFavorite}
              onSelectBatch={(batch) => setSelectedBatch(batch)}
              onBrowseBatches={() => setCurrentTab('batches')}
            />
          </div>
        ) : currentTab === 'history' ? (
          /* VIEW 3: WATCH HISTORY */
          <div className="mx-auto max-w-6xl px-3 sm:px-5 py-4 sm:py-5">
            <WatchHistoryView
              history={watchHistory}
              onPlayItem={(item) => {
                if (item.batchId && item.subjectId && item.topicId && item.videoId) {
                  setActiveLecture({
                    batchId: item.batchId,
                    batchName: item.batchName,
                    programId: item.programId,
                    subjectId: item.subjectId,
                    topicId: item.topicId,
                    videoId: item.videoId,
                    videoType: item.videoType || 'new',
                    playType: item.playType || 'Lecture',
                    title: item.title,
                    rawVideoUrl: item.videoUrl,
                    resumeSeconds: item.progressSeconds,
                  });
                } else {
                  const found = [...allBatches, ...vidyapeethBatches].find(
                    (b) => b.batch_id === item.batchId
                  );
                  if (found) setSelectedBatch(found);
                }
              }}
              onClearHistory={handleClearHistory}
              onBrowseBatches={() => setCurrentTab('batches')}
            />
          </div>
        ) : currentTab === 'settings' ? (
          /* VIEW 4: SETTINGS */
          <div className="mx-auto max-w-6xl px-3 sm:px-5 py-4 sm:py-5">
            <SettingsView
              currentTheme={currentTheme}
              onOpenThemes={() => setIsThemeModalOpen(true)}
              onOpenAbout={() => setIsAboutModalOpen(true)}
              onOpenAddBatch={() => setIsAddBatchModalOpen(true)}
              onResetAdventure={() => setAdventureState(resetAdventureProgress())}
              adventureStats={{
                xp: adventureMetrics.xp,
                level: adventureMetrics.level,
                rank: adventureMetrics.rank,
                currentStreak: adventureMetrics.currentStreak,
                completedCount: adventureMetrics.completedCount,
                enrolledCount: myBatches.length,
              }}
              appControls={appControls}
              onClearCache={async () => {
                await clearBatchCatalogCache();
                await loadBatches();
              }}
            />
          </div>
        ) : (
          /* VIEW 5: BATCHES & SEARCH */
          <div className="w-full px-3 sm:px-5 lg:px-6 py-4 sm:py-5 space-y-5">
            {/* Batch Adventure & Streak Hub */}
            <div className="relative overflow-hidden rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4 sm:p-6 shadow-sm">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2 text-xs sm:text-sm text-[var(--text-secondary)]">
                    <span className="font-bold text-[var(--primary-color)]">
                      Study Cloud · Lv.{adventureMetrics.level} {adventureMetrics.rank}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">
                      {allBatches.length > 0 ? `${allBatches.length.toLocaleString()} Batches` : 'Loading Batches...'}
                    </span>
                  </div>
                  <h1 className="font-['Sora'] text-xl sm:text-2xl lg:text-3xl font-extrabold text-[var(--text-primary)] leading-tight">
                    Study Cloud — Batches & Learning Hub
                  </h1>
                  <p className="text-xs sm:text-sm text-[var(--text-secondary)] max-w-2xl leading-relaxed">
                    Track your daily study streak, explore Khazana, PW Pi, PW Community, PW Test, and stream
                    lectures with notes inside one distraction-free workspace.
                  </p>
                </div>

                {/* Live Adventure Stats + Add Batch Controls */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                  <div className="grid grid-cols-3 gap-3.5 rounded-xl border border-[var(--card-border)] bg-[var(--bg-secondary)] px-4 py-2.5 text-center">
                    <div>
                      <div className="flex items-center justify-center gap-1 font-mono tabular-nums text-base sm:text-lg font-extrabold text-amber-400">
                        <Flame className="h-4 w-4" />
                        <span>{adventureMetrics.currentStreak}d</span>
                      </div>
                      <div className="text-[11px] text-[var(--text-secondary)]">Streak</div>
                    </div>
                    <div>
                      <div className="flex items-center justify-center gap-1 font-mono tabular-nums text-base sm:text-lg font-extrabold text-emerald-400">
                        <Trophy className="h-4 w-4" />
                        <span>{adventureMetrics.xp}</span>
                      </div>
                      <div className="text-[11px] text-[var(--text-secondary)]">Total XP</div>
                    </div>
                    <div>
                      <div className="font-mono tabular-nums text-base sm:text-lg font-extrabold text-[var(--text-primary)]">
                        {adventureMetrics.completedCount}
                      </div>
                      <div className="text-[11px] text-[var(--text-secondary)]">Cleared</div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => {
                        setCurrentTab('khazana');
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                      }}
                      className="flex flex-1 sm:flex-initial items-center justify-center gap-1.5 rounded-xl border border-amber-500/40 bg-amber-500/15 px-3.5 py-2 text-xs font-bold text-amber-400 hover:bg-amber-500/25 transition whitespace-nowrap"
                    >
                      <Gem className="h-4 w-4" />
                      <span>Khazana</span>
                    </button>
                    <button
                      onClick={() => {
                        setActiveCategory('mybatches');
                        setDisplayCount(36);
                      }}
                      className="flex flex-1 sm:flex-initial items-center justify-center gap-1.5 rounded-xl border border-[var(--card-border)] bg-[var(--bg-secondary)] px-3.5 py-2 text-xs font-bold text-[var(--text-primary)] hover:border-[var(--primary-color)] transition whitespace-nowrap"
                    >
                      <Compass className="h-4 w-4 text-[var(--primary-color)]" />
                      <span>My Batches ({myBatches.length})</span>
                    </button>
                    <button
                      onClick={() => setIsAddBatchModalOpen(true)}
                      className="flex flex-1 sm:flex-initial items-center justify-center gap-1.5 rounded-xl bg-[var(--primary-color)] px-4 py-2 text-xs font-bold text-white shadow-sm hover:opacity-90 transition active:scale-95 whitespace-nowrap"
                    >
                      <Plus className="h-4 w-4" />
                      <span>Add Batch</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Search Input & Filters Box */}
            <div className="flex flex-col md:flex-row items-stretch md:items-center gap-2.5">
              {/* Search Bar */}
              <div className="relative flex-1">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-secondary)]" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setDisplayCount(36);
                  }}
                  placeholder="Search 18,000+ batches by name, exam (JEE, NEET), teacher, or class..."
                  className="w-full rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] py-2.5 pl-10 pr-14 text-xs sm:text-sm text-[var(--text-primary)] placeholder-[var(--text-secondary)] shadow-sm focus:border-[var(--primary-color)] focus:outline-none focus:ring-2 focus:ring-[var(--primary-color)]/20 transition"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  >
                    Clear
                  </button>
                )}
              </div>

              {/* Language & Class Filters */}
              <div className="flex items-center gap-2.5">
                <select
                  value={selectedLanguage}
                  onChange={(e) => {
                    setSelectedLanguage(e.target.value);
                    setDisplayCount(36);
                  }}
                  className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2.5 text-xs sm:text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:border-[var(--primary-color)]"
                >
                  <option value="all">Language: All</option>
                  <option value="hinglish">Hinglish</option>
                  <option value="hindi">Hindi</option>
                  <option value="english">English</option>
                </select>

                <select
                  value={selectedClass}
                  onChange={(e) => {
                    setSelectedClass(e.target.value);
                    setDisplayCount(36);
                  }}
                  className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2.5 text-xs sm:text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:border-[var(--primary-color)]"
                >
                  <option value="all">Class: All</option>
                  <option value="12">Class 12</option>
                  <option value="11">Class 11</option>
                  <option value="10">Class 10</option>
                  <option value="9">Class 9</option>
                  <option value="dropper">Dropper</option>
                </select>
              </div>
            </div>

            {/* Category Filter Tabs (Horizontal Scroll) */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1.5 no-scrollbar">
              {categories.map((cat) => {
                const isActive = activeCategory === cat.id;
                const Icon = cat.icon;
                return (
                  <button
                    key={cat.id}
                    onClick={() => {
                      setActiveCategory(cat.id);
                      setDisplayCount(36);
                    }}
                    className={`flex shrink-0 items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs sm:text-sm font-bold transition-all ${
                      isActive
                        ? 'bg-[var(--primary-color)] text-white shadow-sm shadow-indigo-600/20'
                        : 'border border-[var(--card-border)] bg-[var(--card-bg)] text-[var(--text-secondary)] hover:border-[var(--primary-color)]/40 hover:text-[var(--text-primary)]'
                    }`}
                  >
                    {Icon && <Icon className="h-3.5 w-3.5" />}
                    <span>{cat.label}</span>
                    {cat.count && (
                      <span
                        className={`rounded-md px-1.5 py-0.5 text-[11px] ${
                          isActive ? 'bg-white/20 text-white' : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)]'
                        }`}
                      >
                        {cat.count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Results Status */}
            <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
              <span>
                Showing <strong className="text-[var(--text-primary)]">{displayedBatches.length}</strong> of{' '}
                <strong className="text-[var(--text-primary)]">{filteredBatches.length.toLocaleString()}</strong> batches
              </span>
              {searchQuery && (
                <span>
                  Filtered by query: <span className="text-[var(--primary-color)] font-semibold">"{searchQuery}"</span>
                </span>
              )}
            </div>

            {/* Error Banner if catalog failed */}
            {batchError && (
              <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs sm:text-sm text-red-300">
                <span>Could not refresh batch catalog: {batchError}</span>
                <button
                  type="button"
                  onClick={() => loadBatches()}
                  className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-500 transition"
                >
                  Retry
                </button>
              </div>
            )}

            {/* Batches Grid */}
            {isLoadingBatches ? (
              /* Skeletons */
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div
                    key={i}
                    className="flex flex-col overflow-hidden rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] animate-pulse"
                  >
                    <div className="aspect-video w-full bg-[var(--bg-tertiary)]" />
                    <div className="p-4 space-y-2.5">
                      <div className="h-4 w-3/4 rounded bg-[var(--bg-tertiary)]" />
                      <div className="h-3.5 w-1/2 rounded bg-[var(--bg-tertiary)]" />
                      <div className="h-3.5 w-full rounded bg-[var(--bg-tertiary)]" />
                    </div>
                  </div>
                ))}
              </div>
            ) : filteredBatches.length === 0 ? (
              /* Empty state */
              <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--card-border)] bg-[var(--bg-secondary)]/50 p-8 text-center">
                <GraduationCap className="h-10 w-10 text-slate-500 mb-2.5" />
                <h3 className="font-['Sora'] text-base font-bold text-[var(--text-primary)]">
                  No Batches Found
                </h3>
                <p className="mt-1 text-xs sm:text-sm text-[var(--text-secondary)] max-w-sm">
                  We couldn't find any batches matching your filter. Try adjusting your keyword or
                  selecting "All Batches".
                </p>
                <button
                  onClick={() => {
                    setSearchQuery('');
                    setActiveCategory('all');
                    setSelectedLanguage('all');
                    setSelectedClass('all');
                  }}
                  className="mt-4 rounded-xl bg-[var(--primary-color)] px-4 py-2 text-xs sm:text-sm font-bold text-white shadow-sm hover:opacity-90"
                >
                  Reset Filters
                </button>
              </div>
            ) : (
              /* Compact 4-col Responsive Batch Cards Grid */
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
                {displayedBatches.map((batch, idx) => (
                  <BatchCard
                    key={`${batch.batch_id}-${idx}`}
                    batch={batch}
                    isFavorite={favorites.includes(batch.batch_id)}
                    onToggleFavorite={handleToggleFavorite}
                    onSelect={(b) => setSelectedBatch(b)}
                    onQuickPlay={(b) => setSelectedBatch(b)}
                  />
                ))}
              </div>
            )}

            {/* Load More Button */}
            {displayedBatches.length < filteredBatches.length && (
              <div className="flex justify-center pt-2">
                <button
                  onClick={() => setDisplayCount((prev) => prev + 36)}
                  className="flex items-center gap-2 rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] px-5 py-2.5 text-xs sm:text-sm font-bold text-[var(--text-primary)] shadow-sm hover:border-[var(--primary-color)] hover:bg-[var(--bg-tertiary)] transition active:scale-95"
                >
                  <RefreshCw className="h-3.5 w-3.5 text-[var(--primary-color)]" />
                  <span>
                    Load More Batches ({(filteredBatches.length - displayedBatches.length).toLocaleString()} remaining)
                  </span>
                </button>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Batch Details Modal */}
      {selectedBatch && (
        <BatchDetailsModal
          batch={selectedBatch}
          isFavorite={favorites.includes(selectedBatch.batch_id)}
          onToggleFavorite={handleToggleFavorite}
          adventureState={adventureState}
          isEnrolled={
            adventureState.enrolledBatchIds.includes(selectedBatch.batch_id) ||
            adventureState.customBatches.some((b) => b.batch_id === selectedBatch.batch_id)
          }
          onToggleEnroll={(batchId) => setAdventureState(toggleEnrolledBatch(batchId))}
          onToggleLectureComplete={(params) => setAdventureState(toggleLectureCompleted(params))}
          onClose={() => setSelectedBatch(null)}
          onPlayLecture={(lec) => {
            setActiveLecture({
              batchId: lec.batchId,
              batchName: lec.batchName,
              programId: lec.programId,
              subjectId: lec.subjectId,
              subjectName: lec.subjectName,
              topicId: lec.topicId,
              topicName: lec.topicName,
              videoId: lec.videoId,
              findKey: lec.findKey,
              videoDetailsId: lec.videoDetailsId,
              typeId: lec.typeId,
              title: lec.title,
              videoImg: lec.videoImg,
              videoType: lec.videoType,
              playType: lec.playType,
              rawVideoUrl: lec.rawVideoUrl,
            });
            handleRefreshHistory();
          }}
          onSelectSubBatch={(subBatch) => setSelectedBatch(subBatch)}
        />
      )}

      {/* Full Video Player Screen */}
      {activeLecture && (
        <VideoPlayerView
          lecture={activeLecture}
          onAdventureUpdate={() => setAdventureState(getAdventureState())}
          onBack={() => {
            setActiveLecture(null);
            setAdventureState(getAdventureState());
            handleRefreshHistory();
          }}
        />
      )}

      {/* Add Batch Modal */}
      {isAddBatchModalOpen && (
        <AddBatchModal
          onClose={() => setIsAddBatchModalOpen(false)}
          onAddBatch={(batch) => {
            setAdventureState(addCustomBatch(batch));
            setActiveCategory('mybatches');
          }}
        />
      )}

      {/* Theme Selector Modal */}
      {isThemeModalOpen && (
        <ThemeModal
          currentTheme={currentTheme}
          onSelectTheme={handleSelectTheme}
          onClose={() => setIsThemeModalOpen(false)}
        />
      )}

      {/* About Modal */}
      {isAboutModalOpen && <AboutModal onClose={() => setIsAboutModalOpen(false)} />}

      {/* Share & Promote Website Modal */}
      {isShareModalOpen && <ShareWebsiteModal onClose={() => setIsShareModalOpen(false)} />}

      {/* Global Lecture Download Center (Quality Picker + Progress Queue) */}
      <LectureDownloadCenter />

        {/* Mobile Bottom Navigation */}
        <BottomNav
          currentTab={currentTab}
          onTabChange={(tab) => {
            setCurrentTab(tab);
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          onOpenSlidebar={() => setIsMobileSidebarOpen(true)}
        />
      </div>
    </div>
  );
}
