/** Request / response model for rent roll + revenue forecast reports. */

export type ReportSections = {
  officeRents: boolean;
  meetingRoomRevenue: boolean;
  hotDeskRevenue: boolean;
  venueRevenue: boolean;
  additionalServices: boolean;
  vacancyForecast: boolean;
  revenueVsTarget: boolean;
  roomByRoom: boolean;
  tenantByTenant: boolean;
  monthlySummary: boolean;
};

export const defaultReportSections = (): ReportSections => ({
  officeRents: true,
  meetingRoomRevenue: true,
  hotDeskRevenue: true,
  venueRevenue: true,
  additionalServices: true,
  vacancyForecast: true,
  revenueVsTarget: false,
  roomByRoom: true,
  tenantByTenant: true,
  monthlySummary: true,
});

export type RentRollRequestBody = {
  propertyIds: string[] | null;
  startDate: string;
  endDate: string;
  sections: ReportSections;
  /** When revenueVsTarget is true, compares monthly totals to this amount (same currency as data). */
  revenueTargetMonthly?: number | null;
};

export type OfficeRentRow = {
  monthKey: string;
  propertyId: string;
  propertyName: string;
  spaceId: string;
  roomNumber: string | null;
  spaceName: string;
  spaceType: string;
  lessee: string;
  contractStart: string | null;
  contractEnd: string | null;
  contractStatus: string;
  contractMonthlyRent: number;
  invoicedBaseRent: number | null;
  invoicedAdditionalServices: number | null;
  invoicedTotal: number | null;
};

export type VacancyRow = {
  monthKey: string;
  propertyId: string;
  propertyName: string;
  spaceId: string;
  roomNumber: string | null;
  spaceName: string;
  spaceType: string;
  listMonthlyRent: number | null;
  listHourly: number | null;
  note: string;
};

export type MonthlyRevenueBreakdown = {
  monthKey: string;
  officeContractRent: number;
  meetingRoomBookings: number;
  hotDeskBookings: number;
  venueBookings: number;
  additionalServices: number;
  total: number;
};

export type RevenueVsTargetRow = {
  monthKey: string;
  total: number;
  target: number;
  variance: number;
  variancePct: number | null;
};

export type RoomMonthCell = {
  monthKey: string;
  amount: number;
  basis: string;
};

export type RoomByRoomRow = {
  propertyId: string;
  propertyName: string;
  spaceId: string;
  roomNumber: string | null;
  spaceName: string;
  spaceType: string;
  months: RoomMonthCell[];
};

export type TenantBreakdownRow = {
  bucketKey: string;
  displayName: string;
  officeContractRent: number;
  bookingRevenue: number;
  additionalServices: number;
  total: number;
};

export type RentRollReportModel = {
  generatedAt: string;
  startDate: string;
  endDate: string;
  monthKeys: string[];
  sections: ReportSections;
  revenueTargetMonthly: number | null;
  properties: { id: string; name: string; city: string | null }[];
  officeRentRoll: OfficeRentRow[];
  revenueByMonth: {
    meeting: Record<string, number>;
    hotDesk: Record<string, number>;
    venue: Record<string, number>;
    additionalServices: Record<string, number>;
  };
  monthlySummary: MonthlyRevenueBreakdown[];
  vacancyForecast: VacancyRow[];
  revenueVsTarget: RevenueVsTargetRow[];
  roomByRoom: RoomByRoomRow[];
  tenantByTenant: TenantBreakdownRow[];
};
