import { useRef, useState } from "react"
import {
  ArrowLeft,
  ArrowUpRight,
  Bath,
  Check,
  Clock3,
  Download,
  Heart,
  House,
  LoaderCircle,
  Moon,
  Printer,
  Share2,
  Sparkles,
  Star,
  Sun,
} from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import type { Day, DayEvent, Profile } from "@workspace/domain"
import { sleepMinutes, totalOunces } from "@workspace/domain"
import { formatDate, formatDuration, formatTime, isSampleMode } from "../api"
import { saveDayPicture } from "../export-picture"
import "@fontsource/patrick-hand/latin-400.css"
import "./share.css"

function BottleDoodle() {
  return (
    <svg
      className="paper-bottle"
      viewBox="0 0 30 47"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M12 9V5C12 1 19 1 19 5V9L22 12V16H8V12Z"
        fill="#ffe7a3"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M7 18H23L25 38Q25 44 19 44H10Q4 44 5 38Z"
        fill="#cce9f2"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M19 23H24M20 29H24M20 35H25"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <rect
        x="5"
        y="13"
        width="20"
        height="6"
        rx="2"
        fill="#e8f5fa"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M9 24L8 35"
        stroke="white"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  )
}
function HappySun() {
  return (
    <svg
      className="paper-happy-sun"
      viewBox="0 0 90 90"
      fill="none"
      aria-hidden="true"
    >
      <g stroke="#eab963" strokeWidth="4" strokeLinecap="round">
        <path d="M45 5V14M45 76V85M5 45H14M76 45H85M16 16L23 23M67 67L74 74M16 74L23 67M67 23L74 16" />
        <circle cx="45" cy="45" r="25" fill="#ffda82" stroke="#f7ca74" />
      </g>
      <circle cx="37" cy="41" r="2.2" fill="#24476a" />
      <circle cx="53" cy="41" r="2.2" fill="#24476a" />
      <path
        d="M39 50Q45 59 51 50"
        stroke="#24476a"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}
function ActivityIcon({ type }: { type: DayEvent["type"] }) {
  return type === "feed" ? (
    <BottleDoodle />
  ) : type === "sleep" ? (
    <Moon className="paper-moon" />
  ) : (
    <Heart className="paper-heart" />
  )
}
function ActivityRow({ event }: { event: DayEvent }) {
  // Imported activity labels are recognized only in their exact saved format.
  // Arbitrary family notes are kept in full, never reinterpreted as instructions.
  const importedNote =
    event.type === "note"
      ? event.note.match(
          /^(Awake \/ Play|Play|Wake|Bath|Bed|Calm Play \+ Wind Down)(?: \(until ((?:[01]\d|2[0-3]):[0-5]\d)\))?(?: · ([\s\S]*))?$/i
        )
      : null
  const label = importedNote?.[1]
  const note = importedNote ? importedNote[3] || "" : event.note
  const endTime =
    event.type === "sleep" ? event.endTime : importedNote?.[2] || null
  const icon = label ? (
    /^bath$/i.test(label) ? (
      <Bath className="paper-bath" />
    ) : /^bed$/i.test(label) ? (
      <Moon className="paper-moon" />
    ) : /calm/i.test(label) ? (
      <Heart className="paper-heart" />
    ) : (
      <Sun className="paper-sun" />
    )
  ) : (
    <ActivityIcon type={event.type} />
  )
  return (
    <tr
      className={
        event.status === "planned" ? "paper-planned-row" : "paper-completed-row"
      }
    >
      <td className="paper-time">
        <span>{formatTime(event.time)}</span>
        {endTime && (
          <>
            <span className="paper-time-end">– {formatTime(endTime)}</span>
            {endTime < event.time && <small>next day</small>}
          </>
        )}
      </td>
      <td>
        <div className="paper-activity">
          {icon}
          <div>
            <strong>
              {event.type === "feed"
                ? `Feed · ${event.amountOz} oz`
                : event.type === "sleep"
                  ? event.endTime
                    ? "Nap"
                    : "Sleep started"
                  : label || "A little moment"}
            </strong>
            <span className="paper-status">
              {event.status === "planned" ? <Clock3 /> : <Check />}
              {event.status === "planned" ? "Planned" : "Happened"}
            </span>
          </div>
        </div>
      </td>
      <td className="paper-notes">
        {note && <span>{note}</span>}
        {event.type === "sleep" && event.endTime && (
          <span className="paper-duration">
            {formatDuration(sleepMinutes(event) || 0)}
          </span>
        )}
        {!note && !(event.type === "sleep" && event.endTime) && (
          <span className="paper-empty-note">—</span>
        )}
      </td>
    </tr>
  )
}

export function ShareView({
  profile,
  day,
  onClose,
}: {
  profile: Profile
  day: Day
  onClose: () => void
}) {
  const [showTips, setShowTips] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState("")
  const [picture, setPicture] = useState<File | null>(null)
  const sheet = useRef<HTMLElement>(null)
  const events = [...day.events].sort((a, b) => a.time.localeCompare(b.time))
  const completed = events.filter((event) => event.status === "completed")
  const planned = events.filter((event) => event.status === "planned")
  const ounces = totalOunces(day.events)
  const minutes = completed.reduce(
    (sum, event) =>
      sum + (event.type === "sleep" ? sleepMinutes(event) || 0 : 0),
    0
  )
  const bottles = completed.filter((event) => event.type === "feed").length
  const next = planned[0]
  const timezone = profile.timezone.replaceAll("_", " ").split("/").at(-1)
  async function download() {
    if (!sheet.current || saving) return
    setSaving(true)
    setMessage("")
    try {
      const filename = `${profile.name}-${day.date}.png`
      const blob = await saveDayPicture(sheet.current, filename)
      const file = new File([blob], filename, { type: "image/png" })
      if (navigator.canShare?.({ files: [file] })) setPicture(file)
      setMessage(
        "Picture ready. Check your downloads, then share it with your little circle."
      )
    } catch {
      setMessage(
        "The picture couldn’t be created in this browser. You can still take a screenshot or use Print."
      )
    } finally {
      setSaving(false)
    }
  }
  return (
    <main className="paper-share-page">
      <div className="paper-controls">
        <Button variant="ghost" onClick={onClose}>
          <ArrowLeft /> Back
        </Button>
        <div className="paper-control-actions">
          <label className="paper-tips-toggle">
            <input
              type="checkbox"
              checked={showTips}
              onChange={(event) => {
                setShowTips(event.target.checked)
                setPicture(null)
                setMessage("")
              }}
              disabled={saving}
            />
            <span>Show tips</span>
          </label>
          <Button
            variant="ghost"
            className="paper-print-button"
            onClick={() => window.print()}
            aria-label="Print day sheet"
          >
            <Printer />
          </Button>
          <Button onClick={() => void download()} disabled={saving}>
            {saving ? <LoaderCircle className="spin" /> : <Download />}
            {saving ? "Making picture…" : "Save picture"}
          </Button>
        </div>
      </div>
      {message && (
        <div className="paper-export-message">
          <p role="status">{message}</p>
          {picture && (
            <Button
              variant="outline"
              onClick={async () => {
                try {
                  await navigator.share({
                    files: [picture],
                    title: `${profile.name}’s Full Day`,
                  })
                } catch (cause) {
                  if (!(
                    cause instanceof DOMException && cause.name === "AbortError"
                  ))
                    setMessage(
                      "Sharing is unavailable. Your PNG is still in downloads."
                    )
                }
              }}
            >
              <Share2 /> Share picture
            </Button>
          )}
        </div>
      )}
      <article
        className={`paper-sheet ${showTips ? "with-tips" : "without-tips"} ${events.length > 14 ? "paper-dense-day" : ""}`}
        ref={sheet}
        aria-label={`${profile.name}’s full day sheet`}
      >
        <header className="paper-heading">
          <div className="paper-heading-main">
            <h1>
              <Heart aria-hidden="true" />
              <span>{profile.name}’s Full Day</span>
              <Heart aria-hidden="true" />
            </h1>
            <p className="paper-subtitle">
              <span />
              {formatDate(day.date, {
                weekday: "long",
                month: "long",
                day: "numeric",
              })}
              <span />
            </p>
            <p className="paper-tagline">
              Little moments <span>♡</span> A little rhythm <span>♡</span> A lot
              of love
            </p>
          </div>
          <div className="paper-thank-you">
            <HappySun />
            <span>
              Thank you for
              <br />
              taking such
              <br />
              great care! <Heart />
            </span>
          </div>
        </header>
        {isSampleMode && (
          <p className="paper-sample">Sample day · not real records</p>
        )}
        <div className="paper-layout">
          <div className="paper-day-column">
            <div className="paper-table-wrap">
              <table className="paper-activity-table">
                <colgroup>
                  <col className="paper-time-column" />
                  <col className="paper-activity-column" />
                  <col className="paper-notes-column" />
                </colgroup>
                <thead>
                  <tr>
                    <th scope="col">Time</th>
                    <th scope="col">What’s happening</th>
                    <th scope="col">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {events.length ? (
                    events.map((event) => (
                      <ActivityRow key={event.id} event={event} />
                    ))
                  ) : (
                    <tr>
                      <td colSpan={3} className="paper-empty-day">
                        <Sun />
                        <strong>A fresh page for a little day.</strong>
                        <span>No events recorded yet.</span>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="paper-recap">
              <section className="paper-panel paper-so-far">
                <h2>
                  <Star /> Today so far
                </h2>
                <div className="paper-recap-line">
                  <BottleDoodle />
                  <div>
                    <strong>{ounces} oz</strong>
                    <span>
                      {bottles} {bottles === 1 ? "bottle" : "bottles"} ·{" "}
                      {day.goalOz} oz goal
                    </span>
                  </div>
                </div>
                <div className="paper-recap-line">
                  <Moon className="paper-moon" />
                  <div>
                    <strong>{formatDuration(minutes)}</strong>
                    <span>completed sleep</span>
                  </div>
                </div>
              </section>
              <section className="paper-panel paper-next">
                <h2>
                  <ArrowUpRight /> What’s next
                </h2>
                {next ? (
                  <>
                    <strong className="paper-next-time">
                      {formatTime(next.time)}
                    </strong>
                    <p>
                      {next.type === "feed"
                        ? `Feed · ${next.amountOz} oz`
                        : next.type === "sleep"
                          ? "A little sleep"
                          : next.note}
                    </p>
                    <span className="paper-small">
                      {planned.length} planned{" "}
                      {planned.length === 1 ? "moment" : "moments"} · not yet
                      counted
                    </span>
                  </>
                ) : (
                  <>
                    <p>No more plans just yet.</p>
                    <span className="paper-small">
                      Room for whatever the day brings.
                    </span>
                  </>
                )}
              </section>
            </div>
          </div>
          {showTips && (
            <aside className="paper-tips" aria-label="Day sheet tips">
              <section className="paper-panel paper-big-picture">
                <h2>
                  <Sparkles /> The big picture
                </h2>
                <p>
                  <BottleDoodle />
                  <span>
                    <strong>
                      {ounces} of {day.goalOz} oz
                    </strong>
                    <br />
                    recorded toward today’s goal.
                  </span>
                </p>
                <p>
                  <Moon className="paper-moon" />
                  <span>
                    <strong>{formatDuration(minutes)} of sleep</strong>
                    <br />
                    from completed sleep periods.
                  </span>
                </p>
                <p>
                  <Clock3 />
                  <span>
                    <strong>{timezone} time</strong>
                    <br />
                    for everyone following the day.
                  </span>
                </p>
              </section>
              <section className="paper-panel paper-reminders">
                <h2>
                  <Star /> Helpful reminders
                </h2>
                <ul>
                  <li>
                    <Check />
                    Record each bottle and nap as it happens.
                  </li>
                  <li>
                    <Check />
                    Plans can change. Update the times when they do.
                  </li>
                  <li>
                    <Check />
                    “Planned” is a plan; only “Happened” counts in totals.
                  </li>
                </ul>
              </section>
              <section className="paper-panel paper-little-details">
                <h2>
                  <House /> Little details
                </h2>
                {day.caregiverNote && (
                  <p className="paper-caregiver-note">{day.caregiverNote}</p>
                )}
                <p>The notes beside each activity travel with this sheet.</p>
                <p>
                  Add anything your little circle should know before sharing.
                </p>
              </section>
              <section className="paper-panel paper-goal">
                <h2>
                  <Heart /> Our little goal
                </h2>
                <p>
                  A shared picture of the day, so everyone can pick up where you
                  left off.
                </p>
                <span className="paper-goal-hearts">
                  ♡ <span>♡</span> ♡
                </span>
              </section>
            </aside>
          )}
        </div>
        <footer className="paper-footer">
          <span />
          <Heart />
          <p>You’re doing great!</p>
          <Heart />
          <span />
        </footer>
        <p className="paper-timezone">
          {timezone} time ·{" "}
          {formatDate(day.date, {
            month: "long",
            day: "numeric",
            year: "numeric",
          })}
        </p>
      </article>
      <p className="paper-export-hint">
        Save a picture captures the whole sheet, without these controls.
        <br />
        Hide tips for a simpler handoff. Activity notes always stay.
      </p>
    </main>
  )
}
