import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const skeletonVariants = cva(
  "animate-pulse rounded-md bg-muted",
  {
    variants: {
      variant: {
        default: "",
        text: "rounded-sm bg-muted/70",
        image: "aspect-video rounded-lg",
        avatar: "rounded-full aspect-square",
        card: "rounded-lg",
      },
      size: {
        default: "h-4",
        sm: "h-3",
        lg: "h-6",
        xl: "h-8",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface SkeletonProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof skeletonVariants> {
  lines?: number
}

const Skeleton = React.forwardRef<HTMLDivElement, SkeletonProps>(
  ({ className, variant, size, lines, ...props }, ref) => {
    // Multi-line text skeleton
    if (lines && lines > 1) {
      return (
        <div className="space-y-2" role="status" aria-label="Loading content...">
          {Array.from({ length: lines }).map((_, index) => (
            <div
              key={index}
              className={cn(
                skeletonVariants({ variant: "text", size }),
                index === lines - 1 && "w-3/4", // Last line shorter
                className
              )}
            />
          ))}
        </div>
      )
    }

    return (
      <div
        className={cn(skeletonVariants({ variant, size }), className)}
        ref={ref}
        role="status"
        aria-label="Loading..."
        {...props}
      />
    )
  }
)
Skeleton.displayName = "Skeleton"

export { Skeleton, skeletonVariants }
