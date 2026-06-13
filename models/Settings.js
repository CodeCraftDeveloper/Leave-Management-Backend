import mongoose from 'mongoose';
import { DEFAULT_SETTINGS } from '../utils/constants.js';

// Single-document settings collection (singleton).
// Use Settings.get() to read; callers never construct manually.
const settingsSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'global', unique: true },
    // Office timing (display / informational; no late deduction applied).
    workStartTime: { type: String, default: DEFAULT_SETTINGS.workStartTime }, // "09:15"
    workEndTime: { type: String, default: DEFAULT_SETTINGS.workEndTime },     // "18:00"
    // Global week-offs. Sunday is employee-scoped in leavePolicy.js.
    weekOffDays: { type: [Number], default: DEFAULT_SETTINGS.weekOffDays },
    // 'actual' (default): perDay = monthlySalary / daysInMonth.
    // 'fixed30':         perDay = monthlySalary / 30.
    perDayMode: { type: String, enum: ['actual', 'fixed30'], default: DEFAULT_SETTINGS.perDayMode },
    // Legacy compatibility only. Leave policy uses monthlyFreeLeaves, not yearly quotas.
    yearlyQuota: { type: Map, of: Number, default: () => new Map(Object.entries(DEFAULT_SETTINGS.yearlyQuota)) },
    // Company gives N free leaves per month — anything beyond deducts perDay.
    monthlyFreeLeaves: { type: Number, default: DEFAULT_SETTINGS.monthlyFreeLeaves, min: 0 },
    // Minimum hours on a Sunday to earn the double-pay bonus.
    sundayMinHours: { type: Number, default: DEFAULT_SETTINGS.sundayMinHours, min: 0 },
    sundayPayMultiplier: { type: Number, default: DEFAULT_SETTINGS.sundayPayMultiplier, min: 1 },
  },
  { timestamps: true }
);

settingsSchema.statics.get = async function () {
  let doc = await this.findOne({ key: 'global' });
  if (!doc) doc = await this.create({ key: 'global' });
  if (doc.yearlyQuota?.size) {
    doc.yearlyQuota = new Map();
    await doc.save();
  }
  return doc;
};

const Settings = mongoose.model('Settings', settingsSchema);
export default Settings;
