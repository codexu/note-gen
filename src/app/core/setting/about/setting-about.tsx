'use client';
import { SettingRow, SettingType } from "../components/setting-base";
import { useTranslations } from 'next-intl';
import Updater from "./updater";
import { Bug, DownloadIcon, Github, MessageSquare } from "lucide-react";
import { open } from "@tauri-apps/plugin-shell";
import { Button } from "@/components/ui/button";

export function SettingAbout({id, icon}: {id: string, icon?: React.ReactNode}) {
  const t = useTranslations('settings.about');

  const items = [
    {
      url: "https://github.com/codexu/note-gen",
      title: t('items.github.title'),
      icon: <Github className="size-4" />,
      buttonName: t('items.github.buttonName')
    },
    {
      url: "https://github.com/codexu/note-gen/releases",
      title: t('items.releases.title'),
      icon: <DownloadIcon className="size-4" />,
      buttonName: t('items.releases.buttonName')
    },
    {
      url: "https://github.com/codexu/note-gen/issues",
      title: t('items.issues.title'),
      icon: <Bug className="size-4" />,
      buttonName: t('items.issues.buttonName')
    },
    {
      url: "https://github.com/codexu/note-gen/discussions",
      title: t('items.discussions.title'),
      icon: <MessageSquare className="size-4" />,
      buttonName: t('items.discussions.buttonName')
    }
  ]

  return (
    <SettingType id={id} icon={icon} title={t('title')}>
      <SettingRow className="mb-12">
        <Updater />
      </SettingRow>
      {
        items.map(item => <AboutItem key={item.url} {...item} />)
      }
    </SettingType>
  )
}

function AboutItem({url, title, icon, buttonName}: {url: string, title: string, icon?: React.ReactNode, buttonName?: string}) {
  const openInBrowser = () => {
    open(url);
  }
  return <SettingRow border className="flex justify-between items-center w-full">
    <div className="flex items-center gap-2">
      {icon}
      <span>{title}</span>
    </div>
    <Button variant="outline" onClick={openInBrowser}>{buttonName}</Button>
  </SettingRow>
}
