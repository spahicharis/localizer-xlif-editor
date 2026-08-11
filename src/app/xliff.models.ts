export interface XliffUnit {
  id: string;
  source: string;
  target: string;
  state: string;
  hasTarget: boolean;
  description: string;
  meaning: string;
  locations: string[];
}

export interface XliffFile {
  id: string;
  originalName: string;
  uploadedAt: string;
  sourceLanguage: string;
  targetLanguage: string;
  original: string;
  units: XliffUnit[];
}

export interface FileSummary {
  id: string;
  originalName: string;
  uploadedAt: string;
}

export interface TranslationResult {
  id: string;
  target?: string;
  error?: string;
}

export interface TranslateResponse {
  fileId: string;
  from: string;
  to: string;
  translations: TranslationResult[];
}
