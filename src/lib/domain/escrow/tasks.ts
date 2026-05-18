export type TaskPriority = 1 | 2 | 3;

export interface Task {
  orderId: number;
  fileNumber: string;
  propertyAddress: string | null;
  escrowOfficerName: string | null;
  priority: TaskPriority;
  label: string;
  daysAgo: number | null;
}

export interface TaskSummary {
  priority1Count: number;
  priority2Count: number;
  priority3Count: number;
  unassignedCount: number | null;
}

export interface EscrowTasksResponse {
  generatedAt: string;
  scope: 'all' | 'assigned';
  totalOrders: number;
  summary: TaskSummary;
  tasksByPriority: {
    '1': Task[];
    '2': Task[];
    '3': Task[];
  };
}
