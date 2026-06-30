import { describe, expect, it } from 'vitest'
import type { LifestyleData } from '@/types'
import { buildLifestyleAnalytics, defaultLifestyleData } from './caffeine-model'

function lifestyleWithEntries(entriesByDate: LifestyleData['caffeineEntriesByDate']): LifestyleData {
  return {
    ...defaultLifestyleData(),
    caffeineEntriesByDate: entriesByDate,
  }
}

describe('caffeine lifestyle model', () => {
  it('starts at zero when there is no prior history', () => {
    const analytics = buildLifestyleAnalytics(defaultLifestyleData(), '2026-06-10', { startDate: '2026-06-10', endDate: '2026-06-10' })
    expect(analytics.selectedDay.summary.midnightCarryoverMg).toBe(0)
    expect(analytics.selectedDay.curve.every((point) => point.total === 0)).toBe(true)
    expect(analytics.selectedDay.curve[0]?.time).toBe('00:00')
    expect(analytics.selectedDay.curve[1]?.time).toBe('00:10')
  })

  it('uses prior-day carryover when the previous day had entries', () => {
    const analytics = buildLifestyleAnalytics(lifestyleWithEntries({
      '2026-06-10': [{ id: 'a', date: '2026-06-10', timeSlot: '18:00', presetId: 'espresso', amountMg: 150 }],
      '2026-06-11': [{ id: 'b', date: '2026-06-11', timeSlot: '08:00', presetId: 'espresso', amountMg: 75 }],
    }), '2026-06-11', { startDate: '2026-06-10', endDate: '2026-06-11' })

    expect(analytics.rangeDays[0].summary.midnightCarryoverMg).toBeGreaterThan(0)
    expect(analytics.selectedDay.curve[0].total).toBeGreaterThan(0)
  })

  it('treats missing days as zero-intake days and resets carryover propagation', () => {
    const analytics = buildLifestyleAnalytics(lifestyleWithEntries({
      '2026-06-10': [{ id: 'a', date: '2026-06-10', timeSlot: '20:00', presetId: 'espresso', amountMg: 200 }],
      '2026-06-12': [{ id: 'b', date: '2026-06-12', timeSlot: '08:00', presetId: 'espresso', amountMg: 75 }],
    }), '2026-06-12', { startDate: '2026-06-10', endDate: '2026-06-12' })

    const missingDay = analytics.rangeDays.find((day) => day.date === '2026-06-11')
    expect(missingDay?.summary.totalIntakeMg).toBe(0)
    expect(analytics.selectedDay.curve[0].total).toBe(0)
  })

  it('combines multiple same-day intake events', () => {
    const analytics = buildLifestyleAnalytics(lifestyleWithEntries({
      '2026-06-10': [
        { id: 'a', date: '2026-06-10', timeSlot: '08:00', presetId: 'espresso', amountMg: 80 },
        { id: 'b', date: '2026-06-10', timeSlot: '14:00', presetId: 'coke-250', amountMg: 25 },
      ],
    }), '2026-06-10', { startDate: '2026-06-10', endDate: '2026-06-10' })

    expect(analytics.selectedDay.summary.totalIntakeMg).toBe(105)
    expect(analytics.selectedDay.summary.peakPlasmaMg).toBeGreaterThan(0.001)
    expect(analytics.selectedDay.summary.dailyExposureMgHours).toBeGreaterThan(5)
  })

  it('makes smokers clear caffeine faster than non-smokers', () => {
    const nonSmoker = buildLifestyleAnalytics(lifestyleWithEntries({
      '2026-06-10': [{ id: 'a', date: '2026-06-10', timeSlot: '16:00', presetId: 'monster', amountMg: 160 }],
    }), '2026-06-10', { startDate: '2026-06-10', endDate: '2026-06-10' })

    const smokerData = lifestyleWithEntries({
      '2026-06-10': [{ id: 'a', date: '2026-06-10', timeSlot: '16:00', presetId: 'monster', amountMg: 160 }],
    })
    smokerData.profile.smokingStatus = 'smoker'
    const smoker = buildLifestyleAnalytics(smokerData, '2026-06-10', { startDate: '2026-06-10', endDate: '2026-06-10' })

    expect(smoker.selectedDay.summary.midnightCarryoverMg).toBeLessThan(nonSmoker.selectedDay.summary.midnightCarryoverMg)
    expect(smoker.selectedDay.summary.bedtimeCaffeineMg).toBeLessThan(nonSmoker.selectedDay.summary.bedtimeCaffeineMg)
  })

  it('changes distribution directionally with body composition and keeps sex effects bounded', () => {
    const leanData = lifestyleWithEntries({
      '2026-06-10': [{ id: 'a', date: '2026-06-10', timeSlot: '09:00', presetId: 'americano', amountMg: 95 }],
    })
    leanData.profile.bodyComposition = 'lean'
    const lean = buildLifestyleAnalytics(leanData, '2026-06-10', { startDate: '2026-06-10', endDate: '2026-06-10' })

    const higherFatData = lifestyleWithEntries({
      '2026-06-10': [{ id: 'a', date: '2026-06-10', timeSlot: '09:00', presetId: 'americano', amountMg: 95 }],
    })
    higherFatData.profile.bodyComposition = 'high-body-fat'
    higherFatData.profile.sex = 'female'
    const higherFat = buildLifestyleAnalytics(higherFatData, '2026-06-10', { startDate: '2026-06-10', endDate: '2026-06-10' })

    const leanCarryover = lean.selectedDay.summary.midnightCarryoverMg
    const higherFatCarryover = higherFat.selectedDay.summary.midnightCarryoverMg

    expect(higherFatCarryover).toBeGreaterThan(leanCarryover)
    expect(Math.abs(higherFatCarryover - leanCarryover)).toBeLessThan(30)
  })
})
