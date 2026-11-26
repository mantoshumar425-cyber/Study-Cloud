import React, { useEffect, useMemo, useState } from 'react';
import {
  Bell,
  Download,
  Eye,
  FileText,
  Loader2,
  MessageSquare,
  RefreshCw,
  Send,
  ThumbsUp,
  Users,
} from 'lucide-react';
import { BatchItem } from '../types';
import {
  downloadPdfFile,
  fetchPwCommunityFeed,
  openPdfViewer,
  PwCommunityPost,
  resolveAttachmentUrl,
} from '../services/batchService';

interface BatchLoungePost {
  id: string;
  author: string;
  tag: 'Doubt' | 'Formula' | 'Tip';
  content: string;
  likes: number;
  liked?: boolean;
  createdAt: number;
  replies: Array<{ id: string; author: string; text: string; createdAt: number }>;
}

interface BatchCommunityPanelProps {
  batch: BatchItem;
  announcements: any[];
}

export const BatchCommunityPanel: React.FC<BatchCommunityPanelProps> = ({
  batch,
  announcements,
}) => {
  const storageKey = `studycloud_batch_community_${batch.batch_id}`;

  const [subFilter, setSubFilter] = useState<'all' | 'notices' | 'lounge'>('all');
  const [liveFeed, setLiveFeed] = useState<PwCommunityPost[]>([]);
  const [loadingFeed, setLoadingFeed] = useState(false);

  // Student Study Lounge state per batch
  const [loungePosts, setLoungePosts] = useState<BatchLoungePost[]>([]);
  const [authorName, setAuthorName] = useState('Student');
  const [postTag, setPostTag] = useState<BatchLoungePost['tag']>('Doubt');
  const [postText, setPostText] = useState('');
  const [replyOpenId, setReplyOpenId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      setLoungePosts(raw ? JSON.parse(raw) : []);
    } catch {
      setLoungePosts([]);
    }
  }, [storageKey]);

  const persistLounge = (next: BatchLoungePost[]) => {
    setLoungePosts(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // ignore
    }
  };

  const refreshLiveCommunity = async () => {
    setLoadingFeed(true);
    try {
      const res = await fetchPwCommunityFeed([batch.batch_id]);
      setLiveFeed(res.posts || []);
    } catch {
      setLiveFeed([]);
    } finally {
      setLoadingFeed(false);
    }
  };

  useEffect(() => {
    refreshLiveCommunity();
  }, [batch.batch_id]);

  // Merge announcements passed from /api/batch/:id with live /api/pw/community feed
  const mergedNotices = useMemo(() => {
    const map = new Map<
      string,
      {
        id: string;
        type: string;
        text: string;
        createdAt?: string;
        attachmentUrl?: string;
        attachmentName?: string;
      }
    >();

    for (const ann of announcements) {
      const text = String(ann?.announcement || ann?.title || '').trim();
      if (!text) continue;
      const attUrl = ann?.attachment ? resolveAttachmentUrl(ann.attachment) : '';
      const id = String(ann?._id || text.slice(0, 48));
      map.set(id, {
        id,
        type: String(ann?.type || 'Batch Notice'),
        text,
        createdAt: ann?.createdAt,
        attachmentUrl: attUrl || undefined,
        attachmentName: ann?.attachment?.name || 'Notice Attachment.pdf',
      });
    }

    for (const item of liveFeed) {
      const text = String(item.announcement || '').trim();
      if (!text) continue;
      const existing = map.get(item.id);
      if (!existing) {
        map.set(item.id, {
          id: item.id,
          type: item.type || 'Community Update',
          text,
          createdAt: item.createdAt,
          attachmentUrl: item.attachmentUrl || undefined,
          attachmentName: item.attachmentName || 'Attachment.pdf',
        });
      }
    }

    return Array.from(map.values()).sort(
      (a, b) => (Date.parse(b.createdAt || '') || 0) - (Date.parse(a.createdAt || '') || 0)
    );
  }, [announcements, liveFeed]);

  const handlePublish = (e: React.FormEvent) => {
    e.preventDefault();
    if (!postText.trim()) return;
    const entry: BatchLoungePost = {
      id: `bp-${Date.now()}`,
      author: authorName.trim() || 'Student',
      tag: postTag,
      content: postText.trim(),
      likes: 1,
      liked: true,
      createdAt: Date.now(),
      replies: [],
    };
    persistLounge([entry, ...loungePosts]);
    setPostText('');
  };

  const handleLike = (id: string) => {
    persistLounge(
      loungePosts.map((p) =>
        p.id === id
          ? { ...p, liked: !p.liked, likes: p.liked ? Math.max(0, p.likes - 1) : p.likes + 1 }
          : p
      )
    );
  };

  const handleReply = (id: string) => {
    if (!replyText.trim()) return;
    persistLounge(
      loungePosts.map((p) =>
        p.id === id
          ? {
              ...p,
              replies: [
                ...p.replies,
                {
                  id: `br-${Date.now()}`,
                  author: authorName.trim() || 'Peer',
                  text: replyText.trim(),
                  createdAt: Date.now(),
                },
              ],
            }
          : p
      )
    );
    setReplyText('');
    setReplyOpenId(null);
  };

  return (
    <div className="space-y-4">
      {/* Header & Filter Row */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-2xl border border-[var(--card-border)] bg-[var(--bg-secondary)] p-4">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-[var(--primary-color)]" />
          <h3 className="font-['Sora'] text-sm sm:text-base font-extrabold text-[var(--text-primary)]">
            {batch.name} — Community & Announcements
          </h3>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {[
            { id: 'all' as const, label: 'All' },
            { id: 'notices' as const, label: `Notices (${mergedNotices.length})` },
            { id: 'lounge' as const, label: `Student Lounge (${loungePosts.length})` },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setSubFilter(tab.id)}
              className={`rounded-xl px-3 py-1.5 text-xs font-bold transition ${
                subFilter === tab.id
                  ? 'bg-[var(--primary-color)] text-white'
                  : 'border border-[var(--card-border)] bg-[var(--card-bg)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              {tab.label}
            </button>
          ))}
          <button
            type="button"
            onClick={refreshLiveCommunity}
            disabled={loadingFeed}
            className="flex items-center gap-1 rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] px-2.5 py-1.5 text-xs font-bold text-[var(--text-primary)] hover:border-[var(--primary-color)]"
            title="Refresh community updates"
          >
            <RefreshCw className={`h-3.5 w-3.5 text-[var(--primary-color)] ${loadingFeed ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Notices Section */}
      {(subFilter === 'all' || subFilter === 'notices') && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-[var(--text-secondary)]">
            <Bell className="h-3.5 w-3.5 text-amber-400" />
            <span>Official Batch Notices & Updates</span>
          </div>

          {loadingFeed && mergedNotices.length === 0 ? (
            <div className="flex items-center justify-center py-8 gap-2 text-xs text-[var(--text-secondary)]">
              <Loader2 className="h-4 w-4 animate-spin text-[var(--primary-color)]" />
              <span>Loading batch notices...</span>
            </div>
          ) : mergedNotices.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[var(--card-border)] bg-[var(--bg-secondary)] p-6 text-center text-xs text-[var(--text-secondary)]">
              No announcements posted for this batch yet.
            </div>
          ) : (
            <div className="space-y-3">
              {mergedNotices.map((notice, idx) => (
                <div
                  key={`${notice.id}-${idx}`}
                  className="rounded-2xl border border-[var(--card-border)] bg-[var(--bg-secondary)] p-4 space-y-2.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="rounded-lg bg-amber-500/15 px-2.5 py-0.5 font-bold text-amber-400">
                      {notice.type}
                    </span>
                    {notice.createdAt && (
                      <span className="font-mono text-[var(--text-secondary)]">
                        {new Date(notice.createdAt).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                  <p className="text-xs sm:text-sm text-[var(--text-primary)] whitespace-pre-wrap leading-relaxed">
                    {notice.text}
                  </p>
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--card-border)] pt-2.5">
                    {notice.attachmentUrl ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => openPdfViewer(notice.attachmentUrl!, notice.attachmentName)}
                          className="flex items-center gap-1 rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-1.5 text-xs font-bold text-[var(--text-primary)] hover:border-[var(--primary-color)]"
                        >
                          <Eye className="h-3.5 w-3.5 text-indigo-400" />
                          <span>View PDF</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => downloadPdfFile(notice.attachmentUrl!, notice.attachmentName)}
                          className="flex items-center gap-1 rounded-xl bg-[var(--primary-color)] px-3 py-1.5 text-xs font-bold text-white hover:opacity-90"
                        >
                          <Download className="h-3.5 w-3.5" />
                          <span>Download</span>
                        </button>
                      </div>
                    ) : (
                      <span className="flex items-center gap-1 text-[11px] text-[var(--text-secondary)]">
                        <FileText className="h-3.5 w-3.5" />
                        Batch Community Update
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Per-Batch Peer Study Lounge */}
      {(subFilter === 'all' || subFilter === 'lounge') && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-[var(--text-secondary)]">
            <MessageSquare className="h-3.5 w-3.5 text-[var(--primary-color)]" />
            <span>Batch Study Lounge & Doubt Discussion</span>
          </div>

          <form
            onSubmit={handlePublish}
            className="rounded-2xl border border-[var(--card-border)] bg-[var(--bg-secondary)] p-4 space-y-2.5"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input
                type="text"
                value={authorName}
                onChange={(e) => setAuthorName(e.target.value)}
                placeholder="Your name"
                className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2 text-xs text-[var(--text-primary)] focus:border-[var(--primary-color)] focus:outline-none"
              />
              <select
                value={postTag}
                onChange={(e) => setPostTag(e.target.value as BatchLoungePost['tag'])}
                className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2 text-xs font-semibold text-[var(--text-primary)] focus:border-[var(--primary-color)] focus:outline-none"
              >
                <option value="Doubt">Doubt / Question</option>
                <option value="Formula">Formula / Short Note</option>
                <option value="Tip">Study Tip</option>
              </select>
            </div>
            <textarea
              rows={2}
              value={postText}
              onChange={(e) => setPostText(e.target.value)}
              placeholder={`Share a doubt, class note, or tip with ${batch.name} peers...`}
              className="w-full resize-none rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2 text-xs sm:text-sm text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:border-[var(--primary-color)] focus:outline-none"
            />
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={!postText.trim()}
                className="flex items-center gap-1.5 rounded-xl bg-[var(--primary-color)] px-4 py-2 text-xs font-bold text-white hover:opacity-90 disabled:opacity-50 transition"
              >
                <Send className="h-3.5 w-3.5" />
                <span>Post to Batch Community</span>
              </button>
            </div>
          </form>

          {loungePosts.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[var(--card-border)] bg-[var(--bg-secondary)] p-5 text-center text-xs text-[var(--text-secondary)]">
              No student discussions in {batch.name} yet. Post the first doubt or revision note above!
            </div>
          ) : (
            <div className="space-y-3">
              {loungePosts.map((post, idx) => (
                <div
                  key={`${post.id}-${idx}`}
                  className="rounded-2xl border border-[var(--card-border)] bg-[var(--bg-secondary)] p-4 space-y-2.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-1.5">
                      <span className="font-['Sora'] font-bold text-[var(--text-primary)]">
                        {post.author}
                      </span>
                      <span className="rounded-md bg-[var(--primary-color)]/15 px-2 py-0.5 text-[11px] font-bold text-[var(--primary-color)]">
                        {post.tag}
                      </span>
                    </div>
                    <span className="text-[11px] text-[var(--text-secondary)]">
                      {new Date(post.createdAt).toLocaleDateString()}
                    </span>
                  </div>

                  <p className="text-xs sm:text-sm text-[var(--text-primary)] whitespace-pre-wrap leading-relaxed">
                    {post.content}
                  </p>

                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--card-border)] pt-2">
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => handleLike(post.id)}
                        className={`flex items-center gap-1 text-xs font-bold ${
                          post.liked ? 'text-[var(--primary-color)]' : 'text-[var(--text-secondary)]'
                        }`}
                      >
                        <ThumbsUp className="h-3.5 w-3.5" />
                        <span>{post.likes}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setReplyOpenId(replyOpenId === post.id ? null : post.id)}
                        className="flex items-center gap-1 text-xs font-bold text-[var(--text-secondary)] hover:text-[var(--primary-color)]"
                      >
                        <MessageSquare className="h-3.5 w-3.5" />
                        <span>Reply ({post.replies.length})</span>
                      </button>
                    </div>
                  </div>

                  {post.replies.length > 0 && (
                    <div className="space-y-1.5 border-l-2 border-[var(--primary-color)]/40 pl-3 pt-1">
                      {post.replies.map((r, idx) => (
                        <div key={`${r.id}-${idx}`} className="text-xs">
                          <span className="font-bold text-[var(--text-primary)]">{r.author}: </span>
                          <span className="text-[var(--text-secondary)]">{r.text}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {replyOpenId === post.id && (
                    <div className="flex gap-2 pt-1">
                      <input
                        type="text"
                        value={replyText}
                        onChange={(e) => setReplyText(e.target.value)}
                        placeholder="Write a reply..."
                        className="flex-1 rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-1.5 text-xs text-[var(--text-primary)] focus:border-[var(--primary-color)] focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => handleReply(post.id)}
                        className="rounded-xl bg-[var(--primary-color)] px-3 py-1.5 text-xs font-bold text-white"
                      >
                        Send
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
