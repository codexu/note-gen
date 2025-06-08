'use client'

import ErrorBoundary from '@/components/error-boundary'
import AppStatus from '@/components/app-status'
import { LanguageSwitch } from '@/components/language-switch'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { CheckCircle, Globe, Database, MessageSquare } from 'lucide-react'

// Test component that throws an error
function ErrorComponent() {
  throw new Error('This is a test error to demonstrate the English error boundary')
}

export default function TranslationTestPage() {
  const translatedComponents = [
    {
      name: 'Database Module',
      file: 'src/db/index.ts',
      status: 'completed',
      description: 'All Chinese comments and console messages translated to English'
    },
    {
      name: 'Vector Store',
      file: 'src/stores/vector.ts', 
      status: 'completed',
      description: 'User-facing messages, comments, and function documentation translated'
    },
    {
      name: 'Error Boundary',
      file: 'src/components/error-boundary.tsx',
      status: 'completed', 
      description: 'Error messages and UI text converted to English'
    },
    {
      name: 'App Status',
      file: 'src/components/app-status.tsx',
      status: 'completed',
      description: 'Status messages and comments translated'
    },
    {
      name: 'Language Switch',
      file: 'src/components/language-switch.tsx',
      status: 'completed',
      description: 'Language labels changed from Chinese characters to English words'
    },
    {
      name: 'Global Error',
      file: 'src/app/global-error.tsx',
      status: 'completed',
      description: 'System error messages and UI text translated'
    }
  ]

  return (
    <div className="container mx-auto p-6 space-y-8">
      <div className="text-center space-y-4">
        <h1 className="text-3xl font-bold">NoteGen English Translation Progress</h1>
        <p className="text-muted-foreground">
          Successfully translated core components from Chinese to English
        </p>
        <div className="flex items-center justify-center gap-4">
          <Badge variant="outline" className="flex items-center gap-2">
            <Globe className="h-4 w-4" />
            Internationalization Ready
          </Badge>
          <Badge variant="outline" className="flex items-center gap-2">
            <Database className="h-4 w-4" />
            Browser Compatible
          </Badge>
        </div>
      </div>

      {/* Component Showcase */}
      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5" />
              Translated Components Demo
            </CardTitle>
            <CardDescription>
              Live examples of translated components working in English
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Language Switch Demo */}
            <div className="flex items-center justify-between p-4 border rounded-lg">
              <div>
                <h3 className="font-medium">Language Switch Component</h3>
                <p className="text-sm text-muted-foreground">
                  Now displays "Chinese" and "Japanese" instead of "中文" and "日本語"
                </p>
              </div>
              <LanguageSwitch />
            </div>

            {/* App Status Demo */}
            <div className="flex items-center justify-between p-4 border rounded-lg">
              <div>
                <h3 className="font-medium">App Status Component</h3>
                <p className="text-sm text-muted-foreground">
                  Connection status with English messages
                </p>
              </div>
              <AppStatus />
            </div>

            {/* Error Boundary Demo */}
            <div className="p-4 border rounded-lg">
              <div className="mb-4">
                <h3 className="font-medium">Error Boundary Component</h3>
                <p className="text-sm text-muted-foreground">
                  Error messages now display in English. Click the button to trigger a test error.
                </p>
              </div>
              <ErrorBoundary>
                <Button 
                  variant="destructive" 
                  onClick={() => {
                    // This will trigger the error boundary
                    throw new Error('Test error to demonstrate English error messages')
                  }}
                >
                  Trigger Test Error
                </Button>
              </ErrorBoundary>
            </div>
          </CardContent>
        </Card>

        {/* Translation Progress */}
        <Card>
          <CardHeader>
            <CardTitle>Translation Progress</CardTitle>
            <CardDescription>
              Components and files that have been translated to English
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {translatedComponents.map((component, index) => (
                <div key={index} className="flex items-start gap-3 p-3 border rounded-lg">
                  <CheckCircle className="h-5 w-5 text-green-500 mt-0.5" />
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="font-medium">{component.name}</h4>
                      <Badge variant="secondary" className="text-xs">
                        {component.status}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground mb-1">
                      {component.description}
                    </p>
                    <code className="text-xs bg-muted px-2 py-1 rounded">
                      {component.file}
                    </code>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Next Steps */}
        <Card>
          <CardHeader>
            <CardTitle>Next Translation Targets</CardTitle>
            <CardDescription>
              Additional files that could benefit from English translation
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 bg-orange-500 rounded-full"></span>
                <code>src/lib/rag.ts</code> - RAG functionality console messages
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 bg-orange-500 rounded-full"></span>
                <code>src/lib/ai.ts</code> - AI module error messages
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 bg-orange-500 rounded-full"></span>
                <code>src/stores/article.ts</code> - Article store logging
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 bg-orange-500 rounded-full"></span>
                <code>src/app/core/</code> - Core application components
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="text-center text-sm text-muted-foreground">
        <p>
          🌍 Making NoteGen more accessible to international developers and users
        </p>
      </div>
    </div>
  )
} 