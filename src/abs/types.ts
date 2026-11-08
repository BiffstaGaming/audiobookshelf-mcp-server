/**
 * Partial typings for the Audiobookshelf REST API (verified against
 * Audiobookshelf v2.37 server source). Only fields this server uses are typed;
 * everything is optional-tolerant because older servers omit some fields.
 */

export interface AbsLibrary {
  id: string;
  name: string;
  mediaType: 'book' | 'podcast';
  displayOrder?: number;
  icon?: string;
  createdAt?: number;
  lastUpdate?: number;
}

export interface AbsAuthorRef {
  id: string;
  name: string;
}

export interface AbsSeriesRef {
  id: string;
  name: string;
  sequence?: string | null;
}

/** media.metadata on a minified item (list endpoints). */
export interface AbsBookMetadataMinified {
  title?: string | null;
  subtitle?: string | null;
  authorName?: string | null;
  authorNameLF?: string | null;
  narratorName?: string | null;
  seriesName?: string | null;
  genres?: string[];
  publishedYear?: string | null;
  publishedDate?: string | null;
  publisher?: string | null;
  description?: string | null;
  isbn?: string | null;
  asin?: string | null;
  language?: string | null;
  explicit?: boolean;
  abridged?: boolean;
  /** Present on expanded items. On minified items only when filtering by series (an object). */
  series?: AbsSeriesRef[] | AbsSeriesRef;
  /** Expanded items only. */
  authors?: AbsAuthorRef[];
  /** Expanded items only. */
  narrators?: string[];
  descriptionPlain?: string | null;
}

export interface AbsLibraryItem {
  id: string;
  libraryId: string;
  mediaType: 'book' | 'podcast';
  addedAt?: number;
  updatedAt?: number;
  isMissing?: boolean;
  isInvalid?: boolean;
  media: {
    id?: string;
    metadata: AbsBookMetadataMinified & { author?: string | null };
    tags?: string[];
    duration?: number;
    numChapters?: number;
    numTracks?: number;
    numEpisodes?: number;
    ebookFormat?: string | null;
    chapters?: { id: number; start: number; end: number; title: string }[];
  };
  userMediaProgress?: AbsMediaProgress | null;
  progressLastUpdate?: number;
}

export interface AbsMediaProgress {
  id: string;
  libraryItemId: string | null;
  episodeId: string | null;
  duration: number;
  progress: number;
  currentTime: number;
  isFinished: boolean;
  hideFromContinueListening?: boolean;
  ebookProgress?: number | null;
  lastUpdate: number;
  startedAt: number;
  finishedAt: number | null;
}

export interface AbsUser {
  id: string;
  username: string;
  type: 'root' | 'admin' | 'user' | 'guest';
  isActive?: boolean;
  permissions?: {
    update?: boolean;
    delete?: boolean;
    upload?: boolean;
    accessAllLibraries?: boolean;
    librariesAccessible?: string[];
  };
  librariesAccessible?: string[];
}

export interface AbsAuthorizeResponse {
  user: AbsUser;
  userDefaultLibraryId?: string;
  serverSettings?: { version?: string; [k: string]: unknown };
}

export interface AbsItemsPage {
  results: AbsLibraryItem[];
  total?: number;
  limit: number | string;
  page: number | string;
}

export interface AbsSearchResponse {
  book?: { libraryItem: AbsLibraryItem; matchKey?: string; matchText?: string }[];
  podcast?: { libraryItem: AbsLibraryItem }[];
  narrators?: { name: string; numBooks: number }[];
  tags?: { name: string; numItems: number }[];
  genres?: { name: string; numItems: number }[];
  series?: { series: { id: string; name: string }; books: AbsLibraryItem[] }[];
  authors?: { id: string; name: string; numBooks?: number }[];
}

export interface AbsFilterData {
  authors: AbsAuthorRef[];
  series: { id: string; name: string }[];
  genres: string[];
  tags: string[];
  narrators: string[];
  languages: string[];
  publishers: string[];
  publishedDecades?: string[];
  bookCount?: number;
  authorCount?: number;
  seriesCount?: number;
  podcastCount?: number;
}

export interface AbsAuthor {
  id: string;
  name: string;
  description?: string | null;
  asin?: string | null;
  numBooks?: number;
  libraryItems?: AbsLibraryItem[];
  series?: { id: string; name: string; items: AbsLibraryItem[] }[];
}

export interface AbsSeriesListEntry {
  id: string;
  name: string;
  description?: string | null;
  addedAt?: number;
  totalDuration?: number;
  books: AbsLibraryItem[];
}

export interface AbsListeningSession {
  id: string;
  libraryId?: string;
  libraryItemId: string;
  episodeId?: string | null;
  mediaType?: string;
  displayTitle?: string;
  displayAuthor?: string;
  duration?: number;
  timeListening?: number | string;
  startedAt?: number;
  updatedAt?: number;
  date?: string;
  dayOfWeek?: string;
  deviceInfo?: { clientName?: string; deviceName?: string; model?: string } | null;
  mediaMetadata?: { title?: string; author?: string; authorName?: string } | null;
}

export interface AbsListeningStats {
  totalTime: number;
  today: number;
  items: Record<string, { id: string; timeListening: number; mediaMetadata?: { title?: string } | null }>;
  days: Record<string, number>;
  dayOfWeek: Record<string, number>;
  recentSessions: AbsListeningSession[];
}

export interface AbsCollection {
  id: string;
  libraryId: string;
  name: string;
  description?: string | null;
  books?: AbsLibraryItem[];
}

export interface AbsPlaylist {
  id: string;
  libraryId: string;
  name: string;
  description?: string | null;
  items?: { libraryItemId: string; episodeId?: string | null; libraryItem?: AbsLibraryItem }[];
}
