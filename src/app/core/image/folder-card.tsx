import {
  Card,
  CardContent,
} from "@/components/ui/card"
import { GithubFile } from "@/lib/sync/github"
import useImageStore from "@/stores/imageHosting"
import { Folder } from 'lucide-react'

export function FolderCard({file}: {file: GithubFile}) {
  const { setPath, getImages } = useImageStore()
  const folderHandler = () => {
    setPath(file.name)
    getImages()
  }
  return (
    <Card
      onClick={folderHandler}
      className={`w-full h-36 overflow-hidden p-0 rounded-lg shadow-none relative group cursor-pointer hover:outline outline-0.5`}>
      <CardContent className="p-0 h-full flex items-center gap-2 justify-center flex-col">
        <Folder className="size-12" />
        <p className="text-gray-500">{file.name}</p>
      </CardContent>
    </Card>
  )
}