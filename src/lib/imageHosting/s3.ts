import { Store } from "@tauri-apps/plugin-store";
import { fetch, Proxy } from '@tauri-apps/plugin-http'
import { toast } from '@/hooks/use-toast';
import { v4 as uuid } from 'uuid';

interface S3Config {
  accessKeyId: string
  secretAccessKey: string
  region: string
  bucket: string
  endpoint?: string
  customDomain?: string
  pathPrefix?: string
}

// 生成 AWS 签名 V4 (使用 Web Crypto API)
async function generateSignature(
  method: string,
  url: string,
  headers: Record<string, string>,
  payload: BufferSource,
  config: S3Config
) {
  const algorithm = 'AWS4-HMAC-SHA256';
  const date = new Date();
  const dateStamp = date.toISOString().slice(0, 10).replace(/-/g, '');
  const amzDate = date.toISOString().replace(/[:\-]|\.\d{3}/g, '');
  
  // 必须将 x-amz-date 加入 headers 参与签名
  headers['x-amz-date'] = amzDate;
  
  // 创建规范请求
  // 必须对路径进行 URI 编码，但要保留斜杠
  const canonicalUri = new URL(url).pathname.split('/').map(encodeURIComponent).join('/');
  const canonicalQuerystring = '';

  // AWS V4 签名要求 Headers 的 Key 必须全部转为小写
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map(key => `${key.toLowerCase()}:${headers[key].trim()}\n`)
    .join('');
    
  const signedHeaders = Object.keys(headers)
    .sort()
    .map(key => key.toLowerCase())
    .join(';');
  
  // 使用 Web Crypto API 计算 SHA256
  const payloadHash = await crypto.subtle.digest('SHA-256', payload);
  const payloadHashHex = Array.from(new Uint8Array(payloadHash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  
  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuerystring,
    canonicalHeaders,
    signedHeaders,
    payloadHashHex
  ].join('\n');
  
  // 创建字符串以供签名
  const credentialScope = `${dateStamp}/${config.region}/s3/aws4_request`;
  const stringToSign = [
    algorithm,
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest)
  ].join('\n');
  
  // 计算签名
  const signingKey = await getSignatureKey(config.secretAccessKey, dateStamp, config.region, 's3');
  const signature = await hmacSha256Hex(signingKey, stringToSign);
  
  return {
    authorization: `${algorithm} Credential=${config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    amzDate,
    payloadHashHex
  };
}

// Web Crypto API 辅助函数
async function sha256Hex(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const hash = await crypto.subtle.digest('SHA-256', encoder.encode(data));
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

async function hmacSha256(key: CryptoKey, data: string): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  return await crypto.subtle.sign('HMAC', key, encoder.encode(data));
}

async function hmacSha256Hex(key: CryptoKey, data: string): Promise<string> {
  const signature = await hmacSha256(key, data);
  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

async function getSignatureKey(key: string, dateStamp: string, regionName: string, serviceName: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  
  // 导入初始密钥
  const kSecret = await crypto.subtle.importKey(
    'raw',
    encoder.encode('AWS4' + key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  // kDate = HMAC("AWS4" + kSecret, Date)
  const kDate = await crypto.subtle.sign('HMAC', kSecret, encoder.encode(dateStamp));
  const kDateKey = await crypto.subtle.importKey(
    'raw',
    kDate,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  // kRegion = HMAC(kDate, Region)
  const kRegion = await crypto.subtle.sign('HMAC', kDateKey, encoder.encode(regionName));
  const kRegionKey = await crypto.subtle.importKey(
    'raw',
    kRegion,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  // kService = HMAC(kRegion, Service)
  const kService = await crypto.subtle.sign('HMAC', kRegionKey, encoder.encode(serviceName));
  const kServiceKey = await crypto.subtle.importKey(
    'raw',
    kService,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  // kSigning = HMAC(kService, "aws4_request")
  const kSigning = await crypto.subtle.sign('HMAC', kServiceKey, encoder.encode('aws4_request'));
  return await crypto.subtle.importKey(
    'raw',
    kSigning,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

// 测试 S3 连接
export async function testS3Connection(config: S3Config): Promise<boolean> {
  try {
    const store = await Store.load('store.json');
    const proxyUrl = await store.get<string>('proxy')
    const proxy: Proxy | undefined = proxyUrl ? { all: proxyUrl } : undefined

    const endpoint = (config.endpoint || `https://s3.${config.region}.amazonaws.com`).trim();
    const bucket = config.bucket.trim();
    
    // 智能判断 URL 风格
    let url = `${endpoint}/${bucket}`;
    
    // 针对阿里云 OSS、AWS S3 等支持 Virtual Hosted Style 的服务进行优化
    // 将 https://oss-cn-beijing.aliyuncs.com/bucket 改为 https://bucket.oss-cn-beijing.aliyuncs.com
    const isAliyun = endpoint.includes('aliyuncs.com');
    const isAWS = endpoint.includes('amazonaws.com');
    
    if (isAliyun || isAWS) {
       try {
         const urlObj = new URL(endpoint);
         urlObj.hostname = `${bucket}.${urlObj.hostname}`;
         url = urlObj.toString();
         // 移除末尾斜杠
         if (url.endsWith('/')) url = url.slice(0, -1);
       } catch {
         console.warn('[S3] Failed to construct Virtual Hosted URL, falling back to Path Style');
       }
    }
    

    const emptyPayload = new ArrayBuffer(0);
    const payloadHash = await crypto.subtle.digest('SHA-256', emptyPayload);
    const payloadHashHex = Array.from(new Uint8Array(payloadHash))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    
    const headers: Record<string, string> = {
      'Host': new URL(url).host,
      'X-Amz-Content-Sha256': payloadHashHex
    };
    
    // 使用 GET 请求代替 HEAD，以便在出错时能获取具体的 XML 错误信息
    const method = 'GET';
    const { authorization, amzDate } = await generateSignature(method, url, headers, emptyPayload, config);
    
    const requestHeaders = new Headers();
    requestHeaders.append('Authorization', authorization);
    // 注意：fetch 请求头的键不区分大小写，但为了与签名完全一致，建议保持一致
    requestHeaders.append('X-Amz-Date', amzDate);
    requestHeaders.append('X-Amz-Content-Sha256', payloadHashHex);
    
    const response = await fetch(url, {
      method: method,
      headers: requestHeaders,
      proxy
    });

    if (response.status === 200) {
        return true;
    }

    // 如果 GET (ListObjects) 失败（可能是只有写权限），尝试 PUT 一个测试文件
    if (response.status === 403) {
        console.warn('ListObjects (GET) failed with 403, trying PutObject to verify write permission...');
        
        const testKey = '.connection-test';
        const testUrl = `${url}/${testKey}`.replace(/([^:]\/)\/+/g, "$1");
        const testContent = new TextEncoder().encode('test');
        
        const putHeaders = {
            'Host': new URL(testUrl).host,
            'Content-Type': 'text/plain',
            'Content-Length': testContent.byteLength.toString()
        };
        
        const { authorization: authPut, amzDate: datePut, payloadHashHex: hashPut } = 
            await generateSignature('PUT', testUrl, putHeaders, testContent, config);
            
        const requestPutHeaders = new Headers();
        requestPutHeaders.append('Authorization', authPut);
        requestPutHeaders.append('X-Amz-Date', datePut);
        requestPutHeaders.append('Content-Type', 'text/plain');
        requestPutHeaders.append('X-Amz-Content-Sha256', hashPut);
        
        const putResponse = await fetch(testUrl, {
            method: 'PUT',
            headers: requestPutHeaders,
            body: testContent,
            proxy
        });
        
        if (putResponse.status === 200 || putResponse.status === 204) {
            return true;
        } else {
             const putErrorText = await putResponse.text();
             console.error('PutObject also failed:', putResponse.status, putErrorText);
        }
    }

    const errorText = await response.text();
    console.warn('S3 Check Failed:', {
        status: response.status,
        statusText: response.statusText,
        url: url,
        headers: Object.fromEntries(response.headers.entries()),
        errorBody: errorText || '(empty body)'
    });
    
    return false;
  } catch (error) {
    console.error('S3 connection test failed:', error);
    
    // 尝试提取更有用的错误信息
    const errorMessage = (error as Error).message || String(error);
    if (errorMessage.includes('error sending request')) {
       console.warn('Network Error Details: Please check your Endpoint, Region, and Proxy settings. URL might be malformed.');
    }
    
    return false;
  }
}

// 上传图片到 S3
export async function uploadImageByS3(file: File): Promise<string | undefined> {
  try {
    const store = await Store.load('store.json');
    const config = await store.get<S3Config>('s3Config');
    
    if (!config) {
      toast({
        title: 'S3 配置错误',
        description: '请先配置 S3 参数',
        variant: 'destructive',
      });
      return undefined;
    }
    
    const proxyUrl = await store.get<string>('proxy')
    const proxy: Proxy | undefined = proxyUrl ? { all: proxyUrl } : undefined

    // 生成文件名
    const id = uuid();
    const ext = file.name.split('.').pop() || 'jpg';
    const filename = `${id}.${ext}`.replace(/\s/g, '_');
    
    // 处理 pathPrefix，移除末尾的斜杠以防止双斜杠问题
    const prefix = config.pathPrefix ? config.pathPrefix.trim().replace(/\/+$/, '') : '';
    const key = prefix ? `${prefix}/${filename}` : filename;
    
    // 准备上传
    let endpoint = (config.endpoint || `https://s3.${config.region}.amazonaws.com`).trim();
    // 移除 endpoint 末尾的斜杠
    if (endpoint.endsWith('/')) endpoint = endpoint.slice(0, -1);

    const bucket = config.bucket.trim();
    let url = `${endpoint}/${bucket}/${key}`;

    // 针对阿里云 OSS、AWS S3 等支持 Virtual Hosted Style 的服务进行优化
    const isAliyun = endpoint.includes('aliyuncs.com');
    const isAWS = endpoint.includes('amazonaws.com');
    
    if (isAliyun || isAWS) {
       try {
         const urlObj = new URL(endpoint);
         urlObj.hostname = `${bucket}.${urlObj.hostname}`;
         // 重新构建 URL，包含 key
         url = `${urlObj.toString()}/${key}`;
         // 处理可能的双斜杠
         url = url.replace(/([^:]\/)\/+/g, "$1");
       } catch {
         console.warn('[S3 Upload] Failed to switch to Virtual Hosted Style');
       }
    }
    // 读取文件内容
    const arrayBuffer = await file.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    
    const headers = {
      'Host': new URL(url).host,
      'Content-Type': file.type || 'application/octet-stream',
      'Content-Length': file.size.toString()
    };
    
    const { authorization, amzDate, payloadHashHex } = await generateSignature('PUT', url, headers, arrayBuffer, config);
    
    const requestHeaders = new Headers();
    requestHeaders.append('Authorization', authorization);
    requestHeaders.append('X-Amz-Date', amzDate);
    requestHeaders.append('Content-Type', file.type || 'application/octet-stream');
    requestHeaders.append('X-Amz-Content-Sha256', payloadHashHex);
    
    const response = await fetch(url, {
      method: 'PUT',
      headers: requestHeaders,
      body: uint8Array,
      proxy
    });
    
    if (response.status === 200 || response.status === 204) {
      // 返回访问 URL
      if (config.customDomain) {
        const domain = config.customDomain.trim().replace(/\/+$/, '');
        return `${domain}/${key}`;
      } else {
        // 如果使用了 Virtual Hosted Style，返回优化后的 URL
        if (isAliyun || isAWS) {
           try {
             const urlObj = new URL(endpoint);
             urlObj.hostname = `${bucket}.${urlObj.hostname}`;
             const baseUrl = urlObj.toString().replace(/\/+$/, '');
             return `${baseUrl}/${key}`;
           } catch {
             return `${endpoint}/${bucket}/${key}`;
           }
        }
        return `${endpoint}/${bucket}/${key}`;
      }
    } else {
      const errorText = await response.text();
      throw new Error(`Upload failed: ${response.status} ${errorText}`);
    }
    
  } catch (error) {
    toast({
      title: '上传失败',
      description: (error as Error).message,
      variant: 'destructive',
    });
    return undefined;
  }
}
