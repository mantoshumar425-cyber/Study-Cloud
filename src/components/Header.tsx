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
  Bell,
  ShoppingCart,
  LogIn,
} from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { NavTab } from '../types';
import { STUDY_CLOUD_LOGO } from './Sidebar';
import { useAuth } from '../contexts/AuthContext';

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
  unreadNotifications?: number;
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
  unreadNotifications = 0,
  onOpenShare,
}) => {
  const { isInstallable, isInstalled, install, isIOS } = usePWAInstall();
  const { user, profile, openAuthModal } = useAuth();

  const quickNavLinks: Array<{ id: NavTab; label: string }> = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'batches', label: 'Batches' },
    { id: 'live', label: 'Live' },
    { id: 'dpp', label: 'DPP' },
    { id: 'test', label: 'Test' },
    { id: 'doubts', label: 'Doubts' },
    { id: 'leaderboard', label: 'Rank' },
  ];

  const initials = (profile?.displayName || user?.displayName || 'S')
    .trim()
    .charAt(0)
    .toUpperCase();

  return (
    <header className="sticky top-0 z-30 w-full border-b border-[var(--card-border)] bg-[var(--bg-primary)]/85 backdrop-blur-xl shadow-sm transition-colors">
      <div className="flex h-[58px] items-center justify-between gap-2 sm:gap-4 px-3 sm:px-5">
        {/* Zone 1: Slidebar Toggle + Study Cloud Brand */}
        <div className="flex items-center gap-2 shrink-0">
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
            onClick={() => onTabChange('dashboard')}
            className="flex items-center gap-2 rounded-xl p-0.5 text-left transition hover:opacity-90 focus:outline-none whitespace-nowrap shrink-0 lg:hidden"
            title="Study Cloud Dashboard"
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
        <nav className="hidden xl:flex items-center gap-5 text-[13px] font-bold tracking-[-0.01em]">
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
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {!isInstalled && (isInstallable || isIOS) && (
            <button
              type="button"
              onClick={install}
              className="hidden sm:flex items-center gap-1.5 rounded-xl bg-[var(--primary-color)] px-2.5 py-1.5 text-xs font-bold text-white shadow-sm hover:opacity-90 transition whitespace-nowrap shrink-0"
              title="Install Study Cloud App"
            >
              <Download className="h-3.5 w-3.5" />
              <span className="hidden md:inline">Install</span>
            </button>
          )}

          {/* Notifications */}
          <button
            type="button"
            onClick={() => onTabChange('notifications')}
            className={`relative flex h-9 w-9 items-center justify-center rounded-xl border transition shrink-0 ${
              currentTab === 'notifications'
                ? 'border-[#22C55E] bg-[#16A34A] text-white'
                : 'border-[var(--card-border)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:border-[var(--primary-color)] hover:text-[var(--text-primary)]'
            }`}
            title="Notifications"
          >
            <Bell className="h-4 w-4" />
            {unreadNotifications > 0 && (
              <span className="absolute -top-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[#16A34A] px-1 font-mono text-[9px] font-extrabold text-white ring-2 ring-[var(--bg-primary)]">
                {unreadNotifications}
              </span>
            )}
          </button>

          {/* Store / Cart */}
          <button
            type="button"
            onClick={() => onTabChange('cart')}
            className={`flex h-9 w-9 items-center justify-center rounded-xl border transition shrink-0 ${
              currentTab === 'cart'
                ? 'border-[#22C55E] bg-[#16A34A] text-white'
                : 'border-[var(--card-border)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:border-[var(--primary-color)] hover:text-[var(--text-primary)]'
            }`}
            title="Course Store & Cart"
          >
            <ShoppingCart className="h-4 w-4" />
          </button>

          {/* Downloads */}
          <button
            type="button"
            onClick={() => onTabChange('downloads')}
            className={`relative hidden sm:flex h-9 items-center gap-1.5 rounded-xl border px-2.5 text-xs font-bold transition whitespace-nowrap shrink-0 ${
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
            {downloadsCount > 0 && (
              <span className="font-mono text-[10px] font-extrabold">{downloadsCount}</span>
            )}
          </button>

          {onOpenShare && (
            <button
              type="button"
              onClick={onOpenShare}
              className="hidden md:flex h-9 w-9 items-center justify-center rounded-xl border border-indigo-500/35 bg-indigo-500/15 text-indigo-300 transition hover:bg-indigo-600 hover:text-white shrink-0"
              title="Share Study Cloud Website"
            >
              <Share2 className="h-3.5 w-3.5" />
            </button>
          )}

          <button
            type="button"
            onClick={onOpenThemes}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--card-border)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] transition hover:border-[var(--primary-color)] hover:text-[var(--text-primary)] shrink-0"
            title="Change App Theme"
          >
            <Palette className="h-3.5 w-3.5 text-[var(--primary-color)]" />
          </button>

          <button
            type="button"
            onClick={onRefresh}
            disabled={isRefreshing}
            className={`hidden sm:flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--card-border)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] transition hover:border-[var(--primary-color)] hover:text-[var(--text-primary)] ${
              isRefreshing ? 'opacity-60' : ''
            }`}
            title="Refresh Batches"
          >
            <RotateCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin text-[var(--primary-color)]' : ''}`} />
          </button>

          <button
            type="button"
            onClick={onOpenAbout}
            className="hidden sm:flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--card-border)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] transition hover:border-[var(--primary-color)] hover:text-[var(--text-primary)]"
            title="About Study Cloud"
          >
            <Info className="h-3.5 w-3.5" />
          </button>

          {/* Student Profile / Sign In */}
          {user ? (
            <button
              type="button"
              onClick={() => onTabChange('profile')}
              className={`flex h-9 items-center gap-2 rounded-xl border px-2 text-xs font-bold transition shrink-0 ${
                currentTab === 'profile'
                  ? 'border-[#22C55E] bg-[#16A34A] text-white'
                  : 'border-[var(--card-border)] bg-[var(--bg-secondary)] text-[var(--text-primary)] hover:border-[#22C55E]'
              }`}
              title="Student Profile"
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-[#16A34A] font-['Sora'] text-[11px] font-extrabold text-white">
                {initials}
              </span>
              <span className="hidden sm:inline max-w-[90px] truncate">
                {profile?.displayName || user.displayName || 'Profile'}
              </span>
            </button>
          ) : (
            <button
              type="button"
              onClick={openAuthModal}
              className="flex h-9 items-center gap-1.5 rounded-xl bg-[#16A34A] hover:bg-[#22C55E] px-3 text-xs font-bold text-white shadow-sm transition shrink-0"
              title="Student Login / Sign Up"
            >
              <LogIn className="h-3.5 w-3.5" />
              <span>Login</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
