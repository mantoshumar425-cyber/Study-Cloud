import React from 'react';
import {
  Download,
  FolderDown,
  Palette,
  RotateCw,
  Info,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Share2,
} from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { NavTab } from '../types';
import { STUDY_CLOUD_LOGO } from './Sidebar';

interface HeaderProps {
  currentTab: NavTab;
  onTabChange: (tab: NavTab) => void;
  onOpenThemes: () => void;
  onOpenAbout: () => void;
  onRefresh: () => void;
  onOpenMobileSidebar: () => void;
  isDesktopSidebarCollapsed: boolean;
  onToggleDesktopSidebar: () => void;
  isRefreshing?: boolean;
  downloadsCount?: number;
  onOpenShare?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentTab,
  onTabChange,
  onOpenThemes,
  onOpenAbout,
  onRefresh,
  onOpenMobileSidebar,
  isDesktopSidebarCollapsed,
  onToggleDesktopSidebar,
  isRefreshing = false,
  downloadsCount = 0,
  onOpenShare,
}) => {
  const { isInstallable, isInstalled, install, isIOS } = usePWAInstall();

  const quickNavLinks: Array<{ id: NavTab; label: string }> = [
    { id: 'batches', label: 'Batches' },
    { id: 'khazana', label: 'Khazana' },
    { id: 'pi', label: 'Pi' },
    { id: 'test', label: 'Test' },
    { id: 'community', label: 'Community' },
  ];

  return (
    <header className="sticky top-0 z-30 w-full border-b border-[var(--card-border)] bg-[var(--bg-primary)]/85 backdrop-blur-xl shadow-sm transition-colors">
      <div className="flex h-[58px] items-center justify-between gap-3 sm:gap-6 px-3 sm:px-5">
        {/* Zone 1: Slidebar Toggle + Study Cloud Brand */}
        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={onOpenMobileSidebar}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--card-border)] bg-[var(--bg-secondary)] text-[var(--text-primary)] hover:border-[var(--primary-color)] transition lg:hidden"
            title="Open Slidebar"
            aria-label="Open Slidebar"
          >
            <Menu className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={onToggleDesktopSidebar}
            className="hidden lg:flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--card-border)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:border-[var(--primary-color)] hover:text-[var(--text-primary)] transition"
            title={isDesktopSidebarCollapsed ? 'Expand Slidebar' : 'Collapse Slidebar'}
            aria-label="Toggle Slidebar"
          >
            {isDesktopSidebarCollapsed ? (
              <PanelLeftOpen className="h-4 w-4" />
            ) : (
              <PanelLeftClose className="h-4 w-4" />
            )}
          </button>

          <button
            type="button"
            onClick={() => onTabChange('batches')}
            className="flex items-center gap-2 rounded-xl p-0.5 text-left transition hover:opacity-90 focus:outline-none whitespace-nowrap shrink-0 lg:hidden"
            title="Study Cloud Home"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-xl shadow-sm ring-1 ring-white/15">
              <img
                src={STUDY_CLOUD_LOGO}
                alt="Study Cloud Logo"
                className="h-full w-full object-cover scale-[1.04]"
              />
            </div>
            <span className="font-['Sora'] text-base font-extrabold tracking-[-0.02em] text-[var(--text-primary)] whitespace-nowrap">
              Study Cloud
            </span>
          </button>
        </div>

        {/* Zone 2: Clean Typography Quick Links */}
        <nav className="hidden md:flex items-center gap-6 text-[13.5px] font-bold tracking-[-0.01em]">
          {quickNavLinks.map((item) => {
            const isActive = currentTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onTabChange(item.id)}
                className={`whitespace-nowrap shrink-0 py-1.5 transition-colors border-b-2 ${
                  isActive
                    ? 'border-[var(--primary-color)] text-[var(--primary-color)] font-extrabold'
                    : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: Actions */}
        <div className="flex items-center gap-2 shrink-0">
          {!isInstalled && (isInstallable || isIOS) && (
            <button
              type="button"
              onClick={install}
              className="flex items-center gap-1.5 rounded-xl bg-[var(--primary-color)] px-3 py-1.5 text-xs font-bold text-white shadow-sm hover:opacity-90 transition whitespace-nowrap shrink-0"
              title="Install Study Cloud App"
            >
              <Download className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Install App</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => onTabChange('downloads')}
            className={`relative flex h-9 items-center gap-1.5 rounded-xl border px-2.5 sm:px-3 text-xs font-bold transition whitespace-nowrap shrink-0 ${
              currentTab === 'downloads'
                ? 'border-[var(--primary-color)] bg-[var(--primary-color)] text-white'
                : 'border-[var(--card-border)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:border-[var(--primary-color)] hover:text-[var(--text-primary)]'
            }`}
            title="My Offline Downloads (Inside App)"
          >
            <FolderDown
              className={`h-3.5 w-3.5 ${
                currentTab === 'downloads' ? 'text-white' : 'text-emerald-400'
              }`}
            />
            <span className="hidden sm:inline">Downloads</span>
            {downloadsCount > 0 && (
              <span
                className={`rounded-md px-1.5 py-0.5 font-mono text-[10px] font-extrabold ${
                  currentTab === 'downloads'
                    ? 'bg-white/20 text-white'
                    : 'bg-emerald-500/20 text-emerald-400'
                }`}
              >
                {downloadsCount}
              </span>
            )}
          </button>

          {onOpenShare && (
            <button
              type="button"
              onClick={onOpenShare}
              className="flex h-9 items-center gap-1.5 rounded-xl border border-indigo-500/35 bg-indigo-500/15 px-2.5 sm:px-3 text-xs font-bold text-indigo-300 transition hover:bg-indigo-600 hover:text-white whitespace-nowrap shrink-0"
              title="Share Study Cloud Website"
            >
              <Share2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Share</span>
            </button>
          )}

          <button
            type="button"
            onClick={onOpenThemes}
            className="flex h-9 items-center gap-1.5 rounded-xl border border-[var(--card-border)] bg-[var(--bg-secondary)] px-3 text-xs font-bold text-[var(--text-secondary)] transition hover:border-[var(--primary-color)] hover:text-[var(--text-primary)] whitespace-nowrap shrink-0"
            title="Change App Theme"
          >
            <Palette className="h-3.5 w-3.5 text-[var(--primary-color)]" />
            <span className="hidden sm:inline">Theme</span>
          </button>

          <button
            type="button"
            onClick={onRefresh}
            disabled={isRefreshing}
            className={`flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--card-border)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] transition hover:border-[var(--primary-color)] hover:text-[var(--text-primary)] ${
              isRefreshing ? 'opacity-60' : ''
            }`}
            title="Refresh Batches"
          >
            <RotateCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin text-[var(--primary-color)]' : ''}`} />
          </button>

          <button
            type="button"
            onClick={onOpenAbout}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--card-border)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] transition hover:border-[var(--primary-color)] hover:text-[var(--text-primary)]"
            title="About Study Cloud"
          >
            <Info className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </header>
  );
};
