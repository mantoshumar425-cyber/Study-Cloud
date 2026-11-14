import React from 'react';
import {
  Download,
  Palette,
  RotateCw,
  Info,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
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
}) => {
  const { isInstallable, isInstalled, install, isIOS } = usePWAInstall();

  const quickNavLinks: Array<{ id: NavTab; label: string }> = [
    { id: 'batches', label: 'Batches' },
    { id: 'khazana', label: 'Khazana' },
    { id: 'pi', label: 'Pi' },
    { id: 'test', label: 'Test' },
    { id: 'ai', label: 'AI' },
  ];

  return (
    <header className="sticky top-0 z-30 w-full border-b border-[var(--card-border)] bg-[var(--bg-primary)]/90 backdrop-blur-md transition-colors">
      <div className="flex h-[72px] items-center justify-between gap-4 sm:gap-8 px-4 sm:px-8">
        {/* Zone 1: Slidebar Toggle + Study Cloud Brand */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={onOpenMobileSidebar}
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--card-border)] bg-[var(--bg-secondary)] text-[var(--text-primary)] hover:border-[var(--primary-color)] transition lg:hidden"
            title="Open Slidebar"
            aria-label="Open Slidebar"
          >
            <Menu className="h-5 w-5" />
          </button>

          <button
            type="button"
            onClick={onToggleDesktopSidebar}
            className="hidden lg:flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--card-border)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:border-[var(--primary-color)] hover:text-[var(--text-primary)] transition"
            title={isDesktopSidebarCollapsed ? 'Expand Slidebar' : 'Collapse Slidebar'}
            aria-label="Toggle Slidebar"
          >
            {isDesktopSidebarCollapsed ? (
              <PanelLeftOpen className="h-5 w-5" />
            ) : (
              <PanelLeftClose className="h-5 w-5" />
            )}
          </button>

          <button
            type="button"
            onClick={() => onTabChange('batches')}
            className="flex items-center gap-2.5 rounded-xl p-1 text-left transition hover:opacity-90 focus:outline-none whitespace-nowrap shrink-0 lg:hidden"
            title="Study Cloud Home"
          >
            <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl shadow-md ring-1 ring-white/15">
              <img
                src={STUDY_CLOUD_LOGO}
                alt="Study Cloud Logo"
                className="h-full w-full object-cover scale-[1.04]"
              />
            </div>
            <span className="font-['Sora'] text-lg font-extrabold tracking-tight text-[var(--text-primary)] whitespace-nowrap">
              Study Cloud
            </span>
          </button>
        </div>

        {/* Zone 2: Clean Typography Quick Links */}
        <nav className="hidden md:flex items-center gap-7 text-base font-bold">
          {quickNavLinks.map((item) => {
            const isActive = currentTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onTabChange(item.id)}
                className={`whitespace-nowrap shrink-0 py-1.5 transition-colors border-b-2 ${
                  isActive
                    ? 'border-[var(--primary-color)] text-[var(--text-primary)]'
                    : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: Actions */}
        <div className="flex items-center gap-2.5 shrink-0">
          {!isInstalled && (isInstallable || isIOS) && (
            <button
              type="button"
              onClick={install}
              className="flex items-center gap-2 rounded-xl bg-[var(--primary-color)] px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:opacity-90 transition whitespace-nowrap shrink-0"
              title="Install Study Cloud App"
            >
              <Download className="h-4 w-4" />
              <span className="hidden sm:inline">Install App</span>
            </button>
          )}

          <button
            type="button"
            onClick={onOpenThemes}
            className="flex h-10 items-center gap-2 rounded-xl border border-[var(--card-border)] bg-[var(--bg-secondary)] px-3.5 text-sm font-bold text-[var(--text-secondary)] transition hover:border-[var(--primary-color)] hover:text-[var(--text-primary)] whitespace-nowrap shrink-0"
            title="Change App Theme"
          >
            <Palette className="h-4 w-4 text-[var(--primary-color)]" />
            <span className="hidden sm:inline">Theme</span>
          </button>

          <button
            type="button"
            onClick={onRefresh}
            disabled={isRefreshing}
            className={`flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--card-border)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] transition hover:border-[var(--primary-color)] hover:text-[var(--text-primary)] ${
              isRefreshing ? 'opacity-60' : ''
            }`}
            title="Refresh Batches"
          >
            <RotateCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin text-[var(--primary-color)]' : ''}`} />
          </button>

          <button
            type="button"
            onClick={onOpenAbout}
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--card-border)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] transition hover:border-[var(--primary-color)] hover:text-[var(--text-primary)]"
            title="About Study Cloud"
          >
            <Info className="h-4 w-4" />
          </button>
        </div>
      </div>
    </header>
  );
};
