'use client'

import { Skeleton } from "@/components/ui/skeleton"

export default function SimpleSkeletonTestPage() {
  return (
    <div className="min-h-screen bg-white dark:bg-gray-900 p-8">
      <div className="max-w-4xl mx-auto space-y-12">
        
        {/* Header */}
        <div className="text-center space-y-4">
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white">
            🎨 Enhanced Skeleton Component Test
          </h1>
          <p className="text-lg text-gray-600 dark:text-gray-300">
            Testing your improved skeleton variants, sizes, and features
          </p>
        </div>

        {/* Size Variants */}
        <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-6">
          <h2 className="text-2xl font-semibold mb-6 text-gray-900 dark:text-white">Size Variants</h2>
          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">Small (sm)</h3>
              <Skeleton size="sm" className="w-full" />
            </div>
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">Default</h3>
              <Skeleton size="default" className="w-full" />
            </div>
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">Large (lg)</h3>
              <Skeleton size="lg" className="w-full" />
            </div>
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">Extra Large (xl)</h3>
              <Skeleton size="xl" className="w-full" />
            </div>
          </div>
        </div>

        {/* Variant Types */}
        <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-6">
          <h2 className="text-2xl font-semibold mb-6 text-gray-900 dark:text-white">Variant Types</h2>
          
          <div className="space-y-8">
            {/* Multi-line Text */}
            <div className="space-y-3">
              <h3 className="text-lg font-medium text-gray-700 dark:text-gray-300">Multi-line Text</h3>
              <Skeleton variant="text" lines={3} />
              <p className="text-sm text-gray-500">✨ NEW: lines=&#123;3&#125; prop for paragraph loading</p>
            </div>
            
            <div className="grid grid-cols-3 gap-8">
              {/* Avatar */}
              <div className="space-y-3">
                <h3 className="text-lg font-medium text-gray-700 dark:text-gray-300">Avatar</h3>
                <div className="flex justify-center">
                  <Skeleton variant="avatar" className="w-20 h-20" />
                </div>
                <p className="text-xs text-gray-500 text-center">Circular skeleton</p>
              </div>
              
              {/* Image */}
              <div className="space-y-3">
                <h3 className="text-lg font-medium text-gray-700 dark:text-gray-300">Image</h3>
                <Skeleton variant="image" className="w-full h-24" />
                <p className="text-xs text-gray-500 text-center">Aspect ratio aware</p>
              </div>
              
              {/* Card */}
              <div className="space-y-3">
                <h3 className="text-lg font-medium text-gray-700 dark:text-gray-300">Card</h3>
                <Skeleton variant="card" className="w-full h-20" />
                <p className="text-xs text-gray-500 text-center">Rounded card shape</p>
              </div>
            </div>
          </div>
        </div>

        {/* Real-world Examples */}
        <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-6">
          <h2 className="text-2xl font-semibold mb-6 text-gray-900 dark:text-white">Real-world Loading Examples</h2>
          
          <div className="space-y-8">
            {/* Article Loading */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-gray-700 dark:text-gray-300">Loading Article</h3>
              <div className="bg-white dark:bg-gray-800 p-4 rounded border">
                <div className="flex items-center space-x-3 mb-4">
                  <Skeleton variant="avatar" className="w-10 h-10" />
                  <div className="space-y-2 flex-1">
                    <Skeleton variant="text" className="h-4 w-1/4" />
                    <Skeleton variant="text" className="h-3 w-1/6" />
                  </div>
                </div>
                <Skeleton variant="image" className="w-full h-48 mb-4" />
                <Skeleton variant="text" lines={4} />
              </div>
            </div>

            {/* Chat Messages */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-gray-700 dark:text-gray-300">Loading Chat Messages</h3>
              <div className="bg-white dark:bg-gray-800 p-4 rounded border space-y-4">
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

            {/* File List */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-gray-700 dark:text-gray-300">Loading File List</h3>
              <div className="bg-white dark:bg-gray-800 p-4 rounded border space-y-2">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="flex items-center space-x-3 p-2 border rounded">
                    <Skeleton className="w-6 h-6" />
                    <Skeleton variant="text" className="flex-1" />
                    <Skeleton className="w-16 h-4" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Backward Compatibility */}
        <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-6">
          <h2 className="text-2xl font-semibold mb-4 text-gray-900 dark:text-white">✅ Backward Compatibility</h2>
          <p className="text-gray-600 dark:text-gray-300 mb-4">
            Old skeleton usage patterns still work perfectly:
          </p>
          <div className="bg-white dark:bg-gray-800 p-4 rounded border space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
          <p className="text-sm text-gray-500 mt-2">
            Previous: &lt;Skeleton className="h-4 w-full" /&gt;
          </p>
        </div>

        {/* Feature Summary */}
        <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-6">
          <h2 className="text-2xl font-semibold mb-4 text-gray-900 dark:text-white">🚀 Your Enhancements</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <h3 className="font-medium text-gray-700 dark:text-gray-300">✨ New Features:</h3>
              <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
                <li>• 5 Variants: default, text, avatar, image, card</li>
                <li>• 4 Sizes: sm, default, lg, xl</li>
                <li>• Multi-line text with lines prop</li>
                <li>• Better theme integration</li>
                <li>• Accessibility improvements</li>
              </ul>
            </div>
            <div className="space-y-2">
              <h3 className="font-medium text-gray-700 dark:text-gray-300">🔧 Technical:</h3>
              <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
                <li>• Uses class-variance-authority</li>
                <li>• Design system colors (bg-muted)</li>
                <li>• ARIA labels for screen readers</li>
                <li>• Backwards compatible</li>
                <li>• TypeScript support</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <div className="text-center bg-gray-100 dark:bg-gray-800 rounded-lg p-6">
          <h2 className="text-xl font-semibold mb-2 text-gray-900 dark:text-white">🎉 Great Job!</h2>
          <p className="text-gray-600 dark:text-gray-300 mb-4">
            Your enhanced skeleton component is working perfectly!
          </p>
          <div className="space-y-2">
            <p className="text-sm text-gray-500">
              Try navigating to the main app to see your skeletons in action:
            </p>
            <div className="space-x-4">
              <a 
                href="/core/record" 
                className="inline-block bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 transition-colors"
              >
                View in Main App
              </a>
              <a 
                href="/skeleton-test" 
                className="inline-block bg-gray-500 text-white px-4 py-2 rounded hover:bg-gray-600 transition-colors"
              >
                Full Test Page
              </a>
            </div>
          </div>
        </div>

      </div>
    </div>
  )
} 