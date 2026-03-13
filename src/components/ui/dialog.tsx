import { Card, CardContent } from "./card";

interface DialogProps {
  isOpen: boolean;
  children: React.ReactNode;
}

/**
 * Reusable modal dialog wrapper component
 * Provides consistent overlay backdrop and card styling
 */
export function Dialog({ isOpen, children }: DialogProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <Card className="w-full max-w-md shadowed">
        <CardContent className="pt-6">
          {children}
        </CardContent>
      </Card>
    </div>
  );
}
