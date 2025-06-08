'use client'

import { Skeleton } from "@/components/ui/skeleton"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export default function SkeletonTestPage() {
  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold">🎨 Enhanced Skeleton Component Test</h1>
          <p className="text-muted-foreground">
            Testing the improved skeleton variants with sizes, multi-line text, and accessibility
          </p>
        </div>

        {/* Size Variants */}
        <Card>
          <CardHeader>
            <CardTitle>Size Variants</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <p className="text-sm font-medium">Small (sm)</p>
                <Skeleton size="sm" className="w-full" />
              </div>
              <div className="space-y-2">
                <p className="text-sm font-medium">Default</p>
                <Skeleton size="default" className="w-full" />
              </div>
              <div className="space-y-2">
                <p className="text-sm font-medium">Large (lg)</p>
                <Skeleton size="lg" className="w-full" />
              </div>
              <div className="space-y-2">
                <p className="text-sm font-medium">Extra Large (xl)</p>
                <Skeleton size="xl" className="w-full" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Variant Types */}
        <Card>
          <CardHeader>
            <CardTitle>Variant Types</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-3">
              <h4 className="text-sm font-medium">Text (Multi-line)</h4>
              <Skeleton variant="text" lines={3} />
            </div>
            
            <div className="grid grid-cols-3 gap-6">
              <div className="space-y-3">
                <h4 className="text-sm font-medium">Avatar</h4>
                <Skeleton variant="avatar" className="w-16 h-16 mx-auto" />
              </div>
              
              <div className="space-y-3">
                <h4 className="text-sm font-medium">Image</h4>
                <Skeleton variant="image" className="w-full h-24" />
              </div>
              
              <div className="space-y-3">
                <h4 className="text-sm font-medium">Card</h4>
                <Skeleton variant="card" className="w-full h-20" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Real-world Examples */}
        <Card>
          <CardHeader>
            <CardTitle>Real-world Loading Examples</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Article loading */}
            <div className="space-y-4">
              <h4 className="text-sm font-medium">Loading Article</h4>
              <div className="flex items-center space-x-3">
                <Skeleton variant="avatar" className="w-10 h-10" />
                <div className="space-y-2 flex-1">
                  <Skeleton variant="text" className="h-4 w-1/4" />
                  <Skeleton variant="text" className="h-3 w-1/6" />
                </div>
              </div>
              <Skeleton variant="image" className="w-full h-48" />
              <Skeleton variant="text" lines={4} />
            </div>

            {/* Chat loading */}
            <div className="space-y-4">
              <h4 className="text-sm font-medium">Loading Chat Messages</h4>
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex items-start space-x-3">
                    <Skeleton variant="avatar" className="w-8 h-8" />
                    <div className="space-y-2 flex-1">
                      <Skeleton variant="text" lines={2} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* List loading */}
            <div className="space-y-4">
              <h4 className="text-sm font-medium">Loading File List</h4>
              <div className="space-y-2">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="flex items-center space-x-3 p-2 border rounded">
                    <Skeleton className="w-6 h-6" />
                    <Skeleton variant="text" className="flex-1" />
                    <Skeleton className="w-16 h-4" />
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Backward Compatibility */}
        <Card>
          <CardHeader>
            <CardTitle>✅ Backward Compatibility</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Old usage patterns still work perfectly:
            </p>
            <div className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          </CardContent>
        </Card>

        {/* Navigation */}
        <Card>
          <CardHeader>
            <CardTitle>🔄 Test Navigation</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Navigate back to{" "}
              <a href="/" className="text-blue-500 hover:underline">
                main app
              </a>{" "}
              to see your skeletons in the real sidebar and loading states!
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
} 