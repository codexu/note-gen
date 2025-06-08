'use client'

import { Skeleton } from "@/components/ui/skeleton"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export function SkeletonTest() {
  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold">🎨 Enhanced Skeleton Test</h1>
      
      {/* Size Variants */}
      <Card>
        <CardHeader>
          <CardTitle>Size Variants</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-4">
            <span className="w-16 text-sm">sm:</span>
            <Skeleton size="sm" className="w-32" />
          </div>
          <div className="flex items-center gap-4">
            <span className="w-16 text-sm">default:</span>
            <Skeleton size="default" className="w-32" />
          </div>
          <div className="flex items-center gap-4">
            <span className="w-16 text-sm">lg:</span>
            <Skeleton size="lg" className="w-32" />
          </div>
          <div className="flex items-center gap-4">
            <span className="w-16 text-sm">xl:</span>
            <Skeleton size="xl" className="w-32" />
          </div>
        </CardContent>
      </Card>

      {/* Variant Types */}
      <Card>
        <CardHeader>
          <CardTitle>Variant Types</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <h4 className="text-sm font-medium mb-2">Text (Multi-line)</h4>
            <Skeleton variant="text" lines={3} />
          </div>
          
          <div>
            <h4 className="text-sm font-medium mb-2">Avatar</h4>
            <Skeleton variant="avatar" className="w-12 h-12" />
          </div>
          
          <div>
            <h4 className="text-sm font-medium mb-2">Image</h4>
            <Skeleton variant="image" className="w-full h-32" />
          </div>
          
          <div>
            <h4 className="text-sm font-medium mb-2">Card</h4>
            <Skeleton variant="card" className="w-full h-24" />
          </div>
        </CardContent>
      </Card>

      {/* Real-world Example */}
      <Card>
        <CardHeader>
          <CardTitle>Real-world Example: Loading Article</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center space-x-3">
            <Skeleton variant="avatar" className="w-10 h-10" />
            <div className="space-y-2 flex-1">
              <Skeleton variant="text" className="h-4 w-1/4" />
              <Skeleton variant="text" className="h-3 w-1/6" />
            </div>
          </div>
          <Skeleton variant="image" className="w-full h-48" />
          <Skeleton variant="text" lines={4} />
        </CardContent>
      </Card>

      {/* Backward Compatibility */}
      <Card>
        <CardHeader>
          <CardTitle>✅ Backward Compatibility</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-3">
            Old usage still works perfectly:
          </p>
          <Skeleton className="h-4 w-48" />
        </CardContent>
      </Card>
    </div>
  )
} 