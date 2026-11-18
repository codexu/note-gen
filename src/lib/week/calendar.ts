import { invokeCalendar, type CalendarResponse } from '@/lib/calendar/calendar'
import { localDay } from './dates'

/** Read seven local calendar days from the supplied start date, without prompting. */
export function loadCalendarWeek(start: Date): Promise<CalendarResponse> {
  return invokeCalendar('calendar_week', weekRange(start))
}

/** Request access on explicit user action and return the same seven-day range. */
export function requestCalendarWeekAccess(start: Date): Promise<CalendarResponse> {
  return invokeCalendar('calendar_request_access', weekRange(start))
}

function weekRange(start: Date) {
  return { start: localDay(start).getTime(), end: localDay(start, 7).getTime() }
}
