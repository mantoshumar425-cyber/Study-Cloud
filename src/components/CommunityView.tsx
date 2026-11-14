import React, { useEffect, useMemo, useState } from 'react';
import {
  Users,
  Bell,
  MessageSquare,
  ThumbsUp,
  Send,
  Sparkles,
  Loader2,
  BookOpen,
  FileText,
  RefreshCw,
} from 'lucide-react';
import { AppControls, BatchItem } from '../types';
import {
  buildPdfProxyUrl,
  fetchPwCommunityFeed,
  PwCommunityChannel,
  PwCommunityPost,
} from '../services/batchService';

interface CommunityPost {
  id: string;
  author: string;
  category: 'Doubt' | 'Study Tip' | 'Formula Note' | 'Milestone';
  content: string;
  likes: number;
  liked?: boolean;
  createdAt: number;
  replies: Array<{ id: string; author: string; text: string; createdAt: number }>;
}

interface CommunityViewProps {
  appControls?: AppControls | null;
  myBatches: BatchItem[];
  allBatches: BatchItem[];
  onAskAi: (prompt: string) => void;
  onSelectBatch: (batch: BatchItem) => void;
}

const POSTS_STORAGE_KEY = 'studycloud_community_posts_v1';

const DEFAULT_POSTS: CommunityPost[] = [
  {
    id: 'seed-1',
    author: 'Aarav · JEE Aspirant',
    category: 'Study Tip',
    content:
      'Solve 15 PYQs right after revising Class Notes PDF rather than re-reading theory twice. Retention jumps noticeably.',
    likes: 18,
    createdAt: Date.now() - 3 * 3600 * 1000,
    replies: [
      {
        id: 'rep-1',
        author: 'Riya · NEET 2026',
        text: 'Agreed! Attempting PW Batch DPP quizzes after lecture notes saves so much revision time.',
        createdAt: Date.now() - 2 * 3600 * 1000,
      },
    ],
  },
  {
    id: 'seed-2',
    author: 'Kabir · Class 12',
    category: 'Formula Note',
    content:
      'Quick Gauss Law reminder: Flux depends ONLY on enclosed charge q_in / ε₀, never on the shape or radius of the Gaussian surface.',
    likes: 12,
    createdAt: Date.now() - 8 * 3600 * 1000,
    replies: [],
  },
];

export const CommunityView: React.FC<CommunityViewProps> = ({
  myBatches,
  allBatches,
  onAskAi,
  onSelectBatch,
}) => {
  const [posts, setPosts] = useState<CommunityPost[]>(() => {
    try {
      const raw = localStorage.getItem(POSTS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {
      // ignore
    }
    return DEFAULT_POSTS;
  });

  const [categoryFilter, setCategoryFilter] = useState<'All' | CommunityPost['category']>('All');
  const [newAuthor, setNewAuthor] = useState('Student');
  const [newCategory, setNewCategory] = useState<CommunityPost['category']>('Doubt');
  const [newText, setNewText] = useState('');
  const [replyOpenId, setReplyOpenId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');

  // PW Community Proxy State
  const [pwChannels, setPwChannels] = useState<PwCommunityChannel[]>([]);
  const [pwFeed, setPwFeed] = useState<PwCommunityPost[]>([]);
  const [selectedBatchFilter, setSelectedBatchFilter] = useState<string>('all');
  const [customBatchId, setCustomBatchId] = useState<string>('');
  const [loadingFeed, setLoadingFeed] = useState(false);
  const [feedError, setFeedError] = useState<string | null>(null);

  const candidateBatches = useMemo(() => {
    const merged = [...myBatches, ...allBatches.slice(0, 12)];
    const seen = new Set<string>();
    return merged.filter((b) => {
      if (!b?.batch_id || seen.has(b.batch_id)) return false;
      seen.add(b.batch_id);
      return true;
    });
  }, [myBatches, allBatches]);

  const loadPwCommunity = async (explicitBatchId?: string) => {
    setLoadingFeed(true);
    setFeedError(null);
    try {
      const ids = explicitBatchId
        ? [explicitBatchId]
        : myBatches.length > 0
        ? myBatches.slice(0, 4).map((b) => b.batch_id)
        : undefined;
      const res = await fetchPwCommunityFeed(ids);
      setPwChannels(res.channels || []);
      setPwFeed(res.posts || []);
      setSelectedBatchFilter('all');
    } catch (err: any) {
      setFeedError(err?.message || 'Unable to load PW Community feed.');
    } finally {
      setLoadingFeed(false);
    }
  };

  useEffect(() => {
    loadPwCommunity(customBatchId || undefined);
  }, [customBatchId, myBatches.length]);

  const persistPosts = (next: CommunityPost[]) => {
    setPosts(next);
    try {
      localStorage.setItem(POSTS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  };

  const handlePublish = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newText.trim()) return;
    const post: CommunityPost = {
      id: `p-${Date.now()}`,
      author: newAuthor.trim() || 'Study Cloud Learner',
      category: newCategory,
      content: newText.trim(),
      likes: 1,
      liked: true,
      createdAt: Date.now(),
      replies: [],
    };
    persistPosts([post, ...posts]);
    setNewText('');
  };

  const handleToggleLike = (postId: string) => {
    persistPosts(
      posts.map((p) =>
        p.id === postId
          ? { ...p, liked: !p.liked, likes: p.liked ? Math.max(0, p.likes - 1) : p.likes + 1 }
          : p
      )
    );
  };

  const handleAddReply = (postId: string) => {
    if (!replyText.trim()) return;
    persistPosts(
      posts.map((p) =>
        p.id === postId
          ? {
              ...p,
              replies: [
                ...p.replies,
                {
                  id: `r-${Date.now()}`,
                  author: newAuthor.trim() || 'Peer',
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

  const filteredPosts = useMemo(() => {
    if (categoryFilter === 'All') return posts;
    return posts.filter((p) => p.category === categoryFilter);
  }, [posts, categoryFilter]);

  const filteredPwFeed = useMemo(() => {
    if (selectedBatchFilter === 'all') return pwFeed;
    return pwFeed.filter((item) => item.batchId === selectedBatchFilter);
  }, [pwFeed, selectedBatchFilter]);

  const handleOpenChannelBatch = (batchId: string, batchName: string) => {
    const found = candidateBatches.find((b) => b.batch_id === batchId);
    if (found) {
      onSelectBatch(found);
      return;
    }
    onSelectBatch({
      batch_id: batchId,
      name: batchName,
    });
  };

  return (
    <div className="space-y-8">
      {/* Large Community Header */}
      <div className="rounded-3xl border border-[var(--card-border)] bg-[var(--card-bg)] p-6 sm:p-9">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm sm:text-base font-bold text-[var(--primary-color)]">
              <Users className="h-5 w-5" />
              <span>Study Cloud · PW Community Proxy & Study Lounge</span>
            </div>
            <h1 className="font-['Sora'] text-3xl sm:text-4xl font-extrabold text-[var(--text-primary)]">
              PW Community & Batch Updates
            </h1>
            <p className="text-sm sm:text-base text-[var(--text-secondary)] max-w-3xl leading-relaxed">
              Live batch announcements, faculty updates, study notes, and peer doubt discussions inside
              Study Cloud — completely ad-free without external redirects.
            </p>
          </div>

          <button
            type="button"
            onClick={() => loadPwCommunity(customBatchId || undefined)}
            disabled={loadingFeed}
            className="flex shrink-0 items-center justify-center gap-2 rounded-2xl border border-[var(--card-border)] bg-[var(--bg-secondary)] px-6 py-3.5 text-sm sm:text-base font-bold text-[var(--text-primary)] hover:border-[var(--primary-color)] transition whitespace-nowrap"
          >
            <RefreshCw className={`h-4 w-4 text-[var(--primary-color)] ${loadingFeed ? 'animate-spin' : ''}`} />
            <span>Refresh PW Feed</span>
          </button>
        </div>
      </div>

      {/* Main Expanded 2-Column Community Layout */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-7 items-start">
        {/* Left: Live PW Community Announcements Feed via Proxy (7 cols) */}
        <div className="xl:col-span-7 rounded-3xl border border-[var(--card-border)] bg-[var(--card-bg)] p-6 sm:p-7 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <h2 className="font-['Sora'] text-xl sm:text-2xl font-extrabold text-[var(--text-primary)] flex items-center gap-2.5">
              <Bell className="h-6 w-6 text-amber-400" />
              <span>PW Community Live Feed</span>
            </h2>

            <select
              value={customBatchId}
              onChange={(e) => setCustomBatchId(e.target.value)}
              className="rounded-2xl border border-[var(--card-border)] bg-[var(--bg-secondary)] px-4 py-2.5 text-sm font-semibold text-[var(--text-primary)] focus:border-[var(--primary-color)] focus:outline-none max-w-xs"
            >
              <option value="">Active & Enrolled Batches</option>
              {candidateBatches.map((b) => (
                <option key={b.batch_id} value={b.batch_id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>

          {/* Batch Filter Strip */}
          {pwChannels.length > 0 && (
            <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
              <button
                type="button"
                onClick={() => setSelectedBatchFilter('all')}
                className={`shrink-0 rounded-xl px-4 py-2 text-xs sm:text-sm font-bold transition ${
                  selectedBatchFilter === 'all'
                    ? 'bg-[var(--primary-color)] text-white'
                    : 'border border-[var(--card-border)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                All Feeds ({pwFeed.length})
              </button>
              {pwChannels.map((ch) => (
                <button
                  key={ch.batchId}
                  type="button"
                  onClick={() => setSelectedBatchFilter(ch.batchId)}
                  className={`shrink-0 rounded-xl px-4 py-2 text-xs sm:text-sm font-bold transition ${
                    selectedBatchFilter === ch.batchId
                      ? 'bg-[var(--primary-color)] text-white'
                      : 'border border-[var(--card-border)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  {ch.batchName}
                </button>
              ))}
            </div>
          )}

          {loadingFeed ? (
            <div className="flex items-center justify-center py-14 gap-3 text-sm sm:text-base text-[var(--text-secondary)]">
              <Loader2 className="h-6 w-6 animate-spin text-[var(--primary-color)]" />
              <span>Syncing PW Community notices via proxy...</span>
            </div>
          ) : feedError ? (
            <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-5 text-sm text-red-300">
              {feedError}
            </div>
          ) : filteredPwFeed.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[var(--card-border)] p-10 text-center text-sm sm:text-base text-[var(--text-secondary)]">
              No announcements found for this selection. Choose another batch above.
            </div>
          ) : (
            <div className="space-y-4 max-h-[760px] overflow-y-auto pr-1">
              {filteredPwFeed.map((item) => (
                <div
                  key={item.id}
                  className="rounded-2xl border border-[var(--card-border)] bg-[var(--bg-secondary)] p-5 sm:p-6 space-y-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs sm:text-sm">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-['Sora'] font-extrabold text-[var(--primary-color)] truncate">
                        {item.batchName}
                      </span>
                      <span aria-hidden="true" className="text-[var(--text-secondary)]">·</span>
                      <span className="font-semibold text-[var(--text-secondary)]">{item.type}</span>
                    </div>
                    {item.createdAt && (
                      <span className="font-mono tabular-nums text-[var(--text-secondary)]">
                        {new Date(item.createdAt).toLocaleDateString()}
                      </span>
                    )}
                  </div>

                  <p className="text-sm sm:text-base text-[var(--text-primary)] whitespace-pre-wrap leading-relaxed">
                    {item.announcement}
                  </p>

                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--card-border)] pt-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        onClick={() => handleOpenChannelBatch(item.batchId, item.batchName)}
                        className="flex items-center gap-1.5 text-xs sm:text-sm font-bold text-[var(--primary-color)] hover:underline"
                      >
                        <BookOpen className="h-4 w-4" />
                        <span>Open Batch</span>
                      </button>

                      {item.attachmentUrl && (
                        <a
                          href={buildPdfProxyUrl(item.attachmentUrl, item.attachmentName || 'notice')}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1.5 text-xs sm:text-sm font-bold text-emerald-400 hover:underline"
                        >
                          <FileText className="h-4 w-4" />
                          <span>View Notice PDF</span>
                        </a>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => onAskAi(`Summarize and explain key dates/action items from this notice:\n${item.announcement}`)}
                      className="flex items-center gap-1.5 text-xs sm:text-sm font-bold text-[var(--text-secondary)] hover:text-[var(--primary-color)]"
                    >
                      <Sparkles className="h-4 w-4" />
                      <span>Ask Study AI</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right: Study Lounge Discussion Board (5 cols) */}
        <div className="xl:col-span-5 space-y-5">
          {/* Post Composer */}
          <form
            onSubmit={handlePublish}
            className="rounded-3xl border border-[var(--card-border)] bg-[var(--card-bg)] p-6 space-y-4"
          >
            <h2 className="font-['Sora'] text-xl font-extrabold text-[var(--text-primary)]">
              Student Study Lounge
            </h2>

            <div className="flex flex-wrap items-center gap-3">
              <input
                type="text"
                value={newAuthor}
                onChange={(e) => setNewAuthor(e.target.value)}
                placeholder="Your name"
                className="flex-1 min-w-[140px] rounded-xl border border-[var(--card-border)] bg-[var(--bg-secondary)] px-4 py-2.5 text-sm font-semibold text-[var(--text-primary)] focus:border-[var(--primary-color)] focus:outline-none"
              />
              <select
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value as CommunityPost['category'])}
                className="rounded-xl border border-[var(--card-border)] bg-[var(--bg-secondary)] px-4 py-2.5 text-sm font-semibold text-[var(--text-primary)] focus:outline-none"
              >
                <option value="Doubt">Doubt</option>
                <option value="Study Tip">Study Tip</option>
                <option value="Formula Note">Formula Note</option>
                <option value="Milestone">Milestone</option>
              </select>
            </div>

            <textarea
              value={newText}
              onChange={(e) => setNewText(e.target.value)}
              rows={3}
              placeholder="Share a quick formula, ask a peer doubt, or post your study progress..."
              className="w-full resize-none rounded-2xl border border-[var(--card-border)] bg-[var(--bg-secondary)] px-4 py-3.5 text-sm sm:text-base text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:border-[var(--primary-color)] focus:outline-none"
            />

            <div className="flex items-center justify-between gap-2">
              <span className="text-xs sm:text-sm text-[var(--text-secondary)]">
                Saved in your Study Cloud lounge
              </span>
              <button
                type="submit"
                disabled={!newText.trim()}
                className="flex items-center gap-2 rounded-xl bg-[var(--primary-color)] px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50 hover:opacity-90 transition"
              >
                <Send className="h-4 w-4" />
                <span>Post Note</span>
              </button>
            </div>
          </form>

          {/* Filter Tabs */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
            {(['All', 'Doubt', 'Study Tip', 'Formula Note', 'Milestone'] as const).map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setCategoryFilter(cat)}
                className={`shrink-0 rounded-xl px-4 py-2 text-xs sm:text-sm font-bold transition ${
                  categoryFilter === cat
                    ? 'bg-[var(--primary-color)] text-white'
                    : 'border border-[var(--card-border)] bg-[var(--card-bg)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Posts List */}
          <div className="space-y-4">
            {filteredPosts.map((post) => (
              <div
                key={post.id}
                className="rounded-3xl border border-[var(--card-border)] bg-[var(--card-bg)] p-5 sm:p-6 space-y-3.5"
              >
                <div className="flex items-center justify-between text-xs sm:text-sm text-[var(--text-secondary)]">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-bold text-[var(--text-primary)] truncate">
                      {post.author}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="font-semibold text-[var(--primary-color)]">{post.category}</span>
                  </div>
                  <span className="font-mono tabular-nums shrink-0">
                    {new Date(post.createdAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>

                <p className="text-sm sm:text-base text-[var(--text-primary)] leading-relaxed whitespace-pre-wrap">
                  {post.content}
                </p>

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--card-border)] pt-3 text-xs sm:text-sm">
                  <div className="flex items-center gap-4">
                    <button
                      type="button"
                      onClick={() => handleToggleLike(post.id)}
                      className={`flex items-center gap-1.5 font-bold transition ${
                        post.liked ? 'text-[var(--primary-color)]' : 'text-[var(--text-secondary)]'
                      }`}
                    >
                      <ThumbsUp className="h-4 w-4" />
                      <span className="font-mono tabular-nums">{post.likes}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setReplyOpenId(replyOpenId === post.id ? null : post.id)}
                      className="flex items-center gap-1.5 font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                    >
                      <MessageSquare className="h-4 w-4" />
                      <span>Reply ({post.replies.length})</span>
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => onAskAi(post.content)}
                    className="flex items-center gap-1.5 font-bold text-[var(--primary-color)] hover:underline"
                  >
                    <Sparkles className="h-4 w-4" />
                    <span>Solve with AI</span>
                  </button>
                </div>

                {post.replies.length > 0 && (
                  <div className="space-y-2 border-t border-[var(--card-border)] pt-3">
                    {post.replies.map((rep) => (
                      <div
                        key={rep.id}
                        className="rounded-xl bg-[var(--bg-secondary)] px-4 py-2.5 text-xs sm:text-sm space-y-0.5"
                      >
                        <div className="font-bold text-[var(--text-primary)]">{rep.author}</div>
                        <div className="text-[var(--text-secondary)]">{rep.text}</div>
                      </div>
                    ))}
                  </div>
                )}

                {replyOpenId === post.id && (
                  <div className="flex items-center gap-2 pt-1">
                    <input
                      type="text"
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      placeholder="Write a helpful reply..."
                      className="flex-1 rounded-xl border border-[var(--card-border)] bg-[var(--bg-secondary)] px-3.5 py-2.5 text-sm text-[var(--text-primary)] focus:border-[var(--primary-color)] focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => handleAddReply(post.id)}
                      className="rounded-xl bg-[var(--primary-color)] px-4 py-2.5 text-sm font-bold text-white"
                    >
                      Send
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
