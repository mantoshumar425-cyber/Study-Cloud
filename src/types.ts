export interface BatchItem {
  batch_id: string;
  name: string;
  byName?: string;
  language?: string;
  exam?: string;
  photo?: string;
  class?: string;
  start_date?: string;
  end_date?: string;
  amount?: number;
  isVidyapeeth?: boolean;
}

export interface BatchSubject {
  _id: string;
  subject: string;
  slug: string;
  imageId?: {
    baseUrl?: string;
    key?: string;
  };
  teacherIds?: Array<{
    _id: string;
    firstName?: string;
    lastName?: string;
    imageId?: { baseUrl?: string; key?: string };
  }>;
  fileId?: BatchAttachmentItem | null;
  lectureCount?: number;
  tagCount?: number;
}

export interface BatchTopic {
  _id: string;
  name: string;
  slug: string;
  type?: string;
  typeId?: string;
  videos?: number;
  notes?: number;
  exercises?: number;
  dppVideos?: number;
}

export interface BatchVideoItem {
  _id: string;
  topic: string;
  date?: string;
  startTime?: string;
  endTime?: string;
  url?: string;
  urlType?: string;
  typeId?: string;
  isDPPVideos?: boolean;
  videoDetails?: {
    _id?: string;
    id?: string;
    findKey?: string;
    name?: string;
    image?: string;
    videoUrl?: string;
    embedCode?: string;
    duration?: string;
    types?: string[];
  };
  teachers?: string[];
}

export interface BatchAttachmentItem {
  _id?: string;
  baseUrl?: string;
  key?: string;
  name?: string;
  url?: string;
  resolvedUrl?: string;
}

export interface BatchNoteHomework {
  _id: string;
  topic?: string;
  note?: string;
  attachmentIds?: BatchAttachmentItem[];
}

export interface BatchNoteItem {
  _id: string;
  topic?: string;
  date?: string;
  homeworkIds?: BatchNoteHomework[];
}

export interface ScheduledClassItem {
  _id: string;
  topic: string;
  date?: string;
  dateKey?: string;
  startTime?: string;
  endTime?: string;
  urlType?: string;
  url?: string;
  type?: string;
  typeId?: string;
  status?: string;
  liveStatus?: 'LIVE' | 'UPCOMING' | 'COMPLETED';
  subjectName?: string;
  subjectSlug?: string;
  batchSubjectId?: string;
  topicName?: string;
  topicId?: string;
  teacherNames?: string[];
  teacherImages?: string[];
  teacherImage?: string;
  tag?: string;
  isCancelled?: boolean;
  isDPPVideos?: boolean;
  isDPPNotes?: boolean;
  parentScheduleId?: string;
  scheduleIds?: string[];
  mediaChannelId?: string;
  ytStreamUrl?: string;
  newCdnLink?: string;
  videoDetails?: {
    _id?: string;
    id?: string;
    findKey?: string;
    name?: string;
    image?: string;
    videoUrl?: string;
    embedCode?: string;
    hls_url?: string;
    duration?: string;
  };
  homeworkIds?: BatchNoteHomework[];
  tags?: Array<{ _id: string; name: string }>;
}

export interface WeeklyRoutineSlot {
  weekday: number; // 0 = Sun ... 6 = Sat (IST)
  subjectName: string;
  subjectSlug?: string;
  batchSubjectId?: string;
  startTime?: string;
  endTime?: string;
  sampleTopic?: string;
  teacherNames?: string[];
}

export interface TodayScheduleResponse {
  success: boolean;
  source?: string;
  date: string;
  classes: ScheduledClassItem[];
}

export interface WeeklyScheduleResponse {
  success: boolean;
  source?: string;
  classes: ScheduledClassItem[];
  weeklyRoutine?: WeeklyRoutineSlot[];
}

export interface ResolvedStream {
  success: boolean;
  isYoutube?: boolean;
  youtubeEmbedUrl?: string;
  isDirectMp4?: boolean;
  streamUrl?: string;
  hlsUrl?: string;
  dashUrl?: string;
  rawUrl?: string;
  drmType?: string;
  clearKey?: {
    kidB64: string;
    keyB64: string;
    kidHex: string;
    keyHex: string;
  } | null;
  attachments?: BatchAttachmentItem[];
  message?: string;
  liveStreamPending?: boolean;
  urlType?: string;
}

export interface WatchHistoryItem {
  id: string;
  batchId?: string;
  batchName?: string;
  programId?: string;
  subjectId?: string;
  topicId?: string;
  videoId?: string;
  videoType?: string;
  playType?: string;
  title: string;
  videoUrl?: string;
  duration?: number;
  progressSeconds?: number;
  progressPercent?: number;
  watchedAt: number;
}

export interface KhazanaProgramSummary {
  programId: string;
  batchId: string;
  title: string;
  subtitle: string;
  exam: string;
  classLevel: string;
  batchName: string;
  photo?: string;
}

export interface KhazanaSubjectOption {
  _id: string;
  name: string;
  value: string;
  displayOrder?: number;
}

export interface KhazanaTeacher {
  _id: string;
  name: string;
  firstName?: string;
  lastName?: string;
  subject?: string;
  experience?: string;
  tags?: string[];
  featuredLine?: string;
  imageId?: {
    baseUrl?: string;
    key?: string;
  };
}

export interface KhazanaChapter {
  _id: string;
  name: string;
  description?: string;
  subjectId?: string | { _id: string; name?: string };
  programId?: string;
  teacherName?: string;
  backgroundImage?: string;
  imageId?: { baseUrl?: string; key?: string } | null;
  teacher?: {
    _id?: string;
    firstName?: string;
    lastName?: string;
    name?: string;
    experience?: string;
    tags?: string[];
    featuredLine?: string;
    imageId?: { baseUrl?: string; key?: string };
  };
  courseType?: { name?: string; value?: string };
  year?: { name?: string; value?: string };
  batchType?: { name?: string; value?: string };
}

export interface KhazanaTopic {
  _id: string;
  name: string;
  slug?: string;
  chapter?: string;
  displayOrder?: number;
  programId?: string;
  subjectId?: string;
  chapterId?: string;
}

export interface KhazanaSubTopic {
  _id: string;
  name: string;
  slug?: string;
  displayOrder?: number;
  programId?: string;
  subjectId?: string;
  chapterId?: string;
  topicId?: string;
}

export interface KhazanaContentItem {
  type: string; // 'LECTURE' | 'NOTES' | 'EXERCISE' | ...
  data: {
    _id: string;
    title?: string;
    name?: string;
    videoType?: string;
    videoUrl?: string;
    createdAt?: string;
    programId?: string;
    subjectId?: string;
    chapterId?: string;
    topicId?: string;
    subTopicId?: string;
    type?: string;
    subject?: { _id?: string; name?: string };
    teacher?: {
      _id?: string;
      firstName?: string;
      lastName?: string;
      imageId?: { baseUrl?: string; key?: string };
    };
    videoDetails?: {
      _id?: string;
      id?: string;
      findKey?: string;
      name?: string;
      image?: string;
      videoUrl?: string;
      embedCode?: string;
      duration?: string;
      createdAt?: string;
    };
    fileId?: BatchAttachmentItem | null;
    imageId?: BatchAttachmentItem | null;
  };
}

export interface AppControls {
  maintenance_mode: boolean;
  community_tab: boolean;
  tests_tab: boolean;
  dpp_quiz_tab: boolean;
  action_buttons: Array<{
    id: number;
    name: string;
    url: string;
    icon_svg?: string;
    active: boolean;
    sort_order?: number;
  }>;
  download_button?: {
    name: string;
    url: string;
    icon_svg?: string;
    active: boolean;
  };
}

export type ThemeId =
  | 'dark'
  | 'sandalwood'
  | 'forest-emerald'
  | 'ocean-deep'
  | 'sakura-blossom'
  | 'dracula-midnight'
  | 'lavender-mist'
  | 'cyberpunk-neon'
  | 'light';

export type NavTab =
  | 'batches'
  | 'khazana'
  | 'pi'
  | 'community'
  | 'test'
  | 'search'
  | 'ai'
  | 'downloads'
  | 'favorites'
  | 'history'
  | 'settings';

export type AiStudyLanguage = 'hinglish' | 'hindi' | 'english';
export type AiStudyMode = 'doubt' | 'formula' | 'quiz' | 'summary';

export interface AiStudyContext {
  batchName?: string;
  subjectName?: string;
  topicName?: string;
  lectureTitle?: string;
}

export interface AiChatImage {
  mimeType: string;
  data: string; // raw base64 without data URL prefix
  previewUrl?: string;
}

export interface AiChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  createdAt: number;
  image?: AiChatImage;
  mode?: AiStudyMode;
}

export interface CompletedLectureRecord {
  key: string; // `${batchId}:${videoId}`
  batchId: string;
  subjectId: string;
  topicId: string;
  videoId: string;
  title: string;
  completedAt: number;
}

export interface AdventureState {
  completedLectures: Record<string, CompletedLectureRecord>;
  studyDates: string[]; // YYYY-MM-DD
  enrolledBatchIds: string[];
  customBatches: BatchItem[];
}

export interface BatchExerciseDetail {
  _id?: string;
  type?: string;
  status?: string;
  title?: string;
  resolvedExerciseId?: string;
  totalQuestions?: number;
  totalMarks?: number;
  maxDuration?: number;
  content?: Array<{
    _id?: string;
    exerciseId?: string;
    exerciseDetails?: {
      totalQuestions?: number;
      totalMarks?: number;
      maxDuration?: number;
    };
  }>;
}

export interface BatchExerciseItem {
  _id: string;
  status?: string;
  date?: string;
  startTime?: string;
  isDPPNotes?: boolean;
  topic?: string;
  exerciseIds?: BatchExerciseDetail[];
}

export interface OfficialBatchTest {
  id: string;
  exerciseId: string;
  title: string;
  category: string;
  testCatId?: string;
  batchId: string;
  batchName: string;
  subjectName: string;
  syllabus: string;
  totalQuestions: number;
  totalMarks: number;
  maxDuration: number;
  startTime?: string;
  status: string;
  pdfUrl?: string;
  pdfName?: string;
  isOfficial: boolean;
}

export interface PiSubcategory {
  id: string;
  name: string;
  keyword?: string;
}

export interface PiCategory {
  id: string;
  name: string;
  tagline: string;
  icon: string;
  programId?: string;
  subcategories: PiSubcategory[];
}

export interface PiSeriesItem {
  id: string;
  type: 'khazana' | 'batch';
  programId?: string;
  subjectId?: string;
  batchId?: string;
  subjectName: string;
  title: string;
  subtitle: string;
  teacherName: string;
  teacherId?: string;
  poster: string;
  backdrop: string;
  tag: string;
  year: string;
}

export interface PiTeacherItem {
  id: string;
  name: string;
  subject: string;
  experience: string;
  featuredLine: string;
  image: string;
  programId: string;
  source?: string;
}

export interface PiEpisodeItem {
  id: string;
  title: string;
  duration?: string;
  thumb?: string;
  programId?: string;
  batchId: string;
  subjectId: string;
  topicId: string;
  topicName: string;
  findKey?: string;
  videoDetailsId?: string;
  videoType?: string;
  rawVideoUrl?: string;
}

export interface PiQuizCard {
  id: string;
  title: string;
  subject: string;
  questionsCount: number;
  durationMinutes: number;
  badge: string;
  batchId?: string;
}

export interface PiHomeResponse {
  success: boolean;
  category: PiCategory;
  subcategories: PiSubcategory[];
  activeSubId: string;
  heroSlides: PiSeriesItem[];
  top10Series: PiSeriesItem[];
  teachers: PiTeacherItem[];
  latestSeries: PiSeriesItem[];
  conceptPlaylists: PiSeriesItem[];
  quizCards: PiQuizCard[];
}

export interface PiTeacherProfileResponse {
  success: boolean;
  teacher: PiTeacherItem & { seriesCount: number };
  series: PiSeriesItem[];
  playlistVideos: PiEpisodeItem[];
}

export interface PiSeriesDetailResponse {
  success: boolean;
  type: 'khazana' | 'batch';
  seriesId: string;
  title?: string;
  programId?: string;
  subjectId?: string;
  subjects?: Array<{ id: string; name: string }>;
  activeSubjectId?: string;
  topics: Array<{ id: string; name: string; videos?: number }>;
  activeTopicId: string;
  episodes: PiEpisodeItem[];
  notes: BatchNoteItem[];
}

