import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/hooks/useI18n";
import { Languages } from "lucide-react";
import { useTranslations } from "next-intl";
import { SidebarMenuButton } from "@/components/ui/sidebar";
import { Button } from "./ui/button";
import { isMobileDevice } from "@/lib/check";

export function LanguageSwitch() {
  const { currentLocale, changeLanguage } = useI18n();
  const t = useTranslations('common');

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {
          !isMobileDevice() ? 
          <SidebarMenuButton asChild className="md:h-8 md:p-0"
            tooltip={{
              children: t('language'),
              hidden: false,
            }}
          >
            <a href="#">
              <div className="flex size-8 items-center justify-center rounded-lg">
                <Button
                  variant="ghost"
                  size="sm" 
                >
                  <Languages className="h-[1.2rem] w-[1.2rem]" />
                </Button>
              </div>
            </a>
          </SidebarMenuButton> : 
          <Button variant="ghost" size="icon" onClick={() => changeLanguage("en")}>
            <Languages className="h-[1.2rem] w-[1.2rem]" />
          </Button>
        }
      </DropdownMenuTrigger>
      <DropdownMenuContent align={isMobileDevice() ? "end" : "start"} side={isMobileDevice() ? "right" : "bottom"}>
        <DropdownMenuItem onClick={() => changeLanguage("en")}>
          English {currentLocale === "en" && "✓"}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => changeLanguage("zh")}>
          中文 {currentLocale === "zh" && "✓"}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => changeLanguage("ja")}>
          日本語 {currentLocale === "ja" && "✓"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
