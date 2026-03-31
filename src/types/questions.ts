export type Choice = { key: string; text: string };
export type Media =
  | { type: "image"; url: string; alt?: string }
  | null;

export type Question = {
  id: string;              // e.g. "Q58"
  index: number;           // e.g. 58
  type: "MULTIPLE_CHOICE" | "FREE_RESPONSE";
  category: string | null; // unknown at extraction time
  stem: string;
  media: Media;
  choices: Choice[];
  answer?: string;         // leave blank if unknown
};

export type ExamMeta = { label?: string; minutes?: number; source?: string };
export type ExamPayload = { meta?: ExamMeta; questions: Question[] };
