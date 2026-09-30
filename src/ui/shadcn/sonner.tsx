"use client"

import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { Toaster as Sonner, type ToasterProps } from "sonner"

/* The app has no next-themes provider: it themes with [data-theme="dark"] on
   <html> (see src/index.css). Reading that attribute directly keeps the
   toaster in step with the app's own theme instead of a provider that does
   not exist. */
function useAppTheme(): ToasterProps["theme"] {
  return (document.documentElement.dataset.theme === "dark" ? "dark" : "light")
}

/* The prototype's #toasts (qnipay-workforce-v15.html:627-640, 1566-1567):
   bottom centre, 20px up, at most 520px wide; on a phone it clears the
   bottom bar and the home indicator under it, 12px in from each edge. The
   toasts themselves are drawn by src/ui/toast.tsx. */
const Toaster = ({ ...props }: ToasterProps) => {
  const theme = useAppTheme()

  return (
    <Sonner
      theme={theme}
      position="bottom-center"
      offset={{ bottom: 20 }}
      mobileOffset={{ bottom: "calc(72px + env(safe-area-inset-bottom, 0px))", left: 12, right: 12 }}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--width": "min(520px, calc(100vw - 24px))",
          "--normal-bg": "var(--qp-color-surface-inverse)",
          "--normal-text": "var(--qp-color-text-on-inverse)",
          "--normal-border": "transparent",
          "--border-radius": "var(--qp-radius-control)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
