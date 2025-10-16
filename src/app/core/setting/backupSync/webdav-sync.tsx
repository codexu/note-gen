import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormItem } from "../components/setting-base";
import { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Upload, Download, LoaderCircle } from "lucide-react";
import useWebDAVStore, { WebDAVConnectionState } from "@/stores/webdav";
import { useToast } from "@/hooks/use-toast";
import { useTranslations } from "next-intl";
import useArticleStore from "@/stores/article";

export default function WebdavSync() {
  const t = useTranslations("settings.backupSync.webdav");
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
    backupState,
    createWebDAVDir,
  } = useWebDAVStore();
  const { loadFileTree } = useArticleStore()


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
    try {
    const res = await backupToWebDAV();
    toast({
        title: t("backupSuccess"),
        description: t("backupSuccessDesc", { count: res }),
    });
    } catch (_error) {
      const errorMessage = _error as string;

      if (errorMessage.startsWith("[ERR_PATH_NOT_FOUND]")) {
        toast({
          variant: "destructive",
          title: t("backupFailed"),
          description: t("error.pathNotFound"),
        });
      } else {
        toast({
          variant: "destructive",
          title: t("backupFailed"),
          description: t("error.connectionTimeOut"),
        });
      }
    }
  };

  const handleSyncFromWebDAV = async () => {
    try {
    const res = await syncFromWebDAV();
    toast({
        title: t("syncSuccess"),
        description: t("syncSuccessDesc", { count: res }),
    });
    } catch (error) {
      const errorMessage = error as string;

      if (errorMessage.startsWith("[ERR_PATH_NOT_FOUND]")) {
        const missingPath = errorMessage.replace("[ERR_PATH_NOT_FOUND] ", "");
        toast({
          variant: "destructive",
          title: t("syncFailed"),
          description: t("error.pathNotFound", { path: missingPath }),
        });
      } else {
        toast({
          variant: "destructive",
          title: t("syncFailed"),
          description: t("error.connectionTimeOut"),
        });
      }
    } finally {
      loadFileTree()
    }
  };

  const { toast } = useToast();

  const [isCreating, setIsCreating] = useState(false);

  const handleCreateDirectory = async () => {
    if (!path.trim()) {
      toast({
        variant: "destructive",
        title: t("error.createDirFailed"),
        description: t("error.pathCannotBeEmpty"),
      });
      return;
    }

    setIsCreating(true);

    try {
      await createWebDAVDir(path);
      await initWebDAVData();
      toast({
        title: t("success"),
        description: t("directoryCreatedDesc", { path }),
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: t("error.createDirFailed"),
        description: error.message || t("error.connectionTimeOut"),
      });
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="space-y-8">
      <FormItem title="">
          <div className="flex items-center space-x-4">
            <Card className="flex-1">
              <CardHeader>
                <CardTitle className="flex items-center gap-4">
                  <span className="text-base font-bold">WebDAV</span>
                  <Badge 
                    className={`${
                      connectionState === WebDAVConnectionState.success 
                        ? "bg-green-800"
                        : connectionState === WebDAVConnectionState.checking 
                        ? "bg-yellow-800"
                        : "bg-red-800"
                    }`}
                  >
                    {t(`connectionState.${connectionState}`)}
                  </Badge>
                </CardTitle>
                <CardDescription>{t("description")}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col md:flex-row gap-4">
                <Button 
                  onClick={handleBackupToWebDAV} 
                  className="mt-2"
                  disabled={backupState || syncState}
                >
                  {backupState ? <LoaderCircle className="animate-spin" /> : <Upload />}
                  {t("backupTo")}
                </Button>
                <Button 
                  onClick={handleSyncFromWebDAV} 
                  className="mt-2"
                  disabled={syncState || backupState}
                >
                  {syncState ? <LoaderCircle className="animate-spin" /> : <Download />}
                  {t("syncFrom")}
                </Button>
              </CardContent>
            </Card>
          </div>
      </FormItem>
      <FormItem title={t("serverUrl")} desc={t("serverUrlDesc")}>
          <Input value={url} onChange={handleUrlChange} placeholder={t("serverUrlPlaceholder")} />
      </FormItem>
      <FormItem title={t("username")} desc={t("usernameDesc")}>
          <Input value={username} onChange={handleUsernameChange} placeholder={t("usernamePlaceholder")} />
      </FormItem>
      <FormItem title={t("password")} desc={t("passwordDesc")}>
          <Input 
            value={password} 
            onChange={handlePasswordChange} 
            type="password" 
            placeholder={t("passwordPlaceholder")}
          />
      </FormItem>
      <FormItem title={t("backupPath")} desc={t("backupPathDesc")}>
          <div className="flex items-center gap-2">
          <Input 
              className="flex-grow"
            value={path} 
            onChange={handlePathChange} 
              placeholder={t("backupPathPlaceholder")}
          />
            <Button
              variant="outline"
              disabled={connectionState !== WebDAVConnectionState.fail || isCreating || !path.trim() || path.trim() === "/"}
              onClick={handleCreateDirectory}
            >
              {isCreating && <LoaderCircle className="animate-spin" />}
              {t("createDir")}
            </Button>
          </div>
      </FormItem>
    </div>
  );
}