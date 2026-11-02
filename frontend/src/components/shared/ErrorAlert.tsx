import { CircleAlert } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

export function ErrorAlert({ message, className }: { message: string | null; className?: string }) {
  if (!message) return null;
  return (
    <Alert variant="destructive" className={cn("mb-4", className)}>
      <CircleAlert />
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}
