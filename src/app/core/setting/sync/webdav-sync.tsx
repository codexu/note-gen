import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormItem, SettingRow } from "../components/setting-base";
import { useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Upload, Download, LoaderCircle } from "lucide-react";
import useWebDAVStore, { WebDAVConnectionState } from "@/stores/webdav";
import { toast } from "@/hooks/use-toast";

export default function WebdavSync() {
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
      title: "备份成功",
      description: `已备份 ${res} 个文件至 WebDAV。`,
    });
  };

  const handleSyncFromWebDAV = async () => {
    const res = await syncFromWebDAV();
    toast({
      title: "同步成功",
      description: `已从 WebDAV 同步至本地 ${res} 个文件。`,
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
                    {connectionState}
                  </Badge>
                </CardTitle>
                <CardDescription>WebDAV 仅作为备用备份方案，不支持自动同步、历史回滚等功能。</CardDescription>
              </CardHeader>
              <CardContent className="flex gap-4">
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
                  备份至 WebDAV
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
                  从 WebDAV 同步
                </Button>
              </CardContent>
            </Card>
          </div>
        </FormItem>
      </SettingRow>
      <SettingRow>
        <FormItem title="WebDAV 服务器地址" desc="输入WebDAV服务器的URL，例如：https://dav.example.com">
          <Input 
            value={url} 
            onChange={handleUrlChange} 
            placeholder="https://dav.example.com"
          />
        </FormItem>
      </SettingRow>

      <SettingRow>
        <FormItem title="用户名" desc="WebDAV服务器的用户名">
          <Input 
            value={username} 
            onChange={handleUsernameChange} 
            placeholder="用户名"
          />
        </FormItem>
      </SettingRow>

      <SettingRow>
        <FormItem title="密码" desc="WebDAV服务器的密码">
          <Input 
            value={password} 
            onChange={handlePasswordChange} 
            type="password" 
            placeholder="密码"
          />
        </FormItem>
      </SettingRow>

      <SettingRow>
        <FormItem title="备份路径" desc="WebDAV服务器上的备份路径，例如：/backup/notes">
          <Input 
            value={path} 
            onChange={handlePathChange} 
            placeholder="/backup/notes"
          />
        </FormItem>
      </SettingRow>
    </>
  );
}