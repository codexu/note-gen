import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormItem, SettingRow } from "../components/setting-base";
import { useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Upload, Download, LoaderCircle } from "lucide-react";
import useWebDAVStore, { WebDAVConnectionState } from "@/stores/webdav";
import { toast } from "@/hooks/use-toast";
import { useTranslations } from "next-intl";

export default function WebdavSync() {
  const t = useTranslations('settings.backupSync.webdav');
  const { 
    url, setUrl,
    username, setUsername,
    password, setPassword,
    path, setPath,
    connectionState, 
    backupToWebDAV,
    syncFromWebDAV,
    initWebDAVData,
    syncState,
    backupState
  } = useWebDAVStore();

  useEffect(() => {
    initWebDAVData();
  }, []);

  const handleUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setUrl(e.target.value);
  };

  const handleUsernameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setUsername(e.target.value);
  };

  const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPassword(e.target.value);
  };

  const handlePathChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPath(e.target.value);
  };

  const handleBackupToWebDAV = async () => {
    const res = await backupToWebDAV();
    toast({
      title: t('backupSuccess'),
      description: t('backupSuccessDesc', { count: res }),
    });
  };

  const handleSyncFromWebDAV = async () => {
    const res = await syncFromWebDAV();
    toast({
      title: t('syncSuccess'),
      description: t('syncSuccessDesc', { count: res }),
    });
  };

  return (
    <>
      <SettingRow>
        <FormItem title="">
          <div className="flex items-center space-x-4">
            <Card className="flex-1">
              <CardHeader>
                <CardTitle className="flex items-center gap-4">
                  <span className="text-base font-bold">WebDAV</span>
                  <Badge 
                    className={`${
                      connectionState === WebDAVConnectionState.success 
                        ? 'bg-green-800' 
                        : connectionState === WebDAVConnectionState.checking 
                          ? 'bg-yellow-800' 
                          : 'bg-red-800'
                    }`}
                  >
                    {t(`connectionState.${connectionState}`)}
                  </Badge>
                </CardTitle>
                <CardDescription>{t('description')}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col lg:flex-row gap-4">
                <Button 
                  onClick={handleBackupToWebDAV} 
                  variant="outline" 
                  className="mt-2"
                  disabled={backupState || syncState}
                >
                  {
                    backupState ? (
                      <LoaderCircle className="animate-spin" />
                    ) : (
                      <Upload />
                    )
                  }
                  {t('backupTo')}
                </Button>
                <Button 
                  onClick={handleSyncFromWebDAV} 
                  variant="outline" 
                  className="mt-2"
                  disabled={syncState || backupState}
                >
                  {
                    syncState ? (
                      <LoaderCircle className="animate-spin" />
                    ) : (
                      <Download />
                    )
                  }
                  {t('syncFrom')}
                </Button>
              </CardContent>
            </Card>
          </div>
        </FormItem>
      </SettingRow>
      <SettingRow>
        <FormItem title={t('serverUrl')} desc={t('serverUrlDesc')}>
          <Input 
            value={url} 
            onChange={handleUrlChange} 
            placeholder={t('serverUrlPlaceholder')}
          />
        </FormItem>
      </SettingRow>

      <SettingRow>
        <FormItem title={t('username')} desc={t('usernameDesc')}>
          <Input 
            value={username} 
            onChange={handleUsernameChange} 
            placeholder={t('usernamePlaceholder')}
          />
        </FormItem>
      </SettingRow>

      <SettingRow>
        <FormItem title={t('password')} desc={t('passwordDesc')}>
          <Input 
            value={password} 
            onChange={handlePasswordChange} 
            type="password" 
            placeholder={t('passwordPlaceholder')}
          />
        </FormItem>
      </SettingRow>

      <SettingRow>
        <FormItem title={t('backupPath')} desc={t('backupPathDesc')}>
          <Input 
            value={path} 
            onChange={handlePathChange} 
            placeholder={t('backupPathPlaceholder')}
          />
        </FormItem>
      </SettingRow>
    </>
  );
}