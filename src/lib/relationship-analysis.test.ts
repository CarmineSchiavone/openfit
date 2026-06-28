import { describe, expect, it } from 'vitest'
import type { DashboardData, TrendPoint } from '@/types'
import { buildRecoveryModel, recoveryDrivers } from './relationship-analysis'

function trend(date: string, overrides: Partial<TrendPoint>): TrendPoint {
  return {
    date,
    label: date,
    steps: null,
    calories: null,
    distanceKm: null,
    floors: null,
    activeMinutes: null,
    zoneMinutes: null,
    sedentaryMinutes: null,
    restingHeartRate: null,
    hrvMs: null,
    breathingRate: null,
    spo2: null,
    skinTemperature: null,
    coreTemperature: null,
    cardioScore: null,
    strain: null,
    recoveryScore: null,
    sleepPerformance: null,
    sleepMinutes: null,
    sleepScore: null,
    sleepEfficiency: null,
    weight: null,
    bodyFat: null,
    waterMl: null,
    caloriesIn: null,
    ...overrides,
  }
}

function data(trends: TrendPoint[]): DashboardData {
  return {
    source: 'demo',
    selectedDate: trends.at(-1)?.date ?? '2026-06-01',
    generatedAt: '2026-06-28T00:00:00Z',
    profile: { displayName: 'Ada', avatar: null, memberSince: null, timezone: null },
    device: null,
    activity: {
      steps: null, stepsGoal: null, calories: null, caloriesGoal: null, distanceKm: null, distanceGoalKm: null,
      floors: null, floorsGoal: null, activeMinutes: null, lightActiveMinutes: null, moderateActiveMinutes: null,
      vigorousActiveMinutes: null, activeMinutesGoal: null, zoneMinutes: null, sedentaryMinutes: null, stepsIntraday: [], caloriesIntraday: [],
    },
    health: {
      currentHeartRate: null, restingHeartRate: null, heartRateMin: null, heartRateMax: null, heartRateIntraday: [],
      hrvMs: null, hrvDeepSleepRmssdMs: null, hrvEntropy: null, nonRemHeartRate: null, breathingRate: null, spo2: null,
      spo2Min: null, spo2Max: null, skinTemperature: null, skinNightlyTemperatureCelsius: null, skinBaselineTemperatureCelsius: null,
      skinTemperatureStddev30dCelsius: null, coreTemperature: null, vo2Max: null, cardioScore: null, strain: null,
      recoveryScore: null, ecgClassification: null, bloodGlucoseMgDl: null, irregularRhythmAlerts: null,
    },
    sleep: {
      totalMinutes: null, goalMinutes: null, score: null, performance: null, efficiency: null, startTime: null, endTime: null,
      stages: [], stageTimeline: [], stageTransitions: { deep: null, light: null, rem: null, wake: null }, minutesToFallAsleep: null,
      minutesAfterWakeUp: null, timeInBed: null, minutesAwake: null,
    },
    body: { weightKg: null, weightGoalKg: null, bmi: null, bodyFat: null, waterMl: null, waterGoalMl: null, caloriesIn: null },
    trends,
    activities: [],
    insights: [],
    sync: { endpointCount: 0, successCount: 0, errors: [], rateLimitRemaining: null },
  }
}

describe('buildRecoveryModel', () => {
  it('returns null when recovery is unavailable', () => {
    expect(buildRecoveryModel(data([
      trend('2026-06-01', { steps: 3000 }),
      trend('2026-06-02', { steps: 4000 }),
    ]))).toBeNull()
  })

  it('fits a multivariable recovery model and ranks contributors', () => {
    const dashboard = data([
      trend('2026-06-01', { steps: 2000, sleepMinutes: 390, sleepEfficiency: 82, recoveryScore: 51, restingHeartRate: 61, hrvMs: 41 }),
      trend('2026-06-02', { steps: 3500, sleepMinutes: 410, sleepEfficiency: 84, recoveryScore: 57, restingHeartRate: 59, hrvMs: 46 }),
      trend('2026-06-03', { steps: 4000, sleepMinutes: 430, sleepEfficiency: 86, recoveryScore: 62, restingHeartRate: 57, hrvMs: 49 }),
      trend('2026-06-04', { steps: 5200, sleepMinutes: 450, sleepEfficiency: 89, recoveryScore: 68, restingHeartRate: 56, hrvMs: 55 }),
      trend('2026-06-05', { steps: 6100, sleepMinutes: 465, sleepEfficiency: 91, recoveryScore: 74, restingHeartRate: 54, hrvMs: 58 }),
      trend('2026-06-06', { steps: 7200, sleepMinutes: 475, sleepEfficiency: 93, recoveryScore: 79, restingHeartRate: 52, hrvMs: 63 }),
      trend('2026-06-07', { steps: 7600, sleepMinutes: 485, sleepEfficiency: 94, recoveryScore: 84, restingHeartRate: 51, hrvMs: 66 }),
    ])

    const result = buildRecoveryModel(dashboard)
    expect(result).not.toBeNull()
    expect(result?.sampleCount).toBe(7)
    expect(result?.explainedVariance).toBeGreaterThan(0.8)
    expect(result?.contributions).toHaveLength(5)
    expect(result?.contributions[0].influencePercent).toBeGreaterThan(0)
    expect(result?.points).toHaveLength(7)
    expect(result?.predictors.every((predictor) => recoveryDrivers.some((candidate) => candidate.key === predictor.key))).toBe(true)
  })
})
