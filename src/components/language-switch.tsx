'use client';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/hooks/useI18n";
import { Languages } from "lucide-react";
import { useTranslations, useLocale } from "next-intl";
import { SidebarMenuButton } from "@/components/ui/sidebar";
import { Button } from "./ui/button";
import { languages } from "@/config";

export function LanguageSwitch() {
  const { currentLocale, changeLanguage } = useI18n();
  const t = useTranslations('common');
  const locale = useLocale();

  const handleLanguageChange = (newLocale: string) => {
    // Use the simple localStorage approach
    changeLanguage(newLocale);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
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
        </SidebarMenuButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="right">
        {languages.map((language) => (
          <DropdownMenuItem 
            key={language.code}
            onClick={() => handleLanguageChange(language.code)}
          >
            <span className="mr-2">{language.flag}</span>
            {language.name} {(currentLocale === language.code || locale === language.code) && "✓"}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
