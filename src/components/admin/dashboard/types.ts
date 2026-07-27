
export interface DashboardStats {
  totalStudents: number;
  activeStudents: number;
  expiringStudents: number;
  expiredStudents: number;
  totalDrivers: number;
  activeDrivers: number;
  totalBuses: number;
  activeBuses: number;
  enrouteBuses: number;
  operationalBuses: number;
  totalRoutes: number;
  totalNotifications: number;
  unreadNotifications: number;
  pendingVerifications: number;
  pendingApplications: number;
  approvedToday: number;
  rejectedToday: number;
  morningStudents: number;
  eveningStudents: number;
  totalRevenue: number;
  onlinePayments: number;
  offlinePayments: number;
  academicYearEnd: any;
  softBlock: any;
  hardBlock: any;
  systemBusFee: number;
  feedbacksCount: number;
}

export interface PaymentTrend {
  date: string;
  amount: number;
  count: number;
}

export interface MethodTrend {
  name: string;
  value: number;
  color: string;
}

export interface BusUtilizationData {
  name: string;
  students: number;
  capacity: number;
  utilization: number;
  morningCount: number;
  eveningCount: number;
}

export interface RouteOccupancyData {
  name: string;
  occupancy: number;
  students: number;
  capacity: number;
}

export interface ShiftDistributionData {
  name: string;
  value: number;
  color: string;
}

export interface ActiveTrip {
  id: string;
  busId: string;
  routeName: string;
  driverName: string;
  driverId: string;
  startTime: string;
  studentCount: number;
  status: string;
}
