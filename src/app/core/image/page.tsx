'use client'
import { GithubFile } from '@/lib/sync/github'
import { uploadImageByGithub } from '@/lib/imageHosting/github'
import { useEffect, useState } from 'react'
import { ImageCard } from './image-card'
import useImageStore from '@/stores/imageHosting'
import useMarkStore from '@/stores/mark'
import { ImageHeader } from './image-header'
import { NoData } from './no-data'
import { v4 as uuid } from 'uuid'
import { CheckCircle, LoaderCircle } from 'lucide-react'
import { FolderCard } from './folder-card'
import { Store } from '@tauri-apps/plugin-store'

interface FileUploader {
  id: string
  file: File
  status: 'uploading' | 'success' | 'failed'
}
 
export default function Page() {
  const [loading, setLoading] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [files, setFiles] = useState<FileUploader[]>([])
  const [accessToken, setAccessToken] = useState('')
  const [githubImageUsername, setGithubImageUsername] = useState('')

  const { images, getImages, pushImage } = useImageStore()
  const { fetchAllMarks } = useMarkStore()

  async function init() {
    const store = await Store.load('store.json');
    const githubImageAccessToken = await store.get<string>('githubImageAccessToken')
    const githubImageUsername = await store.get<string>('githubImageUsername')
    if (githubImageAccessToken) {
      setAccessToken(githubImageAccessToken)
    }
    if (githubImageUsername) {
      setGithubImageUsername(githubImageUsername)
    }
  }

  async function uploadImage(fileUploader: FileUploader, index: number) {
    if (accessToken) {
      const res = await uploadImageByGithub(fileUploader.file)
      if (res) {
        fileUploader.status = 'success'
        pushImage({
          name: fileUploader.file.name,
          url: res,
          path: fileUploader.file.name,
          sha: '',
          size: fileUploader.file.size,
          html_url: res,
          download_url: res,
          git_url: res,
          type: 'file',
          _links: {
            self: res,
            git: res,
            html: res
          },
          isNew: true
        })
      } else {
        fileUploader.status ='failed'
      }
      const newFiles = files.splice(index, 1, fileUploader)
      setFiles(newFiles)
      return res
    }
  }

  async function handleDrop (e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setFiles([])
    setLoading(true)
    const dropFiles = e.dataTransfer.files
    const fileUploaders = []
    const newFiles = []
    for (let i = 0; i < dropFiles.length; i += 1) {
      const fileUploader: FileUploader = {
        id: uuid(),
        file: dropFiles[i],
        status: 'uploading'
      }
      newFiles.push(fileUploader)
      fileUploaders.push(uploadImage(fileUploader, i))
    }
    setFiles(newFiles)
    await Promise.all(fileUploaders)
    setIsDragging(false)
    setLoading(false)
  }
  
  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(true)
  }

  function handleDragleave(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false)
  }

  useEffect(() => {
    if (githubImageUsername && images.length === 0) {
      getImages()
      fetchAllMarks()
    }
  }, [githubImageUsername])

  useEffect(() => {
    init()
  }, [])
  
  return (
    <div
      id="image-page"
      className="h-screen overflow-hidden flex flex-col" 
      onDrop={(e) => handleDrop(e)}
      onDragOver={e => handleDragOver(e)}
      onDragLeave={(e) => handleDragleave(e)}
    >
      <ImageHeader />
      {
        isDragging ? <div className="flex-1 overflow-y-auto">
          <div className="flex justify-center items-center h-full">
            {
              loading ? 
              <div className="flex justify-center flex-col items-start h-full">
                {
                  files.map((file) => (
                    <div key={file.id} className="flex items-center gap-2">
                      {
                        file.status === 'success'?
                        <CheckCircle className='size-4' /> :
                        <LoaderCircle className='size-4 animate-spin' />
                      }
                      <p className="text-gray-500">{file.file.name}</p>
                    </div>
                  ))
                }
              </div> :
              <div className="flex justify-center items-center h-full bg-secondary flex-1">
                <div className="flex flex-col items-center gap-2">
                  <p className="text-gray-500">将图片拖拽至此</p>
                </div>
              </div>
            }
          </div>
        </div> :
        <div className="flex-1 overflow-y-auto">
          {
            accessToken ? 
            (
              <div className="p-2 grid md:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-2">
                {
                  images.map((file: GithubFile) => (
                    file.type === 'dir' ? 
                    <FolderCard key={file.path} file={file} /> :
                    <ImageCard key={file.path} file={file} />
                  )) 
                }
              </div>
            ): 
            <NoData />
          }
        </div>
      }
    </div>
  )
}

