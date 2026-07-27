import { Card,CardContent,CardHeader,CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { LucideIcon } from "lucide-react";

interface SectionCardProps {
  title: string;
  icon?: LucideIcon;
  children: React.ReactNode;
  className?: string;
  headerAction?: React.ReactNode;
  headerClassName?: string;
}

export function SectionCard({ title, icon: Icon, children, className, headerAction, headerClassName }: SectionCardProps) {
  return (
    <Card className={cn("border border-gray-200 dark:border-gray-700 shadow-sm hover:shadow-md transition-shadow duration-200 overflow-hidden", className)}>
      <CardHeader className={cn("pb-3 pt-4", headerClassName)}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {Icon && (
              <div className="p-2 rounded-lg bg-primary/10">
                <Icon className="h-4 w-4 text-primary" />
              </div>
            )}
            <CardTitle className="text-base font-semibold">{title}</CardTitle>
          </div>
          {headerAction}
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {children}
      </CardContent>
    </Card>
  );
}
