export interface ExpenseItem {
  description: string;
  amount: number;
}

export interface DailyExpense {
  date: string;
  entries: {
    name: string;
    items: ExpenseItem[];
    total: number;
  }[];
  dayTotal: number;
}

export interface ExtractionResult {
  dailyExpenses: DailyExpense[];
}
