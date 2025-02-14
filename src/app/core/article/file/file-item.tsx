import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu";
import { Input } from "@/components/ui/input";
import useArticleStore, { DirTree } from "@/stores/article";
import { BaseDirectory, remove, rename, writeTextFile } from "@tauri-apps/plugin-fs";
import { appDataDir } from '@tauri-apps/api/path';
import { Cloud, CloudDownload, File } from "lucide-react"
import { useEffect, useRef, useState } from "react";
import { ask } from '@tauri-apps/plugin-dialog';
import { deleteFile } from "@/lib/github";
import { RepoNames } from "@/lib/github.types";
import { cloneDeep } from "lodash-es";
import { open } from "@tauri-apps/plugin-shell";
import { _t } from '@/locales';

export function FileItem({ item }: { item: DirTree }) {
  const [isEditing, setIsEditing] = useState(item.isEditing)
  const [name, setName] = useState(item.name)
  const inputRef = useRef<HTMLInputElement>(null)
  const { activeFilePath, setActiveFilePath, readArticle, setCurrentArticle, fileTree, setFileTree } = useArticleStore()
  const path = item.parent?.name ? item.parent.name + '/' + item.name : item.name

  function handleSelectFile() {
    setActiveFilePath(path)
    readArticle(path, item.sha, item.isLocale)
  }

  async function handleDeleteFile() {
    await remove(`article/${path}`, { baseDir: BaseDirectory.AppData })
    const cacheTree = cloneDeep(fileTree)
    if (path.includes('/')) {
      const dirIndex = cacheTree.findIndex(item => item.name === path.split('/')[0])
      const fileIndex = cacheTree[dirIndex].children?.findIndex(file => file.name === path.split('/')[1])
      const file = cacheTree[dirIndex].children?.find(file => file.name === path.split('/')[1])
      if (file && fileIndex !== undefined && fileIndex !== -1) {
        if (file.sha) {
          file.isLocale = false
          cacheTree[dirIndex].children?.splice(fileIndex, 1, file)
        } else {
          cacheTree[dirIndex].children?.splice(fileIndex, 1)
        }
      }
    } else {
      const index = cacheTree.findIndex(file => file.name === activeFilePath)
      cacheTree.splice(index, 1)
    }
    setFileTree(cacheTree)
    setActiveFilePath('')
    setCurrentArticle('')
  }

  async function handleDeleteSyncFile() {
    const answer = await ask(_t('delete_sync_file_confirm'), {
      title: _t('notegen'),
      kind: 'warning',
    });
    if (answer) {
      await deleteFile({ path: activeFilePath, sha: item.sha as string, repo: RepoNames.sync })
      const cacheTree = cloneDeep(fileTree)
      if (item.parent) {
        const parentIndex = cacheTree.findIndex(file => file.name === item.parent?.name)
        const index = item.parent.children?.findIndex(file => file.name === item.name)
        if (index !== undefined && index !== -1) {
          const currentFile = cloneDeep(item.parent.children?.[index])
          if (currentFile) {
            currentFile.sha = undefined;
            cacheTree[parentIndex].children?.splice(index, 1, currentFile)
          }
        }
      } else {
        const index = cacheTree.findIndex(file => file.name === activeFilePath)
        const currentFile = cacheTree[index]
        currentFile.sha = undefined;
        cacheTree.splice(index, 1, currentFile)
      }
      setFileTree(cacheTree)
    }
  }

  async function handleStartRename() {
    setIsEditing(true)
    setTimeout(() => inputRef.current?.focus(), 300);
  }

  async function handleRename() {
    // 将所有空格替换为下划线
    let name = inputRef.current?.value.replace(/ /g, '_')
    const cacheTree = cloneDeep(fileTree)
    if (name && item.name && name !== item.name) {
      if (item.parent) {
        const parentIndex = cacheTree.findIndex(file => file.name === item.parent?.name)
        const index = cacheTree[parentIndex].children?.findIndex(file => file.name === item.name)
        if (index!== undefined && index!== -1) {
          cacheTree[parentIndex].children?.splice(index, 1, {
            name,
            parent: item.parent,
            isEditing: false,
            isLocale: true,
            isDirectory: false,
            isFile: true,
            isSymlink: false
          })
          setFileTree(cacheTree)
          setActiveFilePath(item.parent.name + '/' + name)
        }
      } else {
        await rename(`article/${item.name}`, `article/${name}` ,{ newPathBaseDir: BaseDirectory.AppData, oldPathBaseDir: BaseDirectory.AppData})
        const cacheTree = cloneDeep(fileTree)
        const index = cacheTree.findIndex(file => file.name === item.name)
        if (index !== -1) {
          cacheTree.splice(index, 1, {
            name,
            parent: item.parent,
            isEditing: false,
            isLocale: true,
            isDirectory: false,
            isFile: true,
            isSymlink: false
          })
          setFileTree(cacheTree)
          setActiveFilePath(name)
        }
      }
    } else if (name) {
      if (!name.endsWith('.md')) name = name + '.md'
      if (item.parent) {
        await writeTextFile(`article/${item.parent.name}/${name}`, '', { baseDir: BaseDirectory.AppData })
        const parentIndex = cacheTree.findIndex(file => file.name === item.parent?.name)
        cacheTree[parentIndex].children?.splice(0, 1, {
          name,
          parent: item.parent,
          isEditing: false,
          isLocale: true,
          isDirectory: false,
          isFile: true,
          isSymlink: false
        })
        setFileTree(cacheTree)
        setActiveFilePath(item.parent.name + '/' + name)
      } else {
        await writeTextFile(`article/${name}`, '', { baseDir: BaseDirectory.AppData })
        cacheTree.splice(0, 1, {
          name,
          parent: item.parent,
          isEditing: false,
          isLocale: true,
          isDirectory: false,
          isFile: true,
          isSymlink: false
        })
        setFileTree(cacheTree)
        setActiveFilePath(name)
      }
      setCurrentArticle('')
      setIsEditing(false)
    } else {
      if (item.parent) {
        const index = cacheTree.findIndex(file => file.name === item.parent?.name)
        const fileIndex = cacheTree[index].children?.findIndex(file => file.name === item.name)
        if (fileIndex!== undefined && fileIndex!== -1) {
          cacheTree[index].children?.splice(fileIndex, 1)
        }
        setFileTree(cacheTree)
      } else {
        const index = cacheTree.findIndex(file => file.name === item.name)
        if (index!== -1) {
          cacheTree.splice(index, 1)
        }
        setFileTree(cacheTree)
      }
    }
  }

  async function handleShowFileManager() {
    const appDir = await appDataDir()
    open(`${appDir}/article${item.parent? '/'+item.parent.name : ''}`)
  }

  async function handleDragStart(ev: React.DragEvent<HTMLDivElement>) {
    ev.dataTransfer.setData('text', path)
  }

  useEffect(() => {
    if (item.isEditing) {
      setName(name)
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [item])

  return (
    <ContextMenu>
      <ContextMenuTrigger>
        <div
          className={path === activeFilePath ? 'file-manange-item active' : 'file-manange-item'}
          onClick={handleSelectFile}
          onContextMenu={handleSelectFile}
        >
          {
            isEditing ?
            <div className="flex gap-1 items-center w-full select-none">
              <span className={item.parent ? 'size-0' : 'size-4 ml-1'} />
              <File className="size-4" />
              <Input
                ref={inputRef}
                className="h-5 rounded-sm text-xs px-1 font-normal flex-1 mr-1"
                value={name}
                onBlur={handleRename}
                onChange={(e) => { setName(e.target.value) }}
                onKeyDown={(e) => {
                  if (e.code === 'Enter') {
                    handleRename()
                  }
                }}
              />
            </div> :
            <span draggable onDragStart={handleDragStart}
              className={`${item.isLocale ? '' : 'opacity-50'} flex justify-between flex-1 select-none items-center gap-1 dark:hover:text-white`}>
              <div className="flex flex-1 gap-1 select-none relative">
                <span className={item.parent ? 'size-0' : 'size-4 ml-1'}></span>
                <div className="relative">
                  { item.isLocale ? <File className="size-4" /> : <CloudDownload className="size-4" /> }
                  { item.sha && item.isLocale && <Cloud className="size-2.5 absolute left-0 bottom-0 z-10 bg-primary-foreground" /> }
                </div>
                <span className="text-xs flex-1 line-clamp-1">{item.name.slice(0, -3)}</span>
              </div>
            </span>
          }
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem inset onClick={handleShowFileManager}>
          {_t('view_directory')}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem inset disabled>
          {_t('cut')}
        </ContextMenuItem>
        <ContextMenuItem inset disabled>
          {_t('copy')}
        </ContextMenuItem>
        <ContextMenuItem inset disabled>
          {_t('paste')}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem disabled={!item.isLocale} inset onClick={handleStartRename}>
          {_t('rename')}
        </ContextMenuItem>
        <ContextMenuItem disabled={!item.sha} inset className="text-red-900" onClick={handleDeleteSyncFile}>
          {_t('delete_sync_file')}
        </ContextMenuItem>
        <ContextMenuItem disabled={!item.isLocale} inset className="text-red-900" onClick={handleDeleteFile}>
          {_t('delete_local_file')}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
