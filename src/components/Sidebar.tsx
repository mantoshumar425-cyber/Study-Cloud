import React from 'react';
import {
  BookOpen,
  Gem,
  Compass,
  Users,
  ClipboardCheck,
  Sparkles,
  Palette,
  Heart,
  History,
  Settings2,
  X,
  Trophy,
  Flame,
  ChevronRight,
  Sigma,
} from 'lucide-react';
import { NavTab, ThemeId } from '../types';

export const STUDY_CLOUD_LOGO =
  '/assets/aistudio/file_0000000032b08211ac7bbc1f00111c6e_0ba6160d.png';

interface SidebarProps {
  currentTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  onOpenThemes: () => void;
  onOpenAbout: () => void;
  currentTheme: ThemeId;
  favoritesCount: number;
  adventureStats: {
    xp: number;
    level: number;
    rank: string;
    currentStreak: number;
  };
  isMobileOpen: boolean;
  onCloseMobile: () => void;
  isDesktopCollapsed: boolean;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentTab,
  onSelectTab,
  onOpenThemes,
  onOpenAbout,
  currentTheme,
  favoritesCount,
  adventureStats,
  isMobileOpen,
  onCloseMobile,
  isDesktopCollapsed,
}) => {
  const mainItems: Array<{
    id: NavTab;
    label: string;
    subtitle: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    { id: 'batches', label: 'Batches', subtitle: '18,000+ courses', icon: BookOpen },
    { id: 'khazana', label: 'Khazana', subtitle: 'Faculty lecture vault', icon: Gem },
    { id: 'pi', label: 'Pi', subtitle: 'Focus & scientific tools', icon: Sigma },
    { id: 'community', label: 'Community', subtitle: 'Channels & study lounge', icon: Users },
    { id: 'test', label: 'Test', subtitle: 'CBT mock & practice sets', icon: ClipboardCheck },
    { id: 'ai', label: 'AI', subtitle: 'Study AI doubt solver', icon: Sparkles },
  ];

  const utilityItems: Array<{
    id: NavTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    count?: number;
  }> = [
    { id: 'favorites', label: 'Favorites', icon: Heart, count: favoritesCount },
    { id: 'history', label: 'History', icon: History },
    { id: 'settings', label: 'Settings', icon: Settings2 },
  ];

  const handleNav = (tab: NavTab) => {
    onSelectTab(tab);
    onCloseMobile();
  };

  const renderSidebarInner = (compact: boolean) => (
    <div className="flex h-full flex-col bg-[var(--bg-secondary)] text-[var(--text-primary)] select-none">
      {/* Brand Header */}
      <div className="flex h-[72px] shrink-0 items-center justify-between border-b border-[var(--card-border)] px-4">
        <button
          type="button"
          onClick={() => {
            onOpenAbout();
            onCloseMobile();
          }}
          className="flex items-center gap-3 min-w-0 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary-color)] rounded-xl"
          title="About Study Cloud"
        >
          <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl shadow-md ring-1 ring-white/15">
            <img
              src={STUDY_CLOUD_LOGO}
              alt="Study Cloud Logo"
              className="h-full w-full object-cover scale-[1.04]"
            />
          </div>
          {!compact && (
            <div className="min-w-0">
              <div className="font-['Sora'] text-base sm:text-lg font-extrabold tracking-tight text-[var(--text-primary)] truncate">
                Study Cloud
              </div>
              <div className="text-xs font-medium text-[var(--text-secondary)] truncate">
                Learn · Practice · Grow
              </div>
            </div>
          )}
        </button>

        {/* Close button shown inside mobile drawer */}
        <button
          type="button"
          onClick={onCloseMobile}
          className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--card-border)] bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] lg:hidden"
          aria-label="Close slidebar"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Navigation Sections */}
      <div className="flex-1 overflow-y-auto px-3.5 py-5 space-y-6">
        <div className="space-y-1.5">
          {!compact && (
            <div className="px-3 pb-1.5 text-xs font-bold tracking-wide text-[var(--text-secondary)]">
              Study Workspace
            </div>
          )}
          {mainItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNav(item.id)}
                title={compact ? item.label : undefined}
                className={`group flex w-full items-center gap-3.5 rounded-2xl px-3.5 py-3 text-left transition ${
                  isActive
                    ? 'bg-[var(--primary-color)] text-white shadow-sm'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
                } ${compact ? 'justify-center px-2.5' : ''}`}
              >
                <Icon
                  className={`h-5 w-5 shrink-0 ${
                    isActive ? 'text-white' : 'text-[var(--text-secondary)] group-hover:text-[var(--primary-color)]'
                  }`}
                />
                {!compact && (
                  <div className="min-w-0 flex-1">
                    <div className="text-[15px] font-bold leading-tight whitespace-nowrap truncate">
                      {item.label}
                    </div>
                    <div
                      className={`text-xs truncate ${
                        isActive ? 'text-white/80' : 'text-[var(--text-secondary)]'
                      }`}
                    >
                      {item.subtitle}
                    </div>
                  </div>
                )}
                {!compact && isActive && <ChevronRight className="h-4 w-4 shrink-0 opacity-85" />}
              </button>
            );
          })}
        </div>

        {/* Theme & Library Section */}
        <div className="space-y-1.5 border-t border-[var(--card-border)] pt-5">
          {!compact && (
            <div className="px-3 pb-1.5 text-xs font-bold tracking-wide text-[var(--text-secondary)]">
              Library & Theme
            </div>
          )}

          {utilityItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNav(item.id)}
                title={compact ? item.label : undefined}
                className={`group flex w-full items-center gap-3.5 rounded-2xl px-3.5 py-3 text-left transition ${
                  isActive
                    ? 'bg-[var(--bg-tertiary)] text-[var(--primary-color)] font-bold'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
                } ${compact ? 'justify-center px-2.5' : ''}`}
              >
                <Icon className="h-5 w-5 shrink-0" />
                {!compact && (
                  <span className="flex-1 text-[15px] font-semibold whitespace-nowrap truncate">
                    {item.label}
                  </span>
                )}
                {!compact && item.count !== undefined && item.count > 0 && (
                  <span className="font-mono tabular-nums text-xs font-bold text-[var(--primary-color)]">
                    {item.count}
                  </span>
                )}
              </button>
            );
          })}

          {/* Theme Modal Trigger inside Slidebar */}
          <button
            type="button"
            onClick={() => {
              onOpenThemes();
              onCloseMobile();
            }}
            title={compact ? 'Theme' : undefined}
            className={`group flex w-full items-center gap-3.5 rounded-2xl px-3.5 py-3 text-left text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] transition ${
              compact ? 'justify-center px-2.5' : ''
            }`}
          >
            <Palette className="h-5 w-5 shrink-0 text-[var(--primary-color)]" />
            {!compact && (
              <div className="min-w-0 flex-1 flex items-center justify-between gap-2">
                <span className="text-[15px] font-semibold whitespace-nowrap">Theme</span>
                <span className="text-xs capitalize text-[var(--text-secondary)] truncate">
                  {currentTheme.replace('-', ' ')}
                </span>
              </div>
            )}
          </button>
        </div>
      </div>

      {/* Bottom Adventure Summary */}
      {!compact ? (
        <div className="shrink-0 border-t border-[var(--card-border)] p-3.5">
          <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--bg-primary)]/70 p-3 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 font-bold text-[var(--text-primary)]">
                <Compass className="h-4 w-4 text-[var(--primary-color)]" />
                <span>Lv.{adventureStats.level} {adventureStats.rank}</span>
              </span>
            </div>
            <div className="flex items-center justify-between font-mono tabular-nums text-xs text-[var(--text-secondary)]">
              <span className="flex items-center gap-1 text-emerald-400 font-bold">
                <Trophy className="h-3.5 w-3.5" />
                {adventureStats.xp} XP
              </span>
              <span className="flex items-center gap-1 text-amber-400 font-bold">
                <Flame className="h-3.5 w-3.5" />
                {adventureStats.currentStreak}d Streak
              </span>
            </div>
          </div>
        </div>
      ) : (
        <div className="shrink-0 border-t border-[var(--card-border)] py-3 flex flex-col items-center gap-1 font-mono tabular-nums text-[11px] font-bold text-amber-400">
          <Flame className="h-4 w-4" />
          <span>{adventureStats.currentStreak}d</span>
        </div>
      )}
    </div>
  );

  return (
    <>
      {/* Desktop Persistent Collapsible Slidebar */}
      <aside
        className={`hidden lg:block shrink-0 border-r border-[var(--card-border)] bg-[var(--bg-secondary)] transition-[width] duration-200 sticky top-0 h-[100dvh] z-30 ${
          isDesktopCollapsed ? 'w-[84px]' : 'w-[292px]'
        }`}
      >
        {renderSidebarInner(isDesktopCollapsed)}
      </aside>

      {/* Mobile & Tablet Slide-Over Drawer */}
      {isMobileOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div
            onClick={onCloseMobile}
            className="fixed inset-0 bg-black/65 backdrop-blur-sm transition-opacity"
            aria-hidden="true"
          />
          <aside className="relative z-10 h-full w-[310px] max-w-[88vw] border-r border-[var(--card-border)] bg-[var(--bg-secondary)] shadow-2xl">
            {renderSidebarInner(false)}
          </aside>
        </div>
      )}
    </>
  );
};
