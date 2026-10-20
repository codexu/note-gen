'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Eye, EyeOff, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { testS3Connection } from '@/lib/sync/s3';
import { S3Config } from '@/types/sync';
import { Store } from '@tauri-apps/plugin-store';
import useSyncStore from '@/stores/sync';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { InputGroup, InputGroupButton, InputGroupInput } from '@/components/ui/input-group';
import { Item, ItemActions, ItemContent, ItemTitle } from '@/components/ui/item';

export function S3Sync() {
  const t = useTranslations();
  const { s3Connected, setS3Connected } = useSyncStore();

  const [config, setConfig] = useState<S3Config>({
    accessKeyId: '',
    secretAccessKey: '',
    region: 'us-east-1',
    bucket: '',
    endpoint: '',
    pathPrefix: '',
    customDomain: ''
  });

  const [showSecretKey, setShowSecretKey] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);

  // 初始化配置
  useEffect(() => {
    const initConfig = async () => {
      try {
        const store = await Store.load('store.json');
        const savedConfig = await store.get<S3Config>('s3SyncConfig');
        if (savedConfig) {
          setConfig(savedConfig);
          // 如果配置完整，自动进行连接检测
          if (savedConfig.accessKeyId && savedConfig.secretAccessKey && savedConfig.region && savedConfig.bucket) {
            testConnection(savedConfig);
          }
        }
      } finally {
        setIsInitialized(true);
      }
    };
    initConfig();
  }, []);

  // 测试连接
  const testConnection = async (configToTest?: S3Config) => {
    const testConfig = configToTest || config;
    if (!testConfig.accessKeyId || !testConfig.secretAccessKey || !testConfig.region || !testConfig.bucket) {
      return;
    }

    setIsConnecting(true);
    try {
      const isConnected = await testS3Connection(testConfig);
      setS3Connected(isConnected);
    } catch (error) {
      console.error('S3 connection test failed:', error);
      setS3Connected(false);
    } finally {
      setIsConnecting(false);
    }
  };

  // 配置变更后自动保存，避免输入过程中频繁写入磁盘
  useEffect(() => {
    if (!isInitialized) return;

    const timer = setTimeout(async () => {
      try {
        const store = await Store.load('store.json');
        await store.set('s3SyncConfig', config);
        await store.save();
      } catch (error) {
        console.error('Failed to auto-save S3 config:', error);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [config, isInitialized]);

  // 配置变更处理
  const handleConfigChange = (key: keyof S3Config, value: string) => {
    setConfig(prev => ({ ...prev, [key]: value }));
    setS3Connected(false);
  };

  const getStatusIcon = () => {
    if (isConnecting) {
      return <Loader2 className="size-4 animate-spin text-blue-500" />;
    }
    if (s3Connected) {
      return <CheckCircle className="size-4 text-green-500" />;
    }
    return <XCircle className="size-4 text-red-500" />;
  };

  const getStatusText = () => {
    if (isConnecting) {
      return t('settings.sync.s3.connecting');
    }
    if (s3Connected) {
      return t('settings.sync.s3.connected');
    }
    return t('settings.sync.s3.disconnected');
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.sync.s3.title')}</CardTitle>
        <CardDescription>{t('settings.sync.s3.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <Item variant="muted">
            <ItemContent>
              <ItemTitle>{t('settings.sync.s3.status')}</ItemTitle>
            </ItemContent>
            <ItemActions>
              {getStatusIcon()}
              <span className="text-sm">{getStatusText()}</span>
            </ItemActions>
          </Item>
          <Field>
            <FieldLabel htmlFor="sync-s3-access-key">{t('settings.sync.s3.accessKeyId')}</FieldLabel>
            <Input
              id="sync-s3-access-key"
              value={config.accessKeyId}
              onChange={(e) => handleConfigChange('accessKeyId', e.target.value)}
              placeholder={t('settings.sync.s3.accessKeyIdPlaceholder')}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="sync-s3-secret-key">{t('settings.sync.s3.secretAccessKey')}</FieldLabel>
            <InputGroup>
              <InputGroupInput
                id="sync-s3-secret-key"
                type={showSecretKey ? "text" : "password"}
                value={config.secretAccessKey}
                onChange={(e) => handleConfigChange('secretAccessKey', e.target.value)}
                placeholder={t('settings.sync.s3.secretAccessKeyPlaceholder')}
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
          <Field>
            <FieldLabel htmlFor="sync-s3-region">{t('settings.sync.s3.region')}</FieldLabel>
            <Input id="sync-s3-region" value={config.region} onChange={(e) => handleConfigChange('region', e.target.value)} placeholder="us-east-1" />
          </Field>
          <Field>
            <FieldLabel htmlFor="sync-s3-bucket">{t('settings.sync.s3.bucket')}</FieldLabel>
            <Input id="sync-s3-bucket" value={config.bucket} onChange={(e) => handleConfigChange('bucket', e.target.value)} placeholder={t('settings.sync.s3.bucketPlaceholder')} />
          </Field>
          <Field>
            <FieldLabel htmlFor="sync-s3-endpoint">{t('settings.sync.s3.endpoint')}</FieldLabel>
            <Input id="sync-s3-endpoint" value={config.endpoint || ''} onChange={(e) => handleConfigChange('endpoint', e.target.value)} placeholder="https://s3.amazonaws.com" />
          </Field>
          <Field>
            <FieldLabel htmlFor="sync-s3-path-prefix">{t('settings.sync.s3.pathPrefix')}</FieldLabel>
            <Input id="sync-s3-path-prefix" value={config.pathPrefix || ''} onChange={(e) => handleConfigChange('pathPrefix', e.target.value)} placeholder={t('settings.sync.s3.pathPrefixPlaceholder')} />
            <FieldDescription>{t('settings.sync.s3.pathPrefixDesc')}</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="sync-s3-custom-domain">{t('settings.sync.s3.customDomain')}</FieldLabel>
            <Input id="sync-s3-custom-domain" value={config.customDomain || ''} onChange={(e) => handleConfigChange('customDomain', e.target.value)} placeholder="https://cdn.example.com" />
          </Field>
        </FieldGroup>
      </CardContent>
      <CardFooter className="gap-2">
        <Button
          variant="outline"
          onClick={() => testConnection()}
          disabled={isConnecting || !config.accessKeyId || !config.secretAccessKey || !config.region || !config.bucket}
        >
          {isConnecting ? (
            <>
              <Loader2 data-icon="inline-start" className="animate-spin" />
              {t('settings.sync.s3.testing')}
            </>
          ) : (
            t('settings.sync.s3.testConnection')
          )}
        </Button>
      </CardFooter>
    </Card>
  );
}
