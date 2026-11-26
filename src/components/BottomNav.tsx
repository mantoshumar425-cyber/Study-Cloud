import React from 'react';
import { BookOpen, Gem, ClipboardCheck, Sigma, Menu } from 'lucide-react';
import { NavTab } from '../types';

interface BottomNavProps {
  currentTab: NavTab;
  onTabChange: (tab: NavTab) => void;
  onOpenSlidebar: () => void;
}

export const BottomNav: React.FC<BottomNavProps> = ({
  currentTab,
  onTabChange,
  onOpenSlidebar,
}) => {
  const tabs = [
    { id: 'batches' as NavTab, label: 'Batches', icon: BookOpen },
    { id: 'khazana' as NavTab, label: 'Khazana', icon: Gem },
    { id: 'pi' as NavTab, label: 'Pi', icon: Sigma },
    { id: 'test' as NavTab, label: 'Test', icon: ClipboardCheck },
  ];

  const isSlidebarTabActive = ['community', 'downloads', 'favorites', 'history', 'settings'].includes(
    currentTab
  );

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-30 border-t border-[var(--card-border)] bg-[var(--bg-primary)]/95 backdrop-blur-lg lg:hidden pb-safe">
      <div className="flex h-[58px] items-center justify-around px-1">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = currentTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTabChange(tab.id)}
              className={`relative flex flex-col items-center justify-center gap-0.5 px-2.5 py-1 transition-colors whitespace-nowrap ${
                isActive
                  ? 'text-[var(--primary-color)] font-bold'
                  : 'text-[var(--text-secondary)] font-medium hover:text-[var(--text-primary)]'
              }`}
            >
              <Icon className={`h-5 w-5 ${isActive ? 'stroke-[2.4]' : 'stroke-[1.8]'}`} />
              <span className="text-[11px] tracking-tight">{tab.label}</span>
              {isActive && (
                <span className="absolute -bottom-0.5 h-0.5 w-6 rounded-full bg-[var(--primary-color)]" />
              )}
            </button>
          );
        })}

        <button
          type="button"
          onClick={onOpenSlidebar}
          className={`relative flex flex-col items-center justify-center gap-0.5 px-2.5 py-1 transition-colors whitespace-nowrap ${
            isSlidebarTabActive
              ? 'text-[var(--primary-color)] font-bold'
              : 'text-[var(--text-secondary)] font-medium hover:text-[var(--text-primary)]'
          }`}
        >
          <Menu className="h-5 w-5" />
          <span className="text-[11px] tracking-tight">Menu</span>
          {isSlidebarTabActive && (
            <span className="absolute -bottom-0.5 h-0.5 w-6 rounded-full bg-[var(--primary-color)]" />
          )}
        </button>
      </div>
    </nav>
  );
};
