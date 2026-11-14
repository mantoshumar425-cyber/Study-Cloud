import React from 'react';
import { BookOpen, Gem, ClipboardCheck, Sparkles, Menu } from 'lucide-react';
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
    { id: 'test' as NavTab, label: 'Test', icon: ClipboardCheck },
    { id: 'ai' as NavTab, label: 'AI', icon: Sparkles },
  ];

  const isSlidebarTabActive = ['pi', 'community', 'favorites', 'history', 'settings'].includes(
    currentTab
  );

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-30 border-t border-[var(--card-border)] bg-[var(--bg-primary)]/95 backdrop-blur-lg lg:hidden pb-safe">
      <div className="flex h-[72px] items-center justify-around px-2">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = currentTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTabChange(tab.id)}
              className={`relative flex flex-col items-center justify-center gap-1 px-3 py-1.5 transition-colors whitespace-nowrap ${
                isActive
                  ? 'text-[var(--primary-color)] font-bold'
                  : 'text-[var(--text-secondary)] font-medium hover:text-[var(--text-primary)]'
              }`}
            >
              <Icon className={`h-6 w-6 ${isActive ? 'stroke-[2.5]' : 'stroke-[1.8]'}`} />
              <span className="text-xs tracking-tight">{tab.label}</span>
              {isActive && (
                <span className="absolute -bottom-1 h-1 w-7 rounded-full bg-[var(--primary-color)]" />
              )}
            </button>
          );
        })}

        <button
          type="button"
          onClick={onOpenSlidebar}
          className={`relative flex flex-col items-center justify-center gap-1 px-3 py-1.5 transition-colors whitespace-nowrap ${
            isSlidebarTabActive
              ? 'text-[var(--primary-color)] font-bold'
              : 'text-[var(--text-secondary)] font-medium hover:text-[var(--text-primary)]'
          }`}
        >
          <Menu className="h-6 w-6" />
          <span className="text-xs tracking-tight">Menu</span>
          {isSlidebarTabActive && (
            <span className="absolute -bottom-1 h-1 w-7 rounded-full bg-[var(--primary-color)]" />
          )}
        </button>
      </div>
    </nav>
  );
};
