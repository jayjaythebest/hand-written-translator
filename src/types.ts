export interface ExpenseItem {
  description: string;
  amount: number;
}

export interface EntryRecord {
  name: string;
  items: ExpenseItem[];
  total: number;
}

export interface DailyExpense {
  date: string;
  entries: EntryRecord[];
  dayTotal: number;
}

export interface ExtractionResult {
  dailyExpenses: DailyExpense[];
}

export interface Project {
  id: string;
  name: string;
  uid: string;
  createdAt: any;
}

export type ImageStatus = 'pending' | 'processing' | 'done' | 'error';

export interface ProjectImage {
  id: string;
  projectId: string;
  uid: string;
  fileName: string;
  imageHash: string;
  imageDataUrl: string;
  status: ImageStatus;
  errorMessage?: string;
  createdAt: any;
}

export interface ProjectRecord {
  id: string;
  projectId: string;
  imageId: string;
  uid: string;
  dailyExpenses: DailyExpense[];
  createdAt: any;
}
