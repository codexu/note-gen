'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Eye, EyeOff, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import useImageStore from '@/stores/imageHosting';
import { SyncStateEnum } from '@/lib/sync/github.types';
import { testS3Connection } from '@/lib/imageHosting/s3';
import { Store } from '@tauri-apps/plugin-store';

interface S3Config {
  accessKeyId: string
  secretAccessKey: string
  region: string
  bucket: string
  endpoint?: string
  customDomain?: string
  pathPrefix?: string
}

export function S3ImageHosting() {
  const t = useTranslations();
  const { setS3Config, s3State, setS3State, mainImageHosting, setMainImageHosting } = useImageStore();
  
  const [config, setConfig] = useState<S3Config>({
    accessKeyId: '',
    secretAccessKey: '',
    region: 'us-east-1',
    bucket: '',
    endpoint: '',
    customDomain: '',
    pathPrefix: ''
  });
  
  const [showSecretKey, setShowSecretKey] = useState(false);

  // 初始化配置
  useEffect(() => {
    const initConfig = async () => {
      const store = await Store.load('store.json');
      const savedConfig = await store.get<S3Config>('s3Config');
      if (savedConfig) {
        setConfig(savedConfig);
        // 如果配置完整，自动进行连接检测
        if (savedConfig.accessKeyId && savedConfig.secretAccessKey && savedConfig.region && savedConfig.bucket) {
          setS3State(SyncStateEnum.checking);
          try {
            const isConnected = await testS3Connection(savedConfig);
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
    if (newConfig.accessKeyId && newConfig.secretAccessKey && newConfig.region && newConfig.bucket) {
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

  // 设为主要图床
  const handleSetAsPrimary = async () => {
    if (s3State !== SyncStateEnum.success) {
      toast({
        title: t('settings.imageHosting.s3.error'),
        description: t('settings.imageHosting.s3.testFirstDesc'),
        variant: 'destructive',
      });
      return;
    }

    await setMainImageHosting('s3');
    toast({
      title: t('settings.imageHosting.s3.setPrimarySuccess'),
      description: t('settings.imageHosting.s3.setPrimarySuccessDesc'),
    });
  };

  const getStatusIcon = () => {
    switch (s3State) {
      case SyncStateEnum.success:
        return <CheckCircle className="size-4 text-green-500" />;
      case SyncStateEnum.checking:
        return <Loader2 className="size-4 animate-spin text-blue-500" />;
      case SyncStateEnum.fail:
      default:
        return <XCircle className="size-4 text-red-500" />;
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
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>{t('settings.imageHosting.s3.title')}</CardTitle>
            <CardDescription>
              {t('settings.imageHosting.s3.description')}
            </CardDescription>
          </div>
          <Button 
            onClick={handleSetAsPrimary}
            disabled={mainImageHosting === 's3' || s3State !== SyncStateEnum.success}
            size="sm"
          >
            {mainImageHosting === 's3' ? 
              '当前主要图床' : 
              t('settings.imageHosting.s3.setAsPrimary')
            }
          </Button>
        </div>
      
      </CardHeader>
      <CardContent className="space-y-4">
        {/* 状态显示 */}
        <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
          <span className="text-sm font-medium">{t('settings.imageHosting.s3.status')}</span>
          <div className="flex items-center gap-2">
            {getStatusIcon()}
            <span className="text-sm">{getStatusText()}</span>
          </div>
        </div>

        {/* 基本配置 */}
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="accessKeyId">{t('settings.imageHosting.s3.accessKeyId')}</Label>
            <Input
              id="accessKeyId"
              type="text"
              value={config.accessKeyId}
              onChange={(e) => handleConfigChange({ ...config, accessKeyId: e.target.value })}
              placeholder={t('settings.imageHosting.s3.accessKeyIdPlaceholder')}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="secretAccessKey">{t('settings.imageHosting.s3.secretAccessKey')}</Label>
            <div className="relative">
              <Input
                id="secretAccessKey"
                type={showSecretKey ? "text" : "password"}
                value={config.secretAccessKey}
                onChange={(e) => handleConfigChange({ ...config, secretAccessKey: e.target.value })}
                placeholder={t('settings.imageHosting.s3.secretAccessKeyPlaceholder')}
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
            <Label htmlFor="region">{t('settings.imageHosting.s3.region')}</Label>
            <Input
              id="region"
              type="text"
              value={config.region}
              onChange={(e) => handleConfigChange({ ...config, region: e.target.value })}
              placeholder="us-east-1"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="bucket">{t('settings.imageHosting.s3.bucket')}</Label>
            <Input
              id="bucket"
              type="text"
              value={config.bucket}
              onChange={(e) => handleConfigChange({ ...config, bucket: e.target.value })}
              placeholder={t('settings.imageHosting.s3.bucketPlaceholder')}
            />
          </div>
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="endpoint">{t('settings.imageHosting.s3.endpoint')}</Label>
            <Input
              id="endpoint"
              type="text"
              value={config.endpoint || ''}
              onChange={(e) => handleConfigChange({ ...config, endpoint: e.target.value })}
              placeholder="https://s3.amazonaws.com"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="customDomain">{t('settings.imageHosting.s3.customDomain')}</Label>
            <Input
              id="customDomain"
              type="text"
              value={config.customDomain || ''}
              onChange={(e) => handleConfigChange({ ...config, customDomain: e.target.value })}
              placeholder="https://cdn.example.com"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pathPrefix">{t('settings.imageHosting.s3.pathPrefix')}</Label>
            <Input
              id="pathPrefix"
              type="text"
              value={config.pathPrefix || ''}
              onChange={(e) => handleConfigChange({ ...config, pathPrefix: e.target.value })}
              placeholder="images/"
            />
            <p className="text-xs text-muted-foreground">
              {t('settings.imageHosting.s3.pathPrefixDesc')}
            </p>
          </div>
        </div>

      </CardContent>
    </Card>
  );
}
