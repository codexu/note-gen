'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Eye, EyeOff, CheckCircle, XCircle, Loader2, Save } from 'lucide-react';
import { testWebDAVConnection } from '@/lib/sync/webdav';
import { WebDAVConfig } from '@/types/sync';
import { Store } from '@tauri-apps/plugin-store';
import useSyncStore from '@/stores/sync';

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
  const [isSaving, setIsSaving] = useState(false);

  // 初始化配置
  useEffect(() => {
    const initConfig = async () => {
      const store = await Store.load('store.json');
      const savedConfig = await store.get<WebDAVConfig>('webdavSyncConfig');
      if (savedConfig) {
        setConfig(savedConfig);
        // 如果配置完整，自动进行连接检测
        if (savedConfig.url && savedConfig.username && savedConfig.password) {
          testConnection(savedConfig);
        }
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

  // 保存配置
  const handleSave = async () => {
    setIsSaving(true);
    try {
      const store = await Store.load('store.json');
      await store.set('webdavSyncConfig', config);
      await store.save();
      // 保存后自动测试连接
      await testConnection(config);
    } catch (error) {
      console.error('Failed to save WebDAV config:', error);
    } finally {
      setIsSaving(false);
    }
  };

  // 配置变更处理
  const handleConfigChange = (key: keyof WebDAVConfig, value: string) => {
    setConfig(prev => ({ ...prev, [key]: value }));
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
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>{t('settings.sync.webdav.title')}</CardTitle>
            <CardDescription>
              {t('settings.sync.webdav.description')}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* 状态显示 */}
        <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
          <span className="text-sm font-medium">{t('settings.sync.webdav.status')}</span>
          <div className="flex items-center gap-2">
            {getStatusIcon()}
            <span className="text-sm">{getStatusText()}</span>
          </div>
        </div>

        {/* 基本配置 */}
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="url">{t('settings.sync.webdav.url')}</Label>
            <Input
              id="url"
              type="text"
              value={config.url}
              onChange={(e) => handleConfigChange('url', e.target.value)}
              placeholder={t('settings.sync.webdav.urlPlaceholder')}
            />
            <p className="text-xs text-muted-foreground">
              {t('settings.sync.webdav.urlDesc')}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="username">{t('settings.sync.webdav.username')}</Label>
            <Input
              id="username"
              type="text"
              value={config.username}
              onChange={(e) => handleConfigChange('username', e.target.value)}
              placeholder={t('settings.sync.webdav.usernamePlaceholder')}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">{t('settings.sync.webdav.password')}</Label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                value={config.password}
                onChange={(e) => handleConfigChange('password', e.target.value)}
                placeholder={t('settings.sync.webdav.passwordPlaceholder')}
                className="pr-10"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="pathPrefix">{t('settings.sync.webdav.pathPrefix')}</Label>
            <Input
              id="pathPrefix"
              type="text"
              value={config.pathPrefix || ''}
              onChange={(e) => handleConfigChange('pathPrefix', e.target.value)}
              placeholder={t('settings.sync.webdav.pathPrefixPlaceholder')}
            />
            <p className="text-xs text-muted-foreground">
              {t('settings.sync.webdav.pathPrefixDesc')}
            </p>
          </div>
        </div>

        {/* 操作按钮 */}
        <div className="flex gap-2 pt-2">
          <Button
            variant="outline"
            onClick={() => testConnection()}
            disabled={isConnecting || !config.url || !config.username || !config.password}
          >
            {isConnecting ? (
              <>
                <Loader2 className="size-4 mr-2 animate-spin" />
                {t('settings.sync.webdav.testing')}
              </>
            ) : (
              t('settings.sync.webdav.testConnection')
            )}
          </Button>
          <Button
            onClick={handleSave}
            disabled={isSaving}
          >
            {isSaving ? (
              <>
                <Loader2 className="size-4 mr-2 animate-spin" />
                {t('settings.sync.webdav.saving')}
              </>
            ) : (
              <>
                <Save className="size-4 mr-2" />
                {t('settings.sync.webdav.saveConfig')}
              </>
            )}
          </Button>
        </div>

      </CardContent>
    </Card>
  );
}
