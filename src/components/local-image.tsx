'use client'
import React, { useState, useRef, useEffect } from 'react'
import Image from 'next/image'
import { convertImage } from '@/lib/utils'

interface LocalImageProps {
  src: string
  localSrc?: string
  alt: string
  width?: number
  height?: number
  className?: string
}

export function LocalImage({ 
  src, 
  localSrc, 
  alt, 
  width, 
  height, 
  className 
}: LocalImageProps) {
  const [imageSrc, setImageSrc] = useState(src)
  const [loading, setLoading] = useState(true)
  
  // If localSrc exists
  useEffect(() => {
    if (localSrc) {
      setImageSrc(localSrc)
    }
  }, [localSrc])

  const handleImageError = () => {
    setImageSrc(src)
    setLoading(false)
  }

  const handleImageLoad = () => {
    setLoading(false)
  }

  return (
    <div className={`relative ${className || ''}`}>
      {loading && (
        <div className="absolute inset-0 bg-gray-200 animate-pulse rounded" />
      )}
      <Image
        src={imageSrc}
        alt={alt}
        width={width || 500}
        height={height || 300}
        onError={handleImageError}
        onLoad={handleImageLoad}
        className={`transition-opacity duration-300 ${loading ? 'opacity-0' : 'opacity-100'}`}
      />
    </div>
  )
}
