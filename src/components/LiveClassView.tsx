import React, { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import {
  Radio,
  Users,
  MessageSquare,
  HelpCircle,
  Send,
  BellRing,
  CheckCircle2,
  Clock,
  Volume2,
  Video,
} from 'lucide-react';
import { LiveChatMessage, LiveClassSession } from '../types';
import { useAuth } from '../contexts/AuthContext';

export const LiveClassView: React.FC = () => {
  const { user, profile, isAdmin, getIdToken, openAuthModal } = useAuth();
  const [classes, setClasses] = useState<LiveClassSession[]>([]);
  const [activeClass, setActiveClass] = useState<LiveClassSession | null>(null);
  const [messages, setMessages] = useState<LiveChatMessage[]>([]);
  const [attendees, setAttendees] = useState<Array<{ uid: string; name: string; joinedAt: number }>>([]);
  const [activeSideTab, setActiveSideTab] = useState<'chat' | 'qa' | 'attendance'>('chat');
  const [inputMsg, setInputMsg] = useState('');
  const [wsConnected, setWsConnected] = useState(false);
  const [reminders, setReminders] = useState<Record<string, boolean>>({});
  const [replyTargetId, setReplyTargetId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    void fetch('/api/live-classes')
      .then((r) => r.json())
      .then((d) => {
        if (d?.success && Array.isArray(d.classes)) {
          setClasses(d.classes);
          const liveOne = d.classes.find((c: LiveClassSession) => c.status === 'live') || d.classes[0];
          if (liveOne) setActiveClass(liveOne);
        }
      })
      .catch(() => {});
  }, []);

  // Load initial message & attendance state + connect WebSocket room
  useEffect(() => {
    if (!activeClass) return;
    let closed = false;

    void fetch(`/api/live-classes/${encodeURIComponent(activeClass.classId)}/state`)
      .then((r) => r.json())
      .then((d) => {
        if (!closed && d?.success) {
          setMessages(Array.isArray(d.messages) ? d.messages : []);
          if (Array.isArray(d.attendance) && d.attendance.length > 0) {
            setAttendees(
              d.attendance.map((a: any) => ({
                uid: a.userId,
                name: a.studentName,
                joinedAt: a.joinedAt,
              }))
            );
          }
        }
      })
      .catch(() => {});

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${window.location.host}/ws/classroom`);
    wsRef.current = ws;

    ws.onopen = async () => {
      if (closed) return;
      setWsConnected(true);
      const token = await getIdToken();
      ws.send(
        JSON.stringify({
          type: 'join',
          classId: activeClass.classId,
          uid: user?.uid || '',
          name: profile?.displayName || user?.displayName || 'Student',
          token: token || undefined,
        })
      );
    };

    ws.onmessage = (evt) => {
      try {
        const pkt = JSON.parse(evt.data);
        if (pkt.type === 'message' && pkt.data) {
          setMessages((prev) => [...prev, pkt.data].slice(-250));
        } else if (pkt.type === 'message_updated' && pkt.data) {
          setMessages((prev) =>
            prev.map((m) => (m.messageId === pkt.data.messageId ? pkt.data : m))
          );
        } else if (pkt.type === 'presence' && Array.isArray(pkt.attendees)) {
          setAttendees(pkt.attendees);
        }
      } catch {
        // ignore malformed frame
      }
    };

    ws.onclose = () => {
      if (!closed) setWsConnected(false);
    };

    return () => {
      closed = true;
      setWsConnected(false);
      try {
        ws.close();
      } catch {
        // ignore
      }
      wsRef.current = null;
    };
  }, [activeClass?.classId, user?.uid, profile?.displayName, getIdToken]);

  // Attach HLS stream to live classroom video player
  useEffect(() => {
    const vid = videoRef.current;
    if (!vid || !activeClass?.streamUrl) return;
    let hls: Hls | null = null;
    if (Hls.isSupported() && activeClass.streamUrl.includes('.m3u8')) {
      hls = new Hls();
      hls.loadSource(activeClass.streamUrl);
      hls.attachMedia(vid);
    } else {
      vid.src = activeClass.streamUrl;
    }
    return () => {
      hls?.destroy();
    };
  }, [activeClass?.streamUrl]);

  const sendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      openAuthModal();
      return;
    }
    const text = inputMsg.trim();
    if (!text || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(
      JSON.stringify({
        type: activeSideTab === 'qa' ? 'qa' : 'chat',
        text,
      })
    );
    setInputMsg('');
  };

  const handleTeacherReply = async (messageId: string) => {
    const token = await getIdToken();
    if (!token || !wsRef.current || !replyText.trim()) return;
    wsRef.current.send(
      JSON.stringify({
        type: 'qa_reply',
        messageId,
        reply: replyText.trim(),
        token,
      })
    );
    setReplyTargetId(null);
    setReplyText('');
  };

  const toggleClassReminder = async (cls: LiveClassSession) => {
    if ('Notification' in window && Notification.permission === 'default') {
      await Notification.requestPermission();
    }
    setReminders((prev) => ({ ...prev, [cls.classId]: !prev[cls.classId] }));
    if ('Notification' in window && Notification.permission === 'granted' && !reminders[cls.classId]) {
      new Notification('Study Cloud Reminder Set', {
        body: `${cls.title} (${cls.subject}) with ${cls.teacherName}`,
      });
    }
  };

  const filteredMessages = messages.filter((m) =>
    activeSideTab === 'qa' ? m.kind === 'qa' : m.kind === 'chat'
  );

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-['Sora'] text-xl sm:text-2xl font-extrabold flex items-center gap-2">
            <Radio className="h-5 w-5 text-rose-500" />
            <span>Online Live Classes</span>
          </h1>
          <p className="text-xs sm:text-sm text-[var(--text-secondary)]">
            Interactive live classroom with real-time WebSocket chat, Q&amp;A, and automatic student attendance.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs font-bold">
          <span
            className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 ${
              wsConnected
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                : 'border-amber-500/30 bg-amber-500/10 text-amber-400'
            }`}
          >
            <span className={`h-2 w-2 rounded-full ${wsConnected ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
            {wsConnected ? 'Live Classroom Connected' : 'Connecting Room...'}
          </span>
        </div>
      </div>

      {/* Main Classroom Stage + Sidebar */}
      {activeClass && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 space-y-3">
            <div className="relative overflow-hidden rounded-2xl border border-[var(--card-border)] bg-black aspect-video">
              <video
                ref={videoRef}
                controls
                playsInline
                className="h-full w-full object-contain"
              />
              <div className="pointer-events-none absolute top-3 left-3 flex items-center gap-2">
                <span className="rounded-lg bg-rose-600 px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wider text-white shadow">
                  {activeClass.status === 'live' ? 'LIVE' : activeClass.status.toUpperCase()}
                </span>
                <span className="rounded-lg bg-black/70 px-2.5 py-1 text-[11px] font-bold text-white backdrop-blur">
                  <Users className="inline h-3.5 w-3.5 mr-1 text-emerald-400" />
                  {attendees.length} Attending
                </span>
              </div>
            </div>

            <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="text-xs font-bold text-emerald-400">{activeClass.subject}</div>
                <h2 className="font-['Sora'] text-base sm:text-lg font-extrabold text-[var(--text-primary)]">
                  {activeClass.title}
                </h2>
                <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--text-secondary)] mt-1">
                  <span className="flex items-center gap-1">
                    <Video className="h-3.5 w-3.5 text-[#22C55E]" /> Faculty: {activeClass.teacherName}
                  </span>
                  <span className="flex items-center gap-1">
                    <Volume2 className="h-3.5 w-3.5 text-[#22C55E]" /> Live Audio/Video Ready
                  </span>
                  <span className="flex items-center gap-1 text-emerald-400 font-semibold">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Attendance Marked
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void toggleClassReminder(activeClass)}
                className={`inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-xs font-bold transition shrink-0 ${
                  reminders[activeClass.classId]
                    ? 'border-[#22C55E] bg-[#16A34A]/20 text-emerald-400'
                    : 'border-[var(--card-border)] bg-[var(--bg-secondary)] hover:border-[#22C55E]'
                }`}
              >
                <BellRing className="h-3.5 w-3.5" />
                <span>{reminders[activeClass.classId] ? 'Reminder Active' : 'Notify Me'}</span>
              </button>
            </div>
          </div>

          {/* Real-time Chat / Q&A / Attendance Panel */}
          <div className="flex flex-col h-[500px] rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] overflow-hidden">
            <div className="grid grid-cols-3 border-b border-[var(--card-border)] text-xs font-bold">
              <button
                type="button"
                onClick={() => setActiveSideTab('chat')}
                className={`flex items-center justify-center gap-1.5 py-3 border-b-2 transition ${
                  activeSideTab === 'chat'
                    ? 'border-[#22C55E] text-[#22C55E] bg-[#16A34A]/10'
                    : 'border-transparent text-[var(--text-secondary)]'
                }`}
              >
                <MessageSquare className="h-3.5 w-3.5" />
                <span>Live Chat</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveSideTab('qa')}
                className={`flex items-center justify-center gap-1.5 py-3 border-b-2 transition ${
                  activeSideTab === 'qa'
                    ? 'border-[#22C55E] text-[#22C55E] bg-[#16A34A]/10'
                    : 'border-transparent text-[var(--text-secondary)]'
                }`}
              >
                <HelpCircle className="h-3.5 w-3.5" />
                <span>Q&amp;A</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveSideTab('attendance')}
                className={`flex items-center justify-center gap-1.5 py-3 border-b-2 transition ${
                  activeSideTab === 'attendance'
                    ? 'border-[#22C55E] text-[#22C55E] bg-[#16A34A]/10'
                    : 'border-transparent text-[var(--text-secondary)]'
                }`}
              >
                <Users className="h-3.5 w-3.5" />
                <span>Roster ({attendees.length})</span>
              </button>
            </div>

            {activeSideTab === 'attendance' ? (
              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {attendees.length === 0 ? (
                  <p className="text-xs text-[var(--text-secondary)] text-center py-8">
                    Attendance updates live as students join this classroom.
                  </p>
                ) : (
                  attendees.map((att) => (
                    <div
                      key={att.uid}
                      className="flex items-center justify-between rounded-xl border border-[var(--card-border)] bg-[var(--bg-secondary)] px-3 py-2 text-xs"
                    >
                      <span className="font-bold text-[var(--text-primary)] truncate">{att.name}</span>
                      <span className="font-mono text-[11px] text-emerald-400">Present</span>
                    </div>
                  ))
                )}
              </div>
            ) : (
              <>
                <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
                  {filteredMessages.length === 0 ? (
                    <p className="text-xs text-[var(--text-secondary)] text-center py-8">
                      {activeSideTab === 'qa'
                        ? 'Ask a live question for the teacher to answer.'
                        : 'Say hello! Messages appear live for everyone in this class.'}
                    </p>
                  ) : (
                    filteredMessages.map((m) => (
                      <div
                        key={m.messageId}
                        className="rounded-xl border border-[var(--card-border)] bg-[var(--bg-secondary)] p-2.5 space-y-1 text-xs"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-emerald-400">{m.senderName}</span>
                          <span className="font-mono text-[10px] text-[var(--text-secondary)]">
                            {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <p className="text-[var(--text-primary)] break-words">{m.text}</p>
                        {m.reply && (
                          <div className="mt-1.5 rounded-lg bg-[#16A34A]/15 border border-[#22C55E]/30 px-2.5 py-1.5 text-[11px] text-emerald-200">
                            <strong>Teacher:</strong> {m.reply}
                          </div>
                        )}
                        {isAdmin && activeSideTab === 'qa' && !m.reply && (
                          <div className="pt-1">
                            {replyTargetId === m.messageId ? (
                              <div className="flex gap-1.5">
                                <input
                                  type="text"
                                  value={replyText}
                                  onChange={(e) => setReplyText(e.target.value)}
                                  placeholder="Type answer..."
                                  className="flex-1 rounded-lg border border-[var(--card-border)] bg-[var(--bg-primary)] px-2 py-1 text-xs"
                                />
                                <button
                                  type="button"
                                  onClick={() => void handleTeacherReply(m.messageId)}
                                  className="rounded-lg bg-[#16A34A] px-2.5 py-1 text-[11px] font-bold text-white"
                                >
                                  Reply
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setReplyTargetId(m.messageId)}
                                className="text-[11px] font-bold text-[#22C55E] hover:underline"
                              >
                                Answer Question
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>

                <form
                  onSubmit={sendMessage}
                  className="flex items-center gap-2 border-t border-[var(--card-border)] p-2.5 bg-[var(--bg-secondary)]"
                >
                  <input
                    type="text"
                    value={inputMsg}
                    onChange={(e) => setInputMsg(e.target.value)}
                    placeholder={
                      user
                        ? activeSideTab === 'qa'
                          ? 'Ask teacher a Q&A question...'
                          : 'Send live chat message...'
                        : 'Sign in to chat or ask Q&A...'
                    }
                    className="flex-1 rounded-xl border border-[var(--card-border)] bg-[var(--bg-primary)] px-3 py-2 text-xs focus:border-[#22C55E] focus:outline-none"
                  />
                  <button
                    type="submit"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#16A34A] hover:bg-[#22C55E] text-white transition"
                    title="Send"
                  >
                    <Send className="h-4 w-4" />
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      )}

      {/* Full Class Schedule List */}
      <div className="space-y-2.5">
        <h3 className="font-['Sora'] text-sm sm:text-base font-extrabold">Class Schedule</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {classes.map((cls) => {
            const isSelected = activeClass?.classId === cls.classId;
            return (
              <div
                key={cls.classId}
                className={`rounded-2xl border p-4 space-y-2 transition ${
                  isSelected
                    ? 'border-[#22C55E] bg-[#16A34A]/10'
                    : 'border-[var(--card-border)] bg-[var(--card-bg)]'
                }`}
              >
                <div className="flex items-center justify-between text-[11px] font-bold">
                  <span
                    className={
                      cls.status === 'live'
                        ? 'text-rose-400'
                        : cls.status === 'scheduled'
                        ? 'text-amber-400'
                        : 'text-[var(--text-secondary)]'
                    }
                  >
                    {cls.status.toUpperCase()}
                  </span>
                  <span className="font-mono text-[var(--text-secondary)]">
                    <Clock className="inline h-3 w-3 mr-1" />
                    {new Date(cls.scheduledAt).toLocaleString([], {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
                <div className="font-['Sora'] text-sm font-bold text-[var(--text-primary)]">{cls.title}</div>
                <div className="text-xs text-[var(--text-secondary)]">
                  {cls.subject} · {cls.teacherName}
                </div>
                <div className="pt-1 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setActiveClass(cls)}
                    className="flex-1 rounded-xl bg-[#16A34A] hover:bg-[#22C55E] py-1.5 text-xs font-bold text-white transition"
                  >
                    {isSelected ? 'Watching' : 'Enter Classroom'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void toggleClassReminder(cls)}
                    className="rounded-xl border border-[var(--card-border)] px-2.5 py-1.5 text-xs font-bold hover:border-[#22C55E]"
                    title="Toggle Reminder"
                  >
                    <BellRing className={`h-3.5 w-3.5 ${reminders[cls.classId] ? 'text-emerald-400' : ''}`} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
