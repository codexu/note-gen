import { Store } from "@tauri-apps/plugin-store";
import { appDataDir } from "@tauri-apps/api/path";
import { mkdir, exists, writeFile, remove } from "@tauri-apps/plugin-fs";
import { v4 as uuid } from "uuid";
import { toast } from "@/hooks/use-toast";

export interface PicgoImageHostingSetting {
  url: string;
  port: string;
  apiKey?: string;
}

// 判断是否为本机地址
function isLocalhost(url: string): boolean {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname;
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0" || hostname === "::1";
  } catch {
    return false;
  }
}

export async function uploadImageByPicgo(image: File) {
  const store = await Store.load("store.json");
  const picgoSetting = await store.get<PicgoImageHostingSetting>("picgo");
  if (!picgoSetting) {
    return null;
  }

  // 构建请求URL
  let uploadUrl = `${picgoSetting.url}/upload`;
  const headers: Record<string, string> = {};

  // 如果有API Key，添加到query参数中
  if (picgoSetting.apiKey) {
    uploadUrl += `?key=${encodeURIComponent(picgoSetting.apiKey)}`;
  }

  // 判断是否为本机，选择不同的上传方式
  const isLocal = isLocalhost(picgoSetting.url);

  try {
    let response: Response;

    if (isLocal) {
      // 本机：使用路径上传
      const cacheDir = await appDataDir();
      const cachePath = `${cacheDir}/picgo`;
      if (!(await exists(cachePath))) {
        await mkdir(cachePath);
      }
      const cacheFile = `${cachePath}/${uuid()}.png`;
      const uint8Array = new Uint8Array(await image.arrayBuffer());
      await writeFile(cacheFile, uint8Array);

      const body = {
        list: [cacheFile],
      };

      headers["Content-Type"] = "application/json";
      response = await fetch(uploadUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });

      // 清理临时文件
      try {
        await remove(cacheFile);
      } catch {
        // 忽略清理错误
      }
    } else {
      // 远程：使用表单上传
      const formData = new FormData();
      
      // 使用 UUID 生成唯一文件名，保持原扩展名
      const originalName = image.name || 'image.png';
      const extension = originalName.split('.').pop() || 'png';
      const uniqueFileName = `${uuid()}.${extension}`;
      
      formData.append("image", image, uniqueFileName);
      
      console.log("原始文件名:", originalName);
      console.log("生成的唯一文件名:", uniqueFileName);
      console.log("上传URL:", uploadUrl);

      response = await fetch(uploadUrl, {
        method: "POST",
        body: formData,
      });
      
      console.log("响应状态:", response.status);
    }

    const data = await response.json();
    console.log(data);

    if (data.success) {
      return data.result[0];
    }
    return null;
  } catch (error) {
    toast({
      title: "Upload failed",
      description: error instanceof Error ? error.message : "Upload failed",
      variant: "destructive",
    });
    return null;
  }
}

export async function checkPicgoState() {
  const store = await Store.load("store.json");
  const picgoSetting = await store.get<PicgoImageHostingSetting>("picgo");
  if (!picgoSetting) {
    return false;
  }

  // 构建心跳检测URL和headers
  const heartbeatUrl = `${picgoSetting.url}/heartbeat`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  try {
    const response = await fetch(heartbeatUrl, {
      method: "GET",
      headers,
    });
    const data = await response.json();

    return response.ok && data;
  } catch {
    return false;
  }
}
