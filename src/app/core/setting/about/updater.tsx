'use client';

import { relaunch } from '@tauri-apps/plugin-process';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useLocale, useTranslations } from 'next-intl';
import useSettingStore from '@/stores/setting';
import useUpdateStore from '@/stores/update';
import Image from 'next/image';
import { toast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, ArrowRight, Info, Loader2, RefreshCw, RotateCcw } from 'lucide-react';
import { getReleases, type GithubRelease } from '@/lib/sync/github';
import { checkIsTauri, isMobileDevice } from '@/lib/check';
import { compareVersions, extractVersionText, isPrereleaseVersion, parseVersion } from '@/lib/version';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import MarkdownIt from 'markdown-it';

const RELEASE_NOTE_SKELETON_ROWS = [0, 1, 2];

const releaseMarkdown = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
});

releaseMarkdown.renderer.rules.link_open = function (tokens, idx, options, _env, self) {
  tokens[idx].attrSet('target', '_blank');
  tokens[idx].attrSet('rel', 'noopener noreferrer');
  return self.renderToken(tokens, idx, options);
}

interface ReleaseNote {
  version: string
  title: string
  body: string | null
  publishedAt: string | null
  prerelease: boolean
}

interface BuildReleaseNotesOptions {
  currentVersion: string
  includePrereleases: boolean
}

type ReleaseLoadStatus = 'idle' | 'loading' | 'ready' | 'error'

function getReleaseVersionText(release: GithubRelease) {
  return extractVersionText(release.tag_name) ?? extractVersionText(release.name);
}

function buildReleaseNotes(releases: GithubRelease[], options: BuildReleaseNotesOptions) {
  const currentVersion = parseVersion(options.currentVersion);
  if (!currentVersion) return [];

  return releases
    .filter((release) => !release.draft)
    .map((release) => {
      const releaseVersionText = getReleaseVersionText(release);
      if (!releaseVersionText) return null;

      const releaseVersion = parseVersion(releaseVersionText);
      const prerelease = Boolean(release.prerelease || isPrereleaseVersion(releaseVersionText));

      if (
        !releaseVersion ||
        compareVersions(releaseVersion, currentVersion) <= 0 ||
        (!options.includePrereleases && prerelease)
      ) {
        return null;
      }

      return {
        version: releaseVersion.text,
        title: release.name || `NoteGen v${releaseVersion.text}`,
        body: release.body ?? null,
        publishedAt: release.published_at ?? null,
        prerelease,
      } satisfies ReleaseNote;
    })
    .filter((release): release is ReleaseNote => Boolean(release))
    .sort((left, right) => compareVersions(right.version, left.version));
}

function getErrorDescription(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return '';
}

function ReleaseMarkdown({ body, fallback }: { body: string | null, fallback: string }) {
  const markdown = body?.trim() || fallback;
  const html = useMemo(() => releaseMarkdown.render(markdown), [markdown]);

  return (
    <div
      className="max-w-none text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere] [&_a]:font-medium [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-4 [&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-foreground [&_h1]:mb-2 [&_h1]:mt-4 [&_h1]:text-base [&_h1]:font-semibold [&_h1]:text-foreground [&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:text-foreground [&_h3]:mb-2 [&_h3]:mt-3 [&_h3]:font-medium [&_h3]:text-foreground [&_li]:my-1 [&_ol]:ml-5 [&_ol]:list-decimal [&_p]:my-2 [&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_strong]:text-foreground [&_ul]:ml-5 [&_ul]:list-disc"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

function ReleaseNotesSkeleton() {
  return (
    <div className="flex flex-col gap-3 rounded-md border bg-muted/30 p-4">
      {RELEASE_NOTE_SKELETON_ROWS.map((item) => (
        <div key={item} className="flex flex-col gap-3 border-b pb-3 last:border-b-0 last:pb-0">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3 w-1/4" />
            </div>
            <Skeleton className="h-5 w-16" />
          </div>
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-4/5" />
        </div>
      ))}
    </div>
  )
}

export default function Updater() {
  const t = useTranslations('settings.about');
  const locale = useLocale();
  const [checking, setChecking] = useState(false);
  const [loading, setLoading] = useState(false);
  const { version } = useSettingStore();
  const {
    update,
    hasUpdate,
    latestVersion,
    ignoredVersion,
    checkForUpdates,
    ignoreCurrentVersion,
    clearIgnoredVersion,
  } = useUpdateStore();
  const [releaseNotes, setReleaseNotes] = useState<ReleaseNote[]>([]);
  const [releaseLoadStatus, setReleaseLoadStatus] = useState<ReleaseLoadStatus>('idle');
  const [releaseLoadError, setReleaseLoadError] = useState<string | null>(null);
  const [lastCheckedAt, setLastCheckedAt] = useState<Date | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [isTauri, setIsTauri] = useState(true);
  const availableUpdate = hasUpdate ? update : null;
  const ignoredUpdateVersion = !hasUpdate && ignoredVersion && (update?.version === ignoredVersion || latestVersion === ignoredVersion)
    ? ignoredVersion
    : '';
  const latestRelease = releaseNotes[0];
  const displayLatestVersion = latestRelease?.version || availableUpdate?.version || ignoredUpdateVersion || latestVersion || '-';
  const primaryActionText = availableUpdate
    ? t('updateAvailable')
    : checking || ignoredUpdateVersion || !lastCheckedAt
      ? t('checkUpdate')
      : t('noUpdate');
  const showReleaseHistory = Boolean(availableUpdate || ignoredUpdateVersion) && (
    releaseLoadStatus === 'loading' ||
    releaseLoadStatus === 'error' ||
    releaseLoadStatus === 'ready' ||
    releaseNotes.length > 0
  );

  function formatDateTime(dateLike: Date | string | null) {
    if (!dateLike) return '';

    const date = typeof dateLike === 'string' ? new Date(dateLike) : dateLike;
    if (Number.isNaN(date.getTime())) return '';

    return new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date);
  }

  async function checkUpdate(forceRefresh = false) {
    setChecking(true);

    try {
      await checkForUpdates();
      setReleaseLoadStatus('loading');
      setReleaseLoadError(null);

      const releases = await getReleases({ forceRefresh });
      if (!releases) {
        setReleaseNotes([]);
        setReleaseLoadStatus('error');
        setReleaseLoadError(t('releaseLoadError'));
        return;
      }

      const updateState = useUpdateStore.getState();
      const includePrereleases = isPrereleaseVersion(version) || isPrereleaseVersion(updateState.update?.version ?? updateState.latestVersion);
      const nextReleaseNotes = buildReleaseNotes(releases, {
        currentVersion: version,
        includePrereleases,
      });

      setReleaseNotes(nextReleaseNotes);
      setReleaseLoadStatus('ready');
    } catch (error) {
      const description = getErrorDescription(error) || t('releaseLoadError');
      setReleaseNotes([]);
      setReleaseLoadStatus('error');
      setReleaseLoadError(description);
      toast({
        title: t('checkError'),
        description,
        variant: 'destructive'
      });
    } finally {
      const checkedAt = new Date();
      setLastCheckedAt(checkedAt);
      setChecking(false);
    }
  }

  async function installUpdate() {
    setLoading(true);
    if (!availableUpdate) {
      setLoading(false);
      return;
    }

    try {
      await availableUpdate.downloadAndInstall();
      await relaunch();
    } catch (error) {
      toast({
        title: t('checkError'),
        description: getErrorDescription(error),
        variant: 'destructive'
      });
      setLoading(false);
    }
  }

  async function handlePrimaryAction() {
    if (!isTauri) {
      return;
    }

    if (availableUpdate) {
      await installUpdate();
      return;
    }

    await checkUpdate(true);
  }

  async function handleIgnoreVersion() {
    await ignoreCurrentVersion();
    toast({
      title: t('ignoreVersionSuccess'),
      variant: 'default'
    });
  }

  async function handleRestoreIgnoredVersion() {
    await clearIgnoredVersion();
    toast({
      title: t('restoreIgnoredVersionSuccess'),
      variant: 'default'
    });

    if (!update) {
      await checkUpdate(true);
    }
  }

  useEffect(() => {
    const detectedMobile = isMobileDevice();
    const detectedTauri = checkIsTauri();
    setIsMobile(detectedMobile);
    setIsTauri(detectedTauri);
    if (!detectedMobile && detectedTauri) {
      checkUpdate();
    }
  }, []);

  return (
    <div className="flex w-full flex-col gap-4">
      <Card className="overflow-hidden">
        <CardHeader className="p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <Image src="/app-icon.png" alt="NoteGen logo" className="size-14 shrink-0 dark:invert" width={56} height={56} />
              <div className="flex min-w-0 flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle className="text-xl font-semibold leading-none">NoteGen</CardTitle>
                  <Badge variant="outline">v{version}</Badge>
                  {availableUpdate || ignoredUpdateVersion ? (
                    <>
                      <ArrowRight className="size-4 text-muted-foreground" />
                      <Badge
                        variant="outline"
                        className={availableUpdate ? 'border-transparent bg-green-600 text-white hover:bg-green-600 dark:bg-green-500 dark:text-white dark:hover:bg-green-500' : undefined}
                      >
                        v{availableUpdate?.version ?? ignoredUpdateVersion}
                      </Badge>
                    </>
                  ) : null}
                </div>
                <CardDescription className="text-sm font-medium leading-none">
                  {t('desc')}
                </CardDescription>
              </div>
            </div>

            {!isMobile ? (
              <div className="flex shrink-0 justify-start lg:justify-end">
                <div className="flex flex-col items-end gap-1.5">
                  <Button
                    variant={availableUpdate ? 'default' : 'outline'}
                    disabled={!isTauri || loading || checking}
                    onClick={handlePrimaryAction}
                  >
                    {checking || loading ? <Loader2 className="animate-spin" data-icon="inline-start" /> : null}
                    {primaryActionText}
                  </Button>
                  <span className="text-right text-xs text-muted-foreground">
                    {lastCheckedAt ? t('lastCheckedAt', { time: formatDateTime(lastCheckedAt) }) : t('lastCheckedNever')}
                  </span>
                </div>
              </div>
            ) : null}
          </div>
        </CardHeader>
      </Card>

      {ignoredUpdateVersion ? (
        <Alert>
          <Info />
          <AlertTitle>{t('ignoredVersionTitle', { version: ignoredUpdateVersion })}</AlertTitle>
          <AlertDescription>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <span>{t('ignoredVersionDesc')}</span>
              <Button size="sm" variant="outline" disabled={checking} onClick={handleRestoreIgnoredVersion}>
                <RotateCcw data-icon="inline-start" />
                {t('restoreIgnoredVersion')}
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      ) : null}

      {showReleaseHistory ? (
        <Card>
          <CardHeader className="flex flex-col gap-3 p-4 md:flex-row md:items-start md:justify-between md:space-y-0">
            <div className="flex flex-col gap-1">
              <CardTitle className="text-base">{t('releaseHistoryTitle')}</CardTitle>
              <CardDescription>
                {t('releaseHistoryDesc', {
                  currentVersion: version || '-',
                  latestVersion: displayLatestVersion,
                  count: releaseNotes.length
                })}
              </CardDescription>
            </div>
            {availableUpdate ? (
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={handleIgnoreVersion}>
                  {t('ignoreVersion')}
                </Button>
              </div>
            ) : null}
          </CardHeader>
          <CardContent className="p-4 pt-0">
            {releaseLoadStatus === 'loading' ? <ReleaseNotesSkeleton /> : null}

            {releaseLoadStatus === 'error' ? (
              <Alert variant="destructive">
                <AlertCircle />
                <AlertTitle>{t('releaseLoadError')}</AlertTitle>
                <AlertDescription>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <span>{releaseLoadError || t('releaseLoadError')}</span>
                    <Button size="sm" variant="outline" disabled={checking} onClick={() => checkUpdate(true)}>
                      <RefreshCw data-icon="inline-start" />
                      {t('retryReleaseNotes')}
                    </Button>
                  </div>
                </AlertDescription>
              </Alert>
            ) : null}

            {releaseLoadStatus === 'ready' && releaseNotes.length === 0 ? (
              <Alert>
                <Info />
                <AlertTitle>{t('releaseHistoryTitle')}</AlertTitle>
                <AlertDescription>{t('releaseHistoryEmpty')}</AlertDescription>
              </Alert>
            ) : null}

            {releaseNotes.length > 0 ? (
              <div className="rounded-md border bg-muted/30">
                <Accordion key={latestRelease?.version} type="single" collapsible defaultValue={`release-${latestRelease?.version}`}>
                  {releaseNotes.map((release, index) => (
                    <AccordionItem key={release.version} value={`release-${release.version}`} className="px-4 last:border-b-0">
                      <AccordionTrigger className="gap-4 py-4 text-left hover:no-underline">
                        <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <div className="flex min-w-0 flex-col gap-1">
                            <span className="truncate text-sm font-medium">{release.title}</span>
                            {release.publishedAt ? (
                              <span className="text-xs font-normal text-muted-foreground">
                                {t('releasePublishedAt', { date: formatDateTime(release.publishedAt) })}
                              </span>
                            ) : null}
                          </div>
                          <div className="flex w-fit shrink-0 flex-wrap items-center gap-2">
                            {release.prerelease ? (
                              <Badge variant="secondary">{t('releasePrerelease')}</Badge>
                            ) : null}
                            <Badge variant={index === 0 ? 'default' : 'outline'}>
                              v{release.version}
                            </Badge>
                          </div>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent className="pt-0">
                        <ReleaseMarkdown body={release.body} fallback={t('releaseNoNotes')} />
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
