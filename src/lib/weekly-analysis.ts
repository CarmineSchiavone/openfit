import type { ActivityItem, SportDetailSummary, SportGroupSummary, TrendPoint, WeeklyAggregate } from '@/types'

export type TrendMetricKey = keyof Pick<
  TrendPoint,
  | 'steps'
  | 'calories'
  | 'distanceKm'
  | 'floors'
  | 'activeMinutes'
  | 'zoneMinutes'
  | 'sedentaryMinutes'
  | 'restingHeartRate'
  | 'hrvMs'
  | 'breathingRate'
  | 'spo2'
  | 'skinTemperature'
  | 'coreTemperature'
  | 'cardioScore'
  | 'strain'
  | 'recoveryScore'
  | 'sleepPerformance'
  | 'sleepMinutes'
  | 'sleepScore'
  | 'sleepEfficiency'
  | 'weight'
  | 'bodyFat'
  | 'waterMl'
  | 'caloriesIn'
>

function parseLocalDate(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, (month || 1) - 1, day || 1, 12)
}

function isoDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function addDays(date: Date, days: number) {
  const copy = new Date(date)
  copy.setDate(copy.getDate() + days)
  return copy
}

function startOfWeekMonday(value: string) {
  const date = parseLocalDate(value)
  const day = date.getDay()
  const offset = day === 0 ? -6 : 1 - day
  return addDays(date, offset)
}

function endOfWeekMonday(value: string) {
  return addDays(startOfWeekMonday(value), 6)
}

function mean(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function standardDeviation(values: number[], average: number) {
  if (values.length <= 1) return 0
  const variance = values.reduce((sum, value) => sum + ((value - average) ** 2), 0) / values.length
  return Math.sqrt(variance)
}

function weekLabel(weekStart: string, weekEnd: string, isPartial: boolean) {
  const start = parseLocalDate(weekStart)
  const end = parseLocalDate(weekEnd)
  const short = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' })
  const long = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' })
  const base = `${long.format(start)} - ${long.format(end)}`
  return {
    short: short.format(start),
    long: isPartial ? `${base} (partial)` : base,
  }
}

export function weeklyAggregates(trends: TrendPoint[], metric: TrendMetricKey): WeeklyAggregate[] {
  const dated = trends
    .map((point) => ({ date: point.date, value: point[metric] }))
    .filter((point): point is { date: string; value: number } => point.value !== null && Number.isFinite(point.value))

  if (!dated.length) return []

  const firstDate = dated[0].date
  const lastDate = dated[dated.length - 1].date
  const firstWeekStart = isoDate(startOfWeekMonday(firstDate))
  const lastWeekEnd = isoDate(endOfWeekMonday(lastDate))
  const buckets = new Map<string, Array<{ date: string; value: number }>>()

  for (const point of dated) {
    const weekStart = isoDate(startOfWeekMonday(point.date))
    const bucket = buckets.get(weekStart) ?? []
    bucket.push(point)
    buckets.set(weekStart, bucket)
  }

  return [...buckets.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([weekStart, points]) => {
      const weekEnd = isoDate(addDays(parseLocalDate(weekStart), 6))
      const values = points.map((point) => point.value)
      const average = mean(values)
      const sd = standardDeviation(values, average)
      const { short, long } = weekLabel(weekStart, weekEnd, weekStart === firstWeekStart || weekEnd === lastWeekEnd)
      return {
        key: `${metric}-${weekStart}`,
        weekStart,
        weekEnd,
        label: long,
        shortLabel: short,
        isPartial: weekStart === firstWeekStart || weekEnd === lastWeekEnd,
        sampleCount: values.length,
        mean: average,
        sd,
        min: Math.min(...values),
        max: Math.max(...values),
        points: points.map((point) => ({
          date: point.date,
          label: point.date,
          value: point.value,
          withinSd: sd === 0 ? true : Math.abs(point.value - average) <= sd,
        })),
      }
    })
}

function averageOf(items: Array<number | null>) {
  const values = items.filter((value): value is number => value !== null && Number.isFinite(value))
  return values.length ? mean(values) : null
}

export function groupActivitiesBySport(activities: ActivityItem[]): SportGroupSummary[] {
  const grouped = new Map<string, ActivityItem[]>()
  for (const item of activities) {
    const key = item.name.trim() || 'Activity'
    const group = grouped.get(key) ?? []
    group.push(item)
    grouped.set(key, group)
  }

  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([sport, items]) => {
      const weeks = new Set(items.map((item) => isoDate(startOfWeekMonday(item.date))))
      return {
        sport,
        activityCount: items.length,
        weeksActive: weeks.size,
        averageSessionsPerWeek: items.length / Math.max(weeks.size, 1),
        averageDurationMinutes: averageOf(items.map((item) => item.durationMinutes)),
        averageHeartRate: averageOf(items.map((item) => item.averageHeartRate)),
        averageCalories: averageOf(items.map((item) => item.calories)),
        averageStrain: averageOf(items.map((item) => item.strain)),
      }
    })
}

function weeklyAggregatesFromSeries(points: Array<{ date: string; value: number | null }>, key: string): WeeklyAggregate[] {
  const dated = points.filter((point): point is { date: string; value: number } => point.value !== null && Number.isFinite(point.value))
  if (!dated.length) return []
  const firstDate = dated[0].date
  const lastDate = dated[dated.length - 1].date
  const firstWeekStart = isoDate(startOfWeekMonday(firstDate))
  const lastWeekEnd = isoDate(endOfWeekMonday(lastDate))
  const buckets = new Map<string, Array<{ date: string; value: number }>>()
  for (const point of dated) {
    const weekStart = isoDate(startOfWeekMonday(point.date))
    const bucket = buckets.get(weekStart) ?? []
    bucket.push(point)
    buckets.set(weekStart, bucket)
  }
  return [...buckets.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([weekStart, weekPoints]) => {
      const weekEnd = isoDate(addDays(parseLocalDate(weekStart), 6))
      const values = weekPoints.map((point) => point.value)
      const average = mean(values)
      const sd = standardDeviation(values, average)
      const isPartial = weekStart === firstWeekStart || weekEnd === lastWeekEnd
      const { short, long } = weekLabel(weekStart, weekEnd, isPartial)
      return {
        key: `${key}-${weekStart}`,
        weekStart,
        weekEnd,
        label: long,
        shortLabel: short,
        isPartial,
        sampleCount: values.length,
        mean: average,
        sd,
        min: Math.min(...values),
        max: Math.max(...values),
        points: weekPoints.map((point) => ({
          date: point.date,
          label: point.date,
          value: point.value,
          withinSd: sd === 0 ? true : Math.abs(point.value - average) <= sd,
        })),
      }
    })
}

export function sportDetails(activities: ActivityItem[]): SportDetailSummary[] {
  const groups = groupActivitiesBySport(activities)
  return groups.map((group) => {
    const sessions = activities
      .filter((item) => (item.name.trim() || 'Activity') === group.sport)
      .slice()
      .sort((left, right) => `${right.date}T${right.time || '00:00'}`.localeCompare(`${left.date}T${left.time || '00:00'}`))

    const weeklyDuration = weeklyAggregatesFromSeries(
      sessions.map((session) => ({ date: session.date, value: session.durationMinutes || null })),
      `${group.sport}-duration`,
    )
    const weeklyHeartRate = weeklyAggregatesFromSeries(
      sessions.map((session) => ({ date: session.date, value: session.averageHeartRate })),
      `${group.sport}-hr`,
    )

    const zoneTotals = sessions.reduce((totals, session) => {
      totals.light += session.heartZoneMinutes?.light ?? 0
      totals.moderate += session.heartZoneMinutes?.moderate ?? 0
      totals.vigorous += session.heartZoneMinutes?.vigorous ?? 0
      totals.peak += session.heartZoneMinutes?.peak ?? 0
      return totals
    }, { light: 0, moderate: 0, vigorous: 0, peak: 0 })
    const totalZoneMinutes = zoneTotals.light + zoneTotals.moderate + zoneTotals.vigorous + zoneTotals.peak
    const percentage = (value: number) => totalZoneMinutes > 0 ? (value / totalZoneMinutes) * 100 : 0

    return {
      ...group,
      sessions,
      weeklyDuration,
      weeklyHeartRate,
      zonePercentages: [
        { label: 'Light', percentage: percentage(zoneTotals.light) },
        { label: 'Moderate', percentage: percentage(zoneTotals.moderate) },
        { label: 'Vigorous', percentage: percentage(zoneTotals.vigorous) },
        { label: 'Peak', percentage: percentage(zoneTotals.peak) },
      ],
    }
  })
}
