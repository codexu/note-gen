'use client'

import { useMemo } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  RadialBar,
  RadialBarChart,
  XAxis,
  YAxis,
} from 'recharts'
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from '@/components/ui/chart'
import {
  getCanvasChartColors,
  resolveCanvasChartAppearance,
} from '@/lib/canvas/chart-appearance'
import { cn } from '@/lib/utils'
import type { CanvasChartAppearance, CanvasChartSpec } from '@/types/canvas'

export function CanvasChart({
  spec,
  appearance: appearanceValue,
  className,
}: {
  spec: CanvasChartSpec
  appearance?: CanvasChartAppearance
  className?: string
}) {
  const appearance = resolveCanvasChartAppearance(appearanceValue)
  const colors = getCanvasChartColors(appearance.palette)
  const seriesColor = (index: number) => colors[index % colors.length]
  const { chartData, config } = useMemo(() => {
    const nextConfig: ChartConfig = Object.fromEntries(spec.series.map(series => [
      series.id,
      {
        label: series.name,
        color: seriesColor(series.colorIndex),
      },
    ]))
    const nextData = spec.data.map((datum, index) => ({
      label: datum.label,
      ...datum.values,
      fill: seriesColor(index),
    }))
    return { chartData: nextData, config: nextConfig }
  }, [colors, spec.data, spec.series])

  const commonCartesian = (
    <>
      {appearance.showGrid && <CartesianGrid vertical={false} />}
      {appearance.showXAxis && (
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={16} />
      )}
      {appearance.showYAxis && <YAxis tickLine={false} axisLine={false} width={42} />}
      {appearance.showLegend && <ChartLegend content={<ChartLegendContent />} />}
    </>
  )

  let chart: React.ReactNode
  if (spec.type === 'line') {
    chart = (
      <LineChart accessibilityLayer data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        {commonCartesian}
        {spec.series.map(series => (
          <Line
            key={series.id}
            type="monotone"
            dataKey={series.id}
            stroke={`var(--color-${series.id})`}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    )
  } else if (spec.type === 'area') {
    chart = (
      <AreaChart accessibilityLayer data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        {commonCartesian}
        {spec.series.map(series => (
          <Area
            key={series.id}
            type="monotone"
            dataKey={series.id}
            fill={`var(--color-${series.id})`}
            fillOpacity={0.22}
            stroke={`var(--color-${series.id})`}
            strokeWidth={2}
            isAnimationActive={false}
          />
        ))}
      </AreaChart>
    )
  } else if (spec.type === 'bar') {
    chart = (
      <BarChart accessibilityLayer data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        {commonCartesian}
        {spec.series.map(series => (
          <Bar
            key={series.id}
            dataKey={series.id}
            fill={`var(--color-${series.id})`}
            radius={4}
            isAnimationActive={false}
          />
        ))}
      </BarChart>
    )
  } else if (spec.type === 'radar') {
    chart = (
      <RadarChart accessibilityLayer data={chartData} margin={{ top: 12, right: 24, bottom: 12, left: 24 }}>
        {appearance.showGrid && <PolarGrid />}
        {appearance.showXAxis && <PolarAngleAxis dataKey="label" />}
        {appearance.showLegend && <ChartLegend content={<ChartLegendContent />} />}
        {spec.series.map(series => (
          <Radar
            key={series.id}
            dataKey={series.id}
            fill={`var(--color-${series.id})`}
            fillOpacity={0.16}
            stroke={`var(--color-${series.id})`}
            strokeWidth={2}
            isAnimationActive={false}
          />
        ))}
      </RadarChart>
    )
  } else {
    const primarySeries = spec.series.find(series => series.id === spec.primarySeriesId) || spec.series[0]
    const polarConfig: ChartConfig = {
      [primarySeries.id]: {
        label: primarySeries.name,
        color: seriesColor(primarySeries.colorIndex),
      },
      ...Object.fromEntries(spec.data.map((datum, index) => [
        datum.label,
        { label: datum.label, color: seriesColor(index) },
      ])),
    }
    chart = spec.type === 'pie' ? (
      <PieChart accessibilityLayer>
        {appearance.showLegend && <ChartLegend content={<ChartLegendContent nameKey="label" />} />}
        <Pie
          data={chartData}
          dataKey={primarySeries.id}
          nameKey="label"
          innerRadius="34%"
          outerRadius="72%"
          paddingAngle={2}
          isAnimationActive={false}
        >
          {chartData.map((datum, index) => <Cell key={datum.label} fill={seriesColor(index)} />)}
        </Pie>
      </PieChart>
    ) : (
      <RadialBarChart
        accessibilityLayer
        data={chartData}
        innerRadius="22%"
        outerRadius="88%"
        startAngle={90}
        endAngle={-270}
      >
        {appearance.showLegend && <ChartLegend content={<ChartLegendContent nameKey="label" />} />}
        <RadialBar dataKey={primarySeries.id} background isAnimationActive={false}>
          {chartData.map((datum, index) => <Cell key={datum.label} fill={seriesColor(index)} />)}
        </RadialBar>
      </RadialBarChart>
    )
    return (
      <ChartContainer config={polarConfig} className={cn('size-full min-h-48 aspect-auto', className)}>
        {chart}
      </ChartContainer>
    )
  }

  return (
    <ChartContainer config={config} className={cn('size-full min-h-48 aspect-auto', className)}>
      {chart}
    </ChartContainer>
  )
}
