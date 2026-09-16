import {
  applyOperations,
  proposalSchema,
  snapshotSchema,
} from "@workspace/domain"
import type {
  DayEvent,
  MeasurementInput,
  Operation,
  Profile,
  Proposal,
  Snapshot,
} from "@workspace/domain"

export const isSampleMode =
  import.meta.env.DEV && import.meta.env.VITE_DEMO_MODE === "true"
export const localDate = (
  timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())
export const currentTime = (timezone: string) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date())
const sampleKey = "beckett.sample.v2"
function initialSample(): Snapshot {
  const date = localDate("America/New_York")
  return {
    profile: {
      id: "sample-child",
      name: "Beckett",
      birthDate: null,
      sex: "male",
      timezone: "America/New_York",
      dailyGoalOz: 28,
    },
    day: {
      date,
      goalOz: 28,
      version: 0,
      events: [
        {
          id: "00000000-0000-4000-8000-000000000001",
          type: "feed",
          time: "07:00",
          endTime: null,
          amountOz: 5,
          note: "A bright and early start",
          status: "completed",
        },
        {
          id: "00000000-0000-4000-8000-000000000002",
          type: "sleep",
          time: "08:30",
          endTime: "09:45",
          amountOz: null,
          note: "",
          status: "completed",
        },
        {
          id: "00000000-0000-4000-8000-000000000003",
          type: "feed",
          time: "10:00",
          endTime: null,
          amountOz: 5,
          note: "",
          status: "completed",
        },
        {
          id: "00000000-0000-4000-8000-000000000004",
          type: "note",
          time: "10:40",
          endTime: null,
          amountOz: null,
          note: "A little fresh air and lots of smiles.",
          status: "completed",
        },
        {
          id: "00000000-0000-4000-8000-000000000005",
          type: "sleep",
          time: "11:30",
          endTime: "12:15",
          amountOz: null,
          note: "",
          status: "completed",
        },
        {
          id: "00000000-0000-4000-8000-000000000006",
          type: "feed",
          time: "13:00",
          endTime: null,
          amountOz: 4.5,
          note: "",
          status: "completed",
        },
        {
          id: "00000000-0000-4000-8000-000000000007",
          type: "sleep",
          time: "14:15",
          endTime: "15:30",
          amountOz: null,
          note: "Afternoon nap",
          status: "planned",
        },
        {
          id: "00000000-0000-4000-8000-000000000008",
          type: "feed",
          time: "16:00",
          endTime: null,
          amountOz: 5,
          note: "",
          status: "planned",
        },
      ],
    },
    measurements: [],
    history: [],
  }
}
function getSample(date?: string): Snapshot {
  let state: Snapshot
  try {
    const parsed = snapshotSchema.safeParse(
      JSON.parse(localStorage.getItem(sampleKey) || "null")
    )
    state = parsed.success ? parsed.data : initialSample()
  } catch {
    state = initialSample()
  }
  if (date && date !== state.day.date) {
    const oldDay = state.day
    state.day = state.history.find((d) => d.date === date) || {
      date,
      goalOz: state.profile.dailyGoalOz,
      version: 0,
      events: [],
    }
    state.history = [
      ...state.history.filter((d) => d.date !== date && d.date !== oldDay.date),
      oldDay,
    ]
  }
  return state
}
function saveSample(state: Snapshot) {
  localStorage.setItem(sampleKey, JSON.stringify(state))
  return state
}

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}
export function createApi(getToken?: () => Promise<string | null>) {
  async function request<T>(
    path: string,
    method = "GET",
    body?: unknown
  ): Promise<T> {
    const token = await getToken?.()
    const response = await fetch(`/api/${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    const payload = await response.json().catch(() => {
      throw new ApiError(
        "The server did not return a valid response. Check your connection and try again.",
        response.status
      )
    })
    if (!response.ok)
      throw new ApiError(
        payload.error || "Something went wrong. Please try again.",
        response.status
      )
    const parsed = path.startsWith("interpret")
      ? proposalSchema.safeParse(payload)
      : snapshotSchema.safeParse(payload)
    if (!parsed.success)
      throw new ApiError(
        "The server returned incomplete data. Please try again.",
        502
      )
    return parsed.data as T
  }
  return {
    state: (date?: string) =>
      isSampleMode
        ? Promise.resolve(saveSample(getSample(date)))
        : request<Snapshot>(`state${date ? `?date=${date}` : ""}`),
    events: (
      date: string,
      version: number,
      operations: Operation[],
      requestId: string
    ) => {
      if (!isSampleMode)
        return request<Snapshot>("events", "POST", {
          date,
          version,
          operations,
          requestId,
        })
      const state = getSample(date)
      if (state.day.version !== version)
        return Promise.reject(
          new ApiError("This sample day changed. Refresh and try again.", 409)
        )
      state.day.events = applyOperations(state.day.events, operations, () =>
        crypto.randomUUID()
      )
      state.day.version++
      return Promise.resolve(saveSample(state))
    },
    interpret: (date: string, text: string, version: number) =>
      isSampleMode
        ? Promise.resolve(sampleInterpret(text))
        : request<Proposal>("interpret", "POST", { date, text, version }),
    profile: (profile: Omit<Profile, "id">, date: string) => {
      if (!isSampleMode)
        return request<Snapshot>(`profile?date=${date}`, "PATCH", profile)
      const state = getSample(date)
      const today = localDate(profile.timezone)
      const updateDay = (day: Snapshot["day"]) =>
        day.date >= today
          ? { ...day, goalOz: profile.dailyGoalOz, version: day.version + 1 }
          : day
      state.profile = { ...profile, id: "sample-child" }
      state.day = updateDay(state.day)
      state.history = state.history.map(updateDay)
      return Promise.resolve(saveSample(state))
    },
    measurement: (measurement: MeasurementInput, date: string) => {
      if (!isSampleMode)
        return request<Snapshot>(
          `measurements?date=${date}`,
          "POST",
          measurement
        )
      const state = getSample(date)
      state.measurements.push({
        headCm: null,
        source: "",
        note: "",
        needsReview: false,
        ...measurement,
        id: crypto.randomUUID(),
      })
      return Promise.resolve(saveSample(state))
    },
    updateMeasurement: (
      id: string,
      measurement: MeasurementInput,
      date: string
    ) => {
      if (!isSampleMode)
        return request<Snapshot>(
          `measurements?id=${encodeURIComponent(id)}&date=${date}`,
          "PATCH",
          measurement
        )
      const state = getSample(date)
      state.measurements = state.measurements.map((m) =>
        m.id === id ? { ...m, ...measurement } : m
      )
      return Promise.resolve(saveSample(state))
    },
    deleteMeasurement: (id: string, date: string) => {
      if (!isSampleMode)
        return request<Snapshot>(
          `measurements?id=${encodeURIComponent(id)}&date=${date}`,
          "DELETE"
        )
      const state = getSample(date)
      state.measurements = state.measurements.filter((m) => m.id !== id)
      return Promise.resolve(saveSample(state))
    },
  }
}

function sampleInterpret(text: string): Proposal {
  const amount = text.match(/(\d+(?:\.\d+)?)\s*(?:oz|ounces?)/i)
  const times = [...text.matchAll(/\b(\d{1,2}):(\d{2})\s*(am|pm)?\b/gi)]
  const time = (index: number) => {
    const match = times[index]!
    let hours = Number(match[1])
    if (match[3]?.toLowerCase() === "pm" && hours < 12) hours += 12
    if (match[3]?.toLowerCase() === "am" && hours === 12) hours = 0
    return `${String(hours).padStart(2, "0")}:${match[2]}`
  }
  const operations: Operation[] = []
  if (
    times.some(
      (match) =>
        !match[3] && !match[1]?.startsWith("0") && Number(match[1]) <= 12
    )
  )
    return {
      summary: "Let’s make sure the time is right.",
      questions: ["Was that am or pm? Add am/pm to the time in your message."],
      operations: [],
    }
  if (amount && times.length === 1 && !/sleep|slept|nap/i.test(text))
    operations.push({
      action: "add",
      event: {
        type: "feed",
        time: time(0),
        endTime: null,
        amountOz: Number(amount[1]),
        note: "",
        status: "completed",
      },
    })
  else if (/sleep|slept|nap/i.test(text) && times.length === 2 && !amount)
    operations.push({
      action: "add",
      event: {
        type: "sleep",
        time: time(0),
        endTime: time(1),
        amountOz: null,
        note: "",
        status: "completed",
      },
    })
  return {
    summary: operations.length
      ? "Sample preview — review this update."
      : "Sample preview uses a limited local parser. Full conversational interpretation requires the configured AI service.",
    questions: operations.length
      ? []
      : [
          "Try “5 oz at 08:15” or “slept from 09:30 to 10:45”, or use Add manually.",
        ],
    operations,
  }
}

export const eventLabel = (event: DayEvent) =>
  event.type === "feed"
    ? `${event.amountOz} oz bottle`
    : event.type === "sleep"
      ? event.endTime
        ? "Nap time"
        : "Sleep started"
      : event.note
export const formatTime = (time: string) => {
  const [hours, minutes] = time.split(":").map(Number)
  return `${hours! % 12 || 12}:${String(minutes).padStart(2, "0")} ${hours! >= 12 ? "pm" : "am"}`
}
export const durationMinutes = (start: string, end: string) => {
  const mins = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3))
  return (mins(end) - mins(start) + 1440) % 1440
}
export const formatDuration = (minutes: number) =>
  `${Math.floor(minutes / 60) ? `${Math.floor(minutes / 60)}h ` : ""}${minutes % 60}m`
export const formatDate = (
  date: string,
  options?: Intl.DateTimeFormatOptions
) =>
  new Date(`${date}T12:00:00`).toLocaleDateString(
    "en-US",
    options || { weekday: "long", month: "long", day: "numeric" }
  )
