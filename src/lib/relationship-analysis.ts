import type { DashboardData, TrendPoint } from '@/types'

export interface RelationshipVariable {
  key: string
  label: string
  unit: string
  accessor: (point: TrendPoint) => number | null
}

export interface RecoveryContribution {
  variable: RelationshipVariable
  coefficient: number
  influencePercent: number
  direction: 'positive' | 'negative'
}

export interface RecoveryModelPoint {
  date: string
  actual: number
  predicted: number
}

export interface RecoveryModelResult {
  outcome: RelationshipVariable
  predictors: RelationshipVariable[]
  sampleCount: number
  explainedVariance: number
  intercept: number
  contributions: RecoveryContribution[]
  points: RecoveryModelPoint[]
}

export const recoveryOutcome: RelationshipVariable = {
  key: 'recoveryScore',
  label: 'Recovery',
  unit: '%',
  accessor: (point) => point.recoveryScore,
}

export const recoveryDrivers: RelationshipVariable[] = [
  { key: 'steps', label: 'Steps', unit: 'steps', accessor: (point) => point.steps },
  { key: 'calories', label: 'Calories burned', unit: 'kcal', accessor: (point) => point.calories },
  { key: 'distanceKm', label: 'Distance', unit: 'km', accessor: (point) => point.distanceKm },
  { key: 'activeMinutes', label: 'Active minutes', unit: 'min', accessor: (point) => point.activeMinutes },
  { key: 'zoneMinutes', label: 'Zone minutes', unit: 'min', accessor: (point) => point.zoneMinutes },
  { key: 'sedentaryMinutes', label: 'Sedentary time', unit: 'min', accessor: (point) => point.sedentaryMinutes },
  { key: 'sleepMinutes', label: 'Sleep duration', unit: 'min', accessor: (point) => point.sleepMinutes },
  { key: 'sleepEfficiency', label: 'Sleep efficiency', unit: '%', accessor: (point) => point.sleepEfficiency },
  { key: 'sleepPerformance', label: 'Sleep score', unit: '%', accessor: (point) => point.sleepScore ?? point.sleepPerformance },
  { key: 'strain', label: 'Strain', unit: '', accessor: (point) => point.strain },
  { key: 'restingHeartRate', label: 'Resting heart rate', unit: 'bpm', accessor: (point) => point.restingHeartRate },
  { key: 'hrvMs', label: 'HRV', unit: 'ms', accessor: (point) => point.hrvMs },
  { key: 'spo2', label: 'SpO2', unit: '%', accessor: (point) => point.spo2 },
  { key: 'breathingRate', label: 'Breathing rate', unit: 'rpm', accessor: (point) => point.breathingRate },
]

function mean(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function sd(values: number[], average: number) {
  if (values.length < 2) return 0
  return Math.sqrt(values.reduce((sum, value) => sum + ((value - average) ** 2), 0) / values.length)
}

function pearson(x: number[], y: number[]) {
  if (x.length < 3 || y.length < 3 || x.length !== y.length) return null
  const meanX = mean(x)
  const meanY = mean(y)
  let covariance = 0
  let varianceX = 0
  let varianceY = 0
  for (let index = 0; index < x.length; index += 1) {
    const dx = x[index] - meanX
    const dy = y[index] - meanY
    covariance += dx * dy
    varianceX += dx * dx
    varianceY += dy * dy
  }
  if (varianceX === 0 || varianceY === 0) return null
  return covariance / Math.sqrt(varianceX * varianceY)
}

function solveLinearSystem(matrix: number[][], vector: number[]) {
  const size = vector.length
  const augmented = matrix.map((row, index) => [...row, vector[index]])
  for (let pivot = 0; pivot < size; pivot += 1) {
    let maxRow = pivot
    for (let row = pivot + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][pivot]) > Math.abs(augmented[maxRow][pivot])) maxRow = row
    }
    if (Math.abs(augmented[maxRow][pivot]) < 1e-9) return null
    ;[augmented[pivot], augmented[maxRow]] = [augmented[maxRow], augmented[pivot]]
    const pivotValue = augmented[pivot][pivot]
    for (let column = pivot; column <= size; column += 1) augmented[pivot][column] /= pivotValue
    for (let row = 0; row < size; row += 1) {
      if (row === pivot) continue
      const factor = augmented[row][pivot]
      for (let column = pivot; column <= size; column += 1) augmented[row][column] -= factor * augmented[pivot][column]
    }
  }
  return augmented.map((row) => row[size])
}

export function buildRecoveryModel(data: DashboardData): RecoveryModelResult | null {
  const candidates = recoveryDrivers.flatMap((variable) => {
    const paired = data.trends.flatMap((point) => {
      const driver = variable.accessor(point)
      const outcome = recoveryOutcome.accessor(point)
      return driver !== null && Number.isFinite(driver) && outcome !== null && Number.isFinite(outcome)
        ? [{ driver, outcome, date: point.date }]
        : []
    })
    if (paired.length < 5) return []
    const correlation = pearson(paired.map((item) => item.driver), paired.map((item) => item.outcome))
    if (correlation === null) return []
    return [{ variable, correlation, paired }]
  })

  if (!candidates.length) return null

  const predictors = candidates
    .sort((left, right) => Math.abs(right.correlation) - Math.abs(left.correlation))
    .slice(0, 5)
    .map((item) => item.variable)

  const rows = data.trends.flatMap((point) => {
    const outcome = recoveryOutcome.accessor(point)
    if (outcome === null || !Number.isFinite(outcome)) return []
    const values = predictors.map((predictor) => predictor.accessor(point))
    return values.every((value) => value !== null && Number.isFinite(value))
      ? [{ date: point.date, outcome, predictors: values as number[] }]
      : []
  })

  if (rows.length < Math.max(6, predictors.length + 2)) return null

  const predictorMeans = predictors.map((_, index) => mean(rows.map((row) => row.predictors[index])))
  const predictorSds = predictors.map((_, index) => sd(rows.map((row) => row.predictors[index]), predictorMeans[index]))
  if (predictorSds.some((value) => value === 0)) return null
  const outcomeMean = mean(rows.map((row) => row.outcome))
  const outcomeSd = sd(rows.map((row) => row.outcome), outcomeMean)
  if (outcomeSd === 0) return null

  const standardizedX = rows.map((row) => row.predictors.map((value, index) => (value - predictorMeans[index]) / predictorSds[index]))
  const standardizedY = rows.map((row) => (row.outcome - outcomeMean) / outcomeSd)

  const featureCount = predictors.length + 1
  const xtx = Array.from({ length: featureCount }, () => Array.from({ length: featureCount }, () => 0))
  const xty = Array.from({ length: featureCount }, () => 0)
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const features = [1, ...standardizedX[rowIndex]]
    for (let i = 0; i < featureCount; i += 1) {
      xty[i] += features[i] * standardizedY[rowIndex]
      for (let j = 0; j < featureCount; j += 1) xtx[i][j] += features[i] * features[j]
    }
  }

  const coefficients = solveLinearSystem(xtx, xty)
  if (!coefficients) return null

  const standardizedIntercept = coefficients[0]
  const standardizedCoefficients = coefficients.slice(1)
  const points = rows.map((row, index) => {
    const standardizedPrediction = standardizedIntercept + standardizedX[index].reduce((sum, value, valueIndex) => sum + value * standardizedCoefficients[valueIndex], 0)
    return {
      date: row.date,
      actual: row.outcome,
      predicted: outcomeMean + standardizedPrediction * outcomeSd,
    }
  })

  const actual = points.map((point) => point.actual)
  const predicted = points.map((point) => point.predicted)
  const actualMean = mean(actual)
  const ssTotal = actual.reduce((sum, value) => sum + ((value - actualMean) ** 2), 0)
  const ssResidual = actual.reduce((sum, value, index) => sum + ((value - predicted[index]) ** 2), 0)
  const explainedVariance = ssTotal === 0 ? 0 : Math.max(0, 1 - (ssResidual / ssTotal))

  const totalInfluence = standardizedCoefficients.reduce((sum, value) => sum + Math.abs(value), 0) || 1
  const contributions = predictors.map((variable, index) => ({
    variable,
    coefficient: standardizedCoefficients[index],
    influencePercent: Math.abs(standardizedCoefficients[index]) / totalInfluence,
    direction: standardizedCoefficients[index] >= 0 ? 'positive' as const : 'negative' as const,
  })).sort((left, right) => Math.abs(right.coefficient) - Math.abs(left.coefficient))

  const intercept = outcomeMean - predictors.reduce((sum, _variable, index) => sum + ((predictorMeans[index] / predictorSds[index]) * standardizedCoefficients[index] * outcomeSd), 0)

  return {
    outcome: recoveryOutcome,
    predictors,
    sampleCount: rows.length,
    explainedVariance,
    intercept,
    contributions,
    points,
  }
}
