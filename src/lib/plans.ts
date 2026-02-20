export type PlanName = "free" | "solo" | "creator" | "studio";

export type PlanLimits = {
  brands: number;
  channels: number;
  monthlySchedules: number;
  monthlyAutoPosts: number;
  scheduleHorizonDays: number | null;
  assetStorageGb: number;
  assetRetentionDays: number;
};

export const PLAN_LIMITS: Record<PlanName, PlanLimits> = {
  free: {
    brands: 1,
    channels: 2,
    monthlySchedules: 30,
    monthlyAutoPosts: 10,
    scheduleHorizonDays: 7,
    assetStorageGb: 1,
    assetRetentionDays: 7
  },
  solo: {
    brands: 1,
    channels: 4,
    monthlySchedules: 300,
    monthlyAutoPosts: 300,
    scheduleHorizonDays: null,
    assetStorageGb: 50,
    assetRetentionDays: 90
  },
  creator: {
    brands: 3,
    channels: 15,
    monthlySchedules: 1200,
    monthlyAutoPosts: 1200,
    scheduleHorizonDays: null,
    assetStorageGb: 200,
    assetRetentionDays: 180
  },
  studio: {
    brands: 10,
    channels: 60,
    monthlySchedules: 5000,
    monthlyAutoPosts: 5000,
    scheduleHorizonDays: null,
    assetStorageGb: 1024,
    assetRetentionDays: 365
  }
};
