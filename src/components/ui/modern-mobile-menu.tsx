"use client"

import * as React from "react"
import { Briefcase, Calendar, Home, Settings, Shield } from "lucide-react"

import { cn } from "@/lib/utils"

type IconComponentType = React.ElementType<{ className?: string }>

export interface InteractiveMenuItem {
  id?: string
  label: string
  icon: IconComponentType
  iconElement?: React.ReactNode
  indicator?: React.ReactNode
  disabled?: boolean
  swipeDisabled?: boolean
}

export interface InteractiveMenuProps {
  items?: InteractiveMenuItem[]
  accentColor?: string
  activeIndex?: number
  defaultActiveIndex?: number
  className?: string
  "aria-label"?: string
  onActiveIndexChange?: (index: number, item: InteractiveMenuItem) => void
}

const defaultItems: InteractiveMenuItem[] = [
  { label: "home", icon: Home },
  { label: "strategy", icon: Briefcase },
  { label: "period", icon: Calendar },
  { label: "security", icon: Shield },
  { label: "settings", icon: Settings },
]

const defaultAccentColor = "hsl(var(--component-active-color-default))"
const iconOnlyTrackWidth = 32
const activeMinTrackWidth = 80
const activeMaxTrackWidth = 112
const activeTrackChromeWidth = 50
const gridGapWidth = 4

const InteractiveMenu = React.forwardRef<HTMLElement, InteractiveMenuProps>(function InteractiveMenu(
  {
    items,
    accentColor,
    activeIndex,
    defaultActiveIndex = 0,
    className,
    "aria-label": ariaLabel = "Mobile navigation",
    onActiveIndexChange,
  },
  ref
) {
  const finalItems = React.useMemo(() => {
    const isValid = items && Array.isArray(items) && items.length >= 2 && items.length <= 5

    if (!isValid) {
      return defaultItems
    }

    return items
  }, [items])

  const [internalActiveIndex, setInternalActiveIndex] = React.useState(defaultActiveIndex)
  const isControlled = activeIndex !== undefined
  const selectedIndex = isControlled ? activeIndex : internalActiveIndex
  const safeActiveIndex =
    selectedIndex >= 0 && selectedIndex < finalItems.length ? selectedIndex : 0
  const navRef = React.useRef<HTMLElement | null>(null)
  const labelMeasureRefs = React.useRef<(HTMLSpanElement | null)[]>([])
  const [layoutMetrics, setLayoutMetrics] = React.useState({
    contentWidth: 0,
    labelWidths: [] as number[],
  })

  React.useEffect(() => {
    if (!isControlled && internalActiveIndex >= finalItems.length) {
      setInternalActiveIndex(0)
    }
  }, [finalItems.length, internalActiveIndex, isControlled])

  const setNavRef = React.useCallback(
    (node: HTMLElement | null) => {
      navRef.current = node

      if (typeof ref === "function") {
        ref(node)
        return
      }

      if (ref) {
        ;(ref as React.MutableRefObject<HTMLElement | null>).current = node
      }
    },
    [ref]
  )

  React.useEffect(() => {
    const navElement = navRef.current

    if (!navElement) {
      return
    }

    function measureLayout() {
      const currentNavElement = navRef.current

      if (!currentNavElement) {
        return
      }

      const styles = window.getComputedStyle(currentNavElement)
      const paddingX = parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight)
      const nextContentWidth = Math.max(0, currentNavElement.clientWidth - paddingX)
      const nextLabelWidths = finalItems.map((_, index) => {
        const labelElement = labelMeasureRefs.current[index]

        return labelElement ? Math.ceil(labelElement.getBoundingClientRect().width) : 0
      })

      setLayoutMetrics(previous => {
        const sameContentWidth = previous.contentWidth === nextContentWidth
        const sameLabelWidths =
          previous.labelWidths.length === nextLabelWidths.length &&
          previous.labelWidths.every((width, index) => width === nextLabelWidths[index])

        if (sameContentWidth && sameLabelWidths) {
          return previous
        }

        return {
          contentWidth: nextContentWidth,
          labelWidths: nextLabelWidths,
        }
      })
    }

    measureLayout()

    const resizeObserver = new ResizeObserver(measureLayout)
    resizeObserver.observe(navElement)
    window.addEventListener("resize", measureLayout)

    return () => {
      resizeObserver.disconnect()
      window.removeEventListener("resize", measureLayout)
    }
  }, [finalItems])

  const gridTemplateColumns = React.useMemo(() => {
    const itemCount = finalItems.length
    const inactiveItemCount = Math.max(itemCount - 1, 0)

    if (layoutMetrics.contentWidth <= 0 || inactiveItemCount === 0) {
      return finalItems.map((_, index) => (index === safeActiveIndex ? "2fr" : "1fr")).join(" ")
    }

    const trackSpace = Math.max(
      0,
      layoutMetrics.contentWidth - gridGapWidth * inactiveItemCount
    )
    const labelWidth = layoutMetrics.labelWidths[safeActiveIndex] ?? 0
    const desiredActiveWidth = labelWidth + activeTrackChromeWidth
    const availableActiveWidth =
      trackSpace - iconOnlyTrackWidth * inactiveItemCount
    const maxActiveWidth = Math.min(
      activeMaxTrackWidth,
      Math.max(iconOnlyTrackWidth, availableActiveWidth)
    )
    const activeWidth = Math.min(
      Math.max(desiredActiveWidth, Math.min(activeMinTrackWidth, maxActiveWidth)),
      maxActiveWidth
    )
    const inactiveWidth = Math.max(
      iconOnlyTrackWidth,
      (trackSpace - activeWidth) / inactiveItemCount
    )

    return finalItems
      .map((_, index) => `${Math.round(index === safeActiveIndex ? activeWidth : inactiveWidth)}px`)
      .join(" ")
  }, [finalItems, layoutMetrics, safeActiveIndex])

  const navStyle = React.useMemo(
    () =>
      ({
        "--component-active-color": accentColor || defaultAccentColor,
        gridTemplateColumns,
      }) as React.CSSProperties,
    [accentColor, gridTemplateColumns]
  )

  function handleItemClick(index: number, item: InteractiveMenuItem) {
    if (item.disabled) {
      return
    }

    if (!isControlled) {
      setInternalActiveIndex(index)
    }

    onActiveIndexChange?.(index, item)
  }

  return (
    <nav
      aria-label={ariaLabel}
      className={cn(
        "relative mx-auto grid h-14 w-full max-w-md items-center gap-1 rounded-[1.35rem] border border-border/60 bg-background/70 backdrop-blur-xl transition-[grid-template-columns] duration-[220ms] ease-out supports-[backdrop-filter]:bg-background/60",
        className
      )}
      ref={setNavRef}
      role="navigation"
      style={navStyle}
    >
      {finalItems.map((item, index) => {
        const isActive = index === safeActiveIndex
        const IconComponent = item.icon

        return (
          <button
            key={item.id ?? item.label}
            aria-current={isActive ? "page" : undefined}
            aria-label={item.label}
            className={cn(
              "group relative flex h-12 min-w-0 items-center justify-center rounded-2xl px-0.5 text-[hsl(var(--component-inactive-color))] transition-[color,transform] duration-200 active:scale-95 disabled:pointer-events-none disabled:opacity-50",
              isActive && "text-[var(--component-active-color)]"
            )}
            disabled={item.disabled}
            data-swipe-disabled={item.swipeDisabled || undefined}
            type="button"
            onClick={() => handleItemClick(index, item)}
          >
            <span
              className={cn(
                "relative flex h-10 min-w-8 max-w-full items-center justify-center rounded-2xl px-2 transition-[background-color,box-shadow] duration-200",
                isActive && "gap-1.5 bg-[hsl(var(--component-active-bg))] px-2.5 shadow-sm shadow-black/5"
              )}
            >
              <span className="relative inline-flex size-5 shrink-0 items-center justify-center">
                {item.iconElement ?? <IconComponent className="size-5" />}
                {item.indicator}
              </span>
              <strong
                className={cn(
                  "max-w-0 truncate text-xs font-medium leading-none opacity-0 transition-[max-width,opacity] duration-[220ms] ease-out",
                  isActive && "max-w-32 opacity-100"
                )}
              >
                {item.label}
              </strong>
            </span>
          </button>
        )
      })}
      <span aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden opacity-0">
        {finalItems.map((item, index) => (
          <span
            key={item.id ?? item.label}
            ref={element => {
              labelMeasureRefs.current[index] = element
            }}
            className="absolute whitespace-nowrap text-xs font-medium leading-none"
          >
            {item.label}
          </span>
        ))}
      </span>
    </nav>
  )
})

export { InteractiveMenu }
