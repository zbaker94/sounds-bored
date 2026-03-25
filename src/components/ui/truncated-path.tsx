import { truncatePath } from "@/lib/utils";

interface TruncatedPathProps {
  path: string | undefined;
  maxLength?: number;
  className?: string;
}

/**
 * Renders a file path with a middle ellipsis when it exceeds maxLength,
 * preserving the filename and a leading prefix.
 * The full path is always visible in the title tooltip on hover.
 * Renders nothing when path is undefined.
 */
export function TruncatedPath({ path, maxLength = 40, className }: TruncatedPathProps) {
  if (!path) return null;
  return (
    <span className={className} title={path}>
      {truncatePath(path, maxLength)}
    </span>
  );
}
