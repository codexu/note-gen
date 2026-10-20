'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Eye, EyeOff, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import useImageStore from '@/stores/imageHosting';
import { SyncStateEnum } from '@/lib/sync/github.types';
import { testS3Connection } from '@/lib/imageHosting/s3';
import { Store } from '@tauri-apps/plugin-store';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { InputGroup, InputGroupButton, InputGroupInput } from '@/components/ui/input-group';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from '@/components/ui/item';
import { ResponsiveSelect } from '@/components/responsive-select';
import type {
  ObjectStorageAddressingStyle,
  ObjectStoragePreset,
  S3Config,
} from '@/lib/imageHosting/types';
import {
  applyObjectStoragePreset,
  getObjectStorageEndpoint,
  isObjectStorageConfigComplete,
  normalizeObjectStorageConfig,
  OBJECT_STORAGE_PRESETS,
} from '@/lib/imageHosting/object-storage-presets';

const DEFAULT_CONFIG: S3Config = {
  preset: 'aws',
  accessKeyId: '',
  secretAccessKey: '',
  region: 'us-east-1',
  bucket: '',
  endpoint: '',
  customDomain: '',
  pathPrefix: '',
  addressingStyle: 'auto',
}

export function S3ImageHosting() {
  const t = useTranslations();
  const { setS3Config, s3State, setS3State } = useImageStore();
  
  const [config, setConfig] = useState<S3Config>(DEFAULT_CONFIG);
  const [showSecretKey, setShowSecretKey] = useState(false);
  const preset = config.preset || 'custom'
  const endpoint = getObjectStorageEndpoint(config)
  const credentialLabels = getCredentialLabels(preset)
  const r2AccountId = getR2AccountId(config.endpoint)
  const showRegion = (
    preset === 'aws'
    || preset === 'aliyun-oss'
    || preset === 'tencent-cos'
    || preset === 'backblaze-b2'
    || preset === 'custom'
  )

  // 初始化配置
  useEffect(() => {
    const initConfig = async () => {
      const store = await Store.load('store.json');
      const savedConfig = await store.get<S3Config>('s3Config');
      if (savedConfig) {
        const normalizedConfig = normalizeObjectStorageConfig({
          ...DEFAULT_CONFIG,
          ...savedConfig,
        });
        setConfig(normalizedConfig);
        await setS3Config(normalizedConfig);
        // 如果配置完整，自动进行连接检测
        if (isObjectStorageConfigComplete(normalizedConfig)) {
          setS3State(SyncStateEnum.checking);
          try {
            const isConnected = await testS3Connection(normalizedConfig);
            if (isConnected) {
              setS3State(SyncStateEnum.success);
            } else {
              setS3State(SyncStateEnum.fail);
            }
          } catch (error) {
            setS3State(SyncStateEnum.fail);
            console.error('S3 connection test failed:', error);
          }
        }
      }
    };
    initConfig();
  }, [setS3Config]);

  // 自动保存和测试配置
  const handleConfigChange = async (newConfig: S3Config) => {
    setConfig(newConfig);
    
    // 自动保存配置
    try {
      await setS3Config(newConfig);
    } catch (error) {
      console.error('Failed to save S3 config:', error);
    }
    
    // 如果必填字段都已填写，自动测试连接
    if (isObjectStorageConfigComplete(newConfig)) {
      setS3State(SyncStateEnum.checking);

      try {
        const isConnected = await testS3Connection(newConfig);
        if (isConnected) {
          setS3State(SyncStateEnum.success);
        } else {
          setS3State(SyncStateEnum.fail);
        }
      } catch (error) {
        setS3State(SyncStateEnum.fail);
        console.error('S3 connection test failed:', error);
      }
    } else {
      setS3State(SyncStateEnum.fail);
    }
  };

  const getStatusIcon = () => {
    switch (s3State) {
      case SyncStateEnum.success:
        return <CheckCircle className="size-4 text-primary" />;
      case SyncStateEnum.checking:
        return <Loader2 className="size-4 animate-spin text-muted-foreground" />;
      case SyncStateEnum.fail:
      default:
        return <XCircle className="size-4 text-muted-foreground" />;
    }
  };

  const getStatusText = () => {
    switch (s3State) {
      case SyncStateEnum.success:
        return t('settings.imageHosting.s3.connected');
      case SyncStateEnum.checking:
        return t('settings.imageHosting.s3.connecting');
      case SyncStateEnum.fail:
      default:
        return t('settings.imageHosting.s3.disconnected');
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.imageHosting.s3.title')}</CardTitle>
        <CardDescription>{t('settings.imageHosting.s3.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <Item variant="muted">
            <ItemContent>
              <ItemTitle>{t('settings.imageHosting.s3.status')}</ItemTitle>
            </ItemContent>
            <ItemActions>
              {getStatusIcon()}
              <span className="text-sm">{getStatusText()}</span>
            </ItemActions>
          </Item>

          <FieldGroup>
            <Field>
              <FieldLabel>{t('settings.imageHosting.s3.provider')}</FieldLabel>
              <ResponsiveSelect
                title={t('settings.imageHosting.s3.provider')}
                value={config.preset || 'custom'}
                onValueChange={value => {
                  void handleConfigChange(applyObjectStoragePreset(value as ObjectStoragePreset, config))
                }}
                options={OBJECT_STORAGE_PRESETS.map(preset => ({
                  value: preset,
                  label: t(`settings.imageHosting.s3.providers.${preset}`),
                }))}
              />
              <FieldDescription>{t('settings.imageHosting.s3.providerDesc')}</FieldDescription>
            </Field>
            <Item variant="muted">
              <ItemContent>
                <ItemTitle>
                  {t(`settings.imageHosting.s3.providers.${preset}`)}
                </ItemTitle>
                <ItemDescription>
                  {t(`settings.imageHosting.s3.providerDetails.${preset}`)}
                </ItemDescription>
                <div className="mt-2 grid gap-1 text-xs text-muted-foreground">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="shrink-0">
                      {t('settings.imageHosting.s3.resolvedEndpoint')}
                    </span>
                    <code className="truncate text-foreground">
                      {endpoint || t('settings.imageHosting.s3.endpointRequired')}
                    </code>
                  </div>
                </div>
              </ItemContent>
            </Item>
            <Field>
              <FieldLabel htmlFor="accessKeyId">{credentialLabels.accessKey}</FieldLabel>
              <Input
                id="accessKeyId"
                type="text"
                value={config.accessKeyId}
                onChange={(e) => handleConfigChange({ ...config, accessKeyId: e.target.value })}
                placeholder={t('settings.imageHosting.s3.credentialPlaceholder', {
                  name: credentialLabels.accessKey,
                })}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="secretAccessKey">{credentialLabels.secretKey}</FieldLabel>
              <InputGroup>
                <InputGroupInput
                  id="secretAccessKey"
                  type={showSecretKey ? "text" : "password"}
                  value={config.secretAccessKey}
                  onChange={(e) => handleConfigChange({ ...config, secretAccessKey: e.target.value })}
                  placeholder={t('settings.imageHosting.s3.credentialPlaceholder', {
                    name: credentialLabels.secretKey,
                  })}
                />
                <InputGroupButton
                  size="icon-xs"
                  aria-label={showSecretKey ? 'Hide secret key' : 'Show secret key'}
                  onClick={() => setShowSecretKey(!showSecretKey)}
                >
                  {showSecretKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </InputGroupButton>
              </InputGroup>
            </Field>
            {preset === 'cloudflare-r2' ? (
              <Field>
                <FieldLabel htmlFor="r2-account-id">
                  {t('settings.imageHosting.s3.accountId')}
                </FieldLabel>
                <Input
                  id="r2-account-id"
                  value={r2AccountId}
                  placeholder={t('settings.imageHosting.s3.accountIdPlaceholder')}
                  onChange={(event) => {
                    const accountId = event.target.value.trim()
                    void handleConfigChange({
                      ...config,
                      endpoint: accountId
                        ? `https://${accountId}.r2.cloudflarestorage.com`
                        : '',
                    })
                  }}
                />
                <FieldDescription>
                  {t('settings.imageHosting.s3.accountIdDesc')}
                </FieldDescription>
              </Field>
            ) : null}
            {showRegion ? (
              <Field>
                <FieldLabel htmlFor="region">{t('settings.imageHosting.s3.region')}</FieldLabel>
                <Input
                  id="region"
                  value={config.region}
                  onChange={(e) => handleConfigChange({ ...config, region: e.target.value })}
                  placeholder={getRegionPlaceholder(preset)}
                />
              </Field>
            ) : null}
            <Field>
              <FieldLabel htmlFor="bucket">{t('settings.imageHosting.s3.bucket')}</FieldLabel>
              <Input id="bucket" value={config.bucket} onChange={(e) => handleConfigChange({ ...config, bucket: e.target.value })} placeholder={t('settings.imageHosting.s3.bucketPlaceholder')} />
            </Field>
            {preset === 'minio' || preset === 'custom' ? (
              <Field>
                <FieldLabel htmlFor="endpoint">{t('settings.imageHosting.s3.endpoint')}</FieldLabel>
                <Input
                  id="endpoint"
                  value={config.endpoint || ''}
                  onChange={(e) => handleConfigChange({ ...config, endpoint: e.target.value })}
                  placeholder={getEndpointPlaceholder(preset)}
                />
                <FieldDescription>
                  {t(`settings.imageHosting.s3.endpointRequiredDetails.${preset}`)}
                </FieldDescription>
              </Field>
            ) : null}
            {preset === 'custom' ? (
              <Field>
                <FieldLabel>{t('settings.imageHosting.s3.addressingStyle')}</FieldLabel>
                <ResponsiveSelect
                  title={t('settings.imageHosting.s3.addressingStyle')}
                  value={config.addressingStyle || 'auto'}
                  onValueChange={value => {
                    void handleConfigChange({ ...config, addressingStyle: value as ObjectStorageAddressingStyle })
                  }}
                  options={[
                    { value: 'auto', label: t('settings.imageHosting.s3.addressingStyles.auto') },
                    { value: 'path', label: t('settings.imageHosting.s3.addressingStyles.path') },
                    { value: 'virtual', label: t('settings.imageHosting.s3.addressingStyles.virtual') },
                  ]}
                />
                <FieldDescription>{t('settings.imageHosting.s3.addressingStyleDesc')}</FieldDescription>
              </Field>
            ) : null}
            <Field>
              <FieldLabel htmlFor="customDomain">{t('settings.imageHosting.s3.customDomain')}</FieldLabel>
              <Input id="customDomain" value={config.customDomain || ''} onChange={(e) => handleConfigChange({ ...config, customDomain: e.target.value })} placeholder="https://cdn.example.com" />
              <FieldDescription>{t('settings.imageHosting.s3.customDomainDesc')}</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="pathPrefix">{t('settings.imageHosting.s3.pathPrefix')}</FieldLabel>
              <Input id="pathPrefix" value={config.pathPrefix || ''} onChange={(e) => handleConfigChange({ ...config, pathPrefix: e.target.value })} placeholder="images/" />
              <FieldDescription>{t('settings.imageHosting.s3.pathPrefixDesc')}</FieldDescription>
            </Field>
          </FieldGroup>
        </FieldGroup>
      </CardContent>
    </Card>
  );
}

function getCredentialLabels(preset: ObjectStoragePreset) {
  switch (preset) {
    case 'aliyun-oss':
      return { accessKey: 'AccessKey ID', secretKey: 'AccessKey Secret' }
    case 'tencent-cos':
      return { accessKey: 'SecretId', secretKey: 'SecretKey' }
    case 'backblaze-b2':
      return { accessKey: 'Key ID', secretKey: 'Application Key' }
    case 'minio':
    case 'custom':
      return { accessKey: 'Access Key', secretKey: 'Secret Key' }
    case 'aws':
    case 'cloudflare-r2':
      return { accessKey: 'Access Key ID', secretKey: 'Secret Access Key' }
  }
}

function getRegionPlaceholder(preset: ObjectStoragePreset) {
  switch (preset) {
    case 'cloudflare-r2':
      return 'auto'
    case 'aliyun-oss':
      return 'cn-hangzhou'
    case 'tencent-cos':
      return 'ap-guangzhou'
    case 'backblaze-b2':
      return 'us-west-004'
    case 'aws':
    case 'minio':
    case 'custom':
      return 'us-east-1'
  }
}

function getEndpointPlaceholder(
  preset: ObjectStoragePreset,
) {
  switch (preset) {
    case 'minio':
      return 'http://127.0.0.1:9000'
    default:
      return 'https://s3.example.com'
  }
}

function getR2AccountId(endpoint?: string) {
  if (!endpoint) return ''
  try {
    const hostname = new URL(endpoint).hostname
    return hostname.endsWith('.r2.cloudflarestorage.com')
      ? hostname.slice(0, -'.r2.cloudflarestorage.com'.length)
      : ''
  } catch {
    return ''
  }
}
