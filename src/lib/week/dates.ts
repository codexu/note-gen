/** Step by local calendar days so a DST transition cannot shift the week by an hour. */
export function localDay(day: Date, offset = 0): Date {
  const next = new Date(day)
  next.setDate(next.getDate() + offset)
  next.setHours(0, 0, 0, 0)
  return next
}

/** Monday in the week containing this date. */
export function weekStart(day: Date): Date {
  return localDay(day, -((day.getDay() + 6) % 7))
}

/** Seven local dates beginning at the supplied date. */
export function weekDays(start: Date): Date[] {
  return Array.from({ length: 7 }, (_, index) => localDay(start, index))
}
