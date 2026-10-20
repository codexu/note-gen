'use client'

import { useEffect, useState } from 'react'
import {
  ArrowDownNarrowWide,
  Grid3X3,
  LayoutGrid,
  Magnet,
  Map,
  Mouse,
  MousePointer2,
  Palette,
  Scan,
  Scaling,
} from 'lucide-react'
import { useTranslations } from 'next-intl'

import { SettingSection, SettingType } from '../components/setting-base'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import type {
  CanvasGridStyle,
  CanvasInsertBehavior,
  CanvasManagerSortMode,
  CanvasManagerViewMode,
  CanvasWheelBehavior,
} from '@/lib/canvas/preferences'
import useSettingStore from '@/stores/setting'

type GridStyleOption = CanvasGridStyle | 'none'

const gridStyleOptions: GridStyleOption[] = ['dots', 'lines', 'none']
const wheelBehaviorOptions: CanvasWheelBehavior[] = ['zoom', 'pan']
const insertBehaviorOptions: CanvasInsertBehavior[] = ['keep', 'select']
const viewModeOptions: CanvasManagerViewMode[] = ['grid', 'list']
const sortModeOptions: CanvasManagerSortMode[] = ['updated', 'created', 'name']

export default function CanvasSettingPage({ mobile = false }: { mobile?: boolean }) {
  const t = useTranslations('settings.canvas')
  const {
    canvasGridVisible,
    canvasSnapToGrid,
    canvasMinimapVisible,
    canvasGridStyle,
    canvasGridGap,
    canvasDefaultZoom,
    canvasManagerViewMode,
    canvasManagerSortMode,
    canvasWheelBehavior,
    canvasInsertBehavior,
    setCanvasGridVisible,
    setCanvasSnapToGrid,
    setCanvasMinimapVisible,
    setCanvasGridStyle,
    setCanvasGridGap,
    setCanvasDefaultZoom,
    setCanvasManagerViewMode,
    setCanvasManagerSortMode,
    setCanvasWheelBehavior,
    setCanvasInsertBehavior,
  } = useSettingStore()
  const [gridGapDraft, setGridGapDraft] = useState(canvasGridGap)
  const [zoomDraft, setZoomDraft] = useState(canvasDefaultZoom)

  useEffect(() => setGridGapDraft(canvasGridGap), [canvasGridGap])
  useEffect(() => setZoomDraft(canvasDefaultZoom), [canvasDefaultZoom])

  const selectedGridStyle: GridStyleOption = canvasGridVisible
    ? canvasGridStyle
    : 'none'

  async function handleGridStyleChange(value: string) {
    if (!value) return
    if (value === 'none') {
      await setCanvasGridVisible(false)
      return
    }
    if (value === 'dots' || value === 'lines') {
      await setCanvasGridStyle(value)
      await setCanvasGridVisible(true)
    }
  }

  return (
    <SettingType
      id="canvas"
      icon={<Palette />}
      title={t('title')}
      desc={t('desc')}
    >
      <SettingSection title={t('display.title')} desc={t('display.desc')}>
        <ItemGroup>
          <Item variant="outline">
            <ItemMedia variant="icon">
              <Grid3X3 />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>{t('display.showGrid.title')}</ItemTitle>
              <ItemDescription>{t('display.showGrid.desc')}</ItemDescription>
            </ItemContent>
            <ItemActions className="mobile-setting-inline-action">
              <Switch
                checked={canvasGridVisible}
                aria-label={t('display.showGrid.title')}
                onCheckedChange={(checked) => void setCanvasGridVisible(checked)}
              />
            </ItemActions>
          </Item>

          <Item variant="outline">
            <ItemMedia variant="icon">
              <Magnet />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>{t('display.snapToGrid.title')}</ItemTitle>
              <ItemDescription>{t('display.snapToGrid.desc')}</ItemDescription>
            </ItemContent>
            <ItemActions className="mobile-setting-inline-action">
              <Switch
                checked={canvasSnapToGrid}
                aria-label={t('display.snapToGrid.title')}
                onCheckedChange={(checked) => void setCanvasSnapToGrid(checked)}
              />
            </ItemActions>
          </Item>

          <Item variant="outline">
            <ItemMedia variant="icon">
              <Map />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>{t('display.minimap.title')}</ItemTitle>
              <ItemDescription>{t('display.minimap.desc')}</ItemDescription>
            </ItemContent>
            <ItemActions className="mobile-setting-inline-action">
              <Switch
                checked={canvasMinimapVisible}
                aria-label={t('display.minimap.title')}
                onCheckedChange={(checked) => void setCanvasMinimapVisible(checked)}
              />
            </ItemActions>
          </Item>

          <Item variant="outline">
            <ItemMedia variant="icon">
              <Scan />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>{t('display.gridStyle.title')}</ItemTitle>
              <ItemDescription>{t('display.gridStyle.desc')}</ItemDescription>
            </ItemContent>
            <ItemActions className="basis-full sm:ml-auto sm:basis-auto">
              <ToggleGroup
                type="single"
                variant="outline"
                value={selectedGridStyle}
                className="w-full flex-wrap sm:w-auto"
                aria-label={t('display.gridStyle.title')}
                onValueChange={(value) => void handleGridStyleChange(value)}
              >
                {gridStyleOptions.map((option) => (
                  <ToggleGroupItem
                    key={option}
                    value={option}
                    className="flex-1 sm:flex-none"
                  >
                    {t(`display.gridStyle.options.${option}`)}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </ItemActions>
          </Item>

          <Item variant="outline" data-disabled={!canvasGridVisible}>
            <ItemMedia variant="icon">
              <Scaling />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>{t('display.gridGap.title')}</ItemTitle>
              <ItemDescription>{t('display.gridGap.desc')}</ItemDescription>
            </ItemContent>
            <ItemActions className="basis-full sm:ml-auto sm:basis-56">
              <div className="flex w-full items-center gap-3">
                <Slider
                  min={8}
                  max={48}
                  step={4}
                  disabled={!canvasGridVisible}
                  value={[gridGapDraft]}
                  aria-label={t('display.gridGap.title')}
                  onValueChange={(value) => setGridGapDraft(value[0] ?? gridGapDraft)}
                  onValueCommit={(value) => void setCanvasGridGap(value[0] ?? gridGapDraft)}
                />
                <span className="w-10 shrink-0 text-right text-sm tabular-nums">
                  {gridGapDraft}px
                </span>
              </div>
            </ItemActions>
          </Item>

          <Item variant="outline">
            <ItemMedia variant="icon">
              <Scaling />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>{t('display.defaultZoom.title')}</ItemTitle>
              <ItemDescription>{t('display.defaultZoom.desc')}</ItemDescription>
            </ItemContent>
            <ItemActions className="basis-full sm:ml-auto sm:basis-56">
              <div className="flex w-full items-center gap-3">
                <Slider
                  min={0.25}
                  max={2}
                  step={0.05}
                  value={[zoomDraft]}
                  aria-label={t('display.defaultZoom.title')}
                  onValueChange={(value) => setZoomDraft(value[0] ?? zoomDraft)}
                  onValueCommit={(value) => void setCanvasDefaultZoom(value[0] ?? zoomDraft)}
                />
                <span className="w-12 shrink-0 text-right text-sm tabular-nums">
                  {Math.round(zoomDraft * 100)}%
                </span>
              </div>
            </ItemActions>
          </Item>
        </ItemGroup>
      </SettingSection>

      <SettingSection title={t('interaction.title')} desc={t('interaction.desc')}>
        <ItemGroup>
          {!mobile ? <Item variant="outline">
            <ItemMedia variant="icon">
              <Mouse />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>{t('interaction.wheel.title')}</ItemTitle>
              <ItemDescription>{t('interaction.wheel.desc')}</ItemDescription>
            </ItemContent>
            <ItemActions className="basis-full sm:ml-auto sm:basis-auto">
              <ToggleGroup
                type="single"
                variant="outline"
                value={canvasWheelBehavior}
                className="w-full flex-wrap sm:w-auto"
                aria-label={t('interaction.wheel.title')}
                onValueChange={(value) => {
                  if (value) void setCanvasWheelBehavior(value as CanvasWheelBehavior)
                }}
              >
                {wheelBehaviorOptions.map((option) => (
                  <ToggleGroupItem
                    key={option}
                    value={option}
                    className="flex-1 sm:flex-none"
                  >
                    {t(`interaction.wheel.options.${option}`)}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </ItemActions>
          </Item> : null}

          <Item variant="outline">
            <ItemMedia variant="icon">
              <MousePointer2 />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>{t('interaction.afterInsert.title')}</ItemTitle>
              <ItemDescription>{t('interaction.afterInsert.desc')}</ItemDescription>
            </ItemContent>
            <ItemActions className="basis-full sm:ml-auto sm:basis-auto">
              <ToggleGroup
                type="single"
                variant="outline"
                value={canvasInsertBehavior}
                className="w-full flex-wrap sm:w-auto"
                aria-label={t('interaction.afterInsert.title')}
                onValueChange={(value) => {
                  if (value) void setCanvasInsertBehavior(value as CanvasInsertBehavior)
                }}
              >
                {insertBehaviorOptions.map((option) => (
                  <ToggleGroupItem
                    key={option}
                    value={option}
                    className="flex-1 sm:flex-none"
                  >
                    {t(`interaction.afterInsert.options.${option}`)}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </ItemActions>
          </Item>
        </ItemGroup>
      </SettingSection>

      <SettingSection title={t('manager.title')} desc={t('manager.desc')}>
        <ItemGroup>
          {!mobile ? <Item variant="outline">
            <ItemMedia variant="icon">
              <LayoutGrid />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>{t('manager.view.title')}</ItemTitle>
              <ItemDescription>{t('manager.view.desc')}</ItemDescription>
            </ItemContent>
            <ItemActions className="basis-full sm:ml-auto sm:basis-auto">
              <ToggleGroup
                type="single"
                variant="outline"
                value={canvasManagerViewMode}
                className="w-full flex-wrap sm:w-auto"
                aria-label={t('manager.view.title')}
                onValueChange={(value) => {
                  if (value) void setCanvasManagerViewMode(value as CanvasManagerViewMode)
                }}
              >
                {viewModeOptions.map((option) => (
                  <ToggleGroupItem
                    key={option}
                    value={option}
                    className="flex-1 sm:flex-none"
                  >
                    {t(`manager.view.options.${option}`)}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </ItemActions>
          </Item> : null}

          <Item variant="outline">
            <ItemMedia variant="icon">
              <ArrowDownNarrowWide />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>{t('manager.sort.title')}</ItemTitle>
              <ItemDescription>{t('manager.sort.desc')}</ItemDescription>
            </ItemContent>
            <ItemActions className="basis-full sm:ml-auto sm:basis-auto">
              <ToggleGroup
                type="single"
                variant="outline"
                value={canvasManagerSortMode}
                className="w-full flex-wrap sm:w-auto"
                aria-label={t('manager.sort.title')}
                onValueChange={(value) => {
                  if (value) void setCanvasManagerSortMode(value as CanvasManagerSortMode)
                }}
              >
                {sortModeOptions.map((option) => (
                  <ToggleGroupItem
                    key={option}
                    value={option}
                    className="flex-1 sm:flex-none"
                  >
                    {t(`manager.sort.options.${option}`)}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </ItemActions>
          </Item>
        </ItemGroup>
      </SettingSection>
    </SettingType>
  )
}
