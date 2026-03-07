'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Eye, EyeOff, CheckCircle, XCircle, Loader2, Save } from 'lucide-react';
import { testS3Connection } from '@/lib/sync/s3';
import { S3Config } from '@/types/sync';
import { Store } from '@tauri-apps/plugin-store';
import useSyncStore from '@/stores/sync';

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
  const [isSaving, setIsSaving] = useState(false);

  // 初始化配置
  useEffect(() => {
    const initConfig = async () => {
      const store = await Store.load('store.json');
      const savedConfig = await store.get<S3Config>('s3SyncConfig');
      if (savedConfig) {
        setConfig(savedConfig);
        // 如果配置完整，自动进行连接检测
        if (savedConfig.accessKeyId && savedConfig.secretAccessKey && savedConfig.region && savedConfig.bucket) {
          testConnection(savedConfig);
        }
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

  // 保存配置
  const handleSave = async () => {
    setIsSaving(true);
    try {
      const store = await Store.load('store.json');
      await store.set('s3SyncConfig', config);
      await store.save();
      // 保存后自动测试连接
      await testConnection(config);
    } catch (error) {
      console.error('Failed to save S3 config:', error);
    } finally {
      setIsSaving(false);
    }
  };

  // 配置变更处理
  const handleConfigChange = (key: keyof S3Config, value: string) => {
    setConfig(prev => ({ ...prev, [key]: value }));
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
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>{t('settings.sync.s3.title')}</CardTitle>
            <CardDescription>
              {t('settings.sync.s3.description')}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* 状态显示 */}
        <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
          <span className="text-sm font-medium">{t('settings.sync.s3.status')}</span>
          <div className="flex items-center gap-2">
            {getStatusIcon()}
            <span className="text-sm">{getStatusText()}</span>
          </div>
        </div>

        {/* 基本配置 */}
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="accessKeyId">{t('settings.sync.s3.accessKeyId')}</Label>
            <Input
              id="accessKeyId"
              type="text"
              value={config.accessKeyId}
              onChange={(e) => handleConfigChange('accessKeyId', e.target.value)}
              placeholder={t('settings.sync.s3.accessKeyIdPlaceholder')}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="secretAccessKey">{t('settings.sync.s3.secretAccessKey')}</Label>
            <div className="relative">
              <Input
                id="secretAccessKey"
                type={showSecretKey ? "text" : "password"}
                value={config.secretAccessKey}
                onChange={(e) => handleConfigChange('secretAccessKey', e.target.value)}
                placeholder={t('settings.sync.s3.secretAccessKeyPlaceholder')}
                className="pr-10"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                onClick={() => setShowSecretKey(!showSecretKey)}
              >
                {showSecretKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="region">{t('settings.sync.s3.region')}</Label>
            <Input
              id="region"
              type="text"
              value={config.region}
              onChange={(e) => handleConfigChange('region', e.target.value)}
              placeholder="us-east-1"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="bucket">{t('settings.sync.s3.bucket')}</Label>
            <Input
              id="bucket"
              type="text"
              value={config.bucket}
              onChange={(e) => handleConfigChange('bucket', e.target.value)}
              placeholder={t('settings.sync.s3.bucketPlaceholder')}
            />
          </div>
        </div>

        {/* 高级配置 */}
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="endpoint">{t('settings.sync.s3.endpoint')}</Label>
            <Input
              id="endpoint"
              type="text"
              value={config.endpoint || ''}
              onChange={(e) => handleConfigChange('endpoint', e.target.value)}
              placeholder="https://s3.amazonaws.com"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pathPrefix">{t('settings.sync.s3.pathPrefix')}</Label>
            <Input
              id="pathPrefix"
              type="text"
              value={config.pathPrefix || ''}
              onChange={(e) => handleConfigChange('pathPrefix', e.target.value)}
              placeholder={t('settings.sync.s3.pathPrefixPlaceholder')}
            />
            <p className="text-xs text-muted-foreground">
              {t('settings.sync.s3.pathPrefixDesc')}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="customDomain">{t('settings.sync.s3.customDomain')}</Label>
            <Input
              id="customDomain"
              type="text"
              value={config.customDomain || ''}
              onChange={(e) => handleConfigChange('customDomain', e.target.value)}
              placeholder="https://cdn.example.com"
            />
          </div>
        </div>

        {/* 操作按钮 */}
        <div className="flex gap-2 pt-2">
          <Button
            variant="outline"
            onClick={() => testConnection()}
            disabled={isConnecting || !config.accessKeyId || !config.secretAccessKey || !config.region || !config.bucket}
          >
            {isConnecting ? (
              <>
                <Loader2 className="size-4 mr-2 animate-spin" />
                {t('settings.sync.s3.testing')}
              </>
            ) : (
              t('settings.sync.s3.testConnection')
            )}
          </Button>
          <Button
            onClick={handleSave}
            disabled={isSaving}
          >
            {isSaving ? (
              <>
                <Loader2 className="size-4 mr-2 animate-spin" />
                {t('settings.sync.s3.saving')}
              </>
            ) : (
              <>
                <Save className="size-4 mr-2" />
                {t('settings.sync.s3.saveConfig')}
              </>
            )}
          </Button>
        </div>

      </CardContent>
    </Card>
  );
}
