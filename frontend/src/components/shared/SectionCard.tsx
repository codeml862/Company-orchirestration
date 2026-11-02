import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * The standard content panel: a card with an optional titled header and actions.
 * `flush` removes the body padding so tables and lists reach the card edges.
 */
export function SectionCard({
  title,
  description,
  actions,
  children,
  className,
  flush = false,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  flush?: boolean;
}) {
  return (
    <Card className={cn("gap-0 py-0", className)}>
      {(title || actions) && (
        <CardHeader className="items-center border-b px-5 py-3.5 [.border-b]:pb-3.5">
          <CardTitle className="text-sm">{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
          {actions && <CardAction className="self-center">{actions}</CardAction>}
        </CardHeader>
      )}
      <CardContent className={cn(flush ? "px-0" : "p-5")}>{children}</CardContent>
    </Card>
  );
}
