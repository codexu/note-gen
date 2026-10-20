'use client'

import { useEffect, useState } from 'react'
import {
  Check,
  Cloud,
  Database,
  FolderOpen,
  GitBranch,
  Globe2,
  HardDrive,
  Image as ImageIcon,
  ImageUp,
  Link2,
  Loader2,
  Server,
  Sparkles,
  UploadCloud,
  WandSparkles,
  type LucideIcon,
} from 'lucide-react'
import { useTranslations } from 'next-intl'

import { GithubImageHosting } from './github'
import PicgoImageHosting from './picgo'
import {
  CloudinaryImageHosting,
  CustomHttpImageHosting,
  ImageKitImageHosting,
  LskyImageHosting,
  QiniuImageHosting,
  UpyunImageHosting,
  WebDavImageHosting,
} from './remote-service-settings'
import { S3ImageHosting } from './s3'
import SMMSImageHosting from './smms'
import { SettingType } from '../components/setting-base'
import { ResponsiveSelect } from '@/components/responsive-select'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item'
import {
  getNormalizedImageHosting,
  IMAGE_HOSTING_TYPES,
  type ImageHostingType,
} from '@/lib/image-hosting-config'
import { SyncStateEnum } from '@/lib/sync/github.types'
import useImageStore from '@/stores/imageHosting'
import useSettingStore from '@/stores/setting'

type ImageHostingSection = 'local' | ImageHostingType

const IMAGE_HOSTING_ICONS: Record<ImageHostingType, LucideIcon> = {
  github: GitBranch,
  smms: ImageIcon,
  picgo: UploadCloud,
  s3: Database,
  lsky: Server,
  webdav: FolderOpen,
  'custom-http': Globe2,
  cloudinary: Sparkles,
  imagekit: WandSparkles,
  qiniu: Cloud,
  upyun: UploadCloud,
}

export default function ImageHostingPage({ mobile = false }: { mobile?: boolean }) {
  const t = useTranslations()
  const {
    mainImageHosting,
    setMainImageHosting,
    imageRepoState,
    smmsState,
    picgoState,
    s3State,
    serviceStates,
  } = useImageStore()
  const { useImageRepo, setUseImageRepo } = useSettingStore()
  const normalizedImageHosting = getNormalizedImageHosting(mainImageHosting)
  const activeSection: ImageHostingSection = useImageRepo
    ? normalizedImageHosting.value
    : 'local'
  const [section, setSection] = useState<ImageHostingSection>(activeSection)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (normalizedImageHosting.shouldPersist) {
      void setMainImageHosting(normalizedImageHosting.value)
    }
  }, [
    normalizedImageHosting.shouldPersist,
    normalizedImageHosting.value,
    setMainImageHosting,
  ])

  useEffect(() => {
    setSection(activeSection)
  }, [activeSection])

  const provider = section === 'local' ? normalizedImageHosting.value : section
  const currentState = getProviderState(provider, {
    github: imageRepoState,
    smms: smmsState,
    picgo: picgoState,
    s3: s3State,
    services: serviceStates,
  })
  const isCurrentProvider = useImageRepo && normalizedImageHosting.value === provider
  const canUseProvider = currentState === SyncStateEnum.success

  function handleProviderChange(nextProvider: ImageHostingType) {
    setSection(nextProvider)
  }

  async function handleUseProvider() {
    setIsSaving(true)
    try {
      await setMainImageHosting(provider)
      await setUseImageRepo(true)
    } finally {
      setIsSaving(false)
    }
  }

  async function handleUseLocalStorage() {
    setIsSaving(true)
    try {
      await setUseImageRepo(false)
    } finally {
      setIsSaving(false)
    }
  }

  function renderUseButton() {
    const isLocal = section === 'local'
    const isCurrent = isLocal ? !useImageRepo : isCurrentProvider
    const disabled = isLocal
      ? isCurrent || isSaving
      : !canUseProvider || isCurrent || isSaving

    return (
      <Button
        type="button"
        size="sm"
        className={mobile ? 'h-11' : undefined}
        variant={isCurrent ? 'secondary' : 'default'}
        disabled={disabled}
        onClick={() => void (isLocal ? handleUseLocalStorage() : handleUseProvider())}
      >
        {isSaving ? (
          <Loader2 data-icon="inline-start" className="animate-spin" />
        ) : isCurrent ? (
          <Check data-icon="inline-start" />
        ) : null}
        {isCurrent
          ? t('settings.imageHosting.currentPlatform')
          : isLocal
            ? t('settings.imageHosting.useLocalStorage')
            : t('settings.imageHosting.setCurrentPlatform')}
      </Button>
    )
  }

  function renderProviderSettings() {
    switch (provider) {
      case 'github':
        return <GithubImageHosting />
      case 'smms':
        return <SMMSImageHosting />
      case 'picgo':
        return <PicgoImageHosting />
      case 's3':
        return <S3ImageHosting />
      case 'lsky':
        return <LskyImageHosting />
      case 'webdav':
        return <WebDavImageHosting />
      case 'custom-http':
        return <CustomHttpImageHosting />
      case 'cloudinary':
        return <CloudinaryImageHosting />
      case 'imagekit':
        return <ImageKitImageHosting />
      case 'qiniu':
        return <QiniuImageHosting />
      case 'upyun':
        return <UpyunImageHosting />
    }
  }

  const providerOptions = [
    {
      value: 'local',
      label: t('settings.imageHosting.localProviderTitle'),
    },
    ...IMAGE_HOSTING_TYPES.map(itemProvider => ({
      value: itemProvider,
      label: getProviderName(itemProvider, t),
    })),
  ]

  return (
    <SettingType
      id="imageHosting"
      icon={<ImageUp />}
      title={t('settings.imageHosting.title')}
      desc={t('settings.imageHosting.desc')}
    >
      <div className="grid items-start gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        {mobile ? (
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <ResponsiveSelect
                title={t('settings.imageHosting.platformSettings')}
                value={section}
                className="h-11"
                options={providerOptions}
                onValueChange={value => setSection(value as ImageHostingSection)}
              />
            </div>
            {renderUseButton()}
          </div>
        ) : <Card size="sm" className="lg:sticky lg:top-2">
          <CardHeader>
            <CardTitle>{t('settings.imageHosting.platformSettings')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="app-panel-scrollbar max-h-[52vh] overflow-y-auto pr-1">
              <ItemGroup className="gap-1">
                <Item
                  asChild
                  size="sm"
                  variant={section === 'local' ? 'outline' : 'default'}
                  className="data-[state=on]:border-primary data-[state=on]:bg-primary/5"
                >
                  <button
                    type="button"
                    data-state={section === 'local' ? 'on' : 'off'}
                    aria-pressed={section === 'local'}
                    onClick={() => setSection('local')}
                  >
                    <ItemMedia variant="icon">
                      <HardDrive />
                    </ItemMedia>
                    <ItemContent>
                      <ItemTitle>{t('settings.imageHosting.localProviderTitle')}</ItemTitle>
                    </ItemContent>
                    {!useImageRepo ? (
                      <ItemActions>
                        <Badge>{t('settings.imageHosting.currentPlatform')}</Badge>
                      </ItemActions>
                    ) : null}
                  </button>
                </Item>

                {IMAGE_HOSTING_TYPES.map((itemProvider) => {
                  const ProviderIcon = IMAGE_HOSTING_ICONS[itemProvider]
                  const isSelected = section === itemProvider
                  const isCurrent = useImageRepo
                    && normalizedImageHosting.value === itemProvider

                  return (
                    <Item
                      key={itemProvider}
                      asChild
                      size="sm"
                      variant={isSelected ? 'outline' : 'default'}
                      className="data-[state=on]:border-primary data-[state=on]:bg-primary/5"
                    >
                      <button
                        type="button"
                        data-state={isSelected ? 'on' : 'off'}
                        aria-pressed={isSelected}
                        onClick={() => handleProviderChange(itemProvider)}
                      >
                        <ItemMedia variant="icon">
                          <ProviderIcon />
                        </ItemMedia>
                        <ItemContent>
                          <ItemTitle>{getProviderName(itemProvider, t)}</ItemTitle>
                        </ItemContent>
                        {isCurrent ? (
                          <ItemActions>
                            <Badge>{t('settings.imageHosting.currentPlatform')}</Badge>
                          </ItemActions>
                        ) : null}
                      </button>
                    </Item>
                  )
                })}
              </ItemGroup>
            </div>
          </CardContent>
        </Card>}

        <div className="flex min-w-0 flex-col gap-4">
          {section === 'local' ? (
            <Card>
              <CardHeader>
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex size-8 shrink-0 items-center justify-center">
                    <HardDrive className="size-full" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <CardTitle>{t('settings.imageHosting.localProviderTitle')}</CardTitle>
                    <CardDescription>{t('settings.imageHosting.localProviderDesc')}</CardDescription>
                  </div>
                </div>
                {!mobile ? <CardAction>{renderUseButton()}</CardAction> : null}
              </CardHeader>
              <CardContent>
                <ItemGroup>
                  <Item variant="outline">
                    <ItemMedia variant="icon">
                      <FolderOpen />
                    </ItemMedia>
                    <ItemContent>
                      <ItemTitle>{t('settings.imageHosting.localLocationTitle')}</ItemTitle>
                      <ItemDescription>
                        {t('settings.imageHosting.localLocationDesc')}
                      </ItemDescription>
                    </ItemContent>
                  </Item>
                  <Item variant="outline">
                    <ItemMedia variant="icon">
                      <Link2 />
                    </ItemMedia>
                    <ItemContent>
                      <ItemTitle>{t('settings.imageHosting.relativePathTitle')}</ItemTitle>
                      <ItemDescription>
                        {t('settings.imageHosting.relativePathDesc')}
                      </ItemDescription>
                    </ItemContent>
                  </Item>
                </ItemGroup>
              </CardContent>
            </Card>
          ) : (
            <>
              <Card>
                <CardHeader>
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex size-8 shrink-0 items-center justify-center">
                      {renderProviderIcon(provider)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <CardTitle>{getProviderName(provider, t)}</CardTitle>
                      <CardDescription>{getProviderDescription(provider, t)}</CardDescription>
                    </div>
                  </div>
                  <CardAction>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <ProviderStatusBadge
                        state={currentState}
                        mode={
                          provider === 'custom-http'
                          || provider === 'cloudinary'
                          || provider === 'qiniu'
                            ? 'configuration'
                            : 'connection'
                        }
                      />
                      {!mobile ? renderUseButton() : null}
                    </div>
                  </CardAction>
                </CardHeader>
              </Card>

              {renderProviderSettings()}
            </>
          )}
        </div>
      </div>
    </SettingType>
  )
}

function getProviderState(
  provider: ImageHostingType,
  states: {
    github: SyncStateEnum
    smms: SyncStateEnum
    picgo: SyncStateEnum
    s3: SyncStateEnum
    services: Partial<Record<ImageHostingType, SyncStateEnum>>
  },
) {
  switch (provider) {
    case 'github':
      return states.github
    case 'smms':
      return states.smms
    case 'picgo':
      return states.picgo
    case 's3':
      return states.s3
    default:
      return states.services[provider] ?? SyncStateEnum.fail
  }
}

function getProviderName(
  provider: ImageHostingType,
  t: ReturnType<typeof useTranslations>,
) {
  switch (provider) {
    case 'github':
      return t('settings.imageHosting.github.title')
    case 'smms':
      return t('settings.imageHosting.smms.title')
    case 'picgo':
      return t('settings.imageHosting.picgo.title')
    case 's3':
      return t('settings.imageHosting.s3.title')
    case 'lsky':
      return t('settings.imageHosting.lsky.title')
    case 'webdav':
      return t('settings.imageHosting.webdav.title')
    case 'custom-http':
      return t('settings.imageHosting.customHttp.title')
    case 'cloudinary':
      return t('settings.imageHosting.cloudinary.title')
    case 'imagekit':
      return t('settings.imageHosting.imagekit.title')
    case 'qiniu':
      return t('settings.imageHosting.qiniu.title')
    case 'upyun':
      return t('settings.imageHosting.upyun.title')
  }
}

function getProviderDescription(
  provider: ImageHostingType,
  t: ReturnType<typeof useTranslations>,
) {
  switch (provider) {
    case 'github':
      return t('settings.imageHosting.github.description')
    case 'smms':
      return t('settings.imageHosting.smms.description')
    case 'picgo':
      return t('settings.imageHosting.picgo.description')
    case 's3':
      return t('settings.imageHosting.s3.description')
    case 'lsky':
      return t('settings.imageHosting.lsky.description')
    case 'webdav':
      return t('settings.imageHosting.webdav.description')
    case 'custom-http':
      return t('settings.imageHosting.customHttp.description')
    case 'cloudinary':
      return t('settings.imageHosting.cloudinary.description')
    case 'imagekit':
      return t('settings.imageHosting.imagekit.description')
    case 'qiniu':
      return t('settings.imageHosting.qiniu.description')
    case 'upyun':
      return t('settings.imageHosting.upyun.description')
  }
}

function renderProviderIcon(provider: ImageHostingType) {
  const ProviderIcon = IMAGE_HOSTING_ICONS[provider]
  return <ProviderIcon className="size-full" />
}

function ProviderStatusBadge({
  state,
  mode = 'connection',
}: {
  state: SyncStateEnum
  mode?: 'connection' | 'configuration'
}) {
  const t = useTranslations('settings.imageHosting.status')

  if (state === SyncStateEnum.success) {
    return <Badge>{mode === 'configuration' ? t('configured') : t('connected')}</Badge>
  }

  if (state === SyncStateEnum.checking || state === SyncStateEnum.creating) {
    return (
      <Badge variant="secondary">
        <Loader2 data-icon="inline-start" className="animate-spin" />
        {t('checking')}
      </Badge>
    )
  }

  return <Badge variant="destructive">{t('disconnected')}</Badge>
}
