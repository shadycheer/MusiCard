/* Shared between API route, DB helpers, and React components. Defines the
   structured "song facts" payload that the LLM returns and that the UI renders. */

export type Citation = {
  url: string;            // real, clickable URL — must come from web_search results
  title?: string;         // page title
  excerpt?: string;       // verbatim snippet pulled from the page for user verification
};

export type Fact<T> = {
  value: T;
  citations: Citation[];  // at least one — fields without a citation are omitted entirely
};

export type Paragraph = {
  text: string;
  citations: Citation[];
  image?: {
    url: string;          // must be a real image URL surfaced by web_search
    caption?: string;
    sourceUrl: string;    // the page where the image was found
  };
};

export type Engineers = {
  mixing?: string;
  mastering?: string;
  recording?: string;
};

export type CoverInfo = {
  artist: string;
  year?: string;
  note?: string;
};

export type MediaUseInfo = {
  medium: string;         // "电影" / "电视剧" / "游戏" / ...
  title: string;
  year?: string;
};

export type ArticleSection = {
  title: string;
  body: Paragraph;
};

export type SongDnaFound = {
  hasData: true;

  article?: {
    headline: string;
    lead: Paragraph;
    keyFacts?: Fact<string[]>;
    sections: ArticleSection[];
    takeaway?: Paragraph;
  };

  identity?: {
    album?: Fact<string>;
    releaseDate?: Fact<string>;     // ISO YYYY-MM-DD / YYYY-MM / YYYY
    label?: Fact<string>;
    duration?: Fact<string>;        // "3:42"
  };

  credits?: {
    lyrics?: Fact<string>;
    composition?: Fact<string>;
    arrangement?: Fact<string>;
    production?: Fact<string>;
    studio?: Fact<string>;
    musicians?: Fact<string[]>;
    engineers?: Fact<Engineers>;
  };

  making?: {
    inspiration?: Paragraph;   // ① 灵感起源
    writing?: Paragraph;       // ② 写作过程 / 艺人当时处境
    recording?: Paragraph;     // ③ 录制现场 / 关键决策 / 轶事
  };

  legacy?: {
    commercial?: Paragraph;
    awards?: Fact<string[]>;
    covers?: Fact<CoverInfo[]>;
    mediaUse?: Fact<MediaUseInfo[]>;
    impact?: Paragraph;
  };
};

export type SongDnaPayload =
  | { hasData: false }
  | SongDnaFound;

export type SongDnaLoadingPhase =
  | 'started'
  | 'searching'
  | 'analyzing'
  | 'synthesizing';

export type SongDnaStreamEvent =
  | { kind: 'status'; phase: SongDnaLoadingPhase; detail?: string }
  | { kind: 'final'; payload: SongDnaPayload; cached: boolean; cachedAt?: string }
  | { kind: 'error'; message: string };
