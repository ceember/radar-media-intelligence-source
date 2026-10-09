export type ResearchSource = {
  id: number; title: string; url: string; snippet: string; text: string;
  status: 'pending' | 'read' | 'failed'; error?: string;
  providers?: ('tavily' | 'f9')[]; reader?: 'tavily-extract' | 'native';
};

export type ResearchRun = {
  id: number; projectId: number; question: string; status: string;
  queries: string[]; sources: ResearchSource[]; answer: string;
  warnings: string[]; error: string | null; createdAt: string;
};

export type ResearchEvent =
  | { type: 'step'; step: 'planning' | 'searching' | 'reading' | 'writing'; message: string }
  | { type: 'sources'; sources: ResearchSource[] }
  | { type: 'done'; run: ResearchRun }
  | { type: 'error'; error: string; runId?: number };
