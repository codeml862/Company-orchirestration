"use client";

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * A dialog that holds a form: fixed header and footer, scrolling body, never taller than the screen.
 * Pass `onSubmit` to make the whole dialog a form (the footer's submit button then submits it).
 */
export function FormDialog({
  open,
  onOpenChange,
  title,
  description,
  icon,
  footer,
  onSubmit,
  className,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  footer?: React.ReactNode;
  onSubmit?: (e: React.FormEvent) => void;
  className?: string;
  children: React.ReactNode;
}) {
  const Body = onSubmit ? "form" : "div";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn("gap-0 overflow-hidden p-0 sm:max-w-2xl", className)}>
        <Body
          onSubmit={onSubmit}
          noValidate={onSubmit ? true : undefined}
          className="flex max-h-[calc(100svh-4rem)] flex-col"
        >
          <DialogHeader className="shrink-0 border-b px-6 py-4">
            <DialogTitle className="flex items-center gap-2 text-base">
              {icon && (
                <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary [&_svg]:size-4">
                  {icon}
                </span>
              )}
              {title}
            </DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          <div className="grid gap-6 overflow-y-auto px-6 py-5">{children}</div>
          {footer && <DialogFooter className="mx-0 mb-0 shrink-0 border-t px-6 py-3">{footer}</DialogFooter>}
        </Body>
      </DialogContent>
    </Dialog>
  );
}

export function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-3">
      <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</h3>
      {children}
    </section>
  );
}

export function FieldError({ children }: { children?: React.ReactNode }) {
  return children ? <p className="text-xs text-destructive">{children}</p> : null;
}

/** Lower-case key from a name, matching what the API derives: "Legal Coordinator" -> "legal_coordinator". */
export function slugify(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);
}
