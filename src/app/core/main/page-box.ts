import type { CSSProperties } from 'react'

export interface PageBox { top: number, right: number, bottom: number, left: number, radius: string }

/**
 * 首頁／Inbox 頁的外框：左緣接在左側欄之後，上下緣與圓角跟第一個看得到的工作區面板一樣。
 * Fork（almanac ALMNC-24）：v3 左右側欄固定，全頁畫面只蓋中間面板；中間收合時才退回蓋到右緣。
 */
export function measurePageBox(container: HTMLElement, group: HTMLElement, panels: HTMLElement[], confineToCenter = false): PageBox {
  const box = container.getBoundingClientRect()
  const groupBox = group.getBoundingClientRect()
  const groupStyle = getComputedStyle(group)
  const visible = (panel: HTMLElement) => panel.getBoundingClientRect().width > 1
  const sidebar = panels.find(panel => panel.querySelector('[data-left-sidebar]'))
  const work = panels.find(panel => panel !== sidebar && visible(panel))
  const contentLeft = groupBox.left + parseFloat(groupStyle.paddingLeft)
  const center = confineToCenter ? panels.find(panel => panel.id === 'center' && visible(panel)) : undefined
  const contentRight = center ? center.getBoundingClientRect().right : groupBox.right - parseFloat(groupStyle.paddingRight)
  const left = work
    ? work.getBoundingClientRect().left
    : sidebar && visible(sidebar) ? sidebar.getBoundingClientRect().right + 1 : contentLeft
  const reference = (work ?? sidebar)?.getBoundingClientRect()
  return {
    left: Math.max(0, Math.round(left - box.left)),
    right: Math.max(0, Math.round(box.right - contentRight)),
    top: reference ? Math.max(0, Math.round(reference.top - box.top)) : 0,
    bottom: reference ? Math.max(0, Math.round(box.bottom - reference.bottom)) : 28,
    radius: work ? getComputedStyle(work).borderTopLeftRadius : '0px',
  }
}

export function pageBoxStyle(box: PageBox | null): CSSProperties {
  // 還沒量到之前：貼齊容器、留出狀態列（h-7）
  const value = box ?? { top: 0, right: 0, bottom: 28, left: 0, radius: '0px' }
  return {
    '--page-top': `${value.top}px`,
    '--page-right': `${value.right}px`,
    '--page-bottom': `${value.bottom}px`,
    '--page-left': `${value.left}px`,
    '--page-radius': value.radius,
  } as CSSProperties
}
