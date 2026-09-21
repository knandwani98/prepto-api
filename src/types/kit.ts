export type KitStatus =
  | "queued"
  | "researching"
  | "generating"
  | "ready"
  | "failed";

export type QuestionCategory =
  | "behavioral"
  | "technical"
  | "role"
  | "company"
  | "curveball";

export type Difficulty = "easy" | "medium" | "hard";

export interface CompanyBrief {
  name: string;
  whatTheyDo: string;
  culture: string;
  products: string[];
  hiringSignals: string[];
}

export interface RoleBreakdown {
  title: string;
  summary: string;
  mustHaves: string[];
  niceToHaves: string[];
  interviewLoop: string[];
  successLooksLike: string;
}

export interface KitQuestion {
  id: string;
  category: QuestionCategory;
  question: string;
  whyAsked: string;
  talkingPoints: string[];
  difficulty: Difficulty;
}

export interface Flashcard {
  id: string;
  front: string;
  back: string;
  tags: string[];
}

export interface QuizItem {
  id: string;
  prompt: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  source: string;
}

export interface ScheduleTask {
  id: string;
  label: string;
  relatedIds: string[];
}

export interface ScheduleDay {
  day: number;
  focus: string;
  tasks: ScheduleTask[];
}

export interface GeneratedKit {
  companyBrief: CompanyBrief;
  roleBreakdown: RoleBreakdown;
  questions: KitQuestion[];
  flashcards: Flashcard[];
  quiz: QuizItem[];
  schedule: ScheduleDay[];
}

export interface CrawledPage {
  url: string;
  title: string;
  text: string;
}

export interface SearchSnippet {
  title: string;
  url: string;
  description: string;
}

export interface KitInput {
  jobDescription: string;
  companyUrl: string;
  companyName?: string;
  daysUntilInterview: number;
}

export interface KitResearch {
  pages: CrawledPage[];
  snippets: SearchSnippet[];
  interviewProcessInferred: boolean;
}

export type RegenerableSection = keyof GeneratedKit;
