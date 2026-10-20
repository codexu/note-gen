'use client';
import { SettingSection, SettingType } from "../components/setting-base";
import { Item, ItemGroup, ItemMedia, ItemContent, ItemTitle, ItemDescription, ItemActions } from "@/components/ui/item";
import { useTranslations } from 'next-intl';
import Updater from "./updater";
import { BriefcaseBusiness, Bug, ExternalLink, GitFork, HandHeart, HomeIcon, MessageSquare } from "lucide-react";
import { open } from "@tauri-apps/plugin-shell";
import { Button } from "@/components/ui/button";
import { ShineBorder } from '@/components/ui/shine-border'
import type { ReactNode } from "react";
import { cn } from '@/lib/utils'
import { checkIsTauri } from "@/lib/check";

interface AboutResource {
  url: string
  title: string
  desc: string
  icon: ReactNode
  buttonName: string
  shine?: boolean
}

interface AboutResourceSection {
  id: string
  title: string
  desc: string
  items: AboutResource[]
}

export function SettingAbout({id, icon}: {id: string, icon?: React.ReactNode}) {
  const t = useTranslations('settings.about');

  const communityItems: AboutResource[] = [
    {
      url: "https://notegen.top/",
      title: t('items.home.title'),
      desc: t('items.home.desc'),
      icon: <HomeIcon />,
      buttonName: t('items.home.buttonName')
    },
    {
      url: "https://github.com/codexu/note-gen",
      title: t('items.github.title'),
      desc: t('items.github.desc'),
      icon: <GitFork />,
      buttonName: t('items.github.buttonName')
    },
    {
      url: "https://github.com/codexu/note-gen/issues",
      title: t('items.issues.title'),
      desc: t('items.issues.desc'),
      icon: <Bug />,
      buttonName: t('items.issues.buttonName')
    },
    {
      url: "https://github.com/codexu/note-gen/discussions",
      title: t('items.discussions.title'),
      desc: t('items.discussions.desc'),
      icon: <MessageSquare />,
      buttonName: t('items.discussions.buttonName')
    }
  ]

  const donationItems: AboutResource[] = [
    {
      url: "https://notegen.top/donate",
      title: t('items.donate.title'),
      desc: t('items.donate.desc'),
      icon: <HandHeart />,
      buttonName: t('items.donate.buttonName'),
      shine: true
    },
    {
      url: "https://notegen.top/business",
      title: t('items.business.title'),
      desc: t('items.business.desc'),
      icon: <BriefcaseBusiness />,
      buttonName: t('items.business.buttonName')
    }
  ]

  const sections: AboutResourceSection[] = [
    {
      id: 'donation',
      title: t('sections.donation.title'),
      desc: t('sections.donation.desc'),
      items: donationItems
    },
    {
      id: 'community',
      title: t('sections.community.title'),
      desc: t('sections.community.desc'),
      items: communityItems
    }
  ]

  return (
    <SettingType id={id} icon={icon} title={t('title')}>
      <div className="flex w-full flex-col gap-6">
        <SettingSection title={t('sections.appInfo.title')} desc={t('sections.appInfo.desc')}>
          <Updater />
        </SettingSection>

        {sections.map(section => (
          <ResourceSection key={section.id} section={section} />
        ))}

        <p className="text-xs text-muted-foreground">{t('licenseText')}</p>
      </div>
    </SettingType>
  )
}

function ResourceSection({ section }: { section: AboutResourceSection }) {
  return (
    <SettingSection title={section.title} desc={section.desc}>
      <ItemGroup className="grid gap-3 lg:grid-cols-2">
        {section.items.map(item => <AboutItem key={item.url} {...item} />)}
      </ItemGroup>
    </SettingSection>
  )
}

function AboutItem({url, title, desc, icon, buttonName, shine}: AboutResource) {
  const openInBrowser = () => {
    if (checkIsTauri()) {
      open(url);
      return;
    }

    window.open(url, '_blank', 'noopener,noreferrer');
  }
  return (
    <Item variant="outline" className={cn(shine && 'relative')}>
      {shine ? (
        <ShineBorder
          borderWidth={1}
          duration={5}
          shineColor={["#FF6B6B", "#4ECDC4", "#45B7D1", "#FFA07A"]}
        />
      ) : null}
      <ItemMedia variant="icon">{icon}</ItemMedia>
      <ItemContent>
        <ItemTitle>{title}</ItemTitle>
        <ItemDescription>{desc}</ItemDescription>
      </ItemContent>
      <ItemActions>
        <Button variant="ghost" size="icon" title={buttonName} aria-label={buttonName} onClick={openInBrowser}>
          <ExternalLink />
        </Button>
      </ItemActions>
    </Item>
  )
}
