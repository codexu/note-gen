'use client';

import { useState, useRef } from 'react';
import {
  Images,
  Upload,
  Trash2,
  Heart,
  Grid,
  List,
  Search,
  SortAsc,
  SortDesc,
  X,
  ZoomIn,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import {
  useGalleryStore,
  type GalleryImage,
  type GallerySortBy,
} from '@/stores/tavern-gallery';

interface GalleryPanelProps {
  characterId?: string;
  characterName?: string;
}

/**
 * 图片卡片组件
 */
function ImageCard({
  image,
  onToggleFavorite,
  onDelete,
  onView,
}: {
  image: GalleryImage;
  onToggleFavorite: () => void;
  onDelete: () => void;
  onView: () => void;
}) {
  return (
    <div className="group relative rounded-lg overflow-hidden border bg-muted/30">
      <div
        className="aspect-square cursor-pointer"
        onClick={onView}
      >
        <img
          src={image.url}
          alt={image.name}
          className="w-full h-full object-cover transition-transform group-hover:scale-105"
        />
      </div>
      
      {/* 悬浮操作栏 */}
      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
        <Button
          size="icon"
          variant="secondary"
          className="h-8 w-8"
          onClick={onView}
        >
          <ZoomIn className="h-4 w-4" />
        </Button>
        <Button
          size="icon"
          variant={image.isFavorite ? 'default' : 'secondary'}
          className="h-8 w-8"
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite();
          }}
        >
          <Heart className={cn('h-4 w-4', image.isFavorite && 'fill-current')} />
        </Button>
        <Button
          size="icon"
          variant="destructive"
          className="h-8 w-8"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      
      {/* 收藏标记 */}
      {image.isFavorite && (
        <div className="absolute top-1 right-1">
          <Heart className="h-4 w-4 text-red-500 fill-red-500" />
        </div>
      )}
      
      {/* 名称 */}
      <div className="p-1.5">
        <p className="text-xs truncate">{image.name}</p>
      </div>
    </div>
  );
}

/**
 * 图片查看器
 */
function ImageViewer({
  image,
  onClose,
}: {
  image: GalleryImage;
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>{image.name}</DialogTitle>
        </DialogHeader>
        <div className="relative">
          <img
            src={image.url}
            alt={image.name}
            className="w-full h-auto max-h-[70vh] object-contain rounded-lg"
          />
        </div>
        {image.description && (
          <p className="text-sm text-muted-foreground">{image.description}</p>
        )}
        {image.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {image.tags.map((tag) => (
              <span
                key={tag}
                className="px-2 py-0.5 bg-muted rounded-full text-xs"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * 画廊面板
 */
export function GalleryPanel({ characterId, characterName }: GalleryPanelProps) {
  const {
    sortBy,
    sortOrder,
    viewMode,
    setSortBy,
    setSortOrder,
    setViewMode,
    addImage,
    removeImage,
    toggleFavorite,
    getSortedImages,
    searchImages,
  } = useGalleryStore();

  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewingImage, setViewingImage] = useState<GalleryImage | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const images = searchQuery
    ? searchImages(searchQuery, characterId)
    : getSortedImages(characterId);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || !characterId) return;

    for (const file of Array.from(files)) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const url = event.target?.result as string;
        const name = file.name.replace(/\.[^/.]+$/, '');
        addImage({
          characterId,
          url,
          name,
          tags: [],
          isFavorite: false,
        });
      };
      reader.readAsDataURL(file);
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DialogTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <Images className="h-4 w-4" />
              </Button>
            </DialogTrigger>
          </TooltipTrigger>
          <TooltipContent>角色画廊</TooltipContent>
        </Tooltip>

        <DialogContent className="max-w-2xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Images className="h-5 w-5" />
              {characterName ? `${characterName} 的画廊` : '角色画廊'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* 工具栏 */}
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="搜索图片..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-8 h-8"
                />
                {searchQuery && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6"
                    onClick={() => setSearchQuery('')}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                )}
              </div>

              <Select value={sortBy} onValueChange={(v) => setSortBy(v as GallerySortBy)}>
                <SelectTrigger className="w-24 h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="date">日期</SelectItem>
                  <SelectItem value="name">名称</SelectItem>
                  <SelectItem value="favorite">收藏</SelectItem>
                </SelectContent>
              </Select>

              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8"
                onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
              >
                {sortOrder === 'asc' ? (
                  <SortAsc className="h-4 w-4" />
                ) : (
                  <SortDesc className="h-4 w-4" />
                )}
              </Button>

              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8"
                onClick={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}
              >
                {viewMode === 'grid' ? (
                  <Grid className="h-4 w-4" />
                ) : (
                  <List className="h-4 w-4" />
                )}
              </Button>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={handleFileUpload}
              />
              <Button
                size="sm"
                variant="outline"
                className="h-8"
                onClick={() => fileInputRef.current?.click()}
                disabled={!characterId}
              >
                <Upload className="h-4 w-4 mr-1" />
                上传
              </Button>
            </div>

            {/* 图片网格 */}
            <ScrollArea className="h-[400px]">
              {images.length > 0 ? (
                <div
                  className={cn(
                    'gap-3 p-1',
                    viewMode === 'grid'
                      ? 'grid grid-cols-3 sm:grid-cols-4'
                      : 'flex flex-col'
                  )}
                >
                  {images.map((image) => (
                    <ImageCard
                      key={image.id}
                      image={image}
                      onToggleFavorite={() => toggleFavorite(image.id)}
                      onDelete={() => removeImage(image.id)}
                      onView={() => setViewingImage(image)}
                    />
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                  <Images className="h-12 w-12 mb-2 opacity-50" />
                  <p className="text-sm">
                    {characterId ? '暂无图片，点击上传添加' : '请先选择角色'}
                  </p>
                </div>
              )}
            </ScrollArea>

            {/* 统计 */}
            <div className="text-xs text-muted-foreground text-center">
              共 {images.length} 张图片
              {images.filter((i) => i.isFavorite).length > 0 &&
                ` · ${images.filter((i) => i.isFavorite).length} 个收藏`}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* 图片查看器 */}
      {viewingImage && (
        <ImageViewer
          image={viewingImage}
          onClose={() => setViewingImage(null)}
        />
      )}
    </>
  );
}
