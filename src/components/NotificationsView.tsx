import React, { useEffect, useState } from 'react';
import { Bell, BellRing, Radio, BookOpen, FileText, ClipboardCheck, Sparkles } from 'lucide-react';
import { PlatformNotification } from '../types';

export const NotificationsView: React.FC = () => {
  const [notifications, setNotifications] = useState<PlatformNotification[]>([]);
  const [pushPerm, setPushPerm] = useState<string>(
    typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'unsupported'
  );

  useEffect(() => {
    void fetch('/api/notifications')
      .then((r) => r.json())
      .then((d) => {
        if (d?.success && Array.isArray(d.notifications)) {
          setNotifications(d.notifications);
        }
      })
      .catch(() => {});

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${window.location.host}/ws/classroom`);
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'join', classId: 'global' }));
    };
    ws.onmessage = (evt) => {
      try {
        const pkt = JSON.parse(evt.data);
        if (pkt.type === 'notification' && pkt.data) {
          setNotifications((prev) => [pkt.data, ...prev]);
        }
      } catch {
        // ignore
      }
    };
    return () => {
      try {
        ws.close();
      } catch {
        // ignore
      }
    };
  }, []);

  const enableBrowserPush = async () => {
    if (!('Notification' in window)) return;
    const perm = await Notification.requestPermission();
    setPushPerm(perm);
    if (perm === 'granted') {
      new Notification('Study Cloud Alerts Enabled', {
        body: 'You will now receive live class reminders, new notes, and test announcements.',
      });
    }
  };

  const iconFor = (type: string) => {
    if (type === 'live') return <Radio className="h-4 w-4 text-rose-400" />;
    if (type === 'notes') return <FileText className="h-4 w-4 text-emerald-400" />;
    if (type === 'test') return <ClipboardCheck className="h-4 w-4 text-amber-400" />;
    if (type === 'lecture') return <BookOpen className="h-4 w-4 text-sky-400" />;
    return <Sparkles className="h-4 w-4 text-[var(--primary-color)]" />;
  };

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-['Sora'] text-xl sm:text-2xl font-extrabold flex items-center gap-2">
            <Bell className="h-5 w-5 text-[#22C55E]" />
            <span>Notifications &amp; Live Alerts</span>
          </h1>
          <p className="text-xs sm:text-sm text-[var(--text-secondary)]">
            Live class reminders, new lecture &amp; PDF notes alerts, test series schedules, and real-time broadcasts.
          </p>
        </div>

        {pushPerm !== 'unsupported' && (
          <button
            type="button"
            onClick={() => void enableBrowserPush()}
            className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold transition ${
              pushPerm === 'granted'
                ? 'border border-emerald-500/30 bg-emerald-500/15 text-emerald-400'
                : 'bg-[#16A34A] hover:bg-[#22C55E] text-white'
            }`}
          >
            <BellRing className="h-3.5 w-3.5" />
            <span>
              {pushPerm === 'granted' ? 'Browser Push Active' : 'Enable Push Notifications'}
            </span>
          </button>
        )}
      </div>

      <div className="space-y-3">
        {notifications.map((n) => (
          <div
            key={n.notificationId}
            className="flex items-start gap-3.5 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--bg-secondary)] border border-[var(--card-border)]">
              {iconFor(n.type)}
            </div>
            <div className="flex-1 min-w-0 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-['Sora'] text-sm font-bold text-[var(--text-primary)]">{n.title}</h3>
                <span className="font-mono text-[11px] text-[var(--text-secondary)] shrink-0">
                  {new Date(n.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              <p className="text-xs text-[var(--text-secondary)] leading-relaxed">{n.body}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
