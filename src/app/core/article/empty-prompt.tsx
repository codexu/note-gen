import { useRef, useEffect } from 'react';
import { Info, FileSymlink, Bot, ExternalLink } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';

export default function EmptyPrompt() {
  const t = useTranslations('article.editor.empty');
  const webviewRefs = useRef<WebviewWindow[]>([]);

  // 清理函数，在组件卸载时关闭所有窗口
  useEffect(() => {
    return () => {
      // 只关闭仍然存在的窗口
      webviewRefs.current.forEach(webview => {
        if (!webview==null) { // 新增检查
          webview.close();
        }
      });
      webviewRefs.current = [];
    };
  }, []);

  // 使用 WebviewWindow 打开链接
  const openInWebview = (url: string, externalLinkTitle: string) => {
    try {
      const assetUrl = `asset://local/${url}`;
      const webview = new WebviewWindow(`guide-webview-${Date.now()}`, {
        url: assetUrl,
        title: externalLinkTitle,
        width: 1000,
        height: 700,
        center: true,
        decorations: true,
        resizable: true,
        fullscreen: false,
        alwaysOnTop: false,
      });      
      webviewRefs.current.push(webview);
      // 错误处理
      webview.once('tauri://error', (e) => {
        console.error(t('WindowCreateFail'), e);
        webviewRefs.current = webviewRefs.current.filter(w => w !== webview);
      });
    } catch (error) {
      console.error(t('WindowOpenFail'), error);
    }
  };

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center z-10 pointer-events-none">
      <div className="bg-background/80 dark:bg-zinc-900/80 p-8 rounded-lg border flex flex-col items-center max-w-md text-center">
        <Info className="size-12 mb-4 text-primary opacity-70" />
        <h3 className="text-xl font-semibold mb-2">{t('title')}</h3>
        <p className="text-muted-foreground mb-4">{t('description')}</p>
        
        <div className="flex flex-col gap-3 w-full">
          {[
            { 
              type: "simple",
              icon: <Bot className="size-8" />,
              title: t('AI.about') ,
              desc: t('AI.desc')
            },
            { 
              type: "simple",
              icon: <FileSymlink className="size-8" />,
              title: t('exportPDF.about') ,
              desc: t('exportPDF.desc')
            },
            // { 
            //   type: "complex",
            //   title: t('exportPDF.style.title'),
            //   desc: t('exportPDF.style.desc'),
            //   details: t('exportPDF.style.details')
            // },
            { 
              type: "external-web",
              title: t('exportPDF.style.title'),
              desc: t('exportPDF.style.desc'),
              url: t('exportPDF.style.url'),
              externalLinkTitle: t('exportPDF.style.externalLinkTitle')
            },
            { 
              type: "external-web",
              title: t('exportPDF.font.title'),
              desc: t('exportPDF.font.desc'),
              url: t('exportPDF.font.url'),
              externalLinkTitle: t('exportPDF.font.externalLinkTitle')
            }            
          ].map((item, index) => (
            <div 
              key={index} 
              className={`flex items-start gap-3 p-2 bg-muted/30 rounded relative
                ${item.type === "complex" 
                  ? "complex-item group pointer-events-auto" 
                  : item.type === "external-web"
                    ? "external-web-item group cursor-pointer transition-all duration-300 hover:bg-muted/50 hover:shadow-md hover:-translate-y-0.5 pointer-events-auto"
                    : ""}`
              }
              onClick={() => {
                if (item.type === "external-web" && item.url && item.externalLinkTitle) {
                  openInWebview(item.url,item.externalLinkTitle);
                }
              }}
            >
              {item.type === "simple" && (
                <span className="flex items-center justify-center mt-0.5 w-10 h-10">
                  {item.icon}
                </span>
              )}
              
              <div className={item.type === "complex" || item.type === "external-web" ? "w-full" : ""}>
                {item.type === "simple" ? (
                  <div className="flex flex-col text-left">
                    <span className="font-medium">{item.title}</span>
                    <span className="text-sm text-muted-foreground whitespace-pre-line">
                      {item.desc}
                    </span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center w-full"> 
                    <span className="font-medium">{item.title}</span>
                    <span className="text-sm text-muted-foreground whitespace-pre-line">
                      {item.desc}
                    </span>
                  </div>
                )}
              </div>
              
              {/* {item.type === "complex" && (
                <div className="absolute inset-0 bg-muted/50 dark:bg-zinc-800/70 rounded opacity-0 transition-opacity duration-300 group-hover:opacity-100 pointer-events-none flex items-center justify-center">
                  <div className="bg-background p-4 rounded-lg border shadow-lg max-w-xs mx-2">
                    <p className="text-sm text-foreground whitespace-pre-line">
                      {item.details}
                    </p>
                  </div>
                </div>
              )} */}
              
              {item.type === "external-web" && (
                <div className="absolute right-2 top-2 transform transition-transform duration-300 group-hover:scale-110">
                  <div className="relative flex items-center justify-center">
                    <ExternalLink className="size-4 text-primary opacity-0 group-hover:opacity-100 transition-all duration-300 delay-100" />
                    <div className="absolute inset-0 bg-primary/10 rounded-full scale-0 group-hover:scale-100 transition-transform duration-300 ease-out"></div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}