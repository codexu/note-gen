'use client'

import { Component, type ErrorInfo, type ReactNode } from 'react'
import {
  BugIcon,
  CircleAlertIcon,
  ClipboardIcon,
  RefreshCwIcon,
  XIcon,
} from 'lucide-react'
import { openUrl } from '@tauri-apps/plugin-opener'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

const GITHUB_BUG_REPORT_URL = 'https://github.com/codexu/note-gen/issues/new'

interface TabContentErrorBoundaryProps {
  children: ReactNode
  tabName: string
  onClose: () => void
}

interface TabContentErrorBoundaryState {
  error: Error | null
  copied: boolean
  actionError: string
}

export class TabContentErrorBoundary extends Component<
  TabContentErrorBoundaryProps,
  TabContentErrorBoundaryState
> {
  state: TabContentErrorBoundaryState = {
    error: null,
    copied: false,
    actionError: '',
  }

  static getDerivedStateFromError(error: Error): Partial<TabContentErrorBoundaryState> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('标签页内容渲染失败:', error, info.componentStack)
  }

  private getErrorDetails() {
    const { error } = this.state
    return [
      `标签页：${this.props.tabName}`,
      `错误：${error?.message || '未知错误'}`,
      `时间：${new Date().toISOString()}`,
      error?.stack ? `\n${error.stack}` : '',
    ].filter(Boolean).join('\n')
  }

  private retry = () => {
    this.setState({
      error: null,
      copied: false,
      actionError: '',
    })
  }

  private copyErrorDetails = async () => {
    try {
      await navigator.clipboard.writeText(this.getErrorDetails())
      this.setState({ copied: true, actionError: '' })
      window.setTimeout(() => this.setState({ copied: false }), 2000)
    } catch (error) {
      console.error('复制标签页错误信息失败:', error)
      this.setState({ actionError: '无法复制错误信息，请检查剪贴板权限' })
    }
  }

  private reportGitHubIssue = async () => {
    let diagnosticsCopied = false
    try {
      await navigator.clipboard.writeText(this.getErrorDetails())
      diagnosticsCopied = true
    } catch (error) {
      console.error('复制 GitHub 反馈信息失败:', error)
    }

    try {
      const issueUrl = new URL(GITHUB_BUG_REPORT_URL)
      issueUrl.searchParams.set('template', 'bug_report.yml')
      issueUrl.searchParams.set('title', '[bug] 标签页进入错误隔离模式')
      await openUrl(issueUrl)
      this.setState({
        actionError: diagnosticsCopied
          ? ''
          : 'GitHub 已打开，但错误信息复制失败，请手动填写报错日志。',
      })
    } catch (error) {
      console.error('打开 GitHub 反馈页面失败:', error)
      this.setState({ actionError: '无法打开 GitHub 反馈页面，请检查网络或浏览器设置。' })
    }
  }

  render() {
    const { children, onClose } = this.props
    const { actionError, copied, error } = this.state

    if (!error) return children

    return (
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-muted/30 p-4">
        <Card className="w-full max-w-xl">
          <CardHeader>
            <CardTitle>当前标签页出现错误</CardTitle>
            <CardDescription>
              只有这个标签页已停止显示，侧边栏、其他标签页和设置仍可继续使用。
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Alert variant="destructive">
              <CircleAlertIcon />
              <AlertTitle>错误详情</AlertTitle>
              <AlertDescription className="max-h-24 overflow-auto break-words font-mono text-xs">
                {error.message || '未知错误'}
              </AlertDescription>
            </Alert>
            {actionError ? (
              <Alert variant="destructive">
                <CircleAlertIcon />
                <AlertTitle>操作失败</AlertTitle>
                <AlertDescription>{actionError}</AlertDescription>
              </Alert>
            ) : null}
          </CardContent>
          <CardFooter className="flex flex-wrap justify-between gap-2">
            <div className="flex flex-wrap gap-2">
              <Button onClick={this.retry}>
                <RefreshCwIcon data-icon="inline-start" />
                重试当前标签页
              </Button>
              <Button variant="outline" onClick={onClose}>
                <XIcon data-icon="inline-start" />
                关闭当前标签页
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" size="sm" onClick={() => void this.copyErrorDetails()}>
                <ClipboardIcon data-icon="inline-start" />
                {copied ? '已复制' : '复制错误信息'}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => void this.reportGitHubIssue()}>
                <BugIcon data-icon="inline-start" />
                反馈 GitHub Issue
              </Button>
            </div>
          </CardFooter>
        </Card>
      </div>
    )
  }
}
