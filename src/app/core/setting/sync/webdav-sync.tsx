'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Eye, EyeOff, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { testWebDAVConnection } from '@/lib/sync/webdav';
import { WebDAVConfig } from '@/types/sync';
import { Store } from '@tauri-apps/plugin-store';
import useSyncStore from '@/stores/sync';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { InputGroup, InputGroupButton, InputGroupInput } from '@/components/ui/input-group';
import { Item, ItemActions, ItemContent, ItemTitle } from '@/components/ui/item';

export function WebDAVSync() {
  const t = useTranslations();
  const { webdavConnected, setWebDAVConnected } = useSyncStore();

  const [config, setConfig] = useState<WebDAVConfig>({
    url: '',
    username: '',
    password: '',
    pathPrefix: ''
  });

  const [showPassword, setShowPassword] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);

  // 初始化配置
  useEffect(() => {
    const initConfig = async () => {
      try {
        const store = await Store.load('store.json');
        const savedConfig = await store.get<WebDAVConfig>('webdavSyncConfig');
        if (savedConfig) {
          setConfig(savedConfig);
          // 如果配置完整，自动进行连接检测
          if (savedConfig.url && savedConfig.username && savedConfig.password) {
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
  const testConnection = async (configToTest?: WebDAVConfig) => {
    const testConfig = configToTest || config;
    if (!testConfig.url || !testConfig.username || !testConfig.password) {
      return;
    }

    setIsConnecting(true);
    try {
      const isConnected = await testWebDAVConnection(testConfig);
      setWebDAVConnected(isConnected);
    } catch (error) {
      console.error('WebDAV connection test failed:', error);
      setWebDAVConnected(false);
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
        await store.set('webdavSyncConfig', config);
        await store.save();
      } catch (error) {
        console.error('Failed to auto-save WebDAV config:', error);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [config, isInitialized]);

  // 配置变更处理
  const handleConfigChange = (key: keyof WebDAVConfig, value: string) => {
    setConfig(prev => ({ ...prev, [key]: value }));
    setWebDAVConnected(false);
  };

  const getStatusIcon = () => {
    if (isConnecting) {
      return <Loader2 className="size-4 animate-spin text-blue-500" />;
    }
    if (webdavConnected) {
      return <CheckCircle className="size-4 text-green-500" />;
    }
    return <XCircle className="size-4 text-red-500" />;
  };

  const getStatusText = () => {
    if (isConnecting) {
      return t('settings.sync.webdav.connecting');
    }
    if (webdavConnected) {
      return t('settings.sync.webdav.connected');
    }
    return t('settings.sync.webdav.disconnected');
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.sync.webdav.title')}</CardTitle>
        <CardDescription>{t('settings.sync.webdav.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <Item variant="muted">
            <ItemContent>
              <ItemTitle>{t('settings.sync.webdav.status')}</ItemTitle>
            </ItemContent>
            <ItemActions>
              {getStatusIcon()}
              <span className="text-sm">{getStatusText()}</span>
            </ItemActions>
          </Item>

          <Field>
            <FieldLabel htmlFor="url">{t('settings.sync.webdav.url')}</FieldLabel>
            <Input
              id="url"
              type="text"
              value={config.url}
              onChange={(e) => handleConfigChange('url', e.target.value)}
              placeholder={t('settings.sync.webdav.urlPlaceholder')}
            />
            <FieldDescription>{t('settings.sync.webdav.urlDesc')}</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="username">{t('settings.sync.webdav.username')}</FieldLabel>
            <Input
              id="username"
              type="text"
              value={config.username}
              onChange={(e) => handleConfigChange('username', e.target.value)}
              placeholder={t('settings.sync.webdav.usernamePlaceholder')}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="password">{t('settings.sync.webdav.password')}</FieldLabel>
            <InputGroup>
              <InputGroupInput
                id="password"
                type={showPassword ? "text" : "password"}
                value={config.password}
                onChange={(e) => handleConfigChange('password', e.target.value)}
                placeholder={t('settings.sync.webdav.passwordPlaceholder')}
              />
              <InputGroupButton
                size="icon-xs"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </InputGroupButton>
            </InputGroup>
          </Field>
          <Field>
            <FieldLabel htmlFor="pathPrefix">{t('settings.sync.webdav.pathPrefix')}</FieldLabel>
            <Input
              id="pathPrefix"
              type="text"
              value={config.pathPrefix || ''}
              onChange={(e) => handleConfigChange('pathPrefix', e.target.value)}
              placeholder={t('settings.sync.webdav.pathPrefixPlaceholder')}
            />
            <FieldDescription>{t('settings.sync.webdav.pathPrefixDesc')}</FieldDescription>
          </Field>
        </FieldGroup>
      </CardContent>
      <CardFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => testConnection()}
            disabled={isConnecting || !config.url || !config.username || !config.password}
          >
            {isConnecting ? (
              <>
                <Loader2 data-icon="inline-start" className="animate-spin" />
                {t('settings.sync.webdav.testing')}
              </>
            ) : (
              t('settings.sync.webdav.testConnection')
            )}
          </Button>
      </CardFooter>
    </Card>
  );
}
