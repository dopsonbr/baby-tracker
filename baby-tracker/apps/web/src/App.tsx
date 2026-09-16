import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react"
import type { CSSProperties, FormEvent, ReactNode } from "react"
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Baby,
  Check,
  ChevronRight,
  Clock3,
  Droplets,
  Heart,
  History,
  LoaderCircle,
  Mic,
  Moon,
  Plus,
  Settings2,
  Share2,
  Sparkles,
  Sprout,
  Sun,
  Trash2,
  X,
} from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import type {
  Day,
  DayEvent,
  Operation,
  Profile,
  Proposal,
  Snapshot,
} from "@workspace/domain"
import {
  ApiError,
  createApi,
  currentTime,
  durationMinutes,
  eventLabel,
  formatDate,
  formatDuration,
  formatTime,
  isSampleMode,
  localDate,
} from "./api"
import { browserTranscription } from "./voice"
import "./app.css"

const Growth = lazy(() => import("./components/Growth"))
type Tab = "today" | "growth" | "history" | "settings"
type EventInput = Omit<DayEvent, "id">
const iconFor = (type: DayEvent["type"]) =>
  type === "feed" ? <Droplets /> : type === "sleep" ? <Moon /> : <Heart />
const sortedEvents = (events: DayEvent[]) =>
  [...events].sort((a, b) => a.time.localeCompare(b.time))
const totalOz = (day: Day) =>
  Math.round(
    day.events.reduce(
      (sum, event) =>
        sum +
        (event.type === "feed" && event.status === "completed"
          ? event.amountOz || 0
          : 0),
      0
    ) * 100
  ) / 100
const sleepTotal = (day: Day) =>
  day.events.reduce(
    (sum, event) =>
      sum +
      (event.type === "sleep" && event.status === "completed" && event.endTime
        ? durationMinutes(event.time, event.endTime)
        : 0),
    0
  )

export function App({
  getToken,
  signOut,
}: {
  getToken?: () => Promise<string | null>
  signOut?: () => void
}) {
  const api = useMemo(() => createApi(getToken), [getToken])
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [tab, setTab] = useState<Tab>("today")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [share, setShare] = useState(false)
  const [editor, setEditor] = useState<DayEvent | "new" | null>(null)
  const [text, setText] = useState("")
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [notice, setNotice] = useState("")
  const [listening, setListening] = useState(false)
  const [voiceAvailable] = useState(() => Boolean(browserTranscription()))
  const stopVoice = useRef<(() => void) | null>(null)
  const request = useRef<{ key: string; id: string } | null>(null)
  const loadGeneration = useRef(0)
  const lastCalendarDay = useRef<string | null>(null)
  const [proposalDate, setProposalDate] = useState<string | null>(null)
  const [proposalVersion, setProposalVersion] = useState<number | null>(null)
  const load = useCallback(
    async (date?: string) => {
      const generation = ++loadGeneration.current
      setLoading(true)
      setError("")
      setProposal(null)
      setProposalDate(null)
      setText("")
      try {
        const next = await api.state(date)
        if (generation !== loadGeneration.current) return
        setSnapshot(next)
      } catch (cause) {
        setError(
          cause instanceof Error ? cause.message : "Could not load this day."
        )
      } finally {
        if (generation === loadGeneration.current) setLoading(false)
      }
    },
    [api]
  )
  useEffect(() => {
    let cancelled = false
    api
      .state()
      .then((next) => {
        if (!cancelled) setSnapshot(next)
      })
      .catch((cause) => {
        if (!cancelled)
          setError(
            cause instanceof Error ? cause.message : "Could not load this day."
          )
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
      stopVoice.current?.()
    }
  }, [api])
  useEffect(() => {
    if (!notice) return
    const timeout = setTimeout(() => setNotice(""), 4500)
    return () => clearTimeout(timeout)
  }, [notice])
  useEffect(() => {
    if (!snapshot) return
    const calendarDay = localDate(snapshot.profile.timezone)
    if (!lastCalendarDay.current) lastCalendarDay.current = calendarDay
    const refresh = (rolloverOnly = false) => {
      if (
        document.visibilityState !== "visible" ||
        busy ||
        loading ||
        editor ||
        proposal ||
        text.trim() ||
        listening ||
        share ||
        tab !== "today"
      )
        return
      const nextDay = localDate(snapshot.profile.timezone)
      const rolledOver = nextDay !== lastCalendarDay.current
      const viewingCurrent = snapshot.day.date === lastCalendarDay.current
      lastCalendarDay.current = nextDay
      if (rolloverOnly && !rolledOver) return
      void load(rolledOver && viewingCurrent ? nextDay : snapshot.day.date)
    }
    const onFocus = () => refresh()
    window.addEventListener("focus", onFocus)
    document.addEventListener("visibilitychange", onFocus)
    const interval = setInterval(() => refresh(true), 30_000)
    return () => {
      window.removeEventListener("focus", onFocus)
      document.removeEventListener("visibilitychange", onFocus)
      clearInterval(interval)
    }
  }, [
    snapshot,
    busy,
    loading,
    editor,
    proposal,
    text,
    listening,
    share,
    tab,
    load,
  ])
  async function apply(
    operations: Operation[],
    version = snapshot!.day.version
  ) {
    if (!snapshot || busy) return false
    setBusy(true)
    setError("")
    const key = JSON.stringify([snapshot.day.date, version, operations])
    if (request.current?.key !== key)
      request.current = { key, id: crypto.randomUUID() }
    try {
      setSnapshot(
        await api.events(
          snapshot.day.date,
          version,
          operations,
          request.current.id
        )
      )
      request.current = null
      setNotice("Saved. You’re all caught up.")
      return true
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) {
        await load(snapshot.day.date)
        setProposal(null)
        setEditor(null)
        setError(
          "This day changed on another device. It has been refreshed. Review the latest events before trying again."
        )
      } else
        setError(
          cause instanceof Error
            ? cause.message
            : "Could not save. Please try again."
        )
      return false
    } finally {
      setBusy(false)
    }
  }
  async function interpret(event?: FormEvent) {
    event?.preventDefault()
    if (!text.trim() || !snapshot || busy) return
    setBusy(true)
    setError("")
    try {
      const generation = loadGeneration.current
      const result = await api.interpret(
        snapshot.day.date,
        text.trim(),
        snapshot.day.version
      )
      if (generation !== loadGeneration.current) return
      setProposal(result)
      setProposalVersion(snapshot.day.version)
      setProposalDate(snapshot.day.date)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not interpret that. You can add it manually."
      )
    } finally {
      setBusy(false)
    }
  }
  function dictate() {
    if (listening) {
      stopVoice.current?.()
      return
    }
    const provider = browserTranscription()
    if (!provider) {
      setError(
        "Dictation is not available in this browser. Try your keyboard’s microphone or type an update."
      )
      return
    }
    try {
      setError("")
      setListening(true)
      stopVoice.current = provider.start(
        (transcript) => {
          setText((previous) =>
            [previous, transcript].filter(Boolean).join(" ")
          )
          setProposal(null)
        },
        setError,
        () => setListening(false)
      )
    } catch {
      setListening(false)
      setError("Microphone could not start. Please type your update instead.")
    }
  }
  if (!snapshot)
    return (
      <main className="setup-screen">
        <div className="brand-mark">
          <Sprout />
        </div>
        <h1>Beckett</h1>
        {loading ? (
          <p className="loading-message">
            <LoaderCircle className="spin" /> Getting your day ready…
          </p>
        ) : (
          <>
            <h2>A little pause</h2>
            <p role="alert">{error}</p>
            <Button onClick={() => void load()}>Try again</Button>
            {signOut && (
              <Button variant="ghost" onClick={signOut}>
                Sign out
              </Button>
            )}
          </>
        )}
      </main>
    )
  const { day, profile } = snapshot
  const today = day.date === localDate(profile.timezone)
  const events = sortedEvents(day.events)
  const completed = events.filter((event) => event.status === "completed")
  const planned = events.filter((event) => event.status === "planned")
  const feeds = completed.filter((event) => event.type === "feed")
  const sleeps = completed.filter((event) => event.type === "sleep")
  const lastFeed = feeds.at(-1)
  const lastSleep = sleeps.at(-1)
  if (share)
    return (
      <ShareView profile={profile} day={day} onClose={() => setShare(false)} />
    )
  return (
    <div className="beckett-app">
      {isSampleMode && (
        <div className="sample-banner">
          LOCAL SAMPLE PREVIEW <span>· saved only in this browser</span>
        </div>
      )}
      <header className="app-header">
        <a
          className="brand"
          href="#today"
          onClick={(event) => {
            event.preventDefault()
            setTab("today")
          }}
        >
          <span className="brand-mark">
            <Sprout />
          </span>
          beckett<span className="brand-dot">.</span>
        </a>
        <span className="header-note">little moments, all together</span>
        <button
          className="profile-button"
          aria-label="Open settings"
          onClick={() => setTab("settings")}
        >
          <Baby />
        </button>
      </header>
      <main className="app-content" id="main-content">
        {error && (
          <div className="error-banner" role="alert">
            <span>{error}</span>
            <button aria-label="Dismiss error" onClick={() => setError("")}>
              <X size={18} />
            </button>
          </div>
        )}
        {tab === "today" && (
          <>
            <section className="page-heading">
              <div>
                <p className="eyebrow">
                  {formatDate(day.date, {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                  })}
                </p>
                <h1>
                  {today ? "A little day." : "A day to remember."}
                  <br />
                  <span>A lot of love.</span>
                </h1>
              </div>
              <button
                className="icon-button share-button"
                onClick={() => setShare(true)}
                aria-label="Open share view"
              >
                <Share2 />
              </button>
            </section>
            {!today && (
              <div className="past-day">
                You’re viewing{" "}
                {formatDate(day.date, { month: "short", day: "numeric" })}.{" "}
                <button onClick={() => void load(localDate(profile.timezone))}>
                  Back to today <ArrowRight size={14} />
                </button>
              </div>
            )}
            <section
              className="day-overview"
              aria-label="Daily feeding progress"
            >
              <div className="feeding-copy">
                <span className="section-kicker">
                  <span className="live-dot" /> {profile.name.toUpperCase()}’S
                  DAY
                </span>
                <div className="ounces">
                  <strong>
                    {totalOz(day).toLocaleString(undefined, {
                      maximumFractionDigits: 2,
                    })}
                  </strong>
                  <span> / {day.goalOz} oz</span>
                </div>
                <p>
                  {Math.max(0, day.goalOz - totalOz(day)) > 0
                    ? `${Number((day.goalOz - totalOz(day)).toFixed(2))} oz to the daily goal`
                    : "Daily goal reached. Nice teamwork!"}
                </p>
                <div className="progress-track">
                  <span
                    style={{
                      width: `${Math.min(100, (totalOz(day) / day.goalOz) * 100)}%`,
                    }}
                  />
                </div>
                <span className="feeding-count">
                  {feeds.length} {feeds.length === 1 ? "bottle" : "bottles"} so
                  far <span>·</span> one happy little human
                </span>
              </div>
              <Bottle progress={totalOz(day) / day.goalOz} />
              <span className="hero-spark spark-one">✦</span>
              <span className="hero-spark spark-two">✧</span>
            </section>
            <div className="quick-stats">
              <div>
                <span className="stat-icon feed">
                  <Droplets />
                </span>
                <div>
                  <span>Last bottle</span>
                  <strong>
                    {lastFeed
                      ? `${lastFeed.amountOz} oz · ${formatTime(lastFeed.time)}`
                      : "A fresh start"}
                  </strong>
                </div>
              </div>
              <div>
                <span className="stat-icon sleep">
                  <Moon />
                </span>
                <div>
                  <span>Sleep today</span>
                  <strong>
                    {sleepTotal(day)
                      ? formatDuration(sleepTotal(day))
                      : "No sleep logged"}
                  </strong>
                  <small>
                    {lastSleep
                      ? `${lastSleep.endTime ? "Last woke" : "Asleep since"} ${formatTime(lastSleep.endTime || lastSleep.time)}`
                      : "Little dreams to come"}
                  </small>
                </div>
              </div>
            </div>
            {planned[0] && (
              <section className="up-next">
                <div className="up-next-icon">{iconFor(planned[0].type)}</div>
                <div>
                  <span>
                    UP NEXT <span className="subtle">· planned</span>
                  </span>
                  <strong>{eventLabel(planned[0])}</strong>
                </div>
                <button onClick={() => setEditor(planned[0]!)}>
                  <span>{formatTime(planned[0].time)}</span>
                  <ChevronRight size={17} />
                </button>
              </section>
            )}
            <section className="composer-section">
              <div className="section-title">
                <h2>What’s new?</h2>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setError("")
                    setEditor("new")
                  }}
                >
                  <Plus /> Add manually
                </Button>
              </div>
              <form
                className={`composer ${listening ? "is-listening" : ""}`}
                onSubmit={interpret}
              >
                <label className="sr-only" htmlFor="day-update">
                  Describe an update
                </label>
                <textarea
                  id="day-update"
                  value={text}
                  onChange={(event) => {
                    setText(event.target.value)
                    setProposal(null)
                  }}
                  placeholder="“He had 5 oz at 8:15 am, then a little nap…”"
                  rows={2}
                  maxLength={3000}
                />
                <div className="composer-actions">
                  <button
                    type="button"
                    className={`dictate-button ${listening ? "active" : ""}`}
                    aria-label={
                      listening ? "Stop dictation" : "Dictate an update"
                    }
                    onClick={dictate}
                  >
                    <Mic size={17} />
                    {listening
                      ? "Listening…"
                      : voiceAvailable
                        ? "Tap to talk"
                        : "Dictation help"}
                  </button>
                  <Button
                    type="submit"
                    disabled={!text.trim() || busy}
                    size="sm"
                  >
                    {busy ? <LoaderCircle className="spin" /> : <Sparkles />}{" "}
                    Review update <ArrowRight />
                  </Button>
                </div>
              </form>
              {listening && (
                <p className="field-hint">
                  Your browser transcribes your voice. Review the text before
                  sending.
                </p>
              )}
              {proposal && (
                <div className="proposal" aria-live="polite">
                  <div className="proposal-heading">
                    <Sparkles size={18} />
                    <h3>Here’s what I understood</h3>
                    <button
                      aria-label="Dismiss proposed update"
                      onClick={() => setProposal(null)}
                    >
                      <X size={17} />
                    </button>
                  </div>
                  <p>{proposal.summary}</p>
                  {proposal.questions.map((question) => (
                    <p className="clarification" key={question}>
                      {question}
                    </p>
                  ))}
                  {proposal.operations.length > 0 && (
                    <ul>
                      {proposal.operations.map((operation, index) => (
                        <li key={index}>
                          <span>
                            {operation.action === "add"
                              ? "Add"
                              : operation.action === "update"
                                ? "Update"
                                : "Delete"}
                          </span>
                          {operation.action === "delete"
                            ? eventLabel(
                                day.events.find(
                                  (event) => event.id === operation.id
                                ) ||
                                  ({ type: "note", note: "event" } as DayEvent)
                              )
                            : `${eventLabel({ ...operation.event, id: "" })} · ${formatTime(operation.event.time)}${operation.event.endTime ? `–${formatTime(operation.event.endTime)}` : ""}`}
                        </li>
                      ))}
                    </ul>
                  )}
                  {proposal.questions.length > 0 ? (
                    <p className="field-hint">
                      Add the missing detail to your message above, then review
                      again.
                    </p>
                  ) : (
                    <Button
                      disabled={
                        busy ||
                        !proposal.operations.length ||
                        proposalDate !== day.date
                      }
                      onClick={async () => {
                        if (
                          await apply(
                            proposal.operations,
                            proposalVersion ?? day.version
                          )
                        ) {
                          setProposal(null)
                          setText("")
                        }
                      }}
                    >
                      <Check /> Confirm & save
                    </Button>
                  )}
                </div>
              )}
            </section>
            <section className="timeline-section">
              <div className="section-title">
                <h2>
                  The little details{" "}
                  <span className="count-pill">{events.length}</span>
                </h2>
                <span>Tap a moment to edit</span>
              </div>
              <div className="timeline-key">
                <span>
                  <i /> Happened
                </span>
                <span>
                  <i className="planned-dot" /> Planned
                </span>
              </div>
              {events.length ? (
                <div className="timeline">
                  {events.map((event) => (
                    <EventRow
                      key={event.id}
                      event={event}
                      onClick={() => setEditor(event)}
                    />
                  ))}
                </div>
              ) : (
                <div className="empty-day">
                  <Sun />
                  <h3>A fresh page for a little day.</h3>
                  <p>Add a bottle, a nap, or a moment to remember.</p>
                  <Button variant="outline" onClick={() => setEditor("new")}>
                    <Plus /> Add the first moment
                  </Button>
                </div>
              )}
            </section>
            <footer className="day-footer">
              <Heart size={13} /> The days are long. The little moments matter.
            </footer>
          </>
        )}
        {tab === "growth" && (
          <Suspense
            fallback={
              <p className="loading-message">
                <LoaderCircle className="spin" /> Loading growth…
              </p>
            }
          >
            <Growth
              profile={profile}
              measurements={snapshot.measurements}
              onSave={async (measurement) => {
                setSnapshot(await api.measurement(measurement, day.date))
                setNotice("Measurement saved.")
              }}
              onDelete={async (id) => {
                setSnapshot(await api.deleteMeasurement(id, day.date))
                setNotice("Measurement removed.")
              }}
              onUpdate={async (id, measurement) => {
                setSnapshot(
                  await api.updateMeasurement(id, measurement, day.date)
                )
                setNotice("Measurement updated.")
              }}
            />
          </Suspense>
        )}
        {tab === "history" && (
          <HistoryView
            snapshot={snapshot}
            onOpen={(date) => {
              setTab("today")
              void load(date)
            }}
          />
        )}
        {tab === "settings" && (
          <SettingsView
            key={profile.id}
            profile={profile}
            onSave={async (value) => {
              setSnapshot(await api.profile(value, day.date))
              setNotice("Your settings are saved.")
            }}
            signOut={signOut}
          />
        )}
      </main>
      <nav className="bottom-nav" aria-label="Main navigation">
        {(
          [
            { id: "today", title: "Today", Icon: Sun },
            { id: "growth", title: "Growth", Icon: Sprout },
            { id: "history", title: "History", Icon: History },
            { id: "settings", title: "Settings", Icon: Settings2 },
          ] as const
        ).map((item) => (
          <button
            key={item.id}
            className={tab === item.id ? "selected" : ""}
            aria-current={tab === item.id ? "page" : undefined}
            onClick={() => {
              setTab(item.id)
              setError("")
            }}
          >
            <item.Icon />
            <span>{item.title}</span>
          </button>
        ))}
      </nav>
      {notice && (
        <div className="toast" role="status">
          <Check size={17} />
          {notice}
        </div>
      )}
      {loading && snapshot && (
        <div className="loading-bar" aria-label="Refreshing day" />
      )}
      {editor && (
        <EventEditor
          event={editor === "new" ? null : editor}
          timezone={profile.timezone}
          busy={busy}
          error={error}
          onClose={() => setEditor(null)}
          onSave={async (event) => {
            const ok = await apply([
              editor === "new"
                ? { action: "add", event }
                : { action: "update", id: editor.id, event },
            ])
            if (ok) setEditor(null)
          }}
          onDelete={
            editor !== "new"
              ? async () => {
                  if (await apply([{ action: "delete", id: editor.id }]))
                    setEditor(null)
                }
              : undefined
          }
        />
      )}
    </div>
  )
}

function Bottle({
  progress,
  small = false,
}: {
  progress: number
  small?: boolean
}) {
  const clipId = useId().replace(/:/g, "")
  return (
    <div
      className={`bottle-illustration ${small ? "small" : ""}`}
      role="img"
      aria-label={`Bottle ${Math.round(progress * 100)} percent full`}
    >
      <svg viewBox="0 0 150 218" fill="none">
        <defs>
          <clipPath id={clipId}>
            <path d="M39 85C39 77 45 73 51 70H99C105 73 111 77 111 85V185C111 197 102 205 90 205H60C48 205 39 197 39 185Z" />
          </clipPath>
        </defs>
        <ellipse cx="75" cy="211" rx="45" ry="5" fill="#7ba8c5" opacity=".12" />
        <path
          d="M62 40V26C62 8 87 8 87 26V40L98 48V60H51V48L62 40Z"
          fill="#fff8ef"
          stroke="#7798b2"
          strokeWidth="2.5"
        />
        <path
          d="M39 85C39 77 45 73 51 70H99C105 73 111 77 111 85V185C111 197 102 205 90 205H60C48 205 39 197 39 185Z"
          fill="#f9fdff"
          stroke="#7598b4"
          strokeWidth="2.5"
        />
        <g clipPath={`url(#${clipId})`}>
          <g
            className="bottle-liquid"
            style={
              {
                transform: `translateY(${190 - Math.min(1, Math.max(0, progress)) * 115}px)`,
              } as CSSProperties
            }
          >
            <path
              className="liquid-wave"
              d="M0 8Q25 -2 50 8T100 8T150 8T200 8T250 8V220H0Z"
              fill="#90c7e8"
            />
            <path d="M0 16Q25 6 50 16T100 16T150 16V220H0Z" fill="#b2dbf2" />
            <circle
              className="bottle-bubble"
              cx="63"
              cy="40"
              r="3"
              fill="white"
              opacity=".6"
            />
            <circle
              className="bottle-bubble bubble-two"
              cx="90"
              cy="58"
              r="2"
              fill="white"
              opacity=".6"
            />
          </g>
        </g>
        <path
          d="M49 90V181"
          stroke="white"
          strokeWidth="4"
          strokeLinecap="round"
          opacity=".85"
        />
        <rect
          x="43"
          y="52"
          width="64"
          height="22"
          rx="8"
          fill="#c6e3f3"
          stroke="#7598b4"
          strokeWidth="2.5"
        />
        <path
          d="M54 58V67M64 58V67M74 58V67M84 58V67M94 58V67"
          stroke="#91b7cd"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <path
          d="M95 97H104M98 110H104M95 123H104M98 136H104M95 149H104M98 162H104"
          stroke="#87a5ba"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <path
          d="M64 172C62 167 54 165 53 172C52 178 64 184 64 184C64 184 75 178 74 172C73 165 66 167 64 172Z"
          fill="#6ba5c9"
        />
      </svg>
    </div>
  )
}

function EventRow({
  event,
  onClick,
}: {
  event: DayEvent
  onClick?: () => void
}) {
  const content = (
    <>
      <span className="event-time">
        {formatTime(event.time).split(" ")[0]}
        <small>{formatTime(event.time).split(" ")[1]}</small>
      </span>
      <span className={`event-icon ${event.type}`}>{iconFor(event.type)}</span>
      <span className="event-copy">
        <strong>{eventLabel(event)}</strong>
        {event.type === "sleep" && event.endTime && (
          <span>
            {formatTime(event.time)} – {formatTime(event.endTime)}{" "}
            {event.endTime < event.time ? "(+1 day)" : ""}
            <span className="duration-pill">
              {formatDuration(durationMinutes(event.time, event.endTime))}
            </span>
          </span>
        )}
        {event.type !== "note" && event.note && <span>{event.note}</span>}
        {event.status === "planned" && (
          <span className="planned-label">Planned</span>
        )}
      </span>
      <span className="event-status">
        {event.status === "completed" ? (
          <Check size={14} />
        ) : (
          <Clock3 size={14} />
        )}
      </span>
    </>
  )
  return onClick ? (
    <button
      className={`event-row ${event.status}`}
      aria-label={`Edit ${eventLabel(event)} at ${formatTime(event.time)}`}
      onClick={onClick}
    >
      {content}
    </button>
  ) : (
    <div className={`event-row ${event.status}`}>{content}</div>
  )
}

function Sheet({
  children,
  onClose,
  title,
}: {
  children: ReactNode
  onClose: () => void
  title: string
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    ref.current?.showModal()
    const previous = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = previous
    }
  }, [])
  return (
    <dialog
      className="editor-sheet"
      ref={ref}
      onCancel={onClose}
      aria-label={title}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="sheet-header">
        <h2>{title}</h2>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="Close editor"
        >
          <X />
        </button>
      </div>
      {children}
    </dialog>
  )
}

function EventEditor({
  event,
  timezone,
  busy,
  error,
  onClose,
  onSave,
  onDelete,
}: {
  event: DayEvent | null
  timezone: string
  busy: boolean
  error: string
  onClose: () => void
  onSave: (event: EventInput) => Promise<void>
  onDelete?: () => Promise<void>
}) {
  const [type, setType] = useState<DayEvent["type"]>(event?.type || "feed")
  const [status, setStatus] = useState<DayEvent["status"]>(
    event?.status || "completed"
  )
  const [deleting, setDeleting] = useState(false)
  const [formError, setFormError] = useState("")
  async function save(submit: FormEvent<HTMLFormElement>) {
    submit.preventDefault()
    const data = new FormData(submit.currentTarget)
    const input: EventInput = {
      type,
      status,
      time: String(data.get("time")),
      endTime:
        type === "sleep" ? String(data.get("endTime") || "") || null : null,
      amountOz: type === "feed" ? Number(data.get("amountOz")) : null,
      note: String(data.get("note") || "").trim(),
    }
    if (type === "note" && !input.note) {
      setFormError("Add a little detail for this note.")
      return
    }
    if (type === "sleep" && input.time === input.endTime) {
      setFormError("Sleep needs a different start and end time.")
      return
    }
    setFormError("")
    await onSave(input)
  }
  return (
    <Sheet
      title={event ? "Edit a little moment" : "Add a little moment"}
      onClose={() => {
        if (!busy) onClose()
      }}
    >
      <form className="event-form" onSubmit={save}>
        <div className="type-picker">
          {(["feed", "sleep", "note"] as const).map((value) => (
            <button
              type="button"
              key={value}
              aria-pressed={type === value}
              className={type === value ? "chosen" : ""}
              onClick={() => setType(value)}
            >
              {iconFor(value)}
              {value === "feed"
                ? "Bottle"
                : value === "sleep"
                  ? "Sleep"
                  : "Note"}
            </button>
          ))}
        </div>
        <div className="status-picker">
          <label>
            <input
              type="radio"
              name="status"
              checked={status === "completed"}
              onChange={() => setStatus("completed")}
            />{" "}
            Happened
          </label>
          <label>
            <input
              type="radio"
              name="status"
              checked={status === "planned"}
              onChange={() => setStatus("planned")}
            />{" "}
            Planned
          </label>
        </div>
        <div className="form-grid">
          <label>
            {type === "sleep" ? "Started at" : "Time"}
            <input
              type="time"
              name="time"
              required
              defaultValue={event?.time || currentTime(timezone)}
            />
          </label>
          {type === "feed" && (
            <label>
              Amount (oz)
              <input
                type="number"
                name="amountOz"
                min="0.1"
                max="30"
                step="0.1"
                required
                defaultValue={event?.amountOz || 5}
              />
            </label>
          )}
          {type === "sleep" && (
            <label>
              Woke at <span className="optional">(optional)</span>
              <input
                type="time"
                name="endTime"
                defaultValue={event?.endTime || ""}
              />
            </label>
          )}
        </div>
        {type === "sleep" && (
          <p className="field-hint">
            Leave the end empty for ongoing sleep. An earlier end time means the
            next day.
          </p>
        )}
        <label>
          {type === "note" ? "The little detail" : "A little note (optional)"}
          <textarea
            name="note"
            rows={3}
            maxLength={1000}
            required={type === "note"}
            defaultValue={event?.note || ""}
            placeholder={
              type === "note"
                ? "A first giggle, a sunny walk…"
                : "Anything worth remembering?"
            }
          />
        </label>
        {(error || formError) && (
          <p className="form-error" role="alert">
            {formError || error}
          </p>
        )}
        <Button type="submit" disabled={busy} className="full-width">
          {busy ? <LoaderCircle className="spin" /> : <Check />}
          {event
            ? "Save changes"
            : status === "planned"
              ? "Add to the plan"
              : "Save moment"}
        </Button>
        {onDelete && (
          <div className="delete-area">
            {deleting ? (
              <>
                <p>Remove this event from the day?</p>
                <Button
                  variant="destructive"
                  disabled={busy}
                  onClick={() => void onDelete()}
                >
                  Yes, delete event
                </Button>
                <Button variant="ghost" onClick={() => setDeleting(false)}>
                  Keep it
                </Button>
              </>
            ) : (
              <Button
                variant="ghost"
                className="delete-button"
                disabled={busy}
                onClick={() => setDeleting(true)}
              >
                <Trash2 /> Delete event
              </Button>
            )}
          </div>
        )}
      </form>
    </Sheet>
  )
}

function HistoryView({
  snapshot,
  onOpen,
}: {
  snapshot: Snapshot
  onOpen: (date: string) => void
}) {
  const days = [
    snapshot.day,
    ...snapshot.history.filter((day) => day.date !== snapshot.day.date),
  ].sort((a, b) => b.date.localeCompare(a.date))
  return (
    <section className="secondary-page">
      <p className="eyebrow">THE DAYS ADD UP</p>
      <h1>A little look back.</h1>
      <p className="page-description">
        Bottles, naps, and everything in between.
      </p>
      <label className="date-jump">
        Jump to a day
        <input
          type="date"
          aria-label="Choose a historical day"
          value={snapshot.day.date}
          onChange={(event) => {
            if (event.target.value) onOpen(event.target.value)
          }}
        />
      </label>
      <div className="history-list">
        {days.map((day) => (
          <button
            key={day.date}
            className="history-row"
            onClick={() => onOpen(day.date)}
          >
            <span className="history-date">
              <strong>{new Date(`${day.date}T12:00:00`).getDate()}</strong>
              <span>{formatDate(day.date, { month: "short" })}</span>
            </span>
            <span>
              <strong>{formatDate(day.date, { weekday: "long" })}</strong>
              <span>
                {totalOz(day)} / {day.goalOz} oz{" "}
                <span className="separator">·</span>{" "}
                {sleepTotal(day)
                  ? `${formatDuration(sleepTotal(day))} sleep`
                  : `${day.events.length} moments`}
              </span>
            </span>
            <ChevronRight size={18} />
          </button>
        ))}
      </div>
      <p className="field-hint">
        Past days keep the feeding goal that applied at the time.
      </p>
    </section>
  )
}

function SettingsView({
  profile,
  onSave,
  signOut,
}: {
  profile: Profile
  onSave: (value: Omit<Profile, "id">) => Promise<void>
  signOut?: () => void
}) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    setSaving(true)
    setError("")
    try {
      const timezone = String(data.get("timezone")).trim()
      try {
        new Intl.DateTimeFormat("en", { timeZone: timezone })
      } catch {
        throw new Error("Use a valid time zone, such as America/New_York.")
      }
      await onSave({
        name: String(data.get("name")).trim(),
        birthDate: String(data.get("birthDate")) || null,
        sex: data.get("sex") as "male" | "female",
        timezone,
        dailyGoalOz: Number(data.get("dailyGoalOz")),
      })
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not save settings."
      )
    } finally {
      setSaving(false)
    }
  }
  return (
    <section className="secondary-page">
      <p className="eyebrow">MAKE IT YOURS</p>
      <h1>For your little one.</h1>
      <p className="page-description">
        A few details to keep everything in rhythm.
      </p>
      <form className="settings-form" onSubmit={save}>
        <h2>
          <Baby size={20} /> The little details
        </h2>
        <label>
          Name
          <input
            name="name"
            required
            maxLength={80}
            defaultValue={profile.name}
          />
        </label>
        <div className="form-grid">
          <label>
            Date of birth
            <input
              type="date"
              name="birthDate"
              max={localDate(profile.timezone)}
              defaultValue={profile.birthDate || ""}
            />
          </label>
          <label>
            Growth reference
            <select name="sex" defaultValue={profile.sex}>
              <option value="male">Boys</option>
              <option value="female">Girls</option>
            </select>
          </label>
        </div>
        <p className="field-hint">
          A birth date is needed for age-based growth charts. It stays optional
          until you’re ready.
        </p>
        <h2>
          <Droplets size={20} /> The daily rhythm
        </h2>
        <label>
          Daily feeding goal (oz)
          <input
            type="number"
            name="dailyGoalOz"
            min="1"
            max="100"
            step="0.5"
            required
            defaultValue={profile.dailyGoalOz}
          />
        </label>
        <p className="field-hint">
          Your goal applies to today and future days. Past days keep their
          original goal.
        </p>
        <label>
          Time zone
          <input
            name="timezone"
            required
            defaultValue={profile.timezone}
            placeholder="America/New_York"
          />
        </label>
        <p className="field-hint">
          Events and days use this time zone, even while you travel.
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" disabled={saving}>
          {saving ? <LoaderCircle className="spin" /> : <Check />} Save settings
        </Button>
      </form>
      <div className="privacy-note">
        <Heart size={19} />
        <div>
          <strong>Just your little circle.</strong>
          <p>Private access for approved family accounts.</p>
        </div>
      </div>
      {signOut && (
        <Button variant="outline" onClick={signOut}>
          Sign out
        </Button>
      )}
      <p className="app-version">BECKETT · MADE FOR THE EVERYDAY</p>
    </section>
  )
}

function ShareView({
  profile,
  day,
  onClose,
}: {
  profile: Profile
  day: Day
  onClose: () => void
}) {
  const events = sortedEvents(day.events)
  const completed = events.filter((event) => event.status === "completed")
  const planned = events.filter((event) => event.status === "planned")
  const total = totalOz(day)
  return (
    <main className="share-page">
      <div className="share-toolbar">
        <Button variant="ghost" size="sm" onClick={onClose}>
          <ArrowLeft /> Back
        </Button>
        <span>
          Ready for a screenshot <ArrowDown size={13} />
        </span>
        <Button variant="ghost" size="sm" onClick={() => window.print()}>
          Print
        </Button>
      </div>
      <article className="share-sheet">
        <header className="share-heading">
          <div>
            <div className="share-wordmark">
              <Sprout size={17} /> beckett.
            </div>
            <h1>{profile.name}’s little day</h1>
            <p>{formatDate(day.date)}</p>
          </div>
          <Sun className="share-sun" />
        </header>
        {isSampleMode && (
          <div className="share-sample">SAMPLE DAY · NOT REAL RECORDS</div>
        )}
        <section className="share-summary">
          <div>
            <span className="section-kicker">BOTTLES & LITTLE DREAMS</span>
            <div className="share-ounces">
              <strong>{total}</strong>
              <span> / {day.goalOz} oz</span>
            </div>
            <div className="progress-track">
              <span
                style={{
                  width: `${Math.min(100, (total / day.goalOz) * 100)}%`,
                }}
              />
            </div>
            <p>
              {completed.filter((event) => event.type === "feed").length}{" "}
              bottles <span>·</span> {formatDuration(sleepTotal(day))} sleep
            </p>
          </div>
          <Bottle small progress={total / day.goalOz} />
        </section>
        <section className="share-events">
          <h2>
            <Check size={13} /> THE DAY SO FAR{" "}
            <span>{completed.length} moments</span>
          </h2>
          {completed.length ? (
            completed.map((event) => <EventRow key={event.id} event={event} />)
          ) : (
            <p className="share-empty">
              A fresh start. Little moments to come.
            </p>
          )}
        </section>
        {planned.length > 0 && (
          <section className="share-events share-planned">
            <h2>
              <Clock3 size={13} /> STILL TO COME <span>the plan</span>
            </h2>
            {planned.map((event) => (
              <EventRow key={event.id} event={event} />
            ))}
          </section>
        )}
        <footer>
          <Heart size={12} />
          <span>A little day. A lot of love.</span>
          <span>
            {profile.timezone.replaceAll("_", " ").split("/").at(-1)} time
          </span>
        </footer>
      </article>
      <p className="screenshot-tip">
        Take a screenshot to share with your little circle.
        <br />
        Longer days may need more than one screenshot.
      </p>
    </main>
  )
}
