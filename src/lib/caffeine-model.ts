import type {
  AnalysisRange,
  CaffeineCurvePoint,
  CaffeineDayModel,
  CaffeineEntry,
  CaffeinePreset,
  CaffeineSummary,
  LifestyleData,
  LifestyleProfile,
} from '@/types'

export interface LifestyleSubjectMetrics {
  weightKg: number | null
  bodyFatPercent: number | null
}

export interface LifestyleAnalytics {
  selectedDay: CaffeineDayModel
  rangeDays: CaffeineDayModel[]
  summariesByDate: Map<string, CaffeineSummary>
  totalIntakeSeries: Array<{ date: string; value: number }>
  bedtimeSeries: Array<{ date: string; value: number }>
  peakPlasmaSeries: Array<{ date: string; value: number }>
  carryoverSeries: Array<{ date: string; value: number }>
  averageTotalIntakeMg: number | null
  averageBedtimeCaffeineMg: number | null
}

type SolverState = {
  gutDepotMg: number
  arterialMgPerL: number
  venousMgPerL: number
  liverMgPerL: number
  brainMgPerL: number
  heartMgPerL: number
  restMgPerL: number
}

type SimulatedDay = CaffeineDayModel & {
  finalState: SolverState
}

type PhysiologicalModel = {
  volumesL: {
    arterial: number
    venous: number
    brain: number
    heart: number
    liver: number
    rest: number
  }
  flowsLPerHour: {
    cardiacOutput: number
    brain: number
    heart: number
    liver: number
    rest: number
  }
  partitionCoefficients: {
    brain: number
    heart: number
    liver: number
    rest: number
  }
  kaPerHour: number
  hepaticClearanceLPerHour: number
}

const INPUT_SLOT_MINUTES = 60
const SOLVER_STEP_MINUTES = 1
const SOLVER_SUBSTEPS = 12
const OUTPUT_STEP_MINUTES = 10
const DAY_MINUTES = 24 * 60
const BEDTIME_MINUTE = 22 * 60
const MOLECULAR_WEIGHT_CAFFEINE_G_PER_MOL = 194.19
const MICROMOL_PER_L_TO_UG_PER_ML = MOLECULAR_WEIGHT_CAFFEINE_G_PER_MOL / 1000
// Baur et al. 2024, Journal of Sleep Research (https://onlinelibrary.wiley.com/doi/10.1111/jsr.14140)
// reported EEG delta-power changes above ~7.4 umol/L during sleep. Because 1 mg/L == 1 ug/mL,
// this becomes about 1.44 ug/mL for a conservative bedtime plasma target line.
export const CAFFEINE_SLEEP_PLASMA_TARGET_UG_ML = Number((7.4 * MICROMOL_PER_L_TO_UG_PER_ML).toFixed(2))

const INPUT_STEPS_PER_DAY = DAY_MINUTES / INPUT_SLOT_MINUTES
const SOLVER_STEPS_PER_DAY = DAY_MINUTES / SOLVER_STEP_MINUTES
const OUTPUT_STEPS_PER_DAY = DAY_MINUTES / OUTPUT_STEP_MINUTES

export const caffeinePresets: CaffeinePreset[] = [
  { id: 'espresso', label: 'Espresso', serving: '1 shot', caffeineMg: 75 },
  { id: 'double-espresso', label: 'Double espresso', serving: '2 shots', caffeineMg: 150 },
  { id: 'americano', label: 'Americano', serving: '1 cup', caffeineMg: 95 },
  { id: 'monster', label: 'Monster Energy', serving: '500 ml can', caffeineMg: 160 },
  { id: 'red-bull', label: 'Red Bull', serving: '250 ml can', caffeineMg: 80 },
  { id: 'coke-250', label: 'Coke', serving: '250 ml', caffeineMg: 25 },
  { id: 'tea', label: 'Black tea', serving: '1 cup', caffeineMg: 47 },
  { id: 'pre-workout', label: 'Pre-workout', serving: '1 scoop', caffeineMg: 200 },
  { id: 'custom', label: 'Custom', serving: 'Custom dose', caffeineMg: 100 },
]

export const caffeineTimeSlots = Array.from({ length: INPUT_STEPS_PER_DAY }, (_, index) => {
  const minuteOfDay = index * INPUT_SLOT_MINUTES
  return formatSlot(minuteOfDay)
})

const plotSlots = Array.from({ length: OUTPUT_STEPS_PER_DAY + 1 }, (_, index) => {
  const minuteOfDay = Math.min(index * OUTPUT_STEP_MINUTES, DAY_MINUTES)
  return {
    minuteOfDay,
    time: formatSlot(minuteOfDay === DAY_MINUTES ? DAY_MINUTES - OUTPUT_STEP_MINUTES : minuteOfDay),
  }
})

export function defaultLifestyleData(): LifestyleData {
  return {
    profile: {
      sex: 'male',
      smokingStatus: 'non-smoker',
      bodyComposition: 'average',
      bodyFatPercentOverride: null,
    },
    caffeineEntriesByDate: {},
    lastUpdatedAt: null,
  }
}

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

function addDays(value: string, days: number) {
  const next = parseLocalDate(value)
  next.setDate(next.getDate() + days)
  return isoDate(next)
}

function minuteOfDay(slot: string) {
  const [hours, minutes] = slot.split(':').map(Number)
  return hours * 60 + minutes
}

function formatSlot(minute: number) {
  const hours = String(Math.floor(minute / 60)).padStart(2, '0')
  const minutes = String(minute % 60).padStart(2, '0')
  return `${hours}:${minutes}`
}

function resolvedWeightKg(subject: LifestyleSubjectMetrics) {
  return subject.weightKg !== null && Number.isFinite(subject.weightKg) ? Math.max(35, subject.weightKg) : 75
}

function resolvedBodyFatFraction(profile: LifestyleProfile, subject: LifestyleSubjectMetrics) {
  if (profile.bodyComposition === 'lean') return 0.14
  if (profile.bodyComposition === 'high-body-fat') return 0.30
  return 0.22
}

function buildPhysiologicalModel(profile: LifestyleProfile, subject: LifestyleSubjectMetrics): PhysiologicalModel {
  const weightKg = resolvedWeightKg(subject)
  const bodyFatFraction = resolvedBodyFatFraction(profile, subject)
  const leanMassKg = Math.max(20, weightKg * (1 - bodyFatFraction))
  const bodyVolumeL = weightKg

  const maleReference = {
    weightKg: 70,
    cardiacOutput: 390,
    arterial: 1.4,
    venous: 4.2,
    brain: 1.45,
    heart: 0.31,
    liver: 1.8,
    brainFlow: 47,
    heartFlow: 16,
    liverFlow: 97,
  }
  const femaleReference = {
    weightKg: 60,
    cardiacOutput: 330,
    arterial: 1.2,
    venous: 3.6,
    brain: 1.3,
    heart: 0.24,
    liver: 1.45,
    brainFlow: 40,
    heartFlow: 13,
    liverFlow: 83,
  }
  const reference = profile.sex === 'female' ? femaleReference : maleReference
  const scale = weightKg / reference.weightKg

  const arterial = reference.arterial * scale
  const venous = reference.venous * scale
  const brain = reference.brain * scale
  const heart = reference.heart * scale
  const liver = reference.liver * scale
  const rest = Math.max(10, bodyVolumeL - arterial - venous - brain - heart - liver)

  const cardiacOutput = reference.cardiacOutput * scale
  const brainFlow = reference.brainFlow * scale
  const heartFlow = reference.heartFlow * scale
  const liverFlow = reference.liverFlow * scale
  const restFlow = Math.max(40, cardiacOutput - brainFlow - heartFlow - liverFlow)

  const clearancePerKg = profile.smokingStatus === 'smoker'
    ? profile.sex === 'female' ? 0.160 : 0.155
    : profile.sex === 'female' ? 0.095 : 0.094

  return {
    volumesL: { arterial, venous, brain, heart, liver, rest },
    flowsLPerHour: {
      cardiacOutput,
      brain: brainFlow,
      heart: heartFlow,
      liver: liverFlow,
      rest: restFlow,
    },
    partitionCoefficients: {
      brain: 0.95,
      heart: 0.90,
      liver: 0.90,
      rest: 0.85 + Math.max(-0.05, Math.min(0.08, (0.22 - bodyFatFraction) * 0.35)),
    },
    kaPerHour: 4.0,
    hepaticClearanceLPerHour: clearancePerKg * leanMassKg,
  }
}

function zeroState(): SolverState {
  return {
    gutDepotMg: 0,
    arterialMgPerL: 0,
    venousMgPerL: 0,
    liverMgPerL: 0,
    brainMgPerL: 0,
    heartMgPerL: 0,
    restMgPerL: 0,
  }
}

function totalAmountMg(state: SolverState, model: PhysiologicalModel) {
  const { volumesL } = model
  return state.gutDepotMg
    + (state.arterialMgPerL * volumesL.arterial)
    + (state.venousMgPerL * volumesL.venous)
    + (state.liverMgPerL * volumesL.liver)
    + (state.brainMgPerL * volumesL.brain)
    + (state.heartMgPerL * volumesL.heart)
    + (state.restMgPerL * volumesL.rest)
}

function evolveState(state: SolverState, model: PhysiologicalModel, dtHours: number): SolverState {
  // Adapted from the attached seven-compartment caffeine PBPK sketch:
  // gut depot -> liver absorption, then arterial / venous blood, liver, brain,
  // heart, and a lumped rest-of-body tissue compartment with hepatic clearance.
  const { volumesL, flowsLPerHour, partitionCoefficients, kaPerHour, hepaticClearanceLPerHour } = model
  const absorbedMgPerHour = kaPerHour * state.gutDepotMg

  const dGut = -absorbedMgPerHour
  const dArterial = (flowsLPerHour.cardiacOutput * state.venousMgPerL - flowsLPerHour.cardiacOutput * state.arterialMgPerL) / volumesL.arterial
  const dVenous = (
    (flowsLPerHour.brain * state.brainMgPerL / partitionCoefficients.brain)
    + (flowsLPerHour.heart * state.heartMgPerL / partitionCoefficients.heart)
    + (flowsLPerHour.liver * state.liverMgPerL / partitionCoefficients.liver)
    + (flowsLPerHour.rest * state.restMgPerL / partitionCoefficients.rest)
    - (flowsLPerHour.cardiacOutput * state.venousMgPerL)
  ) / volumesL.venous
  const dBrain = flowsLPerHour.brain * (state.arterialMgPerL - state.brainMgPerL / partitionCoefficients.brain) / volumesL.brain
  const dHeart = flowsLPerHour.heart * (state.arterialMgPerL - state.heartMgPerL / partitionCoefficients.heart) / volumesL.heart
  const dLiver = (
    flowsLPerHour.liver * (state.arterialMgPerL - state.liverMgPerL / partitionCoefficients.liver)
    + absorbedMgPerHour
    - hepaticClearanceLPerHour * state.liverMgPerL / partitionCoefficients.liver
  ) / volumesL.liver
  const dRest = flowsLPerHour.rest * (state.arterialMgPerL - state.restMgPerL / partitionCoefficients.rest) / volumesL.rest

  return {
    gutDepotMg: Math.max(0, state.gutDepotMg + (dGut * dtHours)),
    arterialMgPerL: Math.max(0, state.arterialMgPerL + (dArterial * dtHours)),
    venousMgPerL: Math.max(0, state.venousMgPerL + (dVenous * dtHours)),
    liverMgPerL: Math.max(0, state.liverMgPerL + (dLiver * dtHours)),
    brainMgPerL: Math.max(0, state.brainMgPerL + (dBrain * dtHours)),
    heartMgPerL: Math.max(0, state.heartMgPerL + (dHeart * dtHours)),
    restMgPerL: Math.max(0, state.restMgPerL + (dRest * dtHours)),
  }
}

function simulateDay(
  date: string,
  entries: CaffeineEntry[],
  profile: LifestyleProfile,
  subject: LifestyleSubjectMetrics,
  initialState: SolverState,
): SimulatedDay {
  const model = buildPhysiologicalModel(profile, subject)
  const dosesByMinute = new Map<number, number>()
  for (const entry of entries) {
    const minute = minuteOfDay(entry.timeSlot)
    dosesByMinute.set(minute, (dosesByMinute.get(minute) ?? 0) + entry.amountMg)
  }

  let state = { ...initialState }
  const curve: CaffeineCurvePoint[] = []
  const dtHours = (SOLVER_STEP_MINUTES / 60) / SOLVER_SUBSTEPS

  for (let step = 0; step <= SOLVER_STEPS_PER_DAY; step += 1) {
    const minute = Math.min(step * SOLVER_STEP_MINUTES, DAY_MINUTES)
    const dose = dosesByMinute.get(minute) ?? 0
    if (dose > 0) state.gutDepotMg += dose

    if (minute % OUTPUT_STEP_MINUTES === 0 || minute === DAY_MINUTES) {
      curve.push({
        time: formatSlot(minute === DAY_MINUTES ? DAY_MINUTES - OUTPUT_STEP_MINUTES : minute),
        minuteOfDay: minute,
        plasma: Number(state.venousMgPerL.toFixed(4)),
        brain: Number(state.brainMgPerL.toFixed(4)),
        heart: Number(state.heartMgPerL.toFixed(4)),
        remainingTissue: Number(state.restMgPerL.toFixed(4)),
        total: Number(totalAmountMg(state, model).toFixed(2)),
      })
    }

    if (step < SOLVER_STEPS_PER_DAY) {
      for (let substep = 0; substep < SOLVER_SUBSTEPS; substep += 1) {
        state = evolveState(state, model, dtHours)
      }
    }
  }

  const bedtimePoint = curve.find((point) => point.minuteOfDay >= BEDTIME_MINUTE) ?? curve.at(-1)!
  const peakPlasma = curve.reduce((peak, point) => Math.max(peak, point.plasma), 0)
  const dailyExposure = curve.slice(1).reduce((sum, point, index) => {
    const previous = curve[index]
    return sum + (((previous.plasma + point.plasma) / 2) * (OUTPUT_STEP_MINUTES / 60))
  }, 0)

  return {
    date,
    entries,
    curve,
    finalState: state,
    summary: {
      date,
      totalIntakeMg: entries.reduce((sum, entry) => sum + entry.amountMg, 0),
      bedtimeCaffeineMg: Number(bedtimePoint.plasma.toFixed(4)),
      peakPlasmaMg: Number(peakPlasma.toFixed(4)),
      midnightCarryoverMg: Number(totalAmountMg(state, model).toFixed(2)),
      dailyExposureMgHours: Number(dailyExposure.toFixed(2)),
    },
  }
}

function zeroDay(date: string, entries: CaffeineEntry[] = []): SimulatedDay {
  const curve = plotSlots.map((slot) => ({
    time: slot.time,
    minuteOfDay: slot.minuteOfDay,
    plasma: 0,
    brain: 0,
    heart: 0,
    remainingTissue: 0,
    total: 0,
  }))
  return {
    date,
    entries,
    curve,
    finalState: zeroState(),
    summary: {
      date,
      totalIntakeMg: 0,
      bedtimeCaffeineMg: 0,
      peakPlasmaMg: 0,
      midnightCarryoverMg: 0,
      dailyExposureMgHours: 0,
    },
  }
}

function mean(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

export function buildLifestyleAnalytics(
  lifestyle: LifestyleData,
  selectedDate: string,
  range: AnalysisRange,
  subject: LifestyleSubjectMetrics = { weightKg: null, bodyFatPercent: null },
): LifestyleAnalytics {
  const normalized = lifestyle ?? defaultLifestyleData()
  const effectiveRangeEnd = selectedDate > range.endDate ? selectedDate : range.endDate
  const earliestLoggedDate = Object.keys(normalized.caffeineEntriesByDate).sort()[0] ?? selectedDate
  const startDate = earliestLoggedDate < range.startDate ? earliestLoggedDate : range.startDate
  const endDate = effectiveRangeEnd
  const days: SimulatedDay[] = []
  let date = startDate
  let carryover = zeroState()
  let previousDateHadEntries = false

  while (date <= endDate) {
    const entries = [...(normalized.caffeineEntriesByDate[date] ?? [])].sort((left, right) => left.timeSlot.localeCompare(right.timeSlot))
    const day = entries.length
      ? simulateDay(date, entries, normalized.profile, subject, previousDateHadEntries ? carryover : zeroState())
      : zeroDay(date)
    days.push(day)
    carryover = day.finalState
    previousDateHadEntries = entries.length > 0
    date = addDays(date, 1)
  }

  const selectedDay = days.find((dayModel) => dayModel.date === selectedDate) ?? zeroDay(selectedDate)
  const rangeDays = days.filter((dayModel) => dayModel.date >= range.startDate && dayModel.date <= effectiveRangeEnd)
  const summariesByDate = new Map(rangeDays.map((dayModel) => [dayModel.date, dayModel.summary]))
  const totalIntakeSeries = rangeDays.map((dayModel) => ({ date: dayModel.date, value: dayModel.summary.totalIntakeMg }))
  const bedtimeSeries = rangeDays.map((dayModel) => ({ date: dayModel.date, value: dayModel.summary.bedtimeCaffeineMg }))
  const peakPlasmaSeries = rangeDays.map((dayModel) => ({ date: dayModel.date, value: dayModel.summary.peakPlasmaMg }))
  const carryoverSeries = rangeDays.map((dayModel) => ({ date: dayModel.date, value: dayModel.summary.midnightCarryoverMg }))

  return {
    selectedDay,
    rangeDays,
    summariesByDate,
    totalIntakeSeries,
    bedtimeSeries,
    peakPlasmaSeries,
    carryoverSeries,
    averageTotalIntakeMg: rangeDays.length ? Number(mean(totalIntakeSeries.map((point) => point.value)).toFixed(1)) : null,
    averageBedtimeCaffeineMg: rangeDays.length ? Number(mean(bedtimeSeries.map((point) => point.value)).toFixed(2)) : null,
  }
}
